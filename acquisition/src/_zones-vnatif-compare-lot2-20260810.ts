/**
 * _zones-vnatif-compare-lot2-20260810.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * Pour chaque ville du manifeste lot2, compare le jeu de CODES DE ZONE canoniques
 * de la collection SERVIE (S3, layout plat + sous-dossier) au jeu de codes de la
 * couche AMONT capturée (octets CAS, zone_field du manifeste). Produit l'évidence
 * exacte du gate identité (`depositCapturedZones`) : combien de codes servis sont
 * absents de la capture (uncovered → gate HELD), et la provenance servie
 * (level + zone_source_url). N'écrit RIEN sur S3.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-compare-lot2-20260810.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CaptureRunHeaderSchema, captureRunKeys, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { exists, getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const MANIFEST = "work/coverage/zones-vecteur-natif-manifest-lot2-20260810.json";

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) throw new Error("S3 refusé: NODE_OPTIONS=--dns-result-order=ipv4first");
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("S3 refusé: AWS_MAX_ATTEMPTS=10");
}

function canon(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface ManifestCity { slug: string; source_url: string; zone_field: string; capture_run_id: string; feature_count: number }

async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ key: string; level: string[]; url: (string | null)[]; codes: Set<string>; features: number } | null> {
  const flat = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await exists(s3, flat)) keys.push(flat);
  if (await exists(s3, nested)) keys.push(nested);
  if (keys.length === 0) return null;
  const codes = new Set<string>();
  const level = new Set<string>();
  const url = new Set<string | null>();
  let features = 0;
  for (const k of keys) {
    const fc = JSON.parse((await getBytes(s3, k)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> | null }> };
    const feats = Array.isArray(fc.features) ? fc.features : [];
    features = Math.max(features, feats.length);
    for (const f of feats) {
      const p = f.properties ?? {};
      const c = canon(p["zone_code"]);
      if (c) codes.add(c);
      level.add(typeof p["zone_source_level"] === "string" ? p["zone_source_level"] : "(none)");
      url.add(typeof p["zone_source_url"] === "string" ? p["zone_source_url"] : null);
    }
  }
  return { key: keys.join("|"), level: [...level].sort(), url: [...url], codes, features };
}

async function captureCodes(s3: ReturnType<typeof s3Client>, run: string, srcUrl: string, zoneField: string): Promise<Set<string>> {
  const rk = captureRunKeys(run);
  CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, rk.header)).toString("utf8")));
  const manifest = parseManifestJsonl((await getBytes(s3, rk.manifest)).toString("utf8"));
  const line = manifest.find((l) => l.url === srcUrl) ?? manifest.find((l) => l.final_url === srcUrl);
  if (!line || line.storage_key === null) throw new Error(`ligne capture introuvable ${srcUrl}`);
  const gj = JSON.parse((await getBytes(s3, line.storage_key)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> | null }> };
  const codes = new Set<string>();
  for (const f of gj.features ?? []) { const c = canon(f.properties?.[zoneField]); if (c) codes.add(c); }
  return codes;
}

async function main(): Promise<void> {
  requireS3();
  const manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), "utf8")) as { cities: ManifestCity[] };
  const s3 = s3Client();
  const report: Record<string, unknown>[] = [];
  for (const c of manifest.cities) {
    const served = await readServed(s3, c.slug);
    const capCodes = await captureCodes(s3, c.capture_run_id, c.source_url, c.zone_field);
    const entry: Record<string, unknown> = {
      slug: c.slug,
      capture_feature_count: c.feature_count,
      capture_zone_field: c.zone_field,
      capture_distinct_codes: capCodes.size,
    };
    if (!served) {
      entry.served = "ABSENT";
      entry.gate = "PASS (aucun servi)";
    } else {
      const uncovered = [...served.codes].filter((x) => !capCodes.has(x)).sort();
      const covered = served.codes.size - uncovered.length;
      entry.served_key = served.key;
      entry.served_features = served.features;
      entry.served_level = served.level;
      entry.served_source_url = served.url;
      entry.served_distinct_codes = served.codes.size;
      entry.served_codes_covered_by_capture = covered;
      entry.served_codes_uncovered = uncovered.length;
      entry.uncovered_codes = uncovered;
      entry.gate = uncovered.length === 0 ? "PASS" : "HELD (identity)";
    }
    report.push(entry);
  }
  process.stdout.write(`${JSON.stringify({ contract: "zones-vnatif-compare/diagnostic", report }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
