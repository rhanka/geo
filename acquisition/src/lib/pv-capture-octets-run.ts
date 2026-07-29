import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { QC_MUNICIPALITIES } from "../../../packages/qc-sources/src/municipalities.js";
import {
  CaptureRunHeaderSchema,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../../packages/qc-sources/src/capture/index.js";
import { extractNativeDocumentText } from "./density-document-review.js";
import {
  PV_CAPTURE_OCTET_CLASSES,
  classifyReadablePvText,
  isPdf,
  startsLikeHtml,
  type PvCaptureOctetClass,
} from "./pv-capture-octets-classification.js";
import { getBytes, listObjectEntries, s3Client } from "./s3.js";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const READ_CONCURRENCY = 2;

interface ClassifiedPvLine {
  readonly manifest_key: string;
  readonly line_index: number;
  readonly run_id: string;
  readonly slug: string;
  readonly municipality_name: string | null;
  readonly url: string;
  readonly http_status: number | null;
  readonly storage_key: string | null;
  readonly classification: PvCaptureOctetClass;
  readonly detail: string;
  readonly owner_verbatim: string | null;
  readonly pv_verbatim: string | null;
}

interface PvReport {
  readonly contract: "pv-capture-octets-classification/v1";
  readonly generated_at: string;
  readonly complete: true;
  readonly scope: { readonly bucket: "sentropic-geo"; readonly lane: "pv"; readonly run_prefix: string; readonly source: "pv-index" };
  readonly progress: { readonly manifests: number; readonly attempts: number; readonly classified: number; readonly read_concurrency: number };
  readonly summary: Record<PvCaptureOctetClass | "partition_total" | "partition_matches_attempts" | "pv_probable_confirmed_rate_percent", number | boolean>;
  readonly lines: readonly ClassifiedPvLine[];
}

function value(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return resolved;
}

function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) throw new Error(`refus d'écraser le rapport: ${relative(ROOT, path)}`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, body);
  renameSync(temporary, path);
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
  return output;
}

function municipalityName(slug: string): string | null {
  return QC_MUNICIPALITIES.find((municipality) => municipality.slug === slug)?.name ?? null;
}

function sourceLines(lines: readonly CaptureManifestLine[]): Array<{ line: CaptureManifestLine; lineIndex: number }> {
  return lines.flatMap((line, lineIndex) => line.source === "pv-index" ? [{ line, lineIndex }] : []);
}

async function classify(
  manifestKey: string,
  lineIndex: number,
  line: CaptureManifestLine,
): Promise<ClassifiedPvLine> {
  const slug = line.slugs.length === 1 ? line.slugs[0]! : "";
  const municipality = slug ? municipalityName(slug) : null;
  const base = {
    manifest_key: manifestKey,
    line_index: lineIndex,
    run_id: line.run_id,
    slug,
    municipality_name: municipality,
    url: line.url,
    http_status: line.http_status,
    storage_key: line.storage_key,
    owner_verbatim: null,
    pv_verbatim: null,
  };
  if (line.http_status === 404) return { ...base, classification: "HTTP_404", detail: "HTTP 404" };
  if (line.http_status === 403) return { ...base, classification: "HTTP_403", detail: "HTTP 403 malgré User-Agent navigateur" };
  if (line.http_status === null || line.http_status < 200 || line.http_status >= 300) {
    return { ...base, classification: "HTTP_AUTRE", detail: line.error ?? `HTTP ${String(line.http_status)}` };
  }
  if (line.storage_key === null) return { ...base, classification: "CAPTURE_SANS_OCTETS", detail: line.error ?? "2xx sans CAS durable" };
  const bytes = await getBytes(s3Client(), line.storage_key);
  if (startsLikeHtml(bytes)) return { ...base, classification: "PAGE_HTML", detail: "octets HTML lus" };
  const native = extractNativeDocumentText(bytes, { sourceName: line.final_url ?? line.url });
  if (native.text === null) {
    if (isPdf(bytes) && native.blocker === "pdf-without-native-text-layer") {
      return { ...base, classification: "PDF_SANS_COUCHE_TEXTE", detail: native.blocker };
    }
    return {
      ...base,
      classification: native.blocker?.startsWith("pdftotext-exit-") ? "ERREUR_EXTRACTION" : "AUTRE",
      detail: native.blocker ?? "document sans texte natif",
    };
  }
  if (municipality === null) return { ...base, classification: "AUTRE", detail: "slug municipal inconnu; propriétaire non attribuable" };
  const readable = classifyReadablePvText(native.text, municipality);
  return {
    ...base,
    classification: readable.classification,
    detail: native.extractor ?? "extracteur texte inconnu",
    owner_verbatim: readable.owner_verbatim,
    pv_verbatim: readable.pv_verbatim,
  };
}

function report(runPrefix: string, manifests: number, lines: readonly ClassifiedPvLine[]): PvReport {
  const summary: PvReport["summary"] = Object.fromEntries(PV_CAPTURE_OCTET_CLASSES.map((classification) => [classification, 0])) as PvReport["summary"];
  for (const line of lines) summary[line.classification] = Number(summary[line.classification]) + 1;
  const attempts = lines.length;
  const confirmed = Number(summary.PV_LISIBLE_PROPRIETAIRE_CONFIRME);
  summary.partition_total = attempts;
  summary.partition_matches_attempts = summary.partition_total === attempts;
  summary.pv_probable_confirmed_rate_percent = attempts === 0 ? 0 : Number(((confirmed / attempts) * 100).toFixed(2));
  return {
    contract: "pv-capture-octets-classification/v1",
    generated_at: new Date().toISOString(),
    complete: true,
    scope: { bucket: "sentropic-geo", lane: "pv", run_prefix: `capture/_runs/${runPrefix}`, source: "pv-index" },
    progress: { manifests, attempts, classified: lines.length, read_concurrency: READ_CONCURRENCY },
    summary,
    lines,
  };
}

/** Read-only PV mode invoked by `capture-octets-classification.ts --lane=pv`. */
export async function runPvCaptureOctetsClassification(argv: readonly string[]): Promise<void> {
  const runPrefix = value(argv, "run-prefix");
  const output = value(argv, "out");
  // Le RUN_ID est fabrique par deploy/capture-job/run-capture-job.sh comme
  // `${LANE}-${RUN_STAMP}-${SHARD}-${POD_ATTEMPT}` avec RUN_STAMP=%Y%m%dT%H%M%SZ:
  // le `T` et le `Z` sont MAJUSCULES par construction. Ce garde en minuscules
  // seules rejetait donc tout run reellement produit par le cluster, et la
  // classification des octets s'arretait sur ses propres captures. Les deux
  // gardes freres (`_capture-e2e-probe.ts`, `served-zonage-proof-url-refetch-verify.ts`)
  // acceptent deja `[A-Za-z0-9-]`.
  if (!runPrefix || !/^pv-[A-Za-z0-9-]+$/.test(runPrefix)) throw new Error("--run-prefix=pv-... est requis");
  if (!output) throw new Error("--out=work/coverage/...json est requis");
  const outPath = insideRepo(output, "out");
  const s3 = s3Client();
  const prefix = `capture/_runs/${runPrefix}`;
  const manifestKeys = (await listObjectEntries(s3, prefix))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/manifest.jsonl"))
    .sort();
  if (manifestKeys.length === 0) throw new Error(`aucun manifeste PV sous ${prefix}`);
  const manifests = await mapConcurrent(manifestKeys, async (manifestKey) => {
    const headerKey = `${manifestKey.slice(0, -"manifest.jsonl".length)}run.json`;
    const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, headerKey)).toString("utf8")));
    if (header.finished_at === null || header.exit_code !== 0) throw new Error(`run PV non terminal ou échoué: ${header.run_id}`);
    return { manifestKey, lines: sourceLines(parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8"))) };
  });
  const candidates = manifests.flatMap(({ manifestKey, lines }) => lines.map(({ line, lineIndex }) => ({ manifestKey, line, lineIndex })));
  const lines = await mapConcurrent(candidates, ({ manifestKey, line, lineIndex }) => classify(manifestKey, lineIndex, line));
  lines.sort((left, right) => left.manifest_key.localeCompare(right.manifest_key) || left.line_index - right.line_index);
  const final = report(runPrefix, manifestKeys.length, lines);
  if (final.summary.partition_matches_attempts !== true) throw new Error("partition PV des octets non fermée");
  writeAtomic(outPath, `${JSON.stringify(final, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    report: relative(ROOT, outPath), attempts: final.progress.attempts,
    confirmed_pv: final.summary.PV_LISIBLE_PROPRIETAIRE_CONFIRME,
    html: final.summary.PAGE_HTML, http_404: final.summary.HTTP_404,
    scans: final.summary.PDF_SANS_COUCHE_TEXTE,
    confirmed_rate_percent: final.summary.pv_probable_confirmed_rate_percent,
  }, null, 2)}\n`);
}
