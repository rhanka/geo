/**
 * _zones-col2-reacq-inspect-served-20260816.ts — SONDE READ-ONLY S3 de l'état SERVI
 * (flat + nested) de beaupre + mille-isles, AVANT la ré-acquisition col-2.
 *
 * N'ÉCRIT RIEN. Rapporte par clé : feature_count, distinct property keys (pour
 * anticiper le gate assertNoServedPropertyKeysLost au remplacement), zone_source_level,
 * zone_source_url, présence d'un bloc de preuve v2 par-feature, échantillon zone_code,
 * bbox + centroïde (mille-isles : sert de base pour mesurer la clôture de l'offset 1705m).
 *
 * USAGE : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-col2-reacq-inspect-served-20260816.ts
 */
import { exists, getBytes, s3Client } from "./lib/s3.js";
import { featureHasV2Proof } from "./lib/zonage-proof.js";

const S3_PREFIX = "normalized/ca-qc-zonage/";
const SLUGS = ["beaupre", "mille-isles"];

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

interface Feat { geometry?: { coordinates?: unknown } | null; properties?: Record<string, unknown> | null }
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  for (const slug of SLUGS) {
    process.stdout.write(`\n=== ${slug} ===\n`);
    const keys = [
      { label: "flat", key: `${S3_PREFIX}qc-zonage-${slug}.geojson` },
      { label: "nested", key: `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson` },
    ];
    for (const { label, key } of keys) {
      if (!(await exists(s3, key))) { process.stdout.write(`[${label}] ABSENT (${key})\n`); continue; }
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { proof?: { schema_version?: unknown }; features?: Feat[] };
      const feats = Array.isArray(fc.features) ? fc.features : [];
      const propKeys = new Set<string>(); const levels = new Set<string>(); const urls = new Set<string | null>();
      const codes = new Set<string>(); let emptyCode = 0; let v2 = 0;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const f of feats) {
        const p = f.properties ?? {};
        for (const k of Object.keys(p)) propKeys.add(k);
        levels.add(typeof p["zone_source_level"] === "string" ? (p["zone_source_level"] as string) : "(none)");
        urls.add(typeof p["zone_source_url"] === "string" ? (p["zone_source_url"] as string) : null);
        const zc = p["zone_code"];
        const s = zc === null || zc === undefined ? "" : String(zc).trim();
        if (!s) emptyCode++; else codes.add(s);
        if (featureHasV2Proof(f)) v2++;
        for (const [x, y] of positions(f.geometry?.coordinates)) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      }
      const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
      process.stdout.write(`[${label}] ${key}\n`);
      process.stdout.write(`  features=${feats.length} collection_proof_schema=${String(fc.proof?.schema_version ?? "none")} features_with_v2_proof=${v2}\n`);
      process.stdout.write(`  distinct_zone_codes=${codes.size} empty_zone_code=${emptyCode} sample_codes=${JSON.stringify([...codes].slice(0, 6))}\n`);
      process.stdout.write(`  zone_source_level=${JSON.stringify([...levels].sort())} zone_source_url=${JSON.stringify([...urls])}\n`);
      process.stdout.write(`  property_keys(${propKeys.size})=${JSON.stringify([...propKeys].sort())}\n`);
      process.stdout.write(`  bbox=[${minx.toFixed(5)},${miny.toFixed(5)},${maxx.toFixed(5)},${maxy.toFixed(5)}] centroid=[${cx.toFixed(5)},${cy.toFixed(5)}]\n`);
    }
  }
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
