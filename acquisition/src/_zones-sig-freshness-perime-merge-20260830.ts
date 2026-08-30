/**
 * READ-ONLY merge sonde (diagnostic). JOIN two already-committed JSON deliverables
 * on `slug` and emit geo-archi's §3 périmé inventory. NO network, NO S3, NO PDF
 * re-parse: reads only the two committed JSONs from disk, so a clean checkout can
 * re-run it deterministically.
 *
 * Inputs (committed):
 *   Layer 1 (capture freshness axis):
 *     work/coverage/zones-sig-freshness-inventory-20260830.json   (commit 8fc76408)
 *   Layer 2 (SIG <-> DEPOSITED-normes code-mismatch, lower-bound):
 *     work/coverage/zones-code-mismatch-broadcity-20260830.json   (commit 747bd0e7)
 *
 * Outputs (this script):
 *   work/coverage/zones-sig-freshness-perime-inventory-20260830.json
 *   work/coverage/zones-sig-freshness-perime-inventory-20260830.md
 *
 * Anti-invention: verbatim-or-null. A muni missing from a layer -> the field is
 * null / source-gap, never guessed. Partitions MUST close (sum to 873); the
 * script asserts this and FAILS LOUD otherwise. No fabricated date/code/millésime/
 * count. Factual status terms only (source-gap, unknown, N-A, lower-bound,
 * not-measurable, unverified, partial).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const L1_PATH = resolve(REPO_ROOT, "work/coverage/zones-sig-freshness-inventory-20260830.json");
const L2_PATH = resolve(REPO_ROOT, "work/coverage/zones-code-mismatch-broadcity-20260830.json");
const OUT_JSON = resolve(REPO_ROOT, "work/coverage/zones-sig-freshness-perime-inventory-20260830.json");
const OUT_MD = resolve(REPO_ROOT, "work/coverage/zones-sig-freshness-perime-inventory-20260830.md");

const SERVED_TOTAL = 873;

function die(msg: string): never {
  console.error(`FAIL-LOUD: ${msg}`);
  process.exit(1);
}

function assertEq(actual: number, expected: number, label: string): void {
  if (actual !== expected) die(`${label}: got ${actual}, expected ${expected}`);
}

// ------------------------------------------------------------------ load
const l1: any = JSON.parse(readFileSync(L1_PATH, "utf8"));
const l2: any = JSON.parse(readFileSync(L2_PATH, "utf8"));

// ------ Layer 1: detect the main per-muni inventory array (the length-873 array).
const l1ArrayKeys = Object.keys(l1).filter((k) => Array.isArray(l1[k]));
const l1InvCandidates = l1ArrayKeys.filter(
  (k) => l1[k].length === SERVED_TOTAL && l1[k].every((r: any) => r && typeof r.slug === "string" && "freshness_class" in r),
);
if (l1InvCandidates.length !== 1) {
  die(`Layer 1: expected exactly one length-${SERVED_TOTAL} inventory array with slug+freshness_class; found [${l1InvCandidates.join(", ")}]`);
}
const L1_INV_KEY = l1InvCandidates[0];
const l1Inv: any[] = l1[L1_INV_KEY];

// Layer 1 worklist (owner-gated, NOT executed) — confirmed key.
const l1Worklist: any[] = l1?.resource_worklist_prescoped?.items;
if (!Array.isArray(l1Worklist)) die("Layer 1: resource_worklist_prescoped.items missing/not an array");

// ------ Layer 2: per-muni code-mismatch rows — confirmed key `munis`.
const l2Munis: any[] = l2?.munis;
if (!Array.isArray(l2Munis)) die("Layer 2: munis missing/not an array");
const l2Map = new Map<string, any>();
for (const r of l2Munis) {
  if (!r || typeof r.slug !== "string") die("Layer 2: a munis row lacks a string slug");
  if (l2Map.has(r.slug)) die(`Layer 2: duplicate slug ${r.slug} in munis`);
  l2Map.set(r.slug, r);
}

// ------ Layer counts, taken VERBATIM from each layer (not recomputed differently).
const L1_FRESH = Number(l1?.by_freshness_class?.["MEASURED-FRESH"]);
const L1_SOURCE_GAP = Number(l1?.by_freshness_class?.["SOURCE-GAP"]);
const L1_PERIME_SUSPECT = Number(l1?.totals?.source_perime_suspects);
const L2_ASSESSABLE = Number(l2?.summary?.munis_assessable_mismatch);
const L2_WITH_MISMATCH = Number(l2?.summary?.munis_with_mismatch);
const L2_NO_MISMATCH = Number(l2?.summary?.munis_no_mismatch);
const L2_NORMES_GAP = Number(l2?.summary?.munis_normes_source_gap);
for (const [v, lbl] of [
  [L1_FRESH, "L1 MEASURED-FRESH"],
  [L1_SOURCE_GAP, "L1 SOURCE-GAP"],
  [L1_PERIME_SUSPECT, "L1 source_perime_suspects"],
  [L2_ASSESSABLE, "L2 munis_assessable_mismatch"],
  [L2_WITH_MISMATCH, "L2 munis_with_mismatch"],
  [L2_NO_MISMATCH, "L2 munis_no_mismatch"],
  [L2_NORMES_GAP, "L2 munis_normes_source_gap"],
] as [number, string][]) {
  if (!Number.isFinite(v)) die(`Missing/NaN layer count: ${lbl}`);
}

// ------------------------------------------------------------------ PROBE
const l2NormesSourceValues: Record<string, number> = {};
for (const r of l2Munis) {
  const key = String(r.normes_source);
  l2NormesSourceValues[key] = (l2NormesSourceValues[key] ?? 0) + 1;
}
console.log("=== PROBE ===");
console.log("L1 inventory key:", L1_INV_KEY, "len:", l1Inv.length);
console.log("L1 worklist len:", l1Worklist.length);
console.log("L2 munis len:", l2Munis.length);
console.log("L2 normes_source value histogram:", JSON.stringify(l2NormesSourceValues));

// ------------------------------------------------------------------ merge
// assessable == deposited normes parquet exists AND joined for this served slug.
function isAssessable(l2row: any | undefined): boolean {
  return !!l2row && l2row.normes_source === "deposited";
}

const MISMATCH_BASIS =
  "code-mismatch (canon-join geo canonZone/canonicalizeZoneCodeForJoin); DEPOSITED-LAYER LOWER BOUND on true perime — confounded by expandCategoryZonesToSig which relabels category norms onto the muni's own SIG codes and re-stamps, so a SIG-expanded deposit absorbs the SIG set and under-reports mismatch. True raw-grille-PDF perime is source-gap read-only (needs cluster PDFs).";
const GAP_MISMATCH_BASIS =
  "normes-source-gap (no deposited normes parquet for this served muni) — SIG↔normes mismatch not-measurable read-only.";

function millesimeMarker(row: any): string | null {
  // superseded millésime value (verbatim) for a vintage marker, if present.
  const sm = row?.source_millesime;
  if (Array.isArray(sm) && sm.length) {
    const first = sm[0];
    if (first && "value" in first) return String(first.value);
  }
  return null;
}

const rows: any[] = [];
let cFresh = 0,
  cSourceGap = 0,
  cStale = 0;
let cVintageMarker = 0,
  cVintageGap = 0;
let cAssessable = 0,
  cWithMismatch = 0,
  cClean = 0,
  cNormesGap = 0;

for (const inv of l1Inv) {
  const slug: string = inv.slug;
  const l2row = l2Map.get(slug);

  // --- freshness (from layer 1), mapped to {fresh, source-gap}; 0 stale measured.
  let freshness_class: string;
  if (inv.freshness_class === "MEASURED-FRESH") {
    freshness_class = "fresh";
    cFresh++;
  } else if (inv.freshness_class === "SOURCE-GAP") {
    freshness_class = "source-gap";
    cSourceGap++;
  } else {
    // No 'stale' class exists in layer 1; anything else is not-measurable -> source-gap.
    // Never invent a stale verdict.
    freshness_class = "source-gap";
    cSourceGap++;
    cStale += 0;
  }

  // --- vintage_perime (upstream vintage axis) — TRUE only on an explicit L1 marker.
  let vintage_perime: { bool: boolean; basis: string };
  if (inv.source_perime_suspect === "yes") {
    const marker = inv.source_url_stale_marker ?? millesimeMarker(inv) ?? "unverified-marker";
    vintage_perime = { bool: true, basis: `vintage-marker (${marker})` };
    cVintageMarker++;
  } else {
    vintage_perime = { bool: false, basis: "source-gap (upstream vintage not measurable read-only)" };
    cVintageGap++;
  }

  // --- deposited_norme_mismatch (from layer 2, lower bound).
  const assessable = isAssessable(l2row);
  let deposited_norme_mismatch: any;
  if (assessable) {
    cAssessable++;
    const n_mismatch = Number(l2row.n_mismatched);
    if (!Number.isFinite(n_mismatch)) die(`Layer 2: ${slug} deposited row lacks numeric n_mismatched`);
    const codes = Array.isArray(l2row.mismatched_sig_codes) ? l2row.mismatched_sig_codes : [];
    if (n_mismatch > 0) cWithMismatch++;
    else cClean++;
    deposited_norme_mismatch = {
      assessable: true,
      n_mismatch,
      codes,
      is_lower_bound: true,
      basis: MISMATCH_BASIS,
    };
  } else {
    cNormesGap++;
    deposited_norme_mismatch = {
      assessable: false,
      n_mismatch: null,
      codes: [],
      is_lower_bound: false,
      basis: GAP_MISMATCH_BASIS,
    };
  }

  // --- n_zones: distinct SIG codes from layer 2 (n_sig_codes); fallback layer 1.
  let n_zones: number | null = null;
  if (l2row && Number.isFinite(Number(l2row.n_sig_codes))) n_zones = Number(l2row.n_sig_codes);
  else if (Number.isFinite(Number(inv.feature_count))) n_zones = Number(inv.feature_count);

  rows.push({
    slug,
    served: true,
    zone_source_url: inv.zone_source_url ?? null,
    zone_source_level: inv.zone_source_level ?? null,
    method: inv.method ?? null,
    capture_retrieved_at: inv.retrieved_at ?? null,
    source_millesime: inv.source_millesime ?? null,
    freshness_class,
    vintage_perime,
    deposited_norme_mismatch,
    normes_source_gap: !assessable,
    n_zones,
  });
}

// ------------------------------------------------------------------ ASSERT partitions close to 873
assertEq(rows.length, SERVED_TOTAL, "output rows");

// freshness partition
assertEq(cFresh, L1_FRESH, "freshness fresh (recomputed vs layer 1)");
assertEq(cSourceGap, L1_SOURCE_GAP, "freshness source-gap (recomputed vs layer 1)");
assertEq(cStale, 0, "freshness stale (must be 0 measured)");
assertEq(cFresh + cSourceGap + cStale, SERVED_TOTAL, "freshness partition closes to 873");

// vintage partition
assertEq(cVintageMarker, L1_PERIME_SUSPECT, "vintage marker_suspect (recomputed vs layer 1)");
assertEq(cVintageMarker + cVintageGap, SERVED_TOTAL, "vintage partition closes to 873");

// deposited-mismatch partition
assertEq(cAssessable, L2_ASSESSABLE, "deposited assessable (recomputed vs layer 2)");
assertEq(cWithMismatch, L2_WITH_MISMATCH, "deposited munis_with_mismatch (recomputed vs layer 2)");
assertEq(cClean, L2_NO_MISMATCH, "deposited clean (recomputed vs layer 2)");
assertEq(cNormesGap, L2_NORMES_GAP, "deposited normes_source_gap (recomputed vs layer 2)");
assertEq(cWithMismatch + cClean, cAssessable, "with_mismatch + clean == assessable");
assertEq(cWithMismatch + cClean + cNormesGap, SERVED_TOTAL, "deposited partition closes to 873");

// ------------------------------------------------------------------ resource_worklist (owner-gated, NOT executed)
// Provenance ladder: least-proven first.
const PROVENANCE_RANK: Record<string, number> = {
  "null": 0,
  orphan: 1,
  candidate: 2,
  "legacy-traceable": 3,
  "historical-verified": 4,
  documented: 5,
};
function provRank(level: any): number {
  if (level === null || level === undefined || level === "") return PROVENANCE_RANK["null"];
  return level in PROVENANCE_RANK ? PROVENANCE_RANK[level] : 99;
}
// rank 0 = vintage-suspect (mont-tremblant #1); rank 1 = source-gap, ordered by least-proven provenance.
function reasonRank(item: any): number {
  return item.candidate_reason === "source-perime-suspect" ? 0 : 1;
}
const worklist = [...l1Worklist].sort((a, b) => {
  const ra = reasonRank(a),
    rb = reasonRank(b);
  if (ra !== rb) return ra - rb;
  const pa = provRank(a.zone_source_level),
    pb = provRank(b.zone_source_level);
  if (pa !== pb) return pa - pb;
  return String(a.slug).localeCompare(String(b.slug));
});
if (worklist.length && worklist[0].slug !== "mont-tremblant") {
  die(`resource_worklist head expected mont-tremblant (vintage-suspect), got ${worklist[0].slug}`);
}

// ------------------------------------------------------------------ summary block (EXACT layer counts)
const summary = {
  freshness: { fresh: L1_FRESH, "source-gap": L1_SOURCE_GAP, stale: 0 },
  vintage_perime: { marker_suspect: L1_PERIME_SUSPECT, "source-gap": SERVED_TOTAL - L1_PERIME_SUSPECT },
  deposited_mismatch: {
    munis_with_mismatch: L2_WITH_MISMATCH,
    clean: L2_NO_MISMATCH,
    normes_source_gap: L2_NORMES_GAP,
    assessable: L2_ASSESSABLE,
  },
};
// Partition-closure asserts on the summary block itself.
assertEq(summary.freshness.fresh + summary.freshness["source-gap"] + summary.freshness.stale, SERVED_TOTAL, "summary.freshness closes");
assertEq(summary.vintage_perime.marker_suspect + summary.vintage_perime["source-gap"], SERVED_TOTAL, "summary.vintage closes");
assertEq(
  summary.deposited_mismatch.munis_with_mismatch + summary.deposited_mismatch.clean + summary.deposited_mismatch.normes_source_gap,
  SERVED_TOTAL,
  "summary.deposited closes",
);

// ------------------------------------------------------------------ emit JSON
const out = {
  contract: "zones-sig-freshness-perime-inventory/geo-archi-§3",
  generated_at_utc: new Date().toISOString(),
  read_only: true,
  method_note:
    "Merge JOIN on slug of two committed layers — no network, no S3, no PDF re-parse. Layer 1 = capture-freshness axis (retrieved_at) + explicit upstream vintage markers. Layer 2 = SIG↔DEPOSITED-normes canon-join mismatch (LOWER BOUND on true perime; deposited layer is confounded by expandCategoryZonesToSig). True raw-grille-PDF perime remains source-gap read-only.",
  served_total: SERVED_TOTAL,
  inputs: {
    layer1_freshness: "work/coverage/zones-sig-freshness-inventory-20260830.json",
    layer1_commit: "8fc76408",
    layer1_inventory_key: L1_INV_KEY,
    layer2_code_mismatch: "work/coverage/zones-code-mismatch-broadcity-20260830.json",
    layer2_commit: "747bd0e7",
  },
  axes_note:
    "THREE distinct périmé axes. (1) CAPTURE freshness = capture_retrieved_at (fresh|source-gap; 0 stale measured). (2) UPSTREAM VINTAGE = vintage_perime, TRUE only on an explicit layer-1 marker (URL 'Ancien/old' or superseded millésime); otherwise source-gap (not measurable read-only). (3) DEPOSITED-normes mismatch = deposited_norme_mismatch, a LOWER BOUND on true perime; not-measurable where normes_source_gap.",
  summary,
  munis: rows,
  resource_worklist: {
    owner_gated: true,
    executed: false,
    count: worklist.length,
    order_note:
      "rank 0 = vintage-suspect (mont-tremblant #1, Ancien_zonage, superseded millésime 2008); then source-gaps by least-proven provenance (null-level < orphan < candidate < legacy-traceable < historical-verified < documented). Carried verbatim from layer 1 resource_worklist_prescoped.items; re-ordered only.",
    items: worklist,
  },
};
writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");

// ------------------------------------------------------------------ emit MD summary
const md: string[] = [];
md.push("# Zones SIG freshness/périmé inventory — geo-archi §3 (merged)");
md.push("");
md.push(`- Generated (UTC): ${out.generated_at_utc}`);
md.push(`- Read-only merge JOIN on \`slug\` of two committed layers. No network, no S3, no PDF re-parse.`);
md.push(`- Served munis: **${SERVED_TOTAL}** (one row each). Partitions asserted to close to ${SERVED_TOTAL}.`);
md.push("");
md.push("## Inputs (committed)");
md.push("");
md.push(`- Layer 1 (capture freshness): \`${out.inputs.layer1_freshness}\` (commit ${out.inputs.layer1_commit}), inventory key \`${L1_INV_KEY}\`.`);
md.push(`- Layer 2 (SIG↔DEPOSITED-normes mismatch, lower bound): \`${out.inputs.layer2_code_mismatch}\` (commit ${out.inputs.layer2_commit}).`);
md.push("");
md.push("## Three périmé axes (partitions close to 873)");
md.push("");
md.push("### 1. Capture freshness (retrieved_at)");
md.push("");
md.push("| class | munis |");
md.push("|---|---:|");
md.push(`| fresh | ${summary.freshness.fresh} |`);
md.push(`| source-gap | ${summary.freshness["source-gap"]} |`);
md.push(`| stale | ${summary.freshness.stale} |`);
md.push(`| **total** | **${summary.freshness.fresh + summary.freshness["source-gap"] + summary.freshness.stale}** |`);
md.push("");
md.push("### 2. Upstream vintage (explicit marker only)");
md.push("");
md.push("| class | munis |");
md.push("|---|---:|");
md.push(`| marker_suspect | ${summary.vintage_perime.marker_suspect} |`);
md.push(`| source-gap (not-measurable) | ${summary.vintage_perime["source-gap"]} |`);
md.push(`| **total** | **${summary.vintage_perime.marker_suspect + summary.vintage_perime["source-gap"]}** |`);
md.push("");
md.push("### 3. DEPOSITED-normes mismatch (LOWER BOUND on true perime)");
md.push("");
md.push("| class | munis |");
md.push("|---|---:|");
md.push(`| munis_with_mismatch | ${summary.deposited_mismatch.munis_with_mismatch} |`);
md.push(`| clean | ${summary.deposited_mismatch.clean} |`);
md.push(`| normes_source_gap (not-assessable) | ${summary.deposited_mismatch.normes_source_gap} |`);
md.push(`| assessable (mismatch + clean) | ${summary.deposited_mismatch.assessable} |`);
md.push(`| **total** | **${summary.deposited_mismatch.munis_with_mismatch + summary.deposited_mismatch.clean + summary.deposited_mismatch.normes_source_gap}** |`);
md.push("");
md.push(
  "> DEPOSITED-layer mismatch is a LOWER BOUND: `expandCategoryZonesToSig` relabels category norms onto the muni's own SIG codes and re-stamps, so a SIG-expanded deposit absorbs the SIG set and under-reports mismatch. True raw-grille-PDF perime is source-gap read-only (needs cluster PDFs).",
);
md.push("");
md.push("## Resource worklist (owner-gated, NOT executed)");
md.push("");
md.push(`- ${worklist.length} candidates, carried verbatim from layer 1, re-ordered.`);
md.push("- Order: #1 vintage-suspect (mont-tremblant, Ancien_zonage, superseded millésime 2008); then source-gaps by least-proven provenance (null-level < orphan < candidate < legacy-traceable < historical-verified < documented).");
md.push("");
md.push("Head of the worklist:");
md.push("");
md.push("| # | slug | reason | freshness | level |");
md.push("|---:|---|---|---|---|");
for (let i = 0; i < Math.min(12, worklist.length); i++) {
  const w = worklist[i];
  md.push(`| ${i + 1} | ${w.slug} | ${w.candidate_reason ?? ""} | ${w.freshness_class ?? ""} | ${w.zone_source_level ?? "null"} |`);
}
md.push("");
writeFileSync(OUT_MD, md.join("\n") + "\n", "utf8");

// ------------------------------------------------------------------ report
console.log("=== SUMMARY (partitions close to 873) ===");
console.log(JSON.stringify(summary, null, 2));
console.log(`rows: ${rows.length}  worklist: ${worklist.length}`);
console.log(`wrote ${OUT_JSON}`);
console.log(`wrote ${OUT_MD}`);
console.log("OK: all partitions closed to 873.");
