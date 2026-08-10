/**
 * _zones-vnatif-verify-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Relit les objets ZONAGE SERVIS des villes déposées le 20260810 et VÉRIFIE,
 * indépendamment du dépositeur :
 *   - FeatureCollection non vide, feature_count = celui capturé ;
 *   - preuve v2 de collection + de CHAQUE feature (assertServedZoneGeojson) ;
 *   - proof.geometry_source.url + sha256 == ceux du manifeste de capture ;
 *   - zone_source_level=documented + zone_source_url==url de preuve sur chaque feature.
 *
 * N'écrit RIEN. Émet un rapport JSON sur stdout.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-verify-20260810.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";
import { assertServedZoneGeojson, type ServedZoneGeoJson } from "./lib/zonage-proof.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const DEPOSITED = ["longueuil", "salaberry-de-valleyfield", "westmount"];

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("lecture S3 refusée: NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: AWS_MAX_ATTEMPTS=10");
}

interface ManifestCity { slug: string; source_url: string; sha256: string; feature_count: number }

async function main(): Promise<void> {
  requireS3();
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "work/coverage/zones-vecteur-natif-manifest-20260810.json"), "utf8")) as { cities: ManifestCity[] };
  const byslug = new Map(manifest.cities.map((c) => [c.slug, c]));

  const s3 = s3Client();
  const report: Record<string, unknown>[] = [];
  for (const slug of DEPOSITED) {
    const expect = byslug.get(slug)!;
    const flatKey = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
    const nestedKey = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
    const key = (await exists(s3, nestedKey)) ? nestedKey : flatKey;
    const entry: Record<string, unknown> = { slug, served_key: key };
    try {
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as ServedZoneGeoJson & { features: Array<{ properties?: Record<string, unknown> | null }> };
      // Full contract validation (collection + every feature v2 proof + zone source stamp).
      assertServedZoneGeojson(key, fc);
      const gsource = fc.proof!.geometry_source;
      entry.feature_count = fc.features.length;
      entry.feature_count_matches_capture = fc.features.length === expect.feature_count;
      entry.proof_schema = fc.proof!.schema_version;
      entry.proof_url = gsource.url;
      entry.proof_url_matches = gsource.url === expect.source_url;
      entry.proof_sha256 = gsource.sha256;
      entry.proof_sha256_matches = gsource.sha256 === expect.sha256;
      entry.proof_type = gsource.type;
      entry.proof_method = gsource.method;
      entry.proof_reliability = gsource.reliability;
      entry.proof_retrieved_at = gsource.retrieved_at;
      // Every feature carries documented level + the proof url as source.
      let docLevel = 0, srcUrlOk = 0, featProofOk = 0;
      for (const f of fc.features) {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        if (p["zone_source_level"] === "documented") docLevel++;
        if (p["zone_source_url"] === gsource.url) srcUrlOk++;
        const fp = p["proof"] as { geometry_source?: { sha256?: string } } | undefined;
        if (fp?.geometry_source?.sha256 === gsource.sha256) featProofOk++;
      }
      entry.features_level_documented = docLevel;
      entry.features_source_url_ok = srcUrlOk;
      entry.features_proof_ok = featProofOk;
      entry.verdict =
        entry.feature_count_matches_capture &&
        entry.proof_url_matches &&
        entry.proof_sha256_matches &&
        docLevel === fc.features.length &&
        srcUrlOk === fc.features.length &&
        featProofOk === fc.features.length
          ? "VERIFIED"
          : "MISMATCH";
    } catch (e) {
      entry.verdict = `ERROR: ${(e as Error).message}`;
    }
    report.push(entry);
  }
  process.stdout.write(`${JSON.stringify({ contract: "zones-vnatif-verify/diagnostic", report }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
