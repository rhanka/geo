/**
 * _capture-e2e-probe.ts — PREUVE DE BOUT EN BOUT du chokepoint de capture.
 *
 * Relit depuis S3 le manifeste d'un run (`capture/_runs/<run-id>/manifest.jsonl`),
 * puis, pour chaque ligne portant des octets :
 *   1. vérifie que l'objet CAS `raw/<source>/cas/<sha256>.<ext>` EXISTE,
 *   2. le RE-TÉLÉCHARGE et vérifie que ses octets hashent bien vers le sha256
 *      annoncé par la ligne (une clé CAS qui ment est un bug, pas une donnée),
 *   3. vérifie que le `.meta.json` (RawDocumentRecord) est là et concorde,
 *   4. convertit la ligne en `GeometrySourceProof` v2 via `proofFromCaptureEntry`
 *      et la fait passer par `assertGeometryProof` — le MÊME garde que celui
 *      opposé par `putServedZoneGeojson`.
 *
 * N'ÉCRIT RIEN. Lecture seule sur `raw/` et `capture/_runs/`.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_capture-e2e-probe.ts --run zones-20260725T150000Z-0 [--type wfs]
 */
import {
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { fileURLToPath } from "node:url";
import { exists, getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import {
  assertGeometryProof,
  proofFromCaptureEntry,
  type GeometrySourceType,
} from "./lib/zonage-proof.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(k: string): boolean {
  return process.argv.includes(`--${k}`);
}

function runIdsFromManifestKeys(keys: readonly string[], prefix: string): string[] {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^capture/_runs/(${escaped}[A-Za-z0-9-]*)/manifest\\.jsonl$`);
  return keys.flatMap((key) => {
    const match = pattern.exec(key);
    return match ? [match[1]!] : [];
  }).sort();
}

interface E2eSummary {
  runs: number;
  lines: number;
  targetAttempts: number;
  http200: number;
  http404: number;
  http403: number;
  other: number;
  casVerified: number;
  anomalies: number;
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function verifyRun(
  runId: string,
  type: GeometrySourceType,
  quiet: boolean,
): Promise<Omit<E2eSummary, "runs">> {
  const report = (...values: unknown[]) => { if (!quiet) console.error(...values); };
  const s3 = s3Client();
  const keys = captureRunKeys(runId);

  report(`[e2e] run=${runId}`);
  report(`[e2e] manifest=s3://${keys.manifest}`);
  const rawManifest = (await getBytes(s3, keys.manifest)).toString("utf8");
  const lines = parseManifestJsonl(rawManifest);
  report(`[e2e] ${lines.length} ligne(s) de manifeste relue(s) depuis S3`);
  if (process.argv.includes("--raw")) {
    for (const l of rawManifest.split("\n").filter(Boolean)) console.log(l);
  }
  // L'en-tête de run et le log doivent exister (SPEC §2.2 : 3 objets par run).
  let failed = 0;
  for (const [label, key] of [["run.json", keys.header], ["run.log", keys.log]] as const) {
    const present = await exists(s3, key);
    report(`[e2e] ${present ? "✓" : "✗"} ${label} s3://${key}`);
    if (!present) failed++;
  }

  let proven = 0;
  let casVerified = 0;
  let targetAttempts = 0;
  let http200 = 0;
  let http404 = 0;
  let http403 = 0;
  let other = 0;
  for (const [lineIndex, line] of lines.entries()) {
    if (line.source === "zones-v1-proof-url") {
      targetAttempts++;
      if (line.http_status === 200) http200++;
      else if (line.http_status === 404) http404++;
      else if (line.http_status === 403) http403++;
      else other++;
    }
    report(
      `\n[e2e] ${line.method} ${line.url}\n` +
      `      http_status=${String(line.http_status)} bytes=${String(line.bytes)} dedup=${String(line.dedup)} error=${String(line.error)}`,
    );
    if (line.sha256 === null || line.storage_key === null) {
      report(`      → PAS d'octets : aucune preuve v2 dérivable (ligne d'échec, conservée à dessein)`);
      continue;
    }
    // 1. Le reçu doit désigner une clé CAS nommée par son propre SHA. Le
    // `fetchedAt` du sidecar ne fait pas partie de cette identité : il peut
    // provenir du premier fetch d'octets dédupliqués.
    const receipt = captureReceiptFromManifest(line, keys.manifest, lineIndex);
    if (receipt === null) {
      report(`      ✗ clé CAS incompatible avec le SHA annoncé: s3://${line.storage_key}`);
      failed++;
      continue;
    }
    // 2. La clé existe, puis les octets relus sont vérifiés par la règle lib.
    if (!(await exists(s3, line.storage_key))) {
      report(`      ✗ objet CAS ABSENT: s3://${line.storage_key}`);
      failed++;
      continue;
    }
    const bytes = await getBytes(s3, line.storage_key);
    const peek = Number(arg("peek") ?? 0);
    if (peek > 0) report(`      … ${bytes.toString("utf8").slice(0, peek)}`);

    // 3. Le RawDocumentRecord sibling confirme l'identité du CAS. Sa date et
    // son URL peuvent légitimement appartenir au premier fetch dédupliqué.
    const metaKey = `${line.storage_key}.meta.json`;
    if (await exists(s3, metaKey)) {
      const meta = JSON.parse((await getBytes(s3, metaKey)).toString("utf8")) as {
        sourceUrl?: string; sha256?: string; fetchedAt?: string;
      };
      const checked = verifyRawCapturePayload(receipt, bytes, meta);
      report(`      ${checked.verified ? "✓" : "✗"} CAS s3://${line.storage_key} (${bytes.length} octets, sha vérifié)`);
      report(`      ${checked.verified ? "✓" : "✗"} meta s3://${metaKey} sourceUrl=${String(meta.sourceUrl)} fetchedAt=${String(meta.fetchedAt)}`);
      if (!checked.verified) {
        report(`          → ${checked.reason}`);
        failed++;
      } else casVerified++;
    } else {
      report(`      ✗ meta ABSENT: s3://${metaKey}`);
      failed++;
    }

    // 4. la conversion en preuve v2, opposée au MÊME garde que le dépôt servi.
    try {
      const proof = proofFromCaptureEntry(line as CaptureManifestLine, {
        type,
        method: "natif",
        reliability: "directe",
      });
      assertGeometryProof(proof);
      report(`      ✓ PREUVE v2 VALIDE`);
      report(`          url          = ${proof.url}`);
      report(`          retrieved_at = ${proof.retrieved_at}`);
      report(`          sha256       = ${proof.sha256}`);
      report(`          type/method/reliability = ${proof.type}/${proof.method}/${proof.reliability}`);
      proven++;
    } catch (e) {
      report(`      ✗ conversion refusée: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  report(`\n=== E2E ${failed === 0 ? "OK" : "ÉCHEC"} === preuves v2 valides: ${proven}/${lines.length} lignes, anomalies: ${failed}`);
  return { lines: lines.length, targetAttempts, http200, http404, http403, other, casVerified, anomalies: failed };
}

async function main(): Promise<void> {
  const singleRun = arg("run");
  const prefix = arg("run-prefix");
  if (!!singleRun === !!prefix) throw new Error("usage: --run <run-id> | --run-prefix <run-id-prefix> [--type …] [--quiet]");
  const type = (arg("type") ?? "wfs") as GeometrySourceType;
  const quiet = hasFlag("quiet");
  let runs: string[];
  if (singleRun) {
    runs = [singleRun];
  } else {
    const keys = (await listObjectEntries(s3Client(), `capture/_runs/${prefix}`)).map((entry) => entry.key);
    runs = runIdsFromManifestKeys(keys, prefix!);
    if (runs.length === 0) throw new Error(`aucun manifest pour le préfixe ${prefix}`);
  }
  const totals: E2eSummary = { runs: runs.length, lines: 0, targetAttempts: 0, http200: 0, http404: 0, http403: 0, other: 0, casVerified: 0, anomalies: 0 };
  const results = await mapConcurrent(runs, 4, (runId) => verifyRun(runId, type, quiet));
  for (const result of results) {
    for (const key of Object.keys(result) as Array<keyof typeof result>) totals[key] += result[key];
  }
  console.error(`[e2e] runs=${totals.runs} lines=${totals.lines} target_attempts=${totals.targetAttempts} http_200=${totals.http200} http_404=${totals.http404} http_403=${totals.http403} other=${totals.other} cas_verified=${totals.casVerified} anomalies=${totals.anomalies}`);
  if (totals.anomalies > 0) process.exitCode = 1;
}

export { runIdsFromManifestKeys };

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
}
