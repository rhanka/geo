/**
 * _bdzi-flood-zones-acquire-deposit-20260905.ts — POST-CAPTURE acquire → serve the
 * province-wide BDZI flood-zones OVERLAY (`qc-bdzi-flood-zones`) from the attested
 * CAS raw GeoJSON captured cluster→S3 by the §6 gated capture.
 *
 * This is the §9 acquire-delta for BDZI (docs/spec/S9_ACQUIRE_DELTA_CPTAQ.md,
 * transposed): it READS the CAS raw (never re-fetches — CLAUDE.md capture rule),
 * byte-exact verifies it against the capture manifest line, ogr2ogr Douglas–Peucker
 * simplifies at BDZI_SIMPLIFY (0.0005°), confirms EPSG:4326, normalizes through the
 * ratified `bdziNormalizer`, and serves ONE overlay collection on BOTH layouts
 * (flat + nested) carrying proof-v2 (url + retrieved_at + sha256 from the manifest),
 * with a G5 readback.
 *
 * The RULES live in `lib/bdzi-flood-zones-acquire.ts` (unit-tested, no I/O). This
 * runner owns only S3 I/O, the GDAL shell, and the report — mirroring the
 * victoriaville deposit recipe (byte-exact CAS verify + readback-G5) but for a
 * NON-zonage overlay (no zone_code, no per-city Zone node, so `depositCapturedZones`
 * does not apply — the overlay is written via the generic proof-carrying put).
 *
 * `--dry-run` (DEFAULT) : read-only. Verifies CAS + CRS + simplify plan + proof +
 *   keys and REPORTS the plan. NO S3 write.
 * `--commit`           : real deposit (backup existing → _replaced/, put both
 *   layouts, readback G5). RUNS ON-CLUSTER/CI ONLY (owner-gated) — never locally.
 *
 * USAGE (dry-run):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_bdzi-flood-zones-acquire-deposit-20260905.ts \
 *     --run-id <capture-run-id> [--source bdzi] [--select-url <query-url>] \
 *     --out work/coverage/bdzi-flood-zones-acquire-record-20260905.json
 * USAGE (commit, ON-CLUSTER ONLY): add --commit.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { copyObject, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { proofFromCaptureEntry } from "./lib/zonage-proof.js";
import {
  BDZI_CONSTRAINTS_PREFIX,
  BDZI_SERVED_COLLECTION_ID,
  buildBdziSimplifyArgs,
  buildOverlayMeta,
  buildServedBdziOverlay,
  confirmWgs84,
  geometryDigest,
  normalizeBdziCapture,
  overlayBackupKey,
  overlayBackupStamp,
  overlayKeys,
  overlayMetaKey,
  readbackLayout,
  simplifyGeoJson,
  type LayoutReadback,
} from "./lib/bdzi-flood-zones-acquire.js";
import { BDZI_SIMPLIFY } from "../../packages/geo-sources-americas/src/ca-qc-constraints/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
  }
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function shaBare(s: string | null | undefined): string | null {
  return typeof s === "string" ? s.replace(/^sha256:/, "") : null;
}

/** Depositable line: 2xx, has bytes+sha+storage_key, not redacted. */
function isDepositable(line: CaptureManifestLine): boolean {
  return (
    !line.redacted &&
    line.http_status !== null &&
    line.http_status >= 200 &&
    line.http_status < 300 &&
    line.storage_key !== null &&
    line.sha256 !== null
  );
}

interface RunResult {
  entry: Record<string, unknown>;
}

async function main(): Promise<void> {
  requireS3();
  const commit = has("commit");
  const runId = arg("run-id");
  const source = arg("source") ?? "bdzi";
  const selectUrl = arg("select-url");
  const prefix = arg("prefix") ?? BDZI_CONSTRAINTS_PREFIX;
  const tolerance = arg("tolerance") !== undefined ? Number(arg("tolerance")) : BDZI_SIMPLIFY;
  const out = arg("out");
  if (!runId) throw new Error("--run-id <capture-run-id> requis (l'id du run de capture BDZI)");

  const s3 = s3Client();
  const entry: Record<string, unknown> = {
    contract: "bdzi-flood-zones-acquire-record/v1",
    date: "2026-09-05",
    spec: "S9_ACQUIRE_DELTA_CPTAQ.md (transposé BDZI) ; réplique byte-exact+readback de la recette victoriaville ; overlay proof-v2 via attachGeometryProof",
    mode: commit ? "commit" : "dry-run",
    run_id: runId,
    source,
    served_collection: BDZI_SERVED_COLLECTION_ID,
    served_prefix: prefix,
    simplify_tolerance_deg: tolerance,
  };
  const work = mkdtempSync(join(tmpdir(), "bdzi-acquire-"));
  try {
    // ── 1. Locate the attested capture line ──────────────────────────────────
    const rk = captureRunKeys(runId);
    let header: ReturnType<typeof CaptureRunHeaderSchema.parse>;
    try {
      header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, rk.header)).toString("utf8")));
    } catch (e) {
      entry.statut = "SKIP";
      entry.raison = `en-tête de run illisible/invalide (${rk.header}): ${(e as Error).message}`;
      return finish(entry, out);
    }
    entry.run_ok = header.finished_at !== null && header.exit_code === 0;
    if (!entry.run_ok) {
      entry.statut = "SKIP";
      entry.raison = `run capture non terminé proprement (finished_at=${String(header.finished_at)}, exit_code=${String(header.exit_code)})`;
      return finish(entry, out);
    }
    const lines = parseManifestJsonl((await getBytes(s3, rk.manifest)).toString("utf8"));
    let candidates = lines.filter((l) => l.source === source && isDepositable(l));
    if (selectUrl) candidates = candidates.filter((l) => l.url === selectUrl || l.final_url === selectUrl);
    entry.candidate_lines = candidates.length;
    if (candidates.length === 0) {
      entry.statut = "SKIP";
      entry.raison = `aucune ligne de capture déposable pour source="${source}"${selectUrl ? ` et url=${selectUrl}` : ""} dans ${rk.manifest}`;
      return finish(entry, out);
    }
    if (candidates.length > 1) {
      entry.statut = "SKIP";
      entry.raison =
        `${candidates.length} lignes BDZI déposables (pagination ArcGIS probable) — le merge multi-pages est HORS PÉRIMÈTRE de ce runner. ` +
        `Préciser --select-url <query-url exacte> pour n'en retenir qu'une, ou fusionner les pages en amont. URLs: ${candidates.map((l) => l.url).join(" | ")}`;
      entry.candidate_urls = candidates.map((l) => l.url);
      return finish(entry, out);
    }
    const line = candidates[0]!;
    entry.source_url = line.url;
    entry.retrieved_at = line.retrieved_at;
    entry.sha256 = line.sha256;
    entry.storage_key = line.storage_key;

    // ── 2. Byte-exact CAS verify (rehash + CAS key + sidecar) ────────────────
    const bytes = await getBytes(s3, line.storage_key!);
    const rehashOk = `sha256:${sha256Hex(bytes)}` === line.sha256;
    const casInName = /\/cas\/([a-f0-9]{64})\./.exec(line.storage_key!)?.[1] ?? null;
    const casKeyOk = casInName !== null && `sha256:${casInName}` === line.sha256;
    entry.rehash_ok = rehashOk;
    entry.cas_key_matches = casKeyOk;
    const receipt = captureReceiptFromManifest(line, rk.manifest, lines.indexOf(line));
    let rawVerified = false;
    let rawReason: string | null = "reçu de capture invalide";
    if (receipt) {
      let sidecar: unknown = null;
      try {
        sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8"));
      } catch (e) {
        rawReason = `sidecar CAS illisible: ${(e as Error).message}`;
      }
      if (sidecar !== null) {
        const v = verifyRawCapturePayload(receipt, bytes, sidecar);
        rawVerified = v.verified;
        rawReason = v.reason;
      }
    }
    entry.raw_capture_verified = rawVerified;
    entry.raw_capture_reason = rawReason;
    if (!rehashOk || !casKeyOk || !rawVerified) {
      entry.statut = "SKIP";
      entry.raison = `byte-exact NON prouvé (rehash=${rehashOk} casKey=${casKeyOk} raw=${rawVerified}:${rawReason})`;
      return finish(entry, out);
    }

    // ── 3. Parse + confirm WGS84/EPSG:4326 (capture uses outSR=4326) ─────────
    let rawFc: unknown;
    try {
      rawFc = JSON.parse(bytes.toString("utf8"));
    } catch (e) {
      entry.statut = "SKIP";
      entry.raison = `CAS n'est pas du JSON: ${(e as Error).message}`;
      return finish(entry, out);
    }
    if (rawFc && typeof rawFc === "object" && "error" in (rawFc as Record<string, unknown>) && (rawFc as Record<string, unknown>).error) {
      entry.statut = "SKIP";
      entry.raison = `CAS = objet d'erreur ArcGIS (${JSON.stringify((rawFc as Record<string, unknown>).error).slice(0, 160)})`;
      return finish(entry, out);
    }
    const rawFeatureCount = Array.isArray((rawFc as { features?: unknown }).features)
      ? ((rawFc as { features: unknown[] }).features).length
      : 0;
    const exceeded = (rawFc as { exceededTransferLimit?: unknown }).exceededTransferLimit === true;
    entry.raw_feature_count = rawFeatureCount;
    entry.exceeded_transfer_limit = exceeded;
    const crs = confirmWgs84(rawFc);
    entry.wgs84 = crs;
    if (!crs.ok) {
      entry.statut = "SKIP";
      entry.raison = `géométrie non confirmée WGS84/EPSG:4326: ${crs.reason}`;
      return finish(entry, out);
    }
    if (exceeded) {
      // A truncated single-page fetch cannot serve a complete province overlay.
      entry.statut = "SKIP";
      entry.raison = "capture ArcGIS tronquée (exceededTransferLimit=true) — la couche 22 doit être captée complète (pagination fusionnée) avant dépôt overlay";
      return finish(entry, out);
    }

    // ── 4. ogr2ogr Douglas–Peucker simplify (0.0005°), then normalize ────────
    const inPath = join(work, "bdzi-raw.geojson");
    const outPath = join(work, "bdzi-simplified.geojson");
    writeFileSync(inPath, bytes);
    let simplifiedFc: unknown = rawFc;
    let simplifyApplied = false;
    let simplifyArgs: string[] = buildBdziSimplifyArgs(inPath, outPath, tolerance);
    try {
      const res = await simplifyGeoJson({ inPath, outPath, tolerance });
      simplifiedFc = res.geojson;
      simplifyArgs = res.args;
      simplifyApplied = true;
    } catch (e) {
      if (commit) {
        entry.statut = "ERROR";
        entry.raison = `simplify ogr2ogr requis en --commit et a échoué: ${(e as Error).message}`;
        return finish(entry, out);
      }
      // Dry-run tolerance: GDAL may be absent locally. Report the planned command;
      // the real simplify runs on-cluster. Serve-shape is validated on raw geometry.
      entry.simplify_deferred = true;
      entry.simplify_defer_reason = (e as Error).message;
    }
    entry.simplify_applied = simplifyApplied;
    entry.simplify_args = ["ogr2ogr", ...simplifyArgs];
    const simplifiedCount = Array.isArray((simplifiedFc as { features?: unknown }).features)
      ? ((simplifiedFc as { features: unknown[] }).features).length
      : 0;
    entry.simplified_feature_count = simplifiedCount;

    const normalized = normalizeBdziCapture(simplifiedFc);
    entry.normalized_feature_count = normalized.features.length;
    entry.sample_normalized_props = normalized.features
      .slice(0, 3)
      .map((f) => ({ geoId: f.properties?.["geoId"], name: f.properties?.["name"], constraint: f.properties?.["constraint"], No_rapport: f.properties?.["No_rapport"] }));

    // ── 5. Build the served overlay with proof-v2 ────────────────────────────
    const proof = proofFromCaptureEntry(line, { type: "arcgis", method: "natif", reliability: "directe" });
    const served = buildServedBdziOverlay(normalized, proof, {
      tolerance,
      simplifyApplied,
      featureCountRaw: rawFeatureCount,
      captureRunId: runId,
    });
    const servedBytes = Buffer.from(JSON.stringify(served));
    const servedGeomDigest = geometryDigest(served.features);
    const keys = overlayKeys(prefix);
    // Sibling `.meta.json` per layout (geo-socle: geo-api reads the served
    // collection id from meta.datasetId). Minimal content previewed here; on
    // --commit an existing meta is preserve-merged (only datasetId (re)set).
    const plannedMetaFlat = buildOverlayMeta(served.features.length).meta;
    const metaKeys = { flat: overlayMetaKey(keys.flat), nested: overlayMetaKey(keys.nested) };
    entry.served_keys = keys;
    entry.served_meta_keys = metaKeys;
    entry.planned_meta = { flat: { key: metaKeys.flat, content: plannedMetaFlat }, nested: { key: metaKeys.nested, content: plannedMetaFlat } };
    entry.proof = { url: proof.url, retrieved_at: proof.retrieved_at, sha256: proof.sha256, type: proof.type };
    entry.served_bytes = servedBytes.length;
    entry.served_geometry_digest = servedGeomDigest;

    if (!commit) {
      entry.statut = simplifyApplied ? "DRY-RUN-OK" : "DRY-RUN-OK-SIMPLIFY-DEFERRED";
      entry.raison =
        `prêt au dépôt overlay ${BDZI_SERVED_COLLECTION_ID} (2 layouts .geojson + sibling .meta.json datasetId=${BDZI_SERVED_COLLECTION_ID}) : ${served.features.length} features, proof-v2 (${proof.sha256.slice(0, 20)}…), ` +
        `simplify ${tolerance}° ${simplifyApplied ? "appliqué" : "DIFFÉRÉ (GDAL absent local → cluster)"} ; relancer ON-CLUSTER avec --commit`;
      return finish(entry, out);
    }

    // ── 6. Deposit (ON-CLUSTER/CI ONLY) + readback G5 ────────────────────────
    const stamp = overlayBackupStamp();
    const replaced: string[] = [];
    const metaWrites: Array<Record<string, unknown>> = [];
    for (const [layout, key] of [["flat", keys.flat], ["nested", keys.nested]] as const) {
      if (await exists(s3, key)) {
        const backup = overlayBackupKey(layout, stamp, prefix);
        await copyObject(s3, key, backup);
        replaced.push(backup);
      }
      await putBytes(s3, key, servedBytes, "application/geo+json");
      // Sibling `.meta.json` (geo-socle): pins the served collection id. Read any
      // existing meta and preserve-merge (only datasetId (re)set), else minimal.
      const metaKey = overlayMetaKey(key);
      let existingMeta: Record<string, unknown> | null = null;
      if (await exists(s3, metaKey)) {
        try {
          existingMeta = JSON.parse((await getBytes(s3, metaKey)).toString("utf8")) as Record<string, unknown>;
        } catch {
          existingMeta = null;
        }
      }
      const built = buildOverlayMeta(served.features.length, existingMeta);
      await putBytes(s3, metaKey, `${JSON.stringify(built.meta, null, 2)}\n`, "application/json");
      metaWrites.push({ layout, meta_key: metaKey, had_existing_meta: built.hadExisting, preserved_fields: built.preservedFields, meta_written: built.meta });
    }
    entry.replaced_backups = replaced;
    entry.meta_writes = metaWrites;

    const expectation = {
      featureCount: served.features.length,
      geometryDigest: servedGeomDigest,
      proofUrl: proof.url,
      proofSha256: proof.sha256,
    };
    const readbacks: LayoutReadback[] = [];
    for (const [layout, key] of [["flat", keys.flat], ["nested", keys.nested]] as const) {
      let back: unknown = null;
      if (await exists(s3, key)) back = JSON.parse((await getBytes(s3, key)).toString("utf8"));
      const metaKey = overlayMetaKey(key);
      let metaObj: unknown = null;
      if (await exists(s3, metaKey)) {
        try {
          metaObj = JSON.parse((await getBytes(s3, metaKey)).toString("utf8"));
        } catch {
          metaObj = null;
        }
      }
      readbacks.push(readbackLayout(layout, key, back, metaObj, expectation));
    }
    entry.readback = readbacks;
    const allOk = readbacks.length === 2 && readbacks.every((r) => r.ok);
    entry.readback_ok = allOk;
    entry.statut = allOk ? "DEPOSITED" : "DEPOSITED_READBACK_FAIL";
    entry.raison = allOk
      ? `overlay ${BDZI_SERVED_COLLECTION_ID} déposé v2 byte-exact sur 2 layouts (.geojson + sibling .meta.json datasetId=${BDZI_SERVED_COLLECTION_ID}), level=documented, simplify ${tolerance}° tracé ; backups=${replaced.length}`
      : "DÉPÔT effectué mais readback G5 inattendu (geojson ou meta.datasetId) — VÉRIFIER";
    return finish(entry, out);
  } catch (e) {
    entry.statut = "ERROR";
    entry.raison = (e as Error).message;
    entry.stack = (e as Error).stack;
    return finish(entry, out);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function finish(entry: Record<string, unknown>, out: string | undefined): void {
  process.stderr.write(`[${String(entry.mode)}] ${BDZI_SERVED_COLLECTION_ID}: ${String(entry.statut)} — ${String(entry.raison ?? "")}\n`);
  const record = { ...entry };
  if (out) {
    writeFileSync(resolve(ROOT, out), `${JSON.stringify(record, null, 1)}\n`, "utf8");
    process.stderr.write(`RECORD → ${out}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(record, null, 1)}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
