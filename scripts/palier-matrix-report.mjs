#!/usr/bin/env node
// MATRICE PALIER par-ville × 20 KPI — tableau de bord du sprint (mesure par
// PALIER), à côté du portfolio 1106. Lignes = cohorte de slugs (défaut SET-30
// sélection A = priorityRank<=30 du set-167-bprime ; extensible au 167).
// Colonnes = 20 KPI. Chaque cellule = complete | incomplete | unknown | N-A.
//
// Décision owner (20260803, RÉVISÉE) : les 20 KPI comptent TOUS dans la cible —
// la preuve-v2 exacte (col 10) ET le recall/précision v3.4 (col 20) sont DANS la
// gate, plus aucune colonne exclue. %/ville calculé sur les 20 KPI applicables
// (N-A hors dénominateur). Le résultat v3.4 (col 20) est VISIBLE et compte comme
// absent tant qu'aucune source per-ville n'est intégrée (anti-invention). Ce
// rapport porte DEUX vues : complétion (état fin) ET présence (donnée là).
//
// C'est un PIVOT par-ville des mêmes matrices de complétion committées que le
// portfolio agrège ; il n'invente aucune donnée. Anti-invention ABSOLU :
// entrée manquante -> unknown, jamais deviné ; Δ par diff de snapshots datés,
// jamais fabriqué (unknown≠complete).
//
// Format FIGÉ : docs/spec/SPEC_PALIER_MATRIX.md (corriger le générateur, pas la
// sortie). Usage :
//   node scripts/palier-matrix-report.mjs                 # SET-30, écrit md+json datés
//   node scripts/palier-matrix-report.mjs --check         # valide (fermeture + déterminisme)
//   node scripts/palier-matrix-report.mjs --date=YYYYMMDD # force la date
//   node scripts/palier-matrix-report.mjs --cohort=work/coverage/<liste>.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { latestZoneProvenanceQualityMatrix } from './lib/latest-coverage-matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes('--check');
const WARNINGS = [];
const warn = (m) => WARNINGS.push(m);

function optArg(name, fallback = null) {
  const p = `--${name}=`;
  const v = ARGV.find((a) => a.startsWith(p));
  return v === undefined ? fallback : v.slice(p.length);
}
function todayYYYYMMDD() {
  const forced = optArg('date');
  if (forced) { if (!/^\d{8}$/.test(forced)) throw new Error('--date doit être YYYYMMDD'); return forced; }
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

// ---- résolution de sources (log de provenance) ----------------------------
const sha256File = (p) => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function pickLatestByPrefix(dir, re) {
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null;
}
// Sélection AUTORITAIRE par champ horodaté interne (pas par nom) — comme le
// générateur regdens : deux fichiers du même jour se départagent par contenu.
function pickLatestByField(dir, re, field) {
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => {
    const p = path.join(dir, f);
    let ts = '';
    try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); ts = String(o[field] ?? o?.$meta?.[field] ?? ''); } catch { ts = ''; }
    return { p, ts, f };
  }).sort((a, b) => a.ts.localeCompare(b.ts) || a.f.localeCompare(b.f));
  return cands.length ? cands[cands.length - 1].p : null;
}
const RESOLVED = [];
function loadJson(role, absPath, { optional = false } = {}) {
  if (!absPath || !fs.existsSync(absPath)) {
    if (!optional) warn(`source absente: ${role}`);
    RESOLVED.push({ role, path: absPath ? path.relative(ROOT, absPath) : null, present: false });
    return null;
  }
  RESOLVED.push({ role, path: path.relative(ROOT, absPath), sha256: sha256File(absPath), present: true });
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

const qualityMatrixName = latestZoneProvenanceQualityMatrix(fs.existsSync(COV) ? fs.readdirSync(COV) : []);
const SRC = {
  zones: loadJson('zones-completion', pickLatestByPrefix(COV, /^completion-1-zones-matrix-\d{8}\.json$/)),
  normes: loadJson('normes-completion', pickLatestByPrefix(COV, /^completion-1-normes-matrix-\d{8}\.json$/)),
  coherence: loadJson('lot-zone-consistency', pickLatestByPrefix(COV, /^lot-zone-consistency-scale-\d{8}\.json$/)),
  pv: loadJson('pv-completion-declared', path.join(COV, 'pv-completion-city-audit.json')),
  pvCaptured: loadJson('pv-couverture-captee', pickLatestByPrefix(COV, /^pv-couverture-municipale-.*\.json$/)),
  // Cols 5/6/7 : source UNIFIÉE per-city fournie par reglement (owner cols 5/6/7,
  // cf. SPEC_PALIER_OWNERSHIP §3) — slug→{reglement_declared, reglement_proven,
  // usage_dominant, effet_densifiant}, cohérente avec les totals regdens du portfolio.
  regdensPerCity: loadJson('regdens-per-city', pickLatestByPrefix(COV, /^completion-regdens-percity-\d{8}\.json$/)),
  quality: loadJson('zone-provenance-quality', qualityMatrixName ? path.join(COV, qualityMatrixName) : null),
  readback: loadJson('zone-source-readback', pickLatestByPrefix(COV, /^zone-source-readback-audit-\d{8}\.json$/)),
  immoLotZone: loadJson('immo-lot-zone', pickLatestByPrefix(COV, /^immo-lot-zone-assignment-matrix-\d{8}\.json$/)),
  immoFolded: loadJson('immo-folded-normes', pickLatestByPrefix(COV, /^immo-folded-normes-city-matrix-\d{8}\.json$/)),
  immoField: loadJson('immo-field-completion', path.join(ROOT, 'work', 'immo-field-completion-matrices', 'immo-field-completion-matrix.json')),
  // col 20 = recall directionnel v3.4. Source AUTORITAIRE : classif rigoureuse
  // jointures b16d7947 (zoning-events-col20-167-fresh-geofix-20260807.json,
  // na_proven=15 attestés recette, measured+recall_pct threshold). Miroir local
  // committé dans work/coverage/ ; fallback jointures worktree.
  col20: (() => {
    const localPath = path.join(COV, 'zoning-events-col20-167-fresh-geofix-20260807.json');
    const joinPath = path.resolve(ROOT, '../jointures/work/coverage/zoning-events-col20-167-fresh-geofix-20260807.json');
    const p = fs.existsSync(localPath) ? localPath : fs.existsSync(joinPath) ? joinPath : null;
    return loadJson('col20-recall-v34-b16d7947', p, { optional: true });
  })(),
};

// ---- index par-ville -------------------------------------------------------
const STATES = ['complete', 'incomplete', 'unknown', 'N-A'];
function normState(v) {
  if (v === 'N/A' || v === 'not_applicable' || v === 'N-A') return 'N-A';
  if (v === 'complete' || v === 'incomplete' || v === 'unknown') return v;
  return null;
}
function indexBy(list, key) {
  const m = new Map();
  if (Array.isArray(list)) for (const row of list) if (row && row[key] != null) m.set(row[key], row);
  return m;
}
function bucketIndex(cityBuckets) {
  const m = new Map();
  if (cityBuckets && typeof cityBuckets === 'object') {
    for (const [state, slugs] of Object.entries(cityBuckets)) {
      const s = normState(state);
      if (!s || !Array.isArray(slugs)) continue;
      for (const slug of slugs) m.set(slug, s);
    }
  }
  return m;
}
// Le col-20 existe en DEUX contrats committés par la lane jointures :
//  (a) ancien échantillon 6-villes : { generated_at, rows[] }, vocab statut
//      { measured | immo-gt-pending } ;
//  (b) 167-GT S3 (AUTORITAIRE, qc-zoning-events-col20-s3gt) : { $meta.generated_at,
//      cities[] }, vocab statut { measured | no_geo_events | gap_acquisition }.
// On NORMALISE vers le vocab du générateur SANS fabriquer d'état : le statut de la
// lane est traduit 1:1 (no_geo_events = GT présente mais geo muet → measured-geo-empty
// = incomplete ; gap_acquisition = GT immo absente → immo-gt-pending = unknown). Anti-
// invention : aucune ville ajoutée, aucun statut deviné — seule l'orthographe du statut
// et le nom des champs de détail sont alignés. Le fichier le plus récent (par
// generated_at OU $meta.generated_at) l'emporte : le 167-GT supplante l'échantillon 6.
// na_proven = N-A PROUVÉ par la lane jointures (PV parsés, 0 DesignationEvent
// densifiant, attestation OPTIONA_NA_FINAL) → RÉSOLU par preuve d'absence, PAS
// unknown. gap_acquisition (GT immo absente) reste unknown (immo-gt-pending).
const COL20_STATUT = { no_geo_events: 'measured-geo-empty', gap_acquisition: 'immo-gt-pending', na_proven: 'N-A', complete: 'measured', incomplete: 'measured-geo-empty', gap: 'immo-gt-pending' };
// Seuil recall : measured & recall_pct >= 0.95 → 'measured' (complete) ; sinon
// 'measured-geo-empty' (incomplete). Règle rigoureuse jointures b16d7947 : na_proven
// = SEULEMENT 15 villes attestées recette (liste fermée), JAMAIS inféré d'un GT vide.
const RECALL_THRESHOLD = 0.95;
function normalizeCol20(src) {
  if (!src) return [];
  const list = Array.isArray(src.cities) ? src.cities : Array.isArray(src.rows) ? src.rows : [];
  return list.map((r) => {
    const rawStatut = r.statut ?? r.bucket;
    let statut = COL20_STATUT[rawStatut] ?? rawStatut;
    // Pour les villes 'measured' : appliquer le seuil recall pour distinguer complete vs incomplete.
    if (rawStatut === 'measured') {
      const recall = r.recall_pct_si_mesurable ?? r.recall_pct ?? null;
      statut = (recall != null && recall >= RECALL_THRESHOLD) ? 'measured' : 'measured-geo-empty';
    }
    return {
      slug: r.slug,
      statut,
      geo_events_count: r.geo_events_count ?? r.geo_events ?? null,
      immo_gt_events: r.immo_gt_events ?? r.immo_events ?? null,
      matched: r.matched ?? null,
      recall_pct_si_mesurable: r.recall_pct_si_mesurable ?? r.recall_pct ?? null,
    };
  });
}
const IDX = {
  zones: indexBy(SRC.zones?.cities, 'slug'),
  normes: indexBy(SRC.normes?.cities, 'slug'),
  coherence: indexBy(SRC.coherence?.cities, 'slug'),
  pv: indexBy(SRC.pv?.cities, 'slug'),
  regdensPerCity: indexBy(SRC.regdensPerCity?.cities, 'slug'),
  pvCaptured: new Set((SRC.pvCaptured?.municipal_coverage?.slugs ?? []).map((s) => s.slug)),
  quality: indexBy(SRC.quality?.rows, 'city_slug'),
  readback: indexBy(SRC.readback?.details, 'slug'),
  immoLotZone: bucketIndex(SRC.immoLotZone?.city_buckets),
  immoFolded: bucketIndex(SRC.immoFolded?.city_buckets),
  immoField: indexBy(SRC.immoField?.cities, 'slug'),
  col20: indexBy(normalizeCol20(SRC.col20), 'slug'),
};
// Les artefacts autoritaires disambiguent les homonymes par un suffixe MRC avec
// DOUBLE tiret (`hemmingford--les-jardins-de-napierville`) là où la cohorte
// set-167-bprime porte le tiret SIMPLE. Ce n'est pas deux villes : c'est la même
// entité, orthographe de slug divergente. makeNormMap → index secondaire par slug
// NORMALISÉ (tirets multiples → un seul) ; lu() = fallback STRICT après échec
// exact, jamais de rapprochement flou. Anti-invention : aucun état fabriqué,
// on retrouve l'état DÉJÀ mesuré sous l'orthographe que la jointure naïve manquait.
const normSlug = (s) => String(s).replace(/-+/g, '-');
function makeNormMap(map) {
  const m = new Map();
  for (const [k, v] of map) { const n = normSlug(k); if (!m.has(n)) m.set(n, v); }
  return m;
}
const lu = (exact, norm, s) => exact.get(s) ?? norm.get(normSlug(s));
const immoFieldNorm = makeNormMap(IDX.immoField);
const zonesNorm = makeNormMap(IDX.zones);
const normesNorm = makeNormMap(IDX.normes);
const coherenceNorm = makeNormMap(IDX.coherence);
const pvNorm = makeNormMap(IDX.pv);
const regdensNorm = makeNormMap(IDX.regdensPerCity);
const qualityNorm = makeNormMap(IDX.quality);
const readbackNorm = makeNormMap(IDX.readback);
const immoLotZoneNorm = makeNormMap(IDX.immoLotZone);
const immoFoldedNorm = makeNormMap(IDX.immoFolded);
const pvCapturedNorm = new Set([...IDX.pvCaptured].map(normSlug));
const col20Norm = makeNormMap(IDX.col20);
const col20Row = (s) => IDX.col20.get(s) ?? col20Norm.get(normSlug(s));

// ---- extracteurs par KPI (état pour UN slug) -------------------------------
const U = 'unknown';
const stateFrom = (row, field) => (row ? (normState(row[field]) ?? U) : U);
function immoFieldStatus(slug, field) {
  const row = IDX.immoField.get(slug) ?? immoFieldNorm.get(normSlug(slug));
  if (!row || !row[field]) return U;
  return normState(row[field].status) ?? U;
}
const qualityRow = (s) => lu(IDX.quality, qualityNorm, s) ?? null;
const GAP_V34 = 'PARTIEL: recall v3.4 immo→geo intégré (artefact jointures WP5 par-ville) ; per-ville uniquement là où la GT immo existe — reste unknown ailleurs (167 bloqué sur 2 handoffs immo : liste + export 161)';

// PLAFONDS EXTERNES (contexte d'arbitrage owner) : l'incomplete/unknown de ces
// colonnes n'est PAS librement acquérable — un mur documentaire ou de recalage
// le borne. C'est un CONTEXTE annoté, jamais un N-A fabriqué (anti-invention :
// N-A seulement si PROUVÉ que la donnée n'existe pas — ici on ne peut pas le
// prouver, donc l'état reste incomplete/unknown, mais on DIT le plafond).
const CEILINGS = {
  effet_densifiant: 'plafond DOCUMENTAIRE : l\'effet densifiant n\'est établi que si le document le porte (amendement ne recouvre pas l\'original) — gisement rare ; l\'incomplete/unknown est majoritairement NON acquérable à court terme.',
  prov_v2: 'plafond RECALAGE : ~48% des URL de preuve sont MORTES ; la re-capture v2 plafonne (~52%). Campagne LONGUE (DANS la gate depuis la révision owner) ; le vecteur natif GOnet/ArcGIS débloque une partie de ce plafond.',
  v34_qc_zoning_events: 'plafond MATURITÉ : recall v3.4 (WP5) MESURABLE seulement là où la GT immo existe — quelques villes à ce jour ; 167 bloqué sur 2 handoffs immo (liste + export 161). DANS la gate ; per-ville dès handoff.',
};

const COLUMNS = [
  { n: 1, key: 'zones', label: 'Zones — complétion', extract: (s) => stateFrom(lu(IDX.zones, zonesNorm, s), 'state') },
  { n: 2, key: 'coherence_lot_zone', label: 'Zones — cohérence lot-zone', extract: (s) => {
      const r = lu(IDX.coherence, coherenceNorm, s);
      if (!r || r.status !== 'measured' || typeof r.mismatch_pct !== 'number') return U;
      return r.mismatch_pct < 5 ? 'complete' : 'incomplete';
    } },
  { n: 3, key: 'normes', label: 'Normes — complétion', extract: (s) => stateFrom(lu(IDX.normes, normesNorm, s), 'state') },
  // col 4 = PV CAPTÉ (présence honnête, pas déclaratif). Principe fondateur :
  // « vert par omission = rouge » — une ville à ZÉRO octet PV indexé n'est PAS
  // complete même si le coverage-status déclaratif dit "done". complete ssi ≥1 PV
  // INDEXED owner-confirmé (pv-couverture-municipale) ; le déclaratif ne sert plus
  // qu'à distinguer N-A (hors périmètre prouvé) et incomplete (attendu, non capté).
  { n: 4, key: 'pv', label: 'PV — capté (indexé)', presence_strict: true, extract: (s) => {
      const decl = normState(lu(IDX.pv, pvNorm, s)?.state) ?? U;
      if (decl === 'N-A') return 'N-A';
      if (IDX.pvCaptured.has(s) || pvCapturedNorm.has(normSlug(s))) return 'complete';
      return decl === 'complete' || decl === 'incomplete' ? 'incomplete' : U;
    } },
  // col 5 = règlement sur les DEUX axes (conducteur) : preuve-capture live =
  // complete ; déclaré (reglement_numero connu) mais non prouvé live = incomplete ;
  // ni déclaré ni prouvé = unknown. Détail declared/proven exposé en JSON.
  { n: 5, key: 'reglement', label: 'Règlement — déclarée+preuve', extract: (s) => {
      const r = lu(IDX.regdensPerCity, regdensNorm, s);
      if (!r) return U;
      const declared = normState(r.reglement_declared) ?? U;
      const proven = normState(r.reglement_proven) ?? U;
      if (proven === 'complete') return 'complete';
      if (declared === 'complete' || proven === 'incomplete') return 'incomplete';
      return U;
    }, detail: (s) => {
      const r = lu(IDX.regdensPerCity, regdensNorm, s);
      return { declared: r ? (normState(r.reglement_declared) ?? U) : U, proven: r ? (normState(r.reglement_proven) ?? U) : U };
    } },
  { n: 6, key: 'usage_dominant', label: 'Usage dominant — complétion', extract: (s) => stateFrom(lu(IDX.regdensPerCity, regdensNorm, s), 'usage_dominant') },
  { n: 7, key: 'effet_densifiant', label: 'Effet densifiant — complétion', extract: (s) => stateFrom(lu(IDX.regdensPerCity, regdensNorm, s), 'effet_densifiant') },
  { n: 8, key: 'prov_jointure', label: 'Provenance — jointure exacte', extract: (s) => {
      const r = qualityRow(s); return r && r.collection_key ? 'complete' : U;
    } },
  { n: 9, key: 'prov_qualite', label: 'Provenance — qualité retained', extract: (s) => {
      const r = qualityRow(s);
      if (!r) return U;
      if (r.quality_status === 'acceptable' || r.quality_status === 'v2') return 'complete';
      if (r.quality_status === 'candidate' || r.quality_status === 'orphan') return 'incomplete';
      return U;
    } },
  { n: 10, key: 'prov_v2', label: 'Provenance — PREUVE v2 exacte', v2_track: true, extract: (s) => {
      const r = qualityRow(s);
      if (!r) return U;
      if (r.quality_status === 'v2') return 'complete';
      if (r.quality_status === 'acceptable' || r.quality_status === 'candidate' || r.quality_status === 'orphan') return 'incomplete';
      return U;
    } },
  { n: 11, key: 'prov_url_servie', label: 'Provenance — URL source servie', extract: (s) => {
      const r = lu(IDX.readback, readbackNorm, s);
      if (!r || r.read_error) return U;
      if (r.status === 'STAMPED') return 'complete';
      if (r.status === 'STAMPED_NULL' || r.status === 'UNSTAMPED') return 'incomplete';
      return U;
    } },
  { n: 12, key: 'immo_lot_zone', label: 'Immo — assignation lot-zone', extract: (s) => lu(IDX.immoLotZone, immoLotZoneNorm, s) || U },
  { n: 13, key: 'immo_normes_pliees', label: 'Immo — normes pliées', extract: (s) => lu(IDX.immoFolded, immoFoldedNorm, s) || U },
  // Cols 14-19 = champs immo, mesurés PAR SLUG depuis l'artefact immo autoritaire
  // (immo-field-completion, qui défère lui-même aux verdicts immo par-ville :
  // adresse-completion, etc.). Cette mesure est INDÉPENDANTE du match zonage-
  // events (col 20) dont dérive `graph_matched` : une ville UNMATCHED dans
  // set-167-bprime (donc absente du graphe v3.4) peut avoir des lots immo SERVIS
  // et une adresse PROUVÉE au rôle. Bloquer ces colonnes à unknown pour une telle
  // ville, c'est affirmer unknown sur un complete PROUVÉ — une invention à
  // l'envers. `slug_measured` lève la porte graphe pour ces 6 KPI : ils suivent
  // leur verdict per-slug autoritaire sur la cohorte ENTIÈRE (dénominateur 167).
  { n: 14, key: 'immo_lots_servis', label: 'Immo — lots servis', slug_measured: true, extract: (s) => immoFieldStatus(s, 'lots_served') },
  { n: 15, key: 'immo_surface', label: 'Immo — surface m²', slug_measured: true, extract: (s) => immoFieldStatus(s, 'surface_m2') },
  { n: 16, key: 'immo_code_postal', label: 'Immo — code postal', slug_measured: true, extract: (s) => immoFieldStatus(s, 'postal_code') },
  { n: 17, key: 'immo_adresse', label: 'Immo — adresse civique', slug_measured: true, extract: (s) => immoFieldStatus(s, 'civic_address') },
  { n: 18, key: 'tod_applicabilite', label: 'Immo — applicabilité TOD', slug_measured: true, extract: (s) => immoFieldStatus(s, 'tod_applicability') },
  { n: 19, key: 'tod_completion', label: 'Immo — complétion TOD', slug_measured: true, extract: (s) => immoFieldStatus(s, 'tod_completion') },
  { n: 20, key: 'v34_qc_zoning_events', label: 'Recall+précision v3.4 qc-zoning-events', gap: GAP_V34, extract: (s) => {
      const r = col20Row(s);
      if (!r) return U;                                  // hors périmètre mesuré → GAP unknown (anti-invention, jamais fabriqué)
      if (r.statut === 'measured') return 'complete';    // recall MESURÉ (GT immo présente) → résolu
      if (r.statut === 'N-A') return 'N-A';              // na_proven : absence PROUVÉE (0 event densifiant, attestation) → résolu
      if (r.statut === 'measured-geo-empty') return 'incomplete'; // GT existe mais geo n'émet rien
      return U;                                          // immo-gt-pending → GT immo absente → unknown (null jamais inventé)
    }, detail: (s) => {
      const r = col20Row(s);
      if (!r) return undefined;
      return { statut: r.statut, geo_events_count: r.geo_events_count, immo_gt_events: r.immo_gt_events, matched: r.matched, recall_pct_si_mesurable: r.recall_pct_si_mesurable };
    } },
];

// présence = donnée là. Par défaut : état déterminé (complete|incomplete) = present,
// unknown = absent, N-A hors gate. Colonne `presence_strict` (mesure binaire captée,
// p.ex. PV capté) : SEUL `complete` (capté) est present — un `incomplete` déclaratif
// (attendu mais 0 octet capté) est ABSENT (principe fondateur : vert par omission = rouge).
const presenceOf = (state, strict) => {
  if (state === 'N-A') return 'N-A';
  if (strict) return state === 'complete' ? 'present' : 'absent';
  return state === 'unknown' ? 'absent' : 'present';
};

// ---- cohorte & snapshot précédent -----------------------------------------
function loadCohort() {
  const p = path.resolve(ROOT, optArg('cohort', 'work/coverage/palier-matrix-cohort-167.json'));
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(j.cities)) throw new Error('cohorte invalide: cities[] requis');
  return { path: path.relative(ROOT, p), cohort: j.cohort ?? null, source: j.source ?? null, cities: j.cities };
}
function findPrevSnapshot(todayNum) {
  if (!fs.existsSync(COV)) return null;
  const files = fs.readdirSync(COV)
    .map((f) => f.match(/^palier-matrix-30x167-(\d{8})\.json$/))
    .filter(Boolean)
    .map((m) => ({ date: m[1], num: parseInt(m[1], 10) }))
    .filter((x) => x.num < parseInt(todayNum, 10))
    .sort((a, b) => a.num - b.num);
  if (!files.length) return null;
  const chosen = files[files.length - 1];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(COV, `palier-matrix-30x167-${chosen.date}.json`), 'utf8'));
    const idx = new Map();
    for (const r of data.rows || []) idx.set(r.slug, r.cells || {});
    return { date: chosen.date, idx };
  } catch (e) { warn(`snapshot précédent illisible: ${chosen.date} — ${e.message}`); return null; }
}

// ---- construction ----------------------------------------------------------
function build(todayNum) {
  const cohort = loadCohort();
  const prev = findPrevSnapshot(todayNum);
  const rows = cohort.cities.map((c) => {
    const pending = c.graph_matched === false;
    const cells = {}, deltas = {}, details = {};
    for (const col of COLUMNS) {
      // Porte graphe : une ville PENDING-GRAPH-NODE a ses colonnes DÉRIVÉES du
      // graphe zonage-events blanchies (unknown) — sauf les colonnes `slug_measured`
      // (champs immo per-slug), qui restent mesurées depuis leur artefact autoritaire.
      const state = (pending && !col.slug_measured) ? U : col.extract(c.slug);
      cells[col.key] = state;
      if (!pending && col.detail) { const d = col.detail(c.slug); if (d !== undefined) details[col.key] = d; }
      // Δ par cellule : diff avec le snapshot daté précédent ; jamais fabriqué.
      if (!prev) deltas[col.key] = '—';
      else {
        const before = prev.idx.get(c.slug)?.[col.key];
        deltas[col.key] = before === undefined ? 'new' : before === state ? '·' : `${before}→${state}`;
      }
    }
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    for (const col of COLUMNS) counts[cells[col.key]]++;
    // Présence (gate) : les 20 KPI comptent (décision owner révisée — aucune
    // colonne exclue) ; dénominateur = KPI applicables (non N-A) sur les 20.
    let present = 0, absent = 0, na = 0;
    for (const col of COLUMNS) {
      const pr = presenceOf(cells[col.key], col.presence_strict);
      if (pr === 'present') present++; else if (pr === 'absent') absent++; else na++;
    }
    const presDenom = present + absent;
    return {
      priorityRank: c.priorityRank ?? null, slug: c.slug, graph_matched: c.graph_matched !== false,
      flag: pending ? 'PENDING-GRAPH-NODE' : null,
      cells, deltas, details: Object.keys(details).length ? details : undefined, counts,
      completion_complete_over_20: counts.complete,
      presence: { present, absent, na_excluded: na, denom_applicable: presDenom, pct: presDenom > 0 ? Math.round((present / presDenom) * 1000) / 10 : null },
    };
  });

  const matched = rows.filter((r) => r.graph_matched);
  const pendingRows = rows.filter((r) => !r.graph_matched);
  const perKpi = COLUMNS.map((col) => {
    // Dénominateur PAR KPI : les colonnes `slug_measured` (champs immo per-slug,
    // mesurés indépendamment du match graphe) comptent sur la cohorte ENTIÈRE
    // (167) ; les colonnes dérivées du graphe comptent sur les villes matchées
    // (les PENDING sont unknown+drapeau, hors dénominateur graphe).
    const scope = col.slug_measured ? rows : matched;
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    let present = 0;
    for (const r of scope) { counts[r.cells[col.key]]++; if (presenceOf(r.cells[col.key], col.presence_strict) === 'present') present++; }
    const applicable = counts.complete + counts.incomplete + counts.unknown; // hors N-A
    return {
      n: col.n, key: col.key, label: col.label, gap: col.gap ?? null, v2_track: !!col.v2_track,
      slug_measured: !!col.slug_measured, denom: scope.length,
      ceiling: CEILINGS[col.key] ?? null,
      acquirable_incomplete: counts.incomplete + counts.unknown, // incomplete + unknown = potentiellement acquérable (hors plafond annoté)
      counts, complete_over_matched: `${counts.complete}/${scope.length}`,
      cities_100pct: counts.complete, // villes à 100% sur CE KPI = complete
      pct_complete: scope.length ? Math.round((counts.complete / scope.length) * 1000) / 10 : null,
      present, pct_present: applicable ? Math.round((present / applicable) * 1000) / 10 : null,
    };
  });

  const errs = [];
  for (const r of rows) {
    const tot = STATES.reduce((s, st) => s + r.counts[st], 0);
    if (tot !== COLUMNS.length) errs.push(`ville ${r.slug}: partition cellules ${tot} ≠ ${COLUMNS.length}`);
  }
  for (const k of perKpi) {
    const tot = STATES.reduce((s, st) => s + k.counts[st], 0);
    if (tot !== k.denom) errs.push(`KPI ${k.key}: partition villes ${tot} ≠ ${k.denom}`);
  }
  // Rollup présence global (gate mercredi) sur les villes matchées.
  const summarize = (set) => {
    const presPct = set.map((r) => r.presence.pct).filter((p) => p != null);
    return {
      cities_scored: set.length,
      cities_full_presence: set.filter((r) => r.presence.absent === 0).length,
      cities_full_completion: set.filter((r) => r.counts.incomplete === 0 && r.counts.unknown === 0).length,
      mean_presence_pct: presPct.length ? Math.round((presPct.reduce((a, b) => a + b, 0) / presPct.length) * 10) / 10 : null,
    };
  };
  const presenceGate = {
    axis: 'présence (donnée là) sur les 20 KPI — AUCUNE colonne exclue (cols 10 preuve-v2 & 20 v3.4 INCLUSES, décision owner révisée)',
    gate_columns: COLUMNS.length,
    ...summarize(matched),
  };
  // Vue 30 (palier 1) comme SOUS-ENSEMBLE du 167 : priorityRank<=30, matchées.
  const subset30 = summarize(matched.filter((r) => (r.priorityRank ?? 999) <= 30));

  return {
    contract: 'palier-matrix/v1',
    generatedAt: new Date().toISOString(),
    reportDate: `${todayNum.slice(0, 4)}-${todayNum.slice(4, 6)}-${todayNum.slice(6, 8)}`,
    previousSnapshotDate: prev ? prev.date : null,
    owner_target: 'CIBLE = 100%-RÉSOLU sur les 20 KPI (0 unknown : complete OU N-A prouvé) ; les 20 comptent, cols 10 (preuve-v2) & 20 (v3.4) INCLUSES ; %/ville sur 20 applicables.',
    cohort: { name: cohort.cohort, source: cohort.source, path: cohort.path, cities: rows.length, graph_matched: matched.length, pending_graph_node: pendingRows.length },
    columns: COLUMNS.map((c) => ({ n: c.n, key: c.key, label: c.label, gap: c.gap ?? null, v2_track: !!c.v2_track, gate_excluded: !!c.gate_excluded, presence_strict: !!c.presence_strict, slug_measured: !!c.slug_measured, ceiling: CEILINGS[c.key] ?? null })),
    anti_invention: 'Entrée manquante -> unknown ; jamais deviné. PENDING-GRAPH-NODE : toutes cellules unknown + drapeau, exclues des dénominateurs. Δ par diff de snapshots datés, jamais fabriqué. Col 20 (v3.4) : GAP jusqu\'à source per-city.',
    presence_gate: presenceGate,
    subset_palier1_rank_le_30: subset30,
    rows, per_kpi: perKpi, sources: RESOLVED,
    validation: { closed: errs.length === 0, errors: errs },
    warnings: WARNINGS.slice(),
  };
}

// ---- rendu markdown --------------------------------------------------------
const GLYPH = { complete: '●', incomplete: '◐', unknown: '·', 'N-A': '—' };
function renderMarkdown(p) {
  const L = [];
  L.push(`# Matrice palier par-ville × 20 KPI — ${p.cohort.name ?? 'cohorte'}`);
  L.push('');
  L.push(`Date : ${p.reportDate}${p.previousSnapshotDate ? ` · Précédent : ${p.previousSnapshotDate}` : ' · aucun snapshot antérieur (Δ = «—»)'} · ${p.cohort.cities} villes (${p.cohort.graph_matched} matchées + ${p.cohort.pending_graph_node} PENDING-GRAPH-NODE) · 20 KPI.`);
  L.push(`Cible owner : ${p.owner_target}`);
  L.push('');
  const g = p.presence_gate, s30 = p.subset_palier1_rank_le_30;
  L.push(`**Gate PRÉSENCE (les 20 KPI)** — 167 : ${g.cities_full_presence}/${g.cities_scored} villes à présence complète (0 KPI absent sur les 20, cols 10 & 20 INCLUSES) · présence moyenne ${g.mean_presence_pct ?? '—'}%. Palier 1 (rang≤30) : ${s30.cities_full_presence}/${s30.cities_scored} · moyenne ${s30.mean_presence_pct ?? '—'}%.`);
  L.push('');
  L.push(`Villes à 100% COMPLÉTION (tous KPI applicables complete) — 167 : ${g.cities_full_completion}/${g.cities_scored} · palier 1 : ${s30.cities_full_completion}/${s30.cities_scored}.`);
  L.push('');
  L.push('Légende cellule : ● complete · ◐ incomplete · · unknown · — N-A. Col 5 = déclarée+preuve ; cols 10 (preuve-v2) & 20 (v3.4) comptent DANS la gate (décision owner révisée) ; %/ville sur les 20 applicables.');
  L.push('');
  L.push('| # | Ville | ' + p.columns.map((c) => c.n + (c.v2_track ? '¹⁰' : '')).join(' | ') + ' | présence | compl |');
  L.push('|---:|---|' + p.columns.map(() => ':-:').join('|') + '|---:|---:|');
  for (const r of p.rows) {
    const tag = r.flag ? ' ⚠' : '';
    const cells = p.columns.map((c) => GLYPH[r.cells[c.key]] ?? '?').join(' | ');
    const pres = r.presence.pct == null ? '—' : `${r.presence.present}/${r.presence.denom_applicable} ${r.presence.pct}%`;
    L.push(`| ${r.priorityRank ?? ''} | ${r.slug}${tag} | ${cells} | ${pres} | ${r.completion_complete_over_20}/20 |`);
  }
  L.push('');
  L.push('## Colonnes (KPI) — sur les villes matchées graphe');
  L.push('');
  L.push('Par KPI (villes matchées) : complete / incomplete / unknown / N-A. `incomplete+unknown` = potentiellement ACQUÉRABLE ; ⛰ = plafond externe annoté (contexte owner, PAS un N-A fabriqué).');
  L.push('');
  L.push('| # | KPI | dénom | ✓compl | ◐inc | ·unk | —N-A | %compl | à 100% | plafond / note |');
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const k of p.per_kpi) {
    const note = k.ceiling ? '⛰ ' + k.ceiling : k.gap ? '⚠ ' + k.gap : '';
    const denom = `${k.denom}${k.slug_measured ? ' §' : ''}`;
    L.push(`| ${k.n} | ${k.label} | ${denom} | ${k.counts.complete} | ${k.counts.incomplete} | ${k.counts.unknown} | ${k.counts['N-A']} | ${k.pct_complete == null ? '—' : k.pct_complete + '%'} | ${k.cities_100pct} | ${note} |`);
  }
  L.push('');
  L.push(`> Dénominateurs : colonnes dérivées du graphe sur les ${p.cohort.graph_matched} villes matchées (les ${p.cohort.pending_graph_node} PENDING-GRAPH-NODE exclues, lignes visibles) ; **§ colonnes immo per-slug (14-19) sur la cohorte ENTIÈRE ${p.cohort.cities}** — mesurées depuis l'artefact immo autoritaire, indépendamment du match graphe (une ville UNMATCHED peut avoir lots servis + adresse prouvée). Présence = état ≠ unknown, N-A hors dénominateur ; les 20 KPI comptent (cols 10 & 20 incluses).`);
  L.push('');
  L.push('## Sources (provenance)');
  L.push('');
  for (const s of p.sources) L.push(`- ${s.present ? '' : '⚠ ABSENTE — '}\`${s.path ?? '(non résolue)'}\`${s.sha256 ? ' — ' + s.sha256 : ''} (${s.role})`);
  if (p.warnings.length) { L.push(''); L.push('## Avertissements'); L.push(''); for (const w of p.warnings) L.push(`- ${w}`); }
  L.push('');
  return L.join('\n');
}

// ---- main ------------------------------------------------------------------
function main() {
  const todayNum = todayYYYYMMDD();
  const payload = build(todayNum);
  if (CHECK) {
    const p2 = build(todayNum);
    const strip = (p) => JSON.stringify({ ...p, generatedAt: null });
    const errs = [...payload.validation.errors];
    if (strip(payload) !== strip(p2)) errs.push('Sortie non déterministe entre deux constructions.');
    if (errs.length) { console.error('CHECK ÉCHOUÉ :'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
    console.log('CHECK OK — partitions cellules & KPI fermées, déterministe, unknown≠complete.');
    console.log(`Villes: ${payload.cohort.cities} (${payload.cohort.graph_matched} matchées, ${payload.cohort.pending_graph_node} pending) · KPI: ${payload.columns.length} · sources: ${payload.sources.filter((s) => s.present).length}/${payload.sources.length} · gate présence ${payload.presence_gate.cities_full_presence}/${payload.presence_gate.cities_scored}`);
    for (const w of payload.warnings) console.log('  ! ' + w);
    return;
  }
  if (!payload.validation.closed) for (const e of payload.validation.errors) warn('VALIDATION: ' + e);
  const md = renderMarkdown(payload);
  fs.mkdirSync(COV, { recursive: true });
  const mdPath = path.join(COV, `palier-matrix-30x167-${todayNum}.md`);
  const jsonPath = path.join(COV, `palier-matrix-30x167-${todayNum}.json`);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(md);
  console.log('\nFichiers écrits :');
  console.log('  ' + path.relative(ROOT, mdPath));
  console.log('  ' + path.relative(ROOT, jsonPath));
}

const IS_MAIN = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (IS_MAIN) main();
export { build };
