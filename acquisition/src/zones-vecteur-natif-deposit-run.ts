/**
 * zones-vecteur-natif-deposit-run.ts — dépose en v2 SERVI les captures vecteur natif
 * ATTESTÉES par geo-qa (ruling 1a0e86d7 ; option B : octets attestés, PAS de re-capture).
 *
 * Pour chaque ville d'un manifeste attesté (--manifest), relit les OCTETS EXACTS du
 * CAS (run+url), VÉRIFIE leur intégrité octet-pour-octet contre le sha256 attesté
 * (verifyRawCapturePayload), normalise, et dépose via depositCapturedZones (chemin
 * testé : 2 layouts flat+nested, gate identité/couverture anti-régression, backup
 * _replaced/, re-fold enrichment, re-stamp zone_source_url en dernier). La preuve v2
 * attachée = url+retrieved_at+sha256 de la capture attestée.
 *
 * `--dry-run` (défaut) : relit+vérifie+normalise et rapporte le plan SANS déposer.
 * `--commit` : dépose réellement. Lecture+écriture S3.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/zones-vecteur-natif-deposit-run.ts \
 *     --manifest work/coverage/zones-vecteur-natif-manifest-20260803.json \
 *     [--slugs a,b] [--commit]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, s3Client } from "./lib/s3.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { depositCapturedZones, normalize } from "./zones-obscura-run.js";
import { proofFromCaptureEntry } from "./lib/zonage-proof.js";

// Type de source de preuve v2 selon l'hote (goazimut/GOnet vs FeatureServer ArcGIS).
function proofSourceType(url: string): "geonet" | "arcgis" {
  return /goazimut|gonet/i.test(url) ? "geonet" : "arcgis";
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
function has(name: string): boolean { return process.argv.includes(`--${name}`); }

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

interface ManifestCity {
  slug: string; source_url: string; zone_field: string | null;
  sha256?: string; capture_run_id?: string;
}

// Relit + VÉRIFIE (octet-pour-octet vs sha attesté) les octets capturés du CAS.
async function readVerifiedOctets(s3: ReturnType<typeof s3Client>, run: string, url: string): Promise<{ bytes: Buffer; line: ReturnType<typeof parseManifestJsonl>[number] }> {
  const keys = captureRunKeys(run);
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  if (header.run_id !== run || header.finished_at === null || header.exit_code !== 0) {
    throw new Error(`run non probant ${run}`);
  }
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const direct = manifest.map((line, index) => ({ line, index })).filter(({ line }) => line.url === url);
  const matches = direct.length > 0 ? direct : manifest.map((line, index) => ({ line, index })).filter(({ line }) => line.final_url === url);
  if (matches.length !== 1) throw new Error(`capture exacte attendue 1x, trouvée ${matches.length}`);
  const { line, index } = matches[0]!;
  if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
    throw new Error(`capture non déposable: status=${String(line.http_status)} sha=${String(line.sha256)}`);
  }
  const receipt = captureReceiptFromManifest(line, keys.manifest, index);
  if (receipt === null) throw new Error("reçu de capture invalide");
  const bytes = await getBytes(s3, line.storage_key);
  const sidecar = JSON.parse((await getBytes(s3, `${line.storage_key}.meta.json`)).toString("utf8")) as unknown;
  const verification = verifyRawCapturePayload(receipt, bytes, sidecar);
  if (!verification.verified) throw new Error(`octets NON vérifiés vs sha attesté: ${verification.reason}`);
  return { bytes, line };
}

async function main(): Promise<void> {
  requireS3();
  const manifestPath = arg("manifest");
  if (!manifestPath) throw new Error("usage: --manifest f.json [--slugs a,b] [--commit]");
  const commit = has("commit");
  const wantSlugs = arg("slugs") ? new Set(arg("slugs")!.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const manifest = JSON.parse(readFileSync(resolve(ROOT, manifestPath), "utf8")) as { cities: ManifestCity[] };
  const cities = manifest.cities.filter((c) => !wantSlugs || wantSlugs.has(c.slug));

  const s3 = s3Client();
  const report: Record<string, unknown>[] = [];
  for (const c of cities) {
    try {
      if (!c.capture_run_id) throw new Error("capture_run_id absent du manifeste");
      const { bytes, line } = await readVerifiedOctets(s3, c.capture_run_id, c.source_url);
      if (line.sha256 !== null && c.sha256 && line.sha256.replace(/^sha256:/, "") !== c.sha256.replace(/^sha256:/, "")) {
        throw new Error(`sha CAS ${line.sha256} != sha manifeste ${c.sha256}`);
      }
      const gj = JSON.parse(bytes.toString("utf8")) as { features?: unknown[] };
      const feats = (Array.isArray(gj.features) ? gj.features : []) as never[];
      if (!c.zone_field) throw new Error("zone_field absent");
      const norm = normalize(feats, c.zone_field, c.source_url, "obscura-gonet-vector");
      const proof = proofFromCaptureEntry(line, { type: proofSourceType(c.source_url), method: "natif", reliability: "directe" });
      if (!commit) {
        report.push({ slug: c.slug, plan: "DRY-RUN", features: norm.length, zone_field: c.zone_field, proof_url: proof.url, sha256: line.sha256 });
        process.stderr.write(`[dry-run] ${c.slug}: ${norm.length} features prêtes, preuve=${proof.url.slice(0, 80)} sha=${String(line.sha256).slice(0, 16)}\n`);
        continue;
      }
      const res = await depositCapturedZones(s3, c.slug, norm, proof);
      report.push({ slug: c.slug, plan: "DEPOSITED", features: norm.length, servedBefore: res.servedBefore.map((a) => a.key), servedAfter: res.servedAfter.map((a) => a.key) });
      process.stderr.write(`[deposit] ${c.slug}: DÉPOSÉ ${norm.length} features -> ${res.servedAfter.map((a) => a.key).join(", ")}\n`);
    } catch (e) {
      report.push({ slug: c.slug, plan: "ERROR", reason: (e as Error).message });
      process.stderr.write(`  ERR ${c.slug}: ${(e as Error).message}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ contract: "zones-vecteur-natif-deposit/v1", mode: commit ? "commit" : "dry-run", total: report.length, report }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
