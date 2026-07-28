/**
 * Relie les réponses Wayback tronquées à 1 MiB à leur longueur CDX capturée.
 *
 * Lecture S3 seulement. Le JSON produit est ensuite exécuté sur le cluster par
 * category-a-wayback-range-run.ts; aucune plage n'est téléchargée localement.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CaptureRunHeaderSchema,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { CATEGORY_A_GISEMENT_TARGETS } from "./category-a-gisements-worklist.js";
import {
  CategoryAWaybackRangeWorklistSchema,
  WAYBACK_RANGE_BYTES,
  cdxLengthIndex,
  waybackArchiveKey,
  waybackSnapshotIdentity,
  type CategoryAWaybackRangeTarget,
} from "./lib/category-a-wayback-range.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) =>
    value === `--${name}` && argv[index + 1] ? [argv[index + 1]!] : []);
}

function option(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function completedLines(prefixes: readonly string[]): Promise<CaptureManifestLine[]> {
  const s3 = s3Client();
  const manifestKeys = new Set<string>();
  for (const prefix of prefixes) {
    for (const entry of await listObjectEntries(s3, `capture/_runs/${prefix}`)) {
      if (entry.key.endsWith("/manifest.jsonl")) manifestKeys.add(entry.key);
    }
  }
  const lines: CaptureManifestLine[] = [];
  for (const manifestKey of [...manifestKeys].sort()) {
    const runId = manifestKey.slice("capture/_runs/".length, -"/manifest.jsonl".length);
    const headerKey = `capture/_runs/${runId}/run.json`;
    const entries = await listObjectEntries(s3, headerKey);
    if (!entries.some((entry) => entry.key === headerKey)) continue;
    const header = CaptureRunHeaderSchema.parse(
      JSON.parse((await getBytes(s3, headerKey)).toString("utf8")),
    );
    if (header.finished_at === null || header.exit_code === null) continue;
    lines.push(...parseManifestJsonl(
      (await getBytes(s3, manifestKey)).toString("utf8"),
    ));
  }
  return lines;
}

async function worklist(prefixes: readonly string[]): Promise<{
  contract: "category-a-wayback-range/v1";
  targets: CategoryAWaybackRangeTarget[];
}> {
  const lines = await completedLines(prefixes);
  const scope = new Set(CATEGORY_A_GISEMENT_TARGETS.map((target) => target.slug));
  const lengthsBySlug = new Map<string, Map<string, number>>();
  const s3 = s3Client();
  for (const line of lines) {
    if (
      line.http_status !== 200
      || line.storage_key === null
      || line.sha256 === null
      || !/web\.archive\.org\/cdx\/search\/cdx/i.test(line.url)
    ) continue;
    const bytes = await getBytes(s3, line.storage_key);
    if (digest(bytes) !== line.sha256) throw new Error(`CAS SHA incohérent: ${line.storage_key}`);
    const index = cdxLengthIndex(JSON.parse(bytes.toString("utf8")));
    for (const slug of line.slugs.filter((value) => scope.has(value))) {
      const aggregate = lengthsBySlug.get(slug) ?? new Map<string, number>();
      for (const [key, length] of index) aggregate.set(key, length);
      lengthsBySlug.set(slug, aggregate);
    }
  }

  const targets = new Map<string, CategoryAWaybackRangeTarget>();
  for (const line of lines) {
    if (
      line.http_status !== 200
      || line.storage_key === null
      || line.sha256 === null
      || line.bytes !== WAYBACK_RANGE_BYTES
    ) continue;
    const identity = waybackSnapshotIdentity(line.final_url ?? line.url);
    if (identity === null) continue;
    const bytes = await getBytes(s3, line.storage_key);
    if (digest(bytes) !== line.sha256) throw new Error(`CAS SHA incohérent: ${line.storage_key}`);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") continue;
    for (const slug of line.slugs.filter((value) => scope.has(value))) {
      const key = waybackArchiveKey(identity.timestamp, identity.originalUrl);
      const target = {
        slug,
        url: line.final_url ?? line.url,
        cdxLength: key === null ? null : lengthsBySlug.get(slug)?.get(key) ?? null,
      };
      targets.set(`${slug}\t${target.url}`, target);
    }
  }
  return CategoryAWaybackRangeWorklistSchema.parse({
    contract: "category-a-wayback-range/v1",
    targets: [...targets.values()].sort((left, right) =>
      left.slug.localeCompare(right.slug) || left.url.localeCompare(right.url)),
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const prefixes = values(argv, "run-prefix");
  if (prefixes.length === 0) throw new Error("au moins un --run-prefix est requis");
  const output = resolve(option(argv, "output")
    ?? "acquisition/config/category-a-wayback-range-20260728.json");
  if (!output.startsWith(`${ROOT}/`)) throw new Error("--output doit rester dans le dépôt");
  const value = await worklist(prefixes);
  // Refus d'écraser : la worklist mesure un ensemble précis de runs terminaux.
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${output.replace(`${ROOT}/`, "")}\t${value.targets.length} snapshot(s)\n`);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
