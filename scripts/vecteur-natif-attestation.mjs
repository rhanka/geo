#!/usr/bin/env node
// ATTESTATION QA du dépôt v2 ZONAGE VECTEUR NATIF (GOnet/ArcGIS FeatureServer).
// Rôle de garant : aucune capture vecteur natif ne se dépose sans passer cette
// attestation. Contrairement au raster (recalage-attestation.mjs : résidu / aniso
// / orientation / shear), le vecteur natif n'a AUCUN recalage — la géométrie vient
// déjà projetée de la source autoritaire. Les modes d'échec se déplacent donc :
//
//   Raster attestait la QUALITÉ GÉOMÉTRIQUE d'un recalage (erreur d'échelle/rotation).
//   Vecteur natif atteste l'IDENTITÉ, la RÉALITÉ et l'INTÉGRITÉ de la capture.
//
// PORTES DU BANC (v2 vecteur natif) — chacune PASS | FAIL | INDET (absente) :
//  G1 CAPTURE RÉELLE (anti-« ArcGIS = page HTML ») : http_status=200 ET GeoJSON
//     réellement parsé (feature_count≥1) ET geometry_type ∈ {Polygon,MultiPolygon}.
//     Mémoire ⭐⭐ capture-arcgis-page-html : « un 200 ne prouve rien » — un 200
//     SANS features parsées = FAIL (page HTML masquée), jamais PASS.
//  G2 INTÉGRITÉ / PREUVE v2 PAR CONSTRUCTION : source_url = endpoint FEATURE
//     (…/query?…f=geojson|f=json) ET retrieved_at ISO ET sha256 (64 hex) des octets.
//     C'est la preuve v2 exigée par putServedZoneGeojson (url réelle + retrieved_at
//     + sha256). Une URL de PAGE (pas /query…f=geojson) = FAIL.
//  G3 ANTI-INVENTION STRUCTUREL (gate lane zones) : zone_distinct≥3, zone_maxlen≤24,
//     bbox_diag≤35, champ zone (No_zone/Num_zone) peuplé (zone_nonnull_pct>0).
//  G4 IDENTITÉ / NON-CONTAMINATION : discriminant PRIMAIRE = `nearest_registre_muni
//     === slug` (la couche est attribuée au registre de la BONNE muni). Le
//     `registry_attribution_km` n'est qu'un PROXY spatial : < 1.1 km auto-propre,
//     mais ≥ 1.1 km sur une grande muni rurale est un simple offset centroïde↔point-
//     registre, PAS une contamination — d'où l'identité comme juge, le km en flag.
//     Mémoire ⛔ homonyme/contamination : une couche du bon nom mais de la MAUVAISE
//     muni doit tomber ici. Anti-invention : si `nearest_registre_muni` est ABSENT
//     et km ≥ 1.1, l'identité est INVÉRIFIABLE ⇒ INDET (jamais PASS sur la parole).
//
// lot-zone mismatch < 5 % : porte de VÉRIFICATION AVAL (post-dépôt, après fold lane
// lot) — PAS un bloqueur de dépôt (on ne peut pas plier avant de déposer la zone).
// Reporté ici en informatif quand une passe existe ; le dépôt n'en dépend pas.
//
// Anti-invention : métrique absente ⇒ porte INDET ⇒ verdict FAIL-INDET (on ne
// dépose jamais sur une preuve manquante). Read-only, déterministe, committé.
// Format & ruling : docs/spec/SPEC_QA_GATE_VECTEUR_NATIF.md.
//
// Usage :
//   node scripts/vecteur-natif-attestation.mjs --batch=<capture-manifest.json> [--out=<report.json>]
//   manifest = { cities:[ { slug, source_url, retrieved_at, sha256, http_status,
//                           feature_count, geometry_type, zone_field,
//                           zone_distinct, zone_maxlen, zone_nonnull_pct,
//                           bbox_diag, registry_attribution_km } ] }
//   (le manifeste de capture cluster EST la preuve — cf. principe fondateur.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const ARGV = process.argv.slice(2);
const opt = (n, d = null) => {
  const p = `--${n}=`;
  const v = ARGV.find((a) => a.startsWith(p));
  return v === undefined ? d : v.slice(p.length);
};

// ---- BANC (constantes vecteur natif) ---------------------------------------
const BANC = {
  http_ok: 200,
  polygon_types: ['Polygon', 'MultiPolygon'],
  feature_min: 1,
  // gate anti-invention lane zones (cité : 3b7120c3 / f4bf07f0)
  zone_distinct_min: 3,
  zone_maxlen_max: 24,
  bbox_diag_max: 35,
  // preuve v2 par construction
  sha256_hex_len: 64,
  feature_url_re: /[?&]f=(geo)?json\b/i, // endpoint FEATURE, pas page HTML
  // identité / non-contamination : le proxy km tight ; l'identité (nearest==slug)
  // est le juge quand elle est fournie.
  registry_attribution_km_tight: 1.1,
};

function readJson(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
}

// lot-zone mismatch par slug (dernière passe) — INFORMATIF post-dépôt.
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

// ---- logique PURE du banc : métriques -> verdict (testable sans fichiers) ---
function attestFromMetrics(m, meta = {}) {
  const gate = (val, ok) => (val === null || val === undefined ? 'INDET' : ok ? 'PASS' : 'FAIL');
  // sha256 peut être préfixé « sha256: » (convention du repo) — on strippe avant test.
  const stripSha = (s) => (typeof s === 'string' ? s.replace(/^sha256:/i, '') : s);
  const isHex = (s, n) => { const v = stripSha(s); return typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`, 'i').test(v); };
  const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s);

  const gates = {
    // G1 capture réelle (anti-HTML) : 200 + features parsées + polygone.
    capture_reelle: (m.http_status == null && m.feature_count == null)
      ? 'INDET'
      : gate(1, m.http_status === BANC.http_ok &&
                typeof m.feature_count === 'number' && m.feature_count >= BANC.feature_min &&
                BANC.polygon_types.includes(m.geometry_type)),
    // G2 intégrité / preuve v2 : url feature + retrieved_at + sha256.
    integrite_preuve_v2: gate(m.source_url,
      typeof m.source_url === 'string' && BANC.feature_url_re.test(m.source_url) &&
      isIso(m.retrieved_at) && isHex(m.sha256, BANC.sha256_hex_len)),
    // G3 anti-invention structurel.
    anti_invention: (m.zone_distinct == null && m.zone_maxlen == null && m.bbox_diag == null)
      ? 'INDET'
      : gate(1, typeof m.zone_distinct === 'number' && m.zone_distinct >= BANC.zone_distinct_min &&
                typeof m.zone_maxlen === 'number' && m.zone_maxlen <= BANC.zone_maxlen_max &&
                typeof m.bbox_diag === 'number' && m.bbox_diag <= BANC.bbox_diag_max &&
                (m.zone_nonnull_pct == null || m.zone_nonnull_pct > 0)),
    // G4 identité / non-contamination.
    //  - `nearest_registre_muni` fourni : c'est le JUGE. nearest===slug ⇒ PASS
    //    (km informatif) ; nearest≠slug ⇒ FAIL (contamination avérée).
    //  - champ absent : repli sur le PROXY km. km<1.1 ⇒ PASS (contamination
    //    implausible) ; km≥1.1 ⇒ identité invérifiable ⇒ INDET (jamais PASS sur
    //    parole) ; km absent ⇒ INDET.
    non_contamination: (() => {
      if (!meta.slug) return 'FAIL';
      if (m.nearest_registre_muni != null) return m.nearest_registre_muni === meta.slug ? 'PASS' : 'FAIL';
      if (typeof m.registry_attribution_km !== 'number') return 'INDET';
      return m.registry_attribution_km < BANC.registry_attribution_km_tight ? 'PASS' : 'INDET';
    })(),
  };

  // G5 superset — CONDITIONNELLE (dépôt de REMPLACEMENT seulement). Quand la
  // capture remplace une couche servie PLUS RICHE (orphelin d'une source tierce
  // réelle, p.ex. geomatiquecn-arcgis — PAS un Voronoï), le dépôt ne doit pas
  // RÉGRESSER la couverture : les codes servis antérieurs doivent être ⊆ des codes
  // captés. « superset » doit être PROUVÉ (deux ensembles dans le manifeste), pas
  // affirmé. Gate absente s'il n'y a pas de remplacement (prior_served_codes vide).
  let supersetMissing = null;
  if (Array.isArray(m.prior_served_codes) && m.prior_served_codes.length) {
    if (!Array.isArray(m.zone_codes)) {
      gates.superset_no_regression = 'INDET'; // codes captés non fournis : invérifiable
    } else {
      const captured = new Set(m.zone_codes.map(String));
      supersetMissing = m.prior_served_codes.map(String).filter((c) => !captured.has(c));
      gates.superset_no_regression = supersetMissing.length ? 'FAIL' : 'PASS';
    }
  }

  const failed = Object.entries(gates).filter(([, v]) => v === 'FAIL').map(([k]) => k);
  const indet = Object.entries(gates).filter(([, v]) => v === 'INDET').map(([k]) => k);
  let verdict, motif;
  if (failed.length) {
    verdict = 'FAIL-BANC';
    motif = `porte(s) échouée(s): ${failed.join(', ')}`;
    if (supersetMissing && supersetMissing.length) motif += ` [régression codes: ${supersetMissing.join(',')}]`;
  } else if (indet.length) { verdict = 'FAIL-INDET'; motif = `métrique(s) absente(s), non déposable: ${indet.join(', ')}`; }
  else { verdict = 'PASS-BANC'; motif = 'capture v2 vecteur natif réelle, intègre, non contaminée'; }

  return {
    slug: meta.slug ?? null, verdict, motif, gates,
    metrics: m,
    superset_missing_codes: supersetMissing,
    lot_zone_mismatch_pct_post_depot: meta.lot_zone_mismatch_pct ?? null, // informatif
  };
}

function attest(entry, lotZone) {
  const lz = lotZone.get(entry.slug) ?? null;
  const m = {
    source_url: entry.source_url ?? null,
    retrieved_at: entry.retrieved_at ?? null,
    sha256: entry.sha256 ?? null,
    http_status: entry.http_status ?? null,
    feature_count: entry.feature_count ?? null,
    geometry_type: entry.geometry_type ?? null,
    zone_field: entry.zone_field ?? null,
    zone_distinct: entry.zone_distinct ?? null,
    zone_maxlen: entry.zone_maxlen ?? null,
    zone_nonnull_pct: entry.zone_nonnull_pct ?? null,
    bbox_diag: entry.bbox_diag ?? null,
    registry_attribution_km: entry.registry_attribution_km ?? null,
    nearest_registre_muni: entry.nearest_registre_muni ?? null,
    zone_codes: entry.zone_codes ?? null,                     // G5 : codes captés
    prior_served_codes: entry.prior_served_codes ?? null,     // G5 : codes servis à ne pas régresser
  };
  return attestFromMetrics(m, {
    slug: entry.slug,
    lot_zone_mismatch_pct: typeof lz?.mismatch_pct === 'number' ? lz.mismatch_pct : null,
  });
}

function run(batch) {
  const { map: lotZone, source: lzSource } = loadLotZoneMismatch();
  const lines = (batch.cities ?? []).map((e) => attest(e, lotZone));
  const pass = lines.filter((l) => l.verdict === 'PASS-BANC');
  const fail = lines.filter((l) => l.verdict !== 'PASS-BANC');
  const motifsFail = {};
  for (const l of fail) motifsFail[l.verdict] = (motifsFail[l.verdict] ?? 0) + 1;
  return {
    contract: 'vecteur-natif-attestation/v1',
    banc: BANC,
    lot_zone_source_post_depot: lzSource,
    total: lines.length,
    pass_banc: pass.length,
    fail: fail.length,
    fail_breakdown: motifsFail,
    aggregate: `${pass.length} vecteur-natif PASS-banc / ${fail.length} FAIL`,
    attestations: lines,
  };
}

// export pour test unitaire du banc (logique pure sans fichiers).
export { attestFromMetrics, BANC };

function main() {
  const batchPath = opt('batch');
  if (!batchPath) { console.error('requis: --batch=<capture-manifest.json>'); process.exit(2); }
  const batchAbs = path.isAbsolute(batchPath) ? batchPath : path.resolve(ROOT, batchPath);
  const batch = readJson(batchPath);
  if (!batch) { console.error(`manifest illisible: ${batchPath}`); process.exit(2); }
  const report = run(batch);
  // provenance du manifeste attesté (reproductibilité : preuve de CE qu'on a attesté).
  const manifestRef = opt('manifest-ref') ?? path.relative(ROOT, batchAbs);
  report.source_manifest = {
    ref: manifestRef,
    contract: batch.contract ?? null,
    sha256: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(batchAbs)).digest('hex'),
  };
  const out = opt('out');
  if (out) {
    fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(report, null, 2) + '\n');
    console.log(`écrit: ${out}`);
  }
  console.log(JSON.stringify({ aggregate: report.aggregate, fail_breakdown: report.fail_breakdown,
    verdicts: report.attestations.map((a) => ({ slug: a.slug, verdict: a.verdict, motif: a.motif })) }, null, 2));
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
