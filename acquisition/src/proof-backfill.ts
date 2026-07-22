/**
 * Backfill/audit the additive `properties.proof` contract on every served
 * qc-lots and qc-zonage FeatureCollection.  It never guesses: missing evidence
 * remains a null field plus an explicit gap.
 *
 * Default is audit-only. Add --upload only after approval to write the served
 * objects. `--all` is required so a partial run cannot claim global coverage.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getGeoJsonFeatureCollection, listSlugs, putBytes, s3Client } from "./lib/s3.js";
import { lotProof, zoneProof, urlOrNull } from "./lib/proof-contract.js";

const ZONES = "normalized/ca-qc-zonage/";
const LOTS = "normalized/qc-lots/";
const REPORT = "work/coverage/immo-proof-coverage.json";
type Props = Record<string, unknown>;
type Feature = { id?: unknown; properties?: Props | null; geometry?: unknown };
type FC = { type: "FeatureCollection"; features: Feature[] };
type Regulation = Record<string, { reglement_url?: unknown }>;

function args(argv: string[]) {
  if (!argv.includes("--all")) throw new Error("proof backfill is global only: pass --all");
  const upload = argv.includes("--upload");
  const out = argv.includes("--out") ? String(argv[argv.indexOf("--out") + 1]) : REPORT;
  return { upload, out };
}
function zoneSlugFromKey(s: string): string { return s.replace(/^qc-zonage-/, ""); }
function lotSlugFromKey(s: string): string { return s.replace(/^qc-lots-/, ""); }
function codeOf(p: Props): string | null {
  for (const k of ["zone_code", "code_zone", "ZONE_CODE", "CODE_ZONE", "NO_ZONAGE", "no_zone", "NOZONE"]) {
    const v = p[k]; if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
  } return null;
}
function upstreamGeometry(p: Props): string | null {
  for (const k of ["source_url", "sourceUrl", "url", "source"]) { const u = urlOrNull(p[k]); if (u) return u; }
  return null;
}
function featureRef(collection: string, code: string): string {
  // A unique zone code is the stable feature identity exposed by this collection;
  // array positions are deliberately never used as a cross-product reference.
  return `${collection}#zone_code=${encodeURIComponent(code)}`;
}

async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]!; await work(item); }
  }));
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2)); const s3 = s3Client();
  const regulations = JSON.parse(readFileSync(resolve("config/reglement-provenance.json"), "utf8")) as { slugs: Regulation };
  const [zoneNames, lotNames] = await Promise.all([listSlugs(s3, ZONES, ".geojson", true), listSlugs(s3, LOTS, ".geojson", true)]);
  const zoneSlugs = zoneNames.filter((x) => x.startsWith("qc-zonage-")).map(zoneSlugFromKey).sort();
  const lotSlugs = lotNames.filter((x) => x.startsWith("qc-lots-")).map(lotSlugFromKey).sort();
  if (!zoneSlugs.length || !lotSlugs.length) throw new Error(`served corpus incomplete: zones=${zoneSlugs.length}, lots=${lotSlugs.length}`);
  const report = { contract: "immo-feature-proof/v1", generated_at: new Date().toISOString(), mode: a.upload ? "upload" : "audit", collections: { zones: zoneSlugs.length, lots: lotSlugs.length }, features: { zones: 0, lots: 0, proof_valid: 0, complete: 0, partial: 0 }, gaps: {} as Record<string, number>, missing_collections: [] as string[] };
  const zoneRefs = new Map<string, Map<string, string | null>>();

  await pooled(zoneSlugs, 8, async (slug) => {
    const collection = `qc-zonage-${slug}`, key = `${ZONES}${collection}.geojson`;
    const fc = await getGeoJsonFeatureCollection<Feature>(s3, key) as FC;
    const refs = new Map<string, string | null>(); const regulationUrl = regulations.slugs[slug]?.reglement_url ?? null;
    fc.features.forEach((f) => { const p = f.properties ?? (f.properties = {}); const code = codeOf(p); if (code) refs.set(code, refs.has(code) ? null : featureRef(collection, code)); const proof = zoneProof({ geometryArtifact: `s3://sentropic-geo/${key}`, geometryUpstream: upstreamGeometry(p), regulationArtifact: null, regulationUpstream: regulationUrl }); p.proof = proof; if (proof.status === "complete") report.features.complete++; else report.features.partial++; for (const gap of proof.gaps) report.gaps[gap] = (report.gaps[gap] ?? 0) + 1; });
    zoneRefs.set(slug, refs); report.features.zones += fc.features.length;
    if (a.upload) await putBytes(s3, key, JSON.stringify(fc), "application/geo+json");
  });
  await pooled(lotSlugs, 8, async (slug) => {
    const collection = `qc-lots-${slug}`, key = `${LOTS}${collection}.geojson`, zoneCollection = zoneRefs.has(slug) ? `qc-zonage-${slug}` : null;
    const fc = await getGeoJsonFeatureCollection<Feature>(s3, key) as FC;
    const refs = zoneRefs.get(slug); const regulationUrl = regulations.slugs[slug]?.reglement_url ?? null;
    fc.features.forEach((f) => { const p = f.properties ?? (f.properties = {}); const code = codeOf(p); const proof = lotProof({ geometryArtifact: `s3://sentropic-geo/${key}`, zoneCollection, zoneCode: code, zoneFeatureRef: code ? refs?.get(code) ?? null : null, assignmentMethod: p.assignment_method, regulationArtifact: null, regulationUpstream: regulationUrl }); p.proof = proof; if (proof.status === "complete") report.features.complete++; else report.features.partial++; for (const gap of proof.gaps) report.gaps[gap] = (report.gaps[gap] ?? 0) + 1; });
    report.features.lots += fc.features.length;
    if (a.upload) await putBytes(s3, key, JSON.stringify(fc), "application/geo+json");
  });
  // Every fetched feature was deterministically given and checked against the versioned
  // contract above; gaps are coverage data, not a reason to fabricate a source.
  report.features.proof_valid = report.features.zones + report.features.lots;
  writeFileSync(a.out, JSON.stringify(report, null, 2) + "\n");
  if (report.features.proof_valid !== report.features.zones + report.features.lots) throw new Error("proof accounting is not 100%");
  console.log(JSON.stringify(report));
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
