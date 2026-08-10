/**
 * _zones-vnatif-inspect-brossard-boucherville-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Lit l'état SERVI actuel de brossard et boucherville (les 2 cibles g-cond
 * col-2 rank-8/14) AVANT toute capture : layout (flat/nested/both), nombre de
 * features, zone_codes distincts, zone_source_url / zone_source_level, présence
 * d'une VRAIE preuve v2 par-feature (proof.geometry_source sha256+retrieved_at)
 * ou collection. Sert à confirmer qu'ils sont bien UNPROUVÉS (upgradables) et à
 * dimensionner la garde de couverture du dépôt (incoming >= servi). N'écrit RIEN.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-inspect-brossard-boucherville-20260810.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
void ROOT;
const S3_PREFIX = "normalized/ca-qc-zonage/";
const SLUGS = ["brossard", "boucherville"] as const;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}
function canon(value: unknown): string { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

interface Feat { geometry?: unknown; properties?: Record<string, unknown> | null }
function featureHasRealV2Proof(f: Feat): boolean {
  const p = (f.properties ?? {}) as { proof?: { geometry_source?: { sha256?: unknown; retrieved_at?: unknown } } | null };
  const gs = p.proof?.geometry_source;
  if (!gs) return false;
  const shaOk = typeof gs.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(gs.sha256);
  const retrievedOk = typeof gs.retrieved_at === "string" && ISO_TS_RE.test(gs.retrieved_at) && !Number.isNaN(Date.parse(gs.retrieved_at));
  return shaOk && retrievedOk;
}

function geomTypesOf(feats: Feat[]): string[] {
  const s = new Set<string>();
  for (const f of feats) { const gt = (f.geometry as { type?: string } | null)?.type; if (typeof gt === "string") s.add(gt); }
  return [...s].sort();
}

async function main(): Promise<void> {
  requireS3();
  const s3 = s3Client();
  const out: Record<string, unknown>[] = [];
  for (const slug of SLUGS) {
    const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
    const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
    const keys: string[] = [];
    if (await exists(s3, flat)) keys.push(flat);
    if (await exists(s3, nested)) keys.push(nested);
    const perKey: Record<string, unknown>[] = [];
    for (const k of keys) {
      const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { proof?: { schema_version?: unknown; geometry_source?: { url?: unknown } }; features?: Feat[] };
      const feats = Array.isArray(fc.features) ? fc.features : [];
      const codes = new Set<string>(); const levels = new Set<string>(); const urls = new Set<string | null>();
      let hasV2Feat = false; const sampleCodes: unknown[] = [];
      for (const f of feats) {
        const p = f.properties ?? {};
        const c = canon(p["zone_code"]); if (c) codes.add(c);
        levels.add(typeof p["zone_source_level"] === "string" ? (p["zone_source_level"] as string) : "(none)");
        urls.add(typeof p["zone_source_url"] === "string" ? (p["zone_source_url"] as string) : null);
        if (featureHasRealV2Proof(f)) hasV2Feat = true;
        if (sampleCodes.length < 12) sampleCodes.push(p["zone_code"]);
      }
      perKey.push({
        key: k,
        features: feats.length,
        geometry_types: geomTypesOf(feats),
        distinct_zone_codes: codes.size,
        sample_zone_codes: sampleCodes,
        zone_source_levels: [...levels].sort(),
        zone_source_urls: [...urls],
        collection_proof_schema: fc.proof?.schema_version ?? null,
        collection_proof_url: fc.proof?.geometry_source?.url ?? null,
        has_real_v2_feature_proof: hasV2Feat,
      });
    }
    out.push({ slug, present: keys.length > 0, layout: keys.length === 2 ? "both" : keys.length === 1 ? (keys[0] === flat ? "flat" : "nested") : "none", keys, per_key: perKey });
  }
  process.stdout.write(`${JSON.stringify({ contract: "zones-vnatif-inspect-brossard-boucherville/v1", date: "2026-08-10", munis: out }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
