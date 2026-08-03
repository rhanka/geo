#!/usr/bin/env node
// Matrice PAR VILLE × 20 KPI — tableau de bord sprint (mesure par PALIER),
// à côté du portfolio 1106. Lignes = une cohorte de slugs (défaut : SET-30
// sélection A = priorityRank<=30 du set-167-bprime), colonnes = les 20 KPI.
// Chaque cellule = complete | incomplete | unknown | N-A pour CETTE ville sur
// CE KPI. Anti-invention ABSOLU : entrée manquante -> unknown, jamais deviné.
//
// C'est un PIVOT par-ville des mêmes matrices de complétion committées que le
// portfolio agrège ; il n'invente aucune donnée, il la ré-indexe par ville.
//
// Usage :
//   node scripts/city-kpi-matrix.mjs                 # SET-30, écrit md+json datés
//   node scripts/city-kpi-matrix.mjs --check         # valide (fermeture + déterminisme), n'écrit rien
//   node scripts/city-kpi-matrix.mjs --date=YYYYMMDD # force la date
//   node scripts/city-kpi-matrix.mjs --cohort=work/coverage/<autre-liste>.json
//
// Sortie : work/coverage/city-kpi-matrix-<date>.{json,md}.
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
function warn(m) { WARNINGS.push(m); }

function optArg(name, fallback = null) {
  const p = `--${name}=`;
  const v = ARGV.find((a) => a.startsWith(p));
  return v === undefined ? fallback : v.slice(p.length);
}
function todayYYYYMMDD() {
  const forced = optArg('date');
  if (forced) {
    if (!/^\d{8}$/.test(forced)) throw new Error('--date doit être YYYYMMDD');
    return forced;
  }
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

// ---- résolution de sources (log de provenance) ----------------------------
function sha256File(p) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function pickLatestByPrefix(dir, re) {
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null;
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

// Familles datées : on prend TOUJOURS la plus récente par nom (repro : le nom
// EST le contrat de découverte), jamais un fichier périmé au hasard.
const qualityMatrixName = latestZoneProvenanceQualityMatrix(fs.existsSync(COV) ? fs.readdirSync(COV) : []);
const SRC = {
  zones: loadJson('zones-completion', pickLatestByPrefix(COV, /^completion-1-zones-matrix-\d{8}\.json$/)),
  normes: loadJson('normes-completion', pickLatestByPrefix(COV, /^completion-1-normes-matrix-\d{8}\.json$/)),
  coherence: loadJson('lot-zone-consistency', pickLatestByPrefix(COV, /^lot-zone-consistency-scale-\d{8}\.json$/)),
  pv: loadJson('pv-completion', path.join(COV, 'pv-completion-city-audit.json')),
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
  return null; // inconnu -> l'appelant décide (unknown)
}
function indexBy(list, key) {
  const m = new Map();
  if (Array.isArray(list)) for (const row of list) if (row && row[key] != null) m.set(row[key], row);
  return m;
}
function bucketIndex(cityBuckets) {
  // {complete:[slug...], incomplete:[...], unknown:[...], "N/A"|not_applicable:[...]}
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

const IDX = {
  zones: indexBy(SRC.zones?.cities, 'slug'),
  normes: indexBy(SRC.normes?.cities, 'slug'),
  coherence: indexBy(SRC.coherence?.cities, 'slug'),
  coherenceInconclusive: new Set(SRC.coherence?.inconclusive_zero_assigned_slugs || []),
  pv: indexBy(SRC.pv?.cities, 'slug'),
  quality: indexBy(SRC.quality?.rows, 'city_slug'),
  readback: indexBy(SRC.readback?.details, 'slug'),
  immoLotZone: bucketIndex(SRC.immoLotZone?.city_buckets),
  immoFolded: bucketIndex(SRC.immoFolded?.city_buckets),
  immoField: indexBy(SRC.immoField?.cities, 'slug'),
};

// ---- extracteurs par KPI (état pour UN slug) -------------------------------
const U = 'unknown';
function stateFrom(row, field) {
  if (!row) return U;
  const s = normState(row[field]);
  return s ?? U;
}
function immoFieldStatus(slug, field) {
  const row = IDX.immoField.get(slug);
  if (!row || !row[field]) return U;
  const s = normState(row[field].status);
  return s ?? U;
}
function qualityRow(slug) { return IDX.quality.get(slug) || null; }

// GAP : aucune source PER-VILLE committée pour ce KPI -> unknown honnête + raison.
const GAP_REGDENS = 'GAP: regdens totals-only, aucune matrice per-city committée (attend reglement)';
const GAP_V34 = 'GAP: aucune source recall/précision v3.4 qc-zoning-events (jointures WP5)';

const COLUMNS = [
  { n: 1, key: 'zones', label: 'Zones — complétion', extract: (s) => stateFrom(IDX.zones.get(s), 'state') },
  { n: 2, key: 'coherence_lot_zone', label: 'Zones — cohérence lot-zone', extract: (s) => {
      const r = IDX.coherence.get(s);
      if (!r || r.status !== 'measured' || typeof r.mismatch_pct !== 'number') return U;
      return r.mismatch_pct < 5 ? 'complete' : 'incomplete';
    } },
  { n: 3, key: 'normes', label: 'Normes — complétion', extract: (s) => stateFrom(IDX.normes.get(s), 'state') },
  { n: 4, key: 'pv', label: 'PV — complétion', extract: (s) => stateFrom(IDX.pv.get(s), 'state') },
  { n: 5, key: 'reglement', label: 'Règlement — complétion (déclarée+preuve)', gap: GAP_REGDENS, extract: () => U },
  { n: 6, key: 'usage_dominant', label: 'Usage dominant — complétion', gap: GAP_REGDENS, extract: () => U },
  { n: 7, key: 'effet_densifiant', label: 'Effet densifiant — complétion', gap: GAP_REGDENS, extract: () => U },
  { n: 8, key: 'prov_jointure', label: 'Provenance — jointure exacte', extract: (s) => {
      const r = qualityRow(s);
      return r && r.collection_key ? 'complete' : U;
    } },
  { n: 9, key: 'prov_qualite', label: 'Provenance — qualité retained', extract: (s) => {
      const r = qualityRow(s);
      if (!r) return U;
      if (r.quality_status === 'acceptable' || r.quality_status === 'v2') return 'complete';
      if (r.quality_status === 'candidate' || r.quality_status === 'orphan') return 'incomplete';
      return U;
    } },
  { n: 10, key: 'prov_v2', label: 'Provenance — PREUVE v2 exacte', extract: (s) => {
      const r = qualityRow(s);
      if (!r) return U;
      if (r.quality_status === 'v2') return 'complete';
      if (r.quality_status === 'acceptable' || r.quality_status === 'candidate' || r.quality_status === 'orphan') return 'incomplete';
      return U;
    } },
  { n: 11, key: 'prov_url_servie', label: 'Provenance — URL source servie', extract: (s) => {
      const r = IDX.readback.get(s);
      if (!r) return U;
      if (r.read_error) return U;
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
  { n: 20, key: 'v34_qc_zoning_events', label: 'Recall+précision v3.4 qc-zoning-events', gap: GAP_V34, extract: () => U },
];

// ---- cohorte ---------------------------------------------------------------
function loadCohort() {
  const p = path.resolve(ROOT, optArg('cohort', 'work/coverage/city-kpi-matrix-set30.json'));
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(j.cities)) throw new Error('cohorte invalide: cities[] requis');
  return { path: path.relative(ROOT, p), cohort: j.cohort ?? null, source: j.source ?? null, cities: j.cities };
}

// ---- construction ----------------------------------------------------------
function build(todayNum) {
  const cohort = loadCohort();
  const rows = cohort.cities.map((c) => {
    const pending = c.graph_matched === false;
    const cells = {};
    for (const col of COLUMNS) {
      // Ville non matchée graphe : ligne unknown + drapeau (i-cond cadre l'extraction).
      cells[col.key] = pending ? U : col.extract(c.slug);
    }
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    for (const col of COLUMNS) counts[cells[col.key]]++;
    const denom = COLUMNS.length - counts['N-A'];
    return {
      priorityRank: c.priorityRank ?? null,
      slug: c.slug,
      graph_matched: c.graph_matched !== false,
      flag: pending ? 'PENDING-GRAPH-NODE' : null,
      cells,
      counts,
      complete_over_20: counts.complete,
      pct_complete_non_na: denom > 0 ? Math.round((counts.complete / denom) * 1000) / 10 : null,
    };
  });

  // Rollup par KPI : seulement sur les villes matchées graphe (pending à part).
  const matched = rows.filter((r) => r.graph_matched);
  const pendingRows = rows.filter((r) => !r.graph_matched);
  const perKpi = COLUMNS.map((col) => {
    const counts = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
    for (const r of matched) counts[r.cells[col.key]]++;
    return {
      n: col.n, key: col.key, label: col.label,
      gap: col.gap ?? null,
      counts,
      complete_over_matched: `${counts.complete}/${matched.length}`,
      pct_complete: matched.length ? Math.round((counts.complete / matched.length) * 1000) / 10 : null,
    };
  });

  // Fermetures (assertions dures).
  const errs = [];
  for (const r of rows) {
    const tot = STATES.reduce((s, st) => s + r.counts[st], 0);
    if (tot !== COLUMNS.length) errs.push(`ville ${r.slug}: partition cellules ${tot} ≠ ${COLUMNS.length}`);
  }
  for (const k of perKpi) {
    const tot = STATES.reduce((s, st) => s + k.counts[st], 0);
    if (tot !== matched.length) errs.push(`KPI ${k.key}: partition villes ${tot} ≠ ${matched.length}`);
  }

  return {
    contract: 'city-kpi-matrix/v1',
    generatedAt: new Date().toISOString(),
    reportDate: `${todayNum.slice(0, 4)}-${todayNum.slice(4, 6)}-${todayNum.slice(6, 8)}`,
    cohort: { name: cohort.cohort, source: cohort.source, path: cohort.path, cities: rows.length, graph_matched: matched.length, pending_graph_node: pendingRows.length },
    columns: COLUMNS.map((c) => ({ n: c.n, key: c.key, label: c.label, gap: c.gap ?? null })),
    anti_invention: 'Entrée manquante -> unknown ; jamais deviné. Villes PENDING-GRAPH-NODE : toutes cellules unknown + drapeau. Cols 5/6/7 (regdens totals-only) et 20 (v3.4) : GAP -> unknown flaggé jusqu\'à source per-city committée.',
    rows,
    per_kpi: perKpi,
    sources: RESOLVED,
    validation: { closed: errs.length === 0, errors: errs },
    warnings: WARNINGS.slice(),
  };
}

// ---- rendu markdown --------------------------------------------------------
const GLYPH = { complete: '●', incomplete: '◐', unknown: '·', 'N-A': '—' };
function renderMarkdown(p) {
  const L = [];
  L.push(`# Matrice par-ville × 20 KPI — ${p.cohort.name ?? 'cohorte'}`);
  L.push('');
  L.push(`Date : ${p.reportDate} · ${p.cohort.cities} villes (${p.cohort.graph_matched} matchées graphe + ${p.cohort.pending_graph_node} PENDING-GRAPH-NODE) · 20 KPI.`);
  L.push(`Contrat : \`${p.contract}\`. Anti-invention : ${p.anti_invention}`);
  L.push('');
  L.push('Légende cellule : ● complete · ◐ incomplete · · unknown · — N-A.');
  L.push('');
  // Table villes × KPI (colonnes numérotées 1..20).
  L.push('| # | Ville | ' + p.columns.map((c) => c.n).join(' | ') + ' | %compl |');
  L.push('|---:|---|' + p.columns.map(() => ':-:').join('|') + '|---:|');
  for (const r of p.rows) {
    const tag = r.flag ? ` ⚠` : '';
    const cells = p.columns.map((c) => GLYPH[r.cells[c.key]] ?? '?').join(' | ');
    const pct = r.pct_complete_non_na == null ? '—' : `${r.pct_complete_non_na}%`;
    L.push(`| ${r.priorityRank ?? ''} | ${r.slug}${tag} | ${cells} | ${r.complete_over_20}/20 ${pct} |`);
  }
  L.push('');
  L.push('## Colonnes (KPI)');
  L.push('');
  L.push('| # | KPI | complete/matchées | % | gap |');
  L.push('|---:|---|---:|---:|---|');
  for (const k of p.per_kpi) {
    L.push(`| ${k.n} | ${k.label} | ${k.complete_over_matched} | ${k.pct_complete == null ? '—' : k.pct_complete + '%'} | ${k.gap ? '⚠ ' + k.gap : ''} |`);
  }
  L.push('');
  L.push(`> Rollup KPI calculé sur les ${p.cohort.graph_matched} villes matchées graphe uniquement ; les ${p.cohort.pending_graph_node} PENDING-GRAPH-NODE sont EXCLUES du dénominateur (lignes visibles, toutes unknown).`);
  L.push('');
  L.push('## Sources (provenance)');
  L.push('');
  for (const s of p.sources) {
    L.push(`- ${s.present ? '' : '⚠ ABSENTE — '}\`${s.path ?? '(non résolue)'}\`${s.sha256 ? ' — ' + s.sha256 : ''} (${s.role})`);
  }
  if (p.warnings.length) {
    L.push('');
    L.push('## Avertissements');
    L.push('');
    for (const w of p.warnings) L.push(`- ${w}`);
  }
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
    const deterministic = strip(payload) === strip(p2);
    const errs = [...payload.validation.errors];
    if (!deterministic) errs.push('Sortie non déterministe entre deux constructions.');
    if (errs.length) {
      console.error('CHECK ÉCHOUÉ :');
      for (const e of errs) console.error('  - ' + e);
      process.exit(1);
    }
    console.log('CHECK OK — partitions cellules & KPI fermées, déterministe, unknown≠complete.');
    console.log(`Villes: ${payload.cohort.cities} (${payload.cohort.graph_matched} matchées, ${payload.cohort.pending_graph_node} pending) · KPI: ${payload.columns.length} · sources: ${payload.sources.filter((s) => s.present).length}/${payload.sources.length}`);
    if (payload.warnings.length) for (const w of payload.warnings) console.log('  ! ' + w);
    return;
  }

  if (!payload.validation.closed) for (const e of payload.validation.errors) warn('VALIDATION: ' + e);

  const md = renderMarkdown(payload);
  fs.mkdirSync(COV, { recursive: true });
  const mdPath = path.join(COV, `city-kpi-matrix-${todayNum}.md`);
  const jsonPath = path.join(COV, `city-kpi-matrix-${todayNum}.json`);
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
