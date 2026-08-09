/**
 * capture-run-resolve.ts — dernier maillon pour une lane : après l'apply d'un Job
 * de capture (k8s-capture-run.ts), RÉSOUT le(s) run_id concret(s) et VÉRIFIE que
 * le dépôt S3 a bien eu lieu (octets + manifeste + CAS), SANS connaître le POD_UID.
 *
 * Le launcher émet un descripteur déterministe `s3_manifest_prefix =
 * capture/_runs/<lane>-<stamp>-`. Ce script liste ce préfixe sur S3, résout les
 * run_id via `runIdsFromManifestKeys`, puis confirme pour chaque run les 3 objets
 * (manifest.jsonl / run.json / run.log) et compte les lignes portant des octets.
 * Pour la preuve v2 profonde (re-hash CAS + garde de serving), enchaîner
 * `_capture-e2e-probe.ts --run <run_id>`.
 *
 * LECTURE SEULE. N'écrit rien.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/capture-run-resolve.ts --lane zones --run-stamp 20260802T170000Z
 */
import { pathToFileURL } from "node:url";

import {
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { captureRetrievalPrefix } from "./lib/capture-image-pin.js";
import { runIdsFromManifestKeys } from "./_capture-e2e-probe.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface ResolvedRun {
  run_id: string;
  manifest: boolean;
  run_json: boolean;
  run_log: boolean;
  manifest_lines: number;
  lines_with_bytes: number;
}

export async function resolveCaptureRuns(lane: string, runStamp: string): Promise<{
  prefix: string;
  run_ids: string[];
  runs: ResolvedRun[];
}> {
  const prefix = captureRetrievalPrefix(lane, runStamp);
  const s3 = s3Client();
  const keys = (await listObjectEntries(s3, prefix)).map((entry) => entry.key);
  const runIds = runIdsFromManifestKeys(keys, `${lane}-${runStamp}-`);
  const keySet = new Set(keys);
  const runs: ResolvedRun[] = [];
  for (const runId of runIds) {
    const runKeys = captureRunKeys(runId);
    const manifestPresent = keySet.has(runKeys.manifest);
    const lines = manifestPresent
      ? parseManifestJsonl((await getBytes(s3, runKeys.manifest)).toString("utf8"))
      : [];
    runs.push({
      run_id: runId,
      manifest: manifestPresent,
      run_json: keySet.has(runKeys.header),
      run_log: keySet.has(runKeys.log),
      manifest_lines: lines.length,
      lines_with_bytes: lines.filter((l) => l.sha256 !== null && l.storage_key !== null).length,
    });
  }
  return { prefix, run_ids: runIds, runs };
}

async function main(): Promise<void> {
  const lane = arg("lane");
  const runStamp = arg("run-stamp");
  if (!lane || !runStamp) {
    console.error("usage: --lane <lane> --run-stamp <YYYYMMDDTHHMMSSZ>");
    process.exit(2);
  }
  const result = await resolveCaptureRuns(lane, runStamp);
  console.log(JSON.stringify({
    ...result,
    hint: "preuve v2 profonde par run: npx tsx acquisition/src/_capture-e2e-probe.ts --run <run_id>",
  }, null, 2));
  if (result.run_ids.length === 0) {
    console.error(`[resolve] aucun run sous ${result.prefix} — capture pas encore deposee, stamp errone, ou Job pas fini`);
    process.exit(1);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
