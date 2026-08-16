/**
 * _zones-pdf-recalage-scan-20260811.ts
 *
 * READ-ONLY diagnostic probe (g-cond shovel-ready prep).
 *
 * Purpose: assemble, BY CONSTRUCTION from committed campaign records, the in-cohort
 * (B-prime 167) PDF-recalage candidate residue — the munis whose zones v2 gap can
 * only be closed by georeferencing a plan (no live vector source-identity endpoint).
 * It joins:
 *   - overlap-bprime167-vs-geo-20260802.json      (the 167 cohort membership + buckets)
 *   - zones-recalage-status-167-20260803T003500Z.json (authoritative recale_status)
 *   - the 2026-08-10 vnatif discovery/deposit residue (RIEN / SKIP / held reasons)
 *
 * It ONLY reads committed files under work/coverage/. It NEVER captures, deposits,
 * or writes to S3/cluster. Tiering (T1-T4 / other-gap) is applied in the worklist
 * builder from the ACTUAL source evidence, not invented here.
 *
 * Usage: npx tsx acquisition/src/_zones-pdf-recalage-scan-20260811.ts [index|dump <sub>|join]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COV = join(ROOT, "work", "coverage");
const R = (p: string) => readFileSync(join(COV, p), "utf8");
const J = (p: string) => JSON.parse(R(p));

// slug normalisation: collapse double-tiret to single, strip trailing "-2"/region tails
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/--/g, "-")
    .replace(/\s+/g, "-");
}

const mode = process.argv[2] || "join";

if (mode === "validate") {
  const wl = J("zones-pdf-recalage-worklist-incohort-20260811.json");
  const rows = wl.candidates as any[];
  const byTier: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  let inCohort = 0;
  for (const r of rows) {
    byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    byConf[r.tier_confidence] = (byConf[r.tier_confidence] || 0) + 1;
    if (r.in_cohort_167) inCohort++;
  }
  console.log(JSON.stringify({
    parse_ok: true,
    candidate_rows: rows.length,
    in_cohort_rows: inCohort,
    by_tier: byTier,
    by_tier_confidence: byConf,
    summary_declared: wl.summary.by_tier_in_cohort,
  }, null, 2));
} else if (mode === "join") {
  const overlap = J("overlap-bprime167-vs-geo-20260802.json");
  const status = J("zones-recalage-status-167-20260803T003500Z.json");

  // 167 cohort membership (normalized) -> bucket
  const cohort = new Map<string, string>();
  for (const [bucket, arr] of Object.entries<string[]>(overlap.buckets)) {
    for (const s of arr) cohort.set(norm(s), bucket);
  }
  // also graph_city_slug forms from unmatched
  for (const u of overlap.unmatched || []) {
    if (u.graph_city_slug) cohort.set(norm(u.graph_city_slug), u.bucket_par_graph);
  }

  // recale_status per slug
  const recale = new Map<string, string>();
  for (const c of status.cities) recale.set(norm(c.slug), c.recale_status);

  // priorityRank from overlap recapture_target (only the 6 proof_v1_dead carry it)
  const rank = new Map<string, number>();
  for (const t of overlap.recapture_target || []) rank.set(norm(t.slug), t.priorityRank);

  // residue candidates from the 2026-08-10 discovery + deposit residue
  const discoveryFiles = [
    "zones-vnatif-discovery-20260810.json",
    "zones-vnatif-discovery-lot2-20260810.json",
    "zones-vnatif-discovery-lot3-20260810.json",
    "zones-vnatif-discovery-geomsuspect-20260810.json",
    "zones-vnatif-discovery-lot4-20260810.json",
    "zones-vnatif-discovery-lot5-20260810.json",
  ];
  const residue = new Map<string, { slug: string; sources: string[]; verdicts: Set<string> }>();
  const add = (slug: string, src: string, verdict: string) => {
    const k = norm(slug);
    if (!residue.has(k)) residue.set(k, { slug, sources: [], verdicts: new Set() });
    const e = residue.get(k)!;
    if (!e.sources.includes(src)) e.sources.push(src);
    e.verdicts.add(verdict);
  };
  for (const f of discoveryFiles) {
    const arr = J(f);
    for (const row of arr) {
      const v = (row.status || row.verdict || "").toString().toLowerCase();
      // keep only NOT-found (rien/raster/held) — found/vecteur_trouve = served, excluded
      if (v.includes("found") || v.includes("vecteur_trouve")) continue;
      add(row.slug, f.replace("zones-vnatif-discovery-", "").replace("-20260810.json", ""), v);
    }
  }
  // explicit in-cohort PDF/other residue from deposit records (otherhttp/backlog/lot3)
  const manual: Array<[string, string, string]> = [
    ["saint-amable", "otherhttp-deposit", "rien-pdf-only"],
    ["hemmingford--les-jardins-de-napierville--2", "otherhttp-deposit", "rien-pdf-only"],
  ];
  for (const [s, src, v] of manual) add(s, src, v);

  // emit joined rows, in-cohort first
  const rows = [...residue.values()].map((e) => {
    const k = norm(e.slug);
    return {
      slug: e.slug,
      in_cohort_167: cohort.has(k),
      cohort_bucket: cohort.get(k) || null,
      recale_status: recale.get(k) || null,
      priority_rank: rank.get(k) ?? null,
      residue_sources: e.sources,
      verdicts: [...e.verdicts],
    };
  });
  rows.sort((a, b) => Number(b.in_cohort_167) - Number(a.in_cohort_167) || a.slug.localeCompare(b.slug));

  const inCohort = rows.filter((r) => r.in_cohort_167);
  const inCohortGap = inCohort.filter(
    (r) => r.recale_status === "recale_missing" || r.recale_status === "unresolved" || r.recale_status === null,
  );
  console.log(JSON.stringify({
    total_residue: rows.length,
    in_cohort: inCohort.length,
    in_cohort_recale_gap: inCohortGap.length,
    in_cohort_already_served: inCohort.filter((r) => r.recale_status === "deja_v2_servi" || r.recale_status === "recale_ok").length,
    rows,
  }, null, 2));
}
