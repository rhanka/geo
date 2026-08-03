#!/usr/bin/env node
// MATRICE PALIER par-ville × 20 KPI — tableau de bord du sprint (mesure par
// PALIER), à côté du portfolio 1106. Lignes = cohorte de slugs (défaut SET-30
// sélection A = priorityRank<=30 du set-167-bprime ; extensible au 167).
// Colonnes = 20 KPI. Chaque cellule = complete | incomplete | unknown | N-A.
//
// Décision owner (20260803) : la CIBLE MERCREDI est la PRÉSENCE (donnée là) sur
// les 30 ; la preuve-v2 exacte (col 10) est une campagne LONGUE séparée, PAS la
// gate. Ce rapport porte donc DEUX vues : complétion (état fin) ET présence
// (donnée présente = état ≠ unknown), col 10 exclue de la gate présence.
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
    try { ts = String(JSON.parse(fs.readFileSync(p, 'utf8'))[field] ?? ''); } catch { ts = ''; }
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
  reglDeclared: loadJson('reglement-declared-registry', path.join(ROOT, 'acquisition', 'config', 'reglement-provenance.json')),
  reglProven: loadJson('reglement-capture-kpi', pickLatestByField(COV, /^reglement-capture-kpi-.*\.json$/, 'generated_at')),
  usage: loadJson('usage-dominant-enrichment', path.join(COV, 'zonage-enrichment.json')),
  effet: loadJson('effet-densifiant-bprime', pickLatestByField(COV, /^effet-densifiant-bprime-acquisition-universe-.*\.json$/, 'universe_rule')),
  quality: loadJson('zone-provenance-quality', qualityMatrixName ? path.join(COV, qualityMatrixName) : null),
  readback: loadJson('zone-source-readback', pickLatestByPrefix(COV, /^zone-source-readback-audit-\d{8}\.json$/)),
  immoLotZone: loadJson('immo-lot-zone', pickLatestByPrefix(COV, /^immo-lot-zone-assignment-matrix-\d{8}\.json$/)),
  immoFolded: loadJson('immo-folded-normes', pickLatestByPrefix(COV, /^immo-folded-normes-city-matrix-\d{8}\.json$/)),
  immoField: loadJson('immo-field-completion', path.join(ROOT, 'work', 'immo-field-completion-matrices', 'immo-field-completion-matrix.json')),
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
const REGL_PROVEN = { capture_inchange: 'complete', jamais_capture: 'incomplete', change: 'incomplete', unknown: 'unknown' };
const EFFET = { known: 'complete', absent: 'incomplete', unknown_only: 'unknown', unserved: 'unknown' };

const IDX = {
  zones: indexBy(SRC.zones?.cities, 'slug'),
  normes: indexBy(SRC.normes?.cities, 'slug'),
  coherence: indexBy(SRC.coherence?.cities, 'slug'),
  pv: indexBy(SRC.pv?.cities, 'slug'),
  reglDeclared: new Map(SRC.reglDeclared?.slugs ? Object.entries(SRC.reglDeclared.slugs) : []),
  reglProven: indexBy(SRC.reglProven?.cities, 'city_slug'),
  usage: indexBy(SRC.usage?.perMuni, 'slug'),
  effet: indexBy(SRC.effet?.rows, 'slug'),
  pvCaptured: new Set((SRC.pvCaptured?.municipal_coverage?.slugs ?? []).map((s) => s.slug)),
  quality: indexBy(SRC.quality?.rows, 'city_slug'),
  readback: indexBy(SRC.readback?.details, 'slug'),
  immoLotZone: bucketIndex(SRC.immoLotZone?.city_buckets),
  immoFolded: bucketIndex(SRC.immoFolded?.city_buckets),
  immoField: indexBy(SRC.immoField?.cities, 'slug'),
};

// ---- extracteurs par KPI (état pour UN slug) -------------------------------
const U = 'unknown';
const stateFrom = (row, field) => (row ? (normState(row[field]) ?? U) : U);
function immoFieldStatus(slug, field) {
  const row = IDX.immoField.get(slug);
  if (!row || !row[field]) return U;
  return normState(row[field].status) ?? U;
}
const qualityRow = (s) => IDX.quality.get(s) || null;
const GAP_V34 = 'GAP: aucune source recall/précision v3.4 qc-zoning-events (jointures WP5)';

// PLAFONDS EXTERNES (contexte d'arbitrage owner) : l'incomplete/unknown de ces
// colonnes n'est PAS librement acquérable — un mur documentaire ou de recalage
// le borne. C'est un CONTEXTE annoté, jamais un N-A fabriqué (anti-invention :
// N-A seulement si PROUVÉ que la donnée n'existe pas — ici on ne peut pas le
// prouver, donc l'état reste incomplete/unknown, mais on DIT le plafond).
const CEILINGS = {
  effet_densifiant: 'plafond DOCUMENTAIRE : l\'effet densifiant n\'est établi que si le document le porte (amendement ne recouvre pas l\'original) — gisement rare ; l\'incomplete/unknown est majoritairement NON acquérable à court terme.',
  prov_v2: 'plafond RECALAGE : ~48% des URL de preuve sont MORTES ; la re-capture v2 plafonne (~52%). Campagne LONGUE, hors gate mercredi.',
  v34_qc_zoning_events: 'plafond MATURITÉ : recall/précision v3.4 immature (WP5, jointures L1) et non per-ville — aucune donnée per-ville à ce jour.',
};

const COLUMNS = [
  { n: 1, key: 'zones', label: 'Zones — complétion', extract: (s) => stateFrom(IDX.zones.get(s), 'state') },
  { n: 2, key: 'coherence_lot_zone', label: 'Zones — cohérence lot-zone', extract: (s) => {
      const r = IDX.coherence.get(s);
      if (!r || r.status !== 'measured' || typeof r.mismatch_pct !== 'number') return U;
      return r.mismatch_pct < 5 ? 'complete' : 'incomplete';
    } },
  { n: 3, key: 'normes', label: 'Normes — complétion', extract: (s) => stateFrom(IDX.normes.get(s), 'state') },
  // col 4 = PV CAPTÉ (présence honnête, pas déclaratif). Principe fondateur :
  // « vert par omission = rouge » — une ville à ZÉRO octet PV indexé n'est PAS
  // complete même si le coverage-status déclaratif dit "done". complete ssi ≥1 PV
  // INDEXED owner-confirmé (pv-couverture-municipale) ; le déclaratif ne sert plus
  // qu'à distinguer N-A (hors périmètre prouvé) et incomplete (attendu, non capté).
  { n: 4, key: 'pv', label: 'PV — capté (indexé)', presence_strict: true, extract: (s) => {
      const decl = normState(IDX.pv.get(s)?.state) ?? U;
      if (decl === 'N-A') return 'N-A';
      if (IDX.pvCaptured.has(s)) return 'complete';
      return decl === 'complete' || decl === 'incomplete' ? 'incomplete' : U;
    } },
  // col 5 = règlement sur les DEUX axes (conducteur) : preuve-capture live =
  // complete ; déclaré (reglement_numero connu) mais non prouvé live = incomplete ;
  // ni déclaré ni prouvé = unknown. Détail declared/proven exposé en JSON.
  { n: 5, key: 'reglement', label: 'Règlement — déclarée+preuve', extract: (s) => {
      const d = IDX.reglDeclared.get(s);
      const declared = d ? (d.reglement_numero != null ? 'complete' : 'incomplete') : U;
      const p = IDX.reglProven.get(s);
      const proven = p ? (REGL_PROVEN[p.state] ?? U) : U;
      if (proven === 'complete') return 'complete';
      if (declared === 'complete' || proven === 'incomplete') return 'incomplete';
      return U;
    }, detail: (s) => {
      const d = IDX.reglDeclared.get(s);
      const p = IDX.reglProven.get(s);
      return { declared: d ? (d.reglement_numero != null ? 'complete' : 'incomplete') : U, proven: p ? (REGL_PROVEN[p.state] ?? U) : U };
    } },
  { n: 6, key: 'usage_dominant', label: 'Usage dominant — complétion', extract: (s) => {
      const r = IDX.usage.get(s);
      if (!r || typeof r.usage_dominant !== 'boolean') return U;
      return r.usage_dominant ? 'complete' : 'incomplete';
    } },
  { n: 7, key: 'effet_densifiant', label: 'Effet densifiant — complétion', extract: (s) => {
      const r = IDX.effet.get(s);
      if (!r) return U;
      return EFFET[r.state] ?? U;
    } },
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
  { n: 10, key: 'prov_v2', label: 'Provenance — PREUVE v2 exacte', v2_track: true, gate_excluded: true, extract: (s) => {
      const r = qualityRow(s);
      if (!r) return U;
      if (r.quality_status === 'v2') return 'complete';
      if (r.quality_status === 'acceptable' || r.quality_status === 'candidate' || r.quality_status === 'orphan') return 'incomplete';
      return U;
    } },
  { n: 11, key: 'prov_url_servie', label: 'Provenance — URL source servie', extract: (s) => {
      const r = IDX.readback.get(s);
      if (!r || r.read_error) return U;
      if (r.status === 'STAMPED') return 'complete';
      if (r.status === 'STAMPED_NULL' || r.status === 'UNSTAMPED') return 'incomplete';
      return U;
    } },
  { n: 12, key: 'immo_lot_zone', label: 'Immo — assignation lot-zone', extract: (s) => IDX.immoLotZone.get(s) || U },
  { n: 13, key: 'immo_normes_pliees', label: 'Immo — normes pliées', extract: (s) => IDX.immoFolded.get(s) || U },
  { n: 14, key: 'immo_lots_servis', label: 'Immo — lots servis', extract: (s) => immoFieldStatus(s, 'lots_served') },
  { n: 15, key: 'immo_surface', label: 'Immo — surface m²', extract: (s) => immoFieldStatus(s, 'surface_m2') },
  { n: 16, key: 'immo_code_postal', label: 'Immo — code postal', extract: (s) => immoFieldStatus(s, 'postal_code') },
  { n: 17, key: 'immo_adresse', label: 'Immo — adresse civique', extract: (s) => immoFieldStatus(s, 'civic_address') },
  { n: 18, key: 'tod_applicabilite', label: 'Immo — applicabilité TOD', extract: (s) => immoFieldStatus(s, 'tod_applicability') },
  { n: 19, key: 'tod_completion', label: 'Immo — complétion TOD', extract: (s) => immoFieldStatus(s, 'tod_completion') },
  { n: 20, key: 'v34_qc_zoning_events', label: 'Recall+précision v3.4 qc-zoning-events', gap: GAP_V34, gate_excluded: true, extract: () => U },
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
      const state = pending ? U : col.extract(c.slug);
      cells[col.key] = state;
      if (!pending && col.detail) details[col.key] = col.detail(c.slug);
      // Δ par cellule : diff avec le snapshot daté précédent ; jamais fabriqué.
      if (!prev) deltas[col.key] = '—';
      else {
        const before = prev.idx.get(c.slug)?.[col.key];
        deltas[col.key] = before === undefined ? 'new' : before === state ? '·' : `${before}→${state}`;
      }
    }
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    for (const col of COLUMNS) counts[cells[col.key]]++;
    // Présence (gate mercredi) : cols hors-gate (10 preuve-v2 piste longue, 20
    // v3.4 non mesurable) EXCLUES ; dénominateur = KPI applicables (non N-A).
    let present = 0, absent = 0, na = 0;
    for (const col of COLUMNS) {
      if (col.gate_excluded) continue;
      const pr = presenceOf(cells[col.key], col.presence_strict);
      if (pr === 'present') present++; else if (pr === 'absent') absent++; else na++;
    }
    const presDenom = present + absent;
    return {
      priorityRank: c.priorityRank ?? null, slug: c.slug, graph_matched: c.graph_matched !== false,
      flag: pending ? 'PENDING-GRAPH-NODE' : null,
      cells, deltas, details: Object.keys(details).length ? details : undefined, counts,
      completion_complete_over_20: counts.complete,
      presence: { present, absent, na_excluded: na, denom_excl_v2: presDenom, pct: presDenom > 0 ? Math.round((present / presDenom) * 1000) / 10 : null },
    };
  });

  const matched = rows.filter((r) => r.graph_matched);
  const pendingRows = rows.filter((r) => !r.graph_matched);
  const perKpi = COLUMNS.map((col) => {
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    let present = 0;
    for (const r of matched) { counts[r.cells[col.key]]++; if (presenceOf(r.cells[col.key], col.presence_strict) === 'present') present++; }
    const applicable = counts.complete + counts.incomplete + counts.unknown; // hors N-A
    return {
      n: col.n, key: col.key, label: col.label, gap: col.gap ?? null, v2_track: !!col.v2_track,
      ceiling: CEILINGS[col.key] ?? null,
      acquirable_incomplete: counts.incomplete + counts.unknown, // incomplete + unknown = potentiellement acquérable (hors plafond annoté)
      counts, complete_over_matched: `${counts.complete}/${matched.length}`,
      cities_100pct: counts.complete, // villes à 100% sur CE KPI = complete
      pct_complete: matched.length ? Math.round((counts.complete / matched.length) * 1000) / 10 : null,
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
    if (tot !== matched.length) errs.push(`KPI ${k.key}: partition villes ${tot} ≠ ${matched.length}`);
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
    axis: 'présence (donnée là) ; cols 10 (preuve-v2, piste longue) & 20 (v3.4, non mesurable) EXCLUES de la gate',
    gate_columns: COLUMNS.filter((c) => !c.gate_excluded).length,
    ...summarize(matched),
  };
  // Vue 30 (palier 1) comme SOUS-ENSEMBLE du 167 : priorityRank<=30, matchées.
  const subset30 = summarize(matched.filter((r) => (r.priorityRank ?? 999) <= 30));

  return {
    contract: 'palier-matrix/v1',
    generatedAt: new Date().toISOString(),
    reportDate: `${todayNum.slice(0, 4)}-${todayNum.slice(4, 6)}-${todayNum.slice(6, 8)}`,
    previousSnapshotDate: prev ? prev.date : null,
    owner_target: 'CIBLE MERCREDI = PRÉSENCE 100% sur les 30 (col 10 preuve-v2 = campagne longue séparée).',
    cohort: { name: cohort.cohort, source: cohort.source, path: cohort.path, cities: rows.length, graph_matched: matched.length, pending_graph_node: pendingRows.length },
    columns: COLUMNS.map((c) => ({ n: c.n, key: c.key, label: c.label, gap: c.gap ?? null, v2_track: !!c.v2_track, gate_excluded: !!c.gate_excluded, presence_strict: !!c.presence_strict, ceiling: CEILINGS[c.key] ?? null })),
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
  L.push(`**Gate PRÉSENCE (cible mercredi)** — 167 : ${g.cities_full_presence}/${g.cities_scored} villes à présence complète (0 KPI absent, cols 10 & 20 exclues) · présence moyenne ${g.mean_presence_pct ?? '—'}%. Palier 1 (rang≤30) : ${s30.cities_full_presence}/${s30.cities_scored} · moyenne ${s30.mean_presence_pct ?? '—'}%.`);
  L.push('');
  L.push(`Villes à 100% COMPLÉTION (tous KPI applicables complete) — 167 : ${g.cities_full_completion}/${g.cities_scored} · palier 1 : ${s30.cities_full_completion}/${s30.cities_scored}.`);
  L.push('');
  L.push('Légende cellule : ● complete · ◐ incomplete · · unknown · — N-A. Col 5 = déclarée+preuve ; cols 10 (preuve-v2) & 20 (v3.4) HORS gate présence.');
  L.push('');
  L.push('| # | Ville | ' + p.columns.map((c) => c.n + (c.v2_track ? '¹⁰' : '')).join(' | ') + ' | présence | compl |');
  L.push('|---:|---|' + p.columns.map(() => ':-:').join('|') + '|---:|---:|');
  for (const r of p.rows) {
    const tag = r.flag ? ' ⚠' : '';
    const cells = p.columns.map((c) => GLYPH[r.cells[c.key]] ?? '?').join(' | ');
    const pres = r.presence.pct == null ? '—' : `${r.presence.present}/${r.presence.denom_excl_v2} ${r.presence.pct}%`;
    L.push(`| ${r.priorityRank ?? ''} | ${r.slug}${tag} | ${cells} | ${pres} | ${r.completion_complete_over_20}/20 |`);
  }
  L.push('');
  L.push('## Colonnes (KPI) — sur les villes matchées graphe');
  L.push('');
  L.push('Par KPI (villes matchées) : complete / incomplete / unknown / N-A. `incomplete+unknown` = potentiellement ACQUÉRABLE ; ⛰ = plafond externe annoté (contexte owner, PAS un N-A fabriqué).');
  L.push('');
  L.push('| # | KPI | ✓compl | ◐inc | ·unk | —N-A | %compl | à 100% | plafond / note |');
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|---|');
  for (const k of p.per_kpi) {
    const note = k.ceiling ? '⛰ ' + k.ceiling : k.gap ? '⚠ ' + k.gap : '';
    L.push(`| ${k.n} | ${k.label} | ${k.counts.complete} | ${k.counts.incomplete} | ${k.counts.unknown} | ${k.counts['N-A']} | ${k.pct_complete == null ? '—' : k.pct_complete + '%'} | ${k.cities_100pct} | ${note} |`);
  }
  L.push('');
  L.push(`> Dénominateurs sur les ${p.cohort.graph_matched} villes matchées ; les ${p.cohort.pending_graph_node} PENDING-GRAPH-NODE sont exclues (lignes visibles, toutes unknown). Présence = état ≠ unknown, N-A hors dénominateur, col 10 exclue de la gate.`);
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
