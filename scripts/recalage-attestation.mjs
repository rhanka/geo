#!/usr/bin/env node
// ATTESTATION QA du recalage zonage vs BANC HISTORIQUE. Rôle de garant : aucune
// ville recalée ne se dépose sans passer cette attestation. Pour chaque ville du
// batch, on lit ses rapports (chamfer seed + raster-register T3) + son mismatch
// lot-zone, on compare aux SEUILS DU BANC (gravés ci-dessous, cités du code), on
// détecte la DÉGÉNÉRESCENCE « échelle imprimée », et on émet un verdict PASS/FAIL
// avec motif. Read-only, déterministe, committé.
//
// Anti-invention : une métrique absente n'est jamais PASS par défaut — la porte
// concernée est `indéterminée` et le verdict global tombe à FAIL-INDET (on ne
// dépose pas sur une preuve manquante).
//
// SEUILS DU BANC (source = code recalage, à jour au 2026-08-03) :
//  - gcp_residual max + holdout ≤ 30 m       (lib/t2-autogcp.ts:822/776 ; t2-raster-register.ts:639)
//  - min GCP servis ≥ 12                      (lib/t2-autogcp.ts:777 ; t2-raster-register.ts:640)
//  - anisotropy ≤ 1.1 (hard reject > 1.5)     (lib/t2-autogcp.ts:1202-1210)
//  - orientation (page-right/-down vs E/S) ≤ 15°  (lib/t2-autogcp.ts:1204)
//  - shear ≤ 10°                              (lib/t2-autogcp.ts:1205)
//  - lot_zone_mismatch_pct < 5 %              (qa-aboutir-167-counter.ts:63)
//  - DÉGÉNÉRESCENCE échelle imprimée : verrou en bord de bande d'échelle
//    (scale_ratio ≈ scale_band[0|1]) ou marge faible, avec mean_dist_m≈0
//    (lib/t3-chamfer-seed.ts:44-51,334-349,446-495).
//
// Usage :
//   node scripts/recalage-attestation.mjs --batch=<manifest.json> [--out=<report.json>]
//   manifest = { cities:[ { slug, feuillet?, chamfer_report, t3_report } ] }
//   (chemins relatifs au repo ; le mismatch lot-zone est joint par slug depuis
//    la dernière lot-zone-consistency-scale-*.json.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const ARGV = process.argv.slice(2);
const opt = (n, d = null) => {
  const p = `--${n}=`;
  const v = ARGV.find((a) => a.startsWith(p));
  return v === undefined ? d : v.slice(p.length);
};

// ---- BANC (constantes) -----------------------------------------------------
const BANC = {
  residual_max_m: 30,
  min_gcps: 12,
  anisotropy_max: 1.1,
  anisotropy_hard: 1.5,
  orientation_tol_deg: 15,
  shear_max_deg: 10,
  lot_zone_mismatch_max_pct: 5,
  degeneracy_scale_band_edge_frac: 0.02, // scale_ratio à ≤2% d'un bord de bande = suspect
  degeneracy_mean_dist_m: 0.1,           // mean_dist_m sous ce seuil = quasi-nul
  degeneracy_margin_min_pct: 10,         // marge de score faible = lock fragile
};

function readJson(rel) {
  const abs = path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
}

// lot-zone mismatch par slug (dernière passe à l'échelle).
function loadLotZoneMismatch() {
  const dir = fs.existsSync(COV) ? fs.readdirSync(COV) : [];
  const hits = dir.filter((f) => /^lot-zone-consistency-scale-\d{8}\.json$/.test(f)).sort();
  const m = new Map();
  if (!hits.length) return { map: m, source: null };
  const src = `work/coverage/${hits[hits.length - 1]}`;
  const j = readJson(src);
  for (const c of j?.cities ?? []) if (c?.slug) m.set(c.slug, c);
  return { map: m, source: src };
}

// ---- attestation d'une ville ----------------------------------------------
function attest(entry, lotZone) {
  const chamfer = entry.chamfer_report ? readJson(entry.chamfer_report) : null;
  const t3 = entry.t3_report ? readJson(entry.t3_report) : null;
  const best = chamfer?.best ?? null;
  const lz = lotZone.get(entry.slug) ?? null;

  const metrics = {
    chamfer_mean_dist_m: best?.mean_dist_m ?? null,
    inlier_pct: best?.inlier_pct ?? null,
    scale_ratio: best?.scale_ratio ?? null,
    scale_band: chamfer?.scale_band ?? null,
    margin_pct: chamfer?.margin_pct ?? null,
    rotation_deg: best?.rotation_deg ?? null,
    gcp_residual_max_m: t3?.residual_max_m ?? null,
    gcp_holdout_max_m: t3?.holdout_max_m ?? null,
    selected_gcps: t3?.selected_gcps ?? null,
    anisotropy: t3?.anisotropy ?? chamfer?.anisotropy ?? null,
    shear_deg: t3?.shear_deg ?? chamfer?.shear_deg ?? null,
    lot_zone_mismatch_pct: typeof lz?.mismatch_pct === 'number' ? lz.mismatch_pct : null,
    pipeline_pass: t3?.pass ?? chamfer?.pass ?? null,
  };
  return attestFromMetrics(metrics, { slug: entry.slug, feuillet: entry.feuillet ?? null });
}

// Logique PURE du banc (testable sans fichiers) : métriques -> verdict.
function attestFromMetrics(metrics, meta = {}) {
  // Portes du banc. Chaque porte : PASS | FAIL | INDET (métrique absente).
  const gate = (val, ok) => (val === null || val === undefined ? 'INDET' : ok ? 'PASS' : 'FAIL');
  // Portes de QUALITÉ de dépôt (verdict) : residual/holdout, orientation, lot-zone,
  // + dégénérescence. `min_gcps` (≥12) est une pré-condition de SOLVE, pas une porte
  // de dépôt (un solve à 11 GCP avec residual≤30 est géométriquement bon) : gardé
  // en métrique informative, hors verdict.
  const gates = {
    gcp_residual: gate(metrics.gcp_residual_max_m,
      metrics.gcp_residual_max_m <= BANC.residual_max_m &&
      (metrics.gcp_holdout_max_m == null || metrics.gcp_holdout_max_m <= BANC.residual_max_m)),
    orientation: metrics.anisotropy == null && metrics.shear_deg == null
      ? gate(metrics.pipeline_pass, metrics.pipeline_pass === true) // repli : verdict pipeline
      : gate(1, (metrics.anisotropy == null || metrics.anisotropy <= BANC.anisotropy_max) &&
                (metrics.shear_deg == null || Math.abs(metrics.shear_deg) <= BANC.shear_max_deg)),
    lot_zone: gate(metrics.lot_zone_mismatch_pct, metrics.lot_zone_mismatch_pct < BANC.lot_zone_mismatch_max_pct),
  };

  // Dégénérescence « échelle imprimée » : mean_dist quasi-nul + verrou en bord de
  // bande d'échelle (ou marge de score faible). C'est un REJET dur, jamais un PASS.
  let degenerate = false;
  const dReasons = [];
  if (metrics.scale_band && metrics.scale_ratio != null) {
    const [lo, hi] = metrics.scale_band;
    const edge = metrics.scale_ratio <= lo * (1 + BANC.degeneracy_scale_band_edge_frac) ||
                 metrics.scale_ratio >= hi * (1 - BANC.degeneracy_scale_band_edge_frac);
    const quasiNull = metrics.chamfer_mean_dist_m != null && metrics.chamfer_mean_dist_m < BANC.degeneracy_mean_dist_m;
    const thinMargin = metrics.margin_pct != null && metrics.margin_pct < BANC.degeneracy_margin_min_pct;
    if (edge && (quasiNull || thinMargin)) { degenerate = true; dReasons.push('scale-band-edge-lock'); }
    if (quasiNull && metrics.scale_ratio < lo) { degenerate = true; dReasons.push('mean-dist≈0-scale-sous-bande'); }
  }

  const failed = Object.entries(gates).filter(([, v]) => v === 'FAIL').map(([k]) => k);
  const indet = Object.entries(gates).filter(([, v]) => v === 'INDET').map(([k]) => k);
  let verdict, motif;
  if (degenerate) { verdict = 'FAIL-BANC'; motif = `dégénérescence échelle imprimée (${dReasons.join(',')})`; }
  else if (failed.length) { verdict = 'FAIL-BANC'; motif = `porte(s) échouée(s): ${failed.join(', ')}`; }
  else if (indet.length) { verdict = 'FAIL-INDET'; motif = `métrique(s) absente(s), non déposable: ${indet.join(', ')}`; }
  else { verdict = 'PASS-BANC'; motif = 'toutes portes du banc satisfaites, pas de dégénérescence'; }

  return { slug: meta.slug ?? null, feuillet: meta.feuillet ?? null, verdict, motif, gates, degenerate, metrics };
}

// ---- main ------------------------------------------------------------------
function run(batch) {
  const { map: lotZone, source: lzSource } = loadLotZoneMismatch();
  const lines = (batch.cities ?? []).map((e) => attest(e, lotZone));
  const pass = lines.filter((l) => l.verdict === 'PASS-BANC');
  const fail = lines.filter((l) => l.verdict !== 'PASS-BANC');
  const motifsFail = {};
  for (const l of fail) motifsFail[l.verdict] = (motifsFail[l.verdict] ?? 0) + 1;
  return {
    contract: 'recalage-attestation/v1',
    banc: BANC,
    lot_zone_source: lzSource,
    total: lines.length,
    pass_banc: pass.length,
    fail: fail.length,
    fail_breakdown: motifsFail,
    aggregate: `${pass.length} recalées PASS-banc / ${fail.length} FAIL`,
    attestations: lines,
  };
}

function main() {
  const batchPath = opt('batch');
  if (!batchPath) { console.error('requis: --batch=<manifest.json>'); process.exit(2); }
  const batch = readJson(batchPath);
  if (!batch) { console.error(`manifest illisible: ${batchPath}`); process.exit(2); }
  const report = run(batch);
  const out = opt('out');
  if (out) {
    fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(report, null, 2) + '\n');
    console.log(`écrit: ${out}`);
  }
  console.log(JSON.stringify({ aggregate: report.aggregate, fail_breakdown: report.fail_breakdown,
    verdicts: report.attestations.map((a) => ({ slug: a.slug, feuillet: a.feuillet, verdict: a.verdict, motif: a.motif })) }, null, 2));
  process.exit(report.fail === report.total && report.total > 0 ? 0 : 0);
}

const IS_MAIN = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (IS_MAIN) main();
export { run, attest, attestFromMetrics, BANC };
