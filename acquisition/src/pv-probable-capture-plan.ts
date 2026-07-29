/**
 * Materialise une tranche déterministe des `pv_probable` depuis le snapshot
 * d'index qui a produit le rapport de classification observable.
 *
 * Cette commande ne lit QUE les index PV S3 : elle ne télécharge aucun
 * document. Les worklists sont une entrée durable du Job cluster, pas une
 * décision locale cachée.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import {
  firstPvCaptureLotForRange,
  planPvProbableTargets,
  sha256,
  splitPvCaptureTargets,
  stablePvIndexListing,
  type StablePvIndexListing,
  type PvIndexListing,
  type PvIndexSnapshot,
} from "./lib/pv-probable-capture-plan.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PV_INDEX_PREFIX = "registry/qc-pv/";

interface ClassificationReport {
  readonly contract: "pv-observable-classification/v1";
  readonly source_snapshot: { readonly sha256: string; readonly pv_index_listing: readonly (readonly [string, string | null, string | null])[] };
  readonly class_counts: { readonly pv_probable: number };
  readonly no_document_fetch: true;
}

function value(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function required(name: string): string {
  const found = value(name);
  if (!found) throw new Error(`--${name}=... est requis`);
  return found;
}

function integer(name: string, minimum: number): number {
  const raw = required(name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`--${name} doit être un entier >= ${minimum}`);
  return parsed;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return resolved;
}

function slugFromKey(key: string): string {
  const match = /^registry\/qc-pv\/([a-z0-9][a-z0-9-]*)\/index\.json$/.exec(key);
  if (!match) throw new Error(`clé d'index PV invalide: ${key}`);
  return match[1]!;
}

function parseIndex(slug: string, raw: unknown): PvIndexSnapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`index PV invalide pour ${slug}`);
  const index = raw as Record<string, unknown>;
  if (index.slug !== undefined && index.slug !== slug) throw new Error(`index PV ${slug}: slug intégré divergent`);
  return {
    slug,
    index_url: typeof index.pvIndexUrl === "string" && index.pvIndexUrl.trim() ? index.pvIndexUrl.trim() : null,
    entries: Array.isArray(index.entries) ? index.entries : [],
  };
}

function writeImmutable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === body) return;
    throw new Error(`refus d'écraser l'artefact déterministe: ${path}`);
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, body);
  renameSync(temporary, path);
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

interface ReadSnapshot {
  readonly scans: PvIndexSnapshot[];
  readonly listing: StablePvIndexListing;
}

async function readSnapshot(report: ClassificationReport): Promise<ReadSnapshot> {
  const s3 = s3Client();
  const firstListing = (await listObjectEntries(s3, PV_INDEX_PREFIX))
    .filter((entry) => entry.key.endsWith("/index.json"))
    .map((entry) => [entry.key, entry.etag, entry.last_modified] as const) satisfies PvIndexListing;
  const scans = await mapConcurrent(firstListing, 4, async ([key]) =>
    parseIndex(slugFromKey(key), JSON.parse((await getBytes(s3, key)).toString("utf8")) as unknown));
  const finalListing = (await listObjectEntries(s3, PV_INDEX_PREFIX))
    .filter((entry) => entry.key.endsWith("/index.json"))
    .map((entry) => [entry.key, entry.etag, entry.last_modified] as const) satisfies PvIndexListing;
  return { scans, listing: stablePvIndexListing(report.source_snapshot.sha256, firstListing, finalListing) };
}

async function main(): Promise<void> {
  const classificationPath = insideRepo(required("classification"), "classification");
  const outPrefix = insideRepo(required("out-prefix"), "out-prefix");
  const combinedOut = insideRepo(required("combined-out"), "combined-out");
  const outPlan = insideRepo(required("out-plan"), "out-plan");
  const start = integer("start", 0);
  const count = integer("count", 1);
  const lotSize = integer("lot-size", 1);
  if (!outPrefix.endsWith("lot-")) throw new Error("--out-prefix doit finir par lot-");
  const firstLot = firstPvCaptureLotForRange(start, lotSize);
  const report = JSON.parse(readFileSync(classificationPath, "utf8")) as ClassificationReport;
  if (report.contract !== "pv-observable-classification/v1" || report.no_document_fetch !== true) {
    throw new Error("--classification doit être le rapport observable PV complet");
  }
  const snapshot = await readSnapshot(report);
  const targets = planPvProbableTargets(snapshot.scans);
  const selected = targets.slice(start, start + count);
  if (selected.length !== count) throw new Error(`tranche PV insuffisante: ${selected.length}/${count}`);
  const lots = splitPvCaptureTargets(selected, lotSize);
  const combinedBody = `${JSON.stringify(selected, null, 2)}\n`;
  writeImmutable(combinedOut, combinedBody);
  const worklists = lots.map((lot, index) => {
    const lotNumber = firstLot + index;
    const body = `${JSON.stringify(lot, null, 2)}\n`;
    const path = `${outPrefix}${String(lotNumber).padStart(4, "0")}.json`;
    writeImmutable(path, body);
    return { lot: lotNumber, path: path.slice(ROOT.length + 1), targets: lot.length, sha256: sha256(body) };
  });
  const plan = {
    contract: "pv-probable-capture-plan/v1",
    classification: classificationPath.slice(ROOT.length + 1),
    source_snapshot: snapshot.listing.sha256,
    classification_snapshot: report.source_snapshot.sha256,
    classification_recomputed_from_fresh_index: snapshot.listing.classificationWasStale,
    expected_pv_probable: targets.length,
    range: { start, count, end_exclusive: start + count },
    selected_sha256: sha256(`${JSON.stringify(selected)}\n`),
    combined_worklist: { path: combinedOut.slice(ROOT.length + 1), targets: selected.length, sha256: sha256(combinedBody) },
    worklists,
  };
  writeImmutable(outPlan, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ plan: outPlan.slice(ROOT.length + 1), targets: selected.length, lots: lots.length }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
