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
import { createHash } from "node:crypto";

import {
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { exists, getBytes, s3Client } from "./lib/s3.js";
import {
  assertGeometryProof,
  proofFromCaptureEntry,
  type GeometrySourceType,
} from "./lib/zonage-proof.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const runId = arg("run");
  if (!runId) { console.error("usage: --run <run-id> [--type wfs|arcgis|agol|geonet|jmap|geojson-officiel]"); process.exit(2); }
  const type = (arg("type") ?? "wfs") as GeometrySourceType;
  const s3 = s3Client();
  const keys = captureRunKeys(runId);

  console.error(`[e2e] run=${runId}`);
  console.error(`[e2e] manifest=s3://${keys.manifest}`);
  const rawManifest = (await getBytes(s3, keys.manifest)).toString("utf8");
  const lines = parseManifestJsonl(rawManifest);
  console.error(`[e2e] ${lines.length} ligne(s) de manifeste relue(s) depuis S3`);
  if (process.argv.includes("--raw")) {
    for (const l of rawManifest.split("\n").filter(Boolean)) console.log(l);
  }
  // L'en-tête de run et le log doivent exister (SPEC §2.2 : 3 objets par run).
  for (const [label, key] of [["run.json", keys.header], ["run.log", keys.log]] as const) {
    console.error(`[e2e] ${(await exists(s3, key)) ? "✓" : "✗"} ${label} s3://${key}`);
  }

  let proven = 0;
  let failed = 0;
  for (const line of lines) {
    console.error(
      `\n[e2e] ${line.method} ${line.url}\n` +
      `      http_status=${String(line.http_status)} bytes=${String(line.bytes)} dedup=${String(line.dedup)} error=${String(line.error)}`,
    );
    if (line.sha256 === null || line.storage_key === null) {
      console.error(`      → PAS d'octets : aucune preuve v2 dérivable (ligne d'échec, conservée à dessein)`);
      continue;
    }
    // 1+2. l'objet CAS existe et ses octets hashent bien vers la clé annoncée.
    if (!(await exists(s3, line.storage_key))) {
      console.error(`      ✗ objet CAS ABSENT: s3://${line.storage_key}`);
      failed++;
      continue;
    }
    const bytes = await getBytes(s3, line.storage_key);
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== line.sha256) {
      console.error(`      ✗ CAS MENSONGER: annoncé ${line.sha256}, relu ${actual}`);
      failed++;
      continue;
    }
    console.error(`      ✓ CAS s3://${line.storage_key} (${bytes.length} octets, sha vérifié)`);
    const peek = Number(arg("peek") ?? 0);
    if (peek > 0) console.error(`      … ${bytes.toString("utf8").slice(0, peek)}`);

    // 3. le RawDocumentRecord sibling.
    const metaKey = `${line.storage_key}.meta.json`;
    if (await exists(s3, metaKey)) {
      const meta = JSON.parse((await getBytes(s3, metaKey)).toString("utf8")) as {
        sourceUrl?: string; sha256?: string; fetchedAt?: string;
      };
      const okMeta = meta.sha256 === line.sha256.slice("sha256:".length) && meta.fetchedAt === line.retrieved_at;
      console.error(`      ${okMeta ? "✓" : "✗"} meta s3://${metaKey} sourceUrl=${String(meta.sourceUrl)}`);
      if (!okMeta) failed++;
    } else {
      console.error(`      ✗ meta ABSENT: s3://${metaKey}`);
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
      console.error(`      ✓ PREUVE v2 VALIDE`);
      console.error(`          url          = ${proof.url}`);
      console.error(`          retrieved_at = ${proof.retrieved_at}`);
      console.error(`          sha256       = ${proof.sha256}`);
      console.error(`          type/method/reliability = ${proof.type}/${proof.method}/${proof.reliability}`);
      proven++;
    } catch (e) {
      console.error(`      ✗ conversion refusée: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.error(`\n=== E2E ${failed === 0 ? "OK" : "ÉCHEC"} === preuves v2 valides: ${proven}/${lines.length} lignes, anomalies: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
