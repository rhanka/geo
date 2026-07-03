/**
 * zone-codes-report.ts — read-only completeness probe for ONE municipality's SIG
 * zones layer, and (if present) its deposited `qc-zonage-norms-<slug>` product.
 *
 * Answers, in ONE committed command (no ad-hoc bash), for a given slug:
 *   1. how many DISTINCT zone_code values the SIG zones layer
 *      (`normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`) declares — both
 *      VERBATIM and after the shared `canonZone` normalisation used by the
 *      norms cross-validation, plus a sorted sample;
 *   2. whether a norms grille product exists on S3 and, if so, how many distinct
 *      codes it carries and the overlap (canonical) with the SIG layer.
 *
 * Pure read: 0 S3 writes, 0 LLM, 0 credit. Mirrors the property fallback list of
 * lot-zone-join-run.zoneCodeOf and reuses lib/zonage-norms canonicalisation, so
 * the counts match what the join + cross-val actually see. ANTI-INVENTION: every
 * printed code is verbatim from the layer; nothing is synthesised.
 *
 * Usage: npx tsx acquisition/src/zone-codes-report.ts <slug> [<slug> ...]
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { normalizeZoneCode, canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { s3Client, getBytes, listSlugs } from "./lib/s3.js";
import {
  resolveGridKey,
  sigZoneCodesFromGeojson,
  canonZone,
  normsKey,
  ZONAGE_NORMS_PREFIX,
} from "./lib/zonage-norms.js";
import { exists } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";

const ZONE_CODE_KEYS = [
  "zone_code",
  "code_zone",
  "ZONE_CODE",
  "CODE_ZONE",
  "NO_ZONAGE",
  "no_zone",
  "NOZONE",
  "Zonage",
  "ZONE",
  "zone",
] as const;

function verbatimZoneCode(props: Record<string, unknown> | null): string {
  const p = props ?? {};
  for (const k of ZONE_CODE_KEYS) {
    const v = p[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  }
  return "";
}

// Shared canonicalisation (order-invariant digit⇄letter reconciliation) — the very
// rule the overlap gate uses, imported to keep the report and the gate in lockstep.
const canon = canonZone;

interface CityDelta {
  slug: string;
  hasGrid: boolean;
  hasNorms: boolean;
  /** overlap under the OLD runtime join canonicalisation (normalizeZoneCode). */
  oldOverlap: number;
  /** overlap under the NEW runtime join canonicalisation (canonicalizeZoneCodeForJoin). */
  newOverlap: number;
  normsCodes: number;
}

/** Count codes shared by two verbatim sets once each side is passed through `key`. */
function overlapUnder(zonesVerbatim: Set<string>, normsVerbatim: Set<string>, key: (v: string) => string): number {
  const zk = new Set([...zonesVerbatim].map(key).filter(Boolean));
  let n = 0;
  const seen = new Set<string>();
  for (const c of normsVerbatim) {
    const k = key(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (zk.has(k)) n++;
  }
  return n;
}

async function reportCity(slug: string, s3: ReturnType<typeof s3Client>): Promise<CityDelta> {
  console.log(`\n=== ${slug} ===`);

  const gridKeyResolved = await resolveGridKey(s3, slug);
  if (!gridKeyResolved) {
    console.log(`SIG zones layer: ABSENT (normalized/ca-qc-zonage/qc-zonage-${slug}.geojson)`);
    return { slug, hasGrid: false, hasNorms: false, oldOverlap: 0, newOverlap: 0, normsCodes: 0 };
  }
  const geojsonBuf = await getBytes(s3, gridKeyResolved);
  const geojsonStr = geojsonBuf.toString("utf8");

  // Verbatim, feature-accurate distinct codes (JSON parse — authoritative).
  const verbatim = new Set<string>();
  const canonSet = new Set<string>();
  let featureCount = 0;
  let withCode = 0;
  try {
    const fc = JSON.parse(geojsonStr) as FeatureCollection<Geometry, Record<string, unknown> | null>;
    for (const f of fc.features ?? ([] as Feature[])) {
      featureCount++;
      const code = verbatimZoneCode((f as Feature<Geometry, Record<string, unknown> | null>).properties);
      if (!code) continue;
      withCode++;
      verbatim.add(code);
      canonSet.add(canon(code));
    }
  } catch (e) {
    console.log(`  (JSON.parse failed: ${(e as Error).message.slice(0, 120)} — regex fallback only)`);
  }
  // Cross-check with the SAME extractor the cross-validation gate uses (curated
  // whitelist + best-field selection, canonical set).
  const regexCanon = sigZoneCodesFromGeojson(geojsonStr);

  const sample = [...verbatim].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  console.log(`SIG zones key: ${gridKeyResolved}`);
  console.log(`  features: ${featureCount} | with zone_code: ${withCode}`);
  console.log(`  DISTINCT zone_code (verbatim): ${verbatim.size}`);
  console.log(`  DISTINCT zone_code (canonical): ${canonSet.size} | via crossval extractor: ${regexCanon.size}`);
  console.log(`  sample (${Math.min(40, sample.length)} of ${sample.length}): ${sample.slice(0, 40).join(", ")}`);

  // Norms product side.
  const nk = normsKey(slug);
  if (!(await exists(s3, nk))) {
    console.log(`NORMS product: ABSENT (${nk})`);
    console.log(`  overlap: n/a (no grille) → lot->zone->norms match would be 0%`);
    return { slug, hasGrid: true, hasNorms: false, oldOverlap: 0, newOverlap: 0, normsCodes: 0 };
  }
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, nk), ["zone_code"]);
  const normsVerbatim = new Set<string>();
  const normsCanon = new Set<string>();
  for (const r of rows) {
    const c = r["zone_code"];
    if (c === null || c === undefined || !String(c).trim()) continue;
    normsVerbatim.add(String(c).trim());
    normsCanon.add(canon(String(c)));
  }
  let overlap = 0;
  for (const c of normsCanon) if (canonSet.has(c)) overlap++;
  // JOIN-accurate before/after: model the runtime join exactly by keying BOTH
  // sides with the library funcs the join uses — normalizeZoneCode (OLD) vs
  // canonicalizeZoneCodeForJoin (NEW). The delta is the codes the canon fix
  // retroactively unlocks for this city's already-served lots.
  const oldOverlap = overlapUnder(verbatim, normsVerbatim, normalizeZoneCode);
  const newOverlap = overlapUnder(verbatim, normsVerbatim, canonicalizeZoneCodeForJoin);
  const normsSample = [...normsVerbatim].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  console.log(`NORMS product: PRESENT (${nk})`);
  console.log(`  norms rows: ${rows.length} | distinct codes (verbatim): ${normsVerbatim.size}`);
  console.log(`  overlap (canonical) norms∩zones: ${overlap} / zones ${canonSet.size} / norms ${normsCanon.size}`);
  console.log(
    `  JOIN overlap OLD(normalize)=${oldOverlap} -> NEW(canon)=${newOverlap} | canon unlocks ${newOverlap - oldOverlap} code(s)`,
  );
  console.log(`  norms sample: ${normsSample.slice(0, 40).join(", ")}`);
  return { slug, hasGrid: true, hasNorms: true, oldOverlap, newOverlap, normsCodes: normsVerbatim.size };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter(Boolean);
  const all = argv.includes("--all");
  const s3 = s3Client();
  let slugs = argv.filter((a) => a !== "--all");
  if (all) {
    // Every deposited norms grille — the exhaustive set of cities where a
    // lot->zone->norms join is even possible, so the canon-delta sweep is total.
    const products = await listSlugs(s3, ZONAGE_NORMS_PREFIX, ".parquet", true);
    const fromProducts = products
      .map((p) => p.replace(/^qc-zonage-norms-/, ""))
      .filter((p) => p && !p.includes("/"));
    slugs = [...new Set([...slugs, ...fromProducts])].sort();
    console.log(`--all: ${slugs.length} deposited norms grille(s)`);
  }
  if (slugs.length === 0) {
    throw new Error("usage: npx tsx acquisition/src/zone-codes-report.ts [--all] <slug> [<slug> ...]");
  }
  const results: CityDelta[] = [];
  for (const slug of slugs) {
    try {
      results.push(await reportCity(slug, s3));
    } catch (e) {
      console.log(`\n=== ${slug} ===\nERROR ${(e as Error).message}`);
    }
  }
  const withNorms = results.filter((r) => r.hasNorms);
  const unlocked = withNorms.filter((r) => r.newOverlap > r.oldOverlap);
  console.log(`\n=== SUMMARY ===`);
  console.log(`cities examined: ${results.length} | with grid+norms: ${withNorms.length}`);
  console.log(
    `canon retroactively unlocks (newOverlap > oldOverlap): ${unlocked.length} city/cities` +
      (unlocked.length
        ? ` -> ${unlocked.map((r) => `${r.slug}(+${r.newOverlap - r.oldOverlap})`).join(", ")}`
        : " (none — every city's zones & norms already share one format under normalizeZoneCode)"),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
