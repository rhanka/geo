#!/usr/bin/env node
// portfolio-city-report.mjs
// Générateur PÉRENNE et REPRODUCTIBLE du "rapport portfolio par ville".
// Déterministe · 0 réseau · 0 S3 · 0 déploiement · 0 commit · 0 Track.
//
// Repart des matrices de complétion committées (work/coverage/*, work/immo-field-*)
// et fige le format validé le 2026-07-23. Chaque KPI mesure la COMPLÉTION-VILLE
// (unité = la ville) : `N / DENOM complete · X incomplete · Y unknown · Z N/A`,
// `unknown` n'est JAMAIS compté complete, et chaque partition ferme.
// Deux KPI "qualité/provenance" sont ajoutés pour rendre la ré-acquisition et le
// stampage MESURABLES (URL de source servie ; cohérence lot-zone).
//
// Précédent/Δ proviennent EXCLUSIVEMENT du diff avec le snapshot daté le plus
// récent ANTÉRIEUR à aujourd'hui dans work/coverage/portfolio-report-history/.
// S'il n'y en a pas → "—". Aucun Δ n'est fabriqué. Toute entrée manquante → KPI
// `unknown/—`, jamais deviné.
//
// Usage:
//   node scripts/portfolio-city-report.mjs            # écrit md+json+history, imprime le tableau
//   node scripts/portfolio-city-report.mjs --check    # valide (déterminisme + fermeture des partitions), n'écrit rien
//   node scripts/portfolio-city-report.mjs --date=YYYYMMDD   # force la date (test/reproduction)
//   node scripts/portfolio-city-report.mjs --stdout   # imprime le md sans écrire
//
// Spec figée: docs/spec/SPEC_PORTFOLIO_REPORT.md

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const HISTORY_DIR = path.join(COV, 'portfolio-report-history');

const CONTRACT = 'portfolio-city-report/v1';
const UNIVERSE = 1106; // villes canoniques du Québec

// ---- CLI -------------------------------------------------------------------
const ARGV = process.argv.slice(2);
const FLAG = (name) => ARGV.includes('--' + name);
const OPT = (name) => {
  const p = '--' + name + '=';
  const hit = ARGV.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : null;
};
const CHECK = FLAG('check');
const STDOUT_ONLY = FLAG('stdout');

// ---- utils -----------------------------------------------------------------
function todayYYYYMMDD() {
  const forced = OPT('date');
  if (forced) {
    if (!/^\d{8}$/.test(forced)) throw new Error('--date doit être YYYYMMDD');
    return forced;
  }
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Format français avec espace comme séparateur de milliers (ASCII space).
function fmt(n) {
  if (n === null || n === undefined || n === '—') return '—';
  if (typeof n === 'string') return n;
  const neg = n < 0;
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return (neg ? '-' : '') + out;
}

function pctFr(x) {
  return String(x).replace('.', ',') + ' %';
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const WARNINGS = [];
function warn(msg) {
  WARNINGS.push(msg);
}

// ---- chargement des sources ------------------------------------------------
function loadFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    warn(`Source absente: ${relPath} (KPI concernés → unknown)`);
    return { path: relPath, exists: false, sha256: null, data: null, asOf: null };
  }
  const bytes = fs.readFileSync(abs);
  const sha = sha256Hex(bytes);
  let data = null;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    warn(`Source illisible (JSON invalide): ${relPath} — ${e.message}`);
    return { path: relPath, exists: true, sha256: sha, data: null, asOf: null };
  }
  return { path: relPath, exists: true, sha256: sha, data, asOf: null };
}

// Découverte du readback le plus récent (par nom).
function discoverReadback() {
  if (!fs.existsSync(COV)) return null;
  const files = fs
    .readdirSync(COV)
    .filter((f) => /^zone-source-readback-audit-.*\.json$/.test(f))
    .sort();
  return files.length ? path.join('work', 'coverage', files[files.length - 1]) : null;
}

// Paths (relatifs à ROOT).
const readbackRel = discoverReadback();

const SRC = {
  zonesNormes: loadFile('work/coverage/completion-1-zones-normes-summary-20260723.json'),
  pv: loadFile('work/coverage/pv-completion-city-audit.json'),
  regdens: loadFile('work/coverage/completion-regdens-20260723.json'),
  provQuality: loadFile('work/coverage/zone-provenance-quality-matrix-20260723-74345365.json'),
  immoLotZone: loadFile('work/coverage/immo-lot-zone-assignment-matrix-20260723.json'),
  immoFolded: loadFile('work/coverage/immo-folded-normes-city-matrix.json'),
  immoField: loadFile('work/immo-field-completion-matrices/immo-field-completion-matrix.json'),
  readback: readbackRel ? loadFile(readbackRel) : { path: null, exists: false, sha256: null, data: null, asOf: null },
  lotZoneConsistency: loadFile('work/coverage/lot-zone-consistency.json'),
};

// ---- extraction des as-of (depuis chaque artefact lui-même) ----------------
function computeAsOf() {
  const s = SRC;
  if (s.zonesNormes.data) s.zonesNormes.asOf = s.zonesNormes.data.analysis_as_of || null;
  if (s.pv.data) s.pv.asOf = s.pv.data.asOf || null;
  if (s.regdens.data) {
    const a = s.regdens.data.source_as_of || {};
    const parts = [];
    if (a['coverage-matrix']) parts.push(`couverture ${a['coverage-matrix']}`);
    if (a['zonage-enrichment']) parts.push(`enrichissement ${a['zonage-enrichment']}`);
    if (a['event-detect-4a-audit']) parts.push(`audit événements ${a['event-detect-4a-audit']}`);
    s.regdens.asOf = parts.join(' ; ') || null;
  }
  if (s.provQuality.data) s.provQuality.asOf = s.provQuality.data.as_of || null;
  if (s.immoLotZone.data) {
    const ins = s.immoLotZone.data.inputs || [];
    const dated = ins.filter((i) => i.declaredAsOf).map((i) => `${i.role}: ${i.declaredAsOf}`);
    s.immoLotZone.asOf = dated.join(' ; ') || null;
  }
  if (s.immoFolded.data) {
    const src = s.immoFolded.data.source || {};
    const parts = [];
    if (src.coverageMatrix?.generatedAt) parts.push(`couverture ${src.coverageMatrix.generatedAt}`);
    if (src.immoLots?.generatedAt) parts.push(`snapshot Immo ${src.immoLots.generatedAt}`);
    s.immoFolded.asOf = parts.join(' ; ') || null;
  }
  if (s.immoField.data) {
    // L'artefact n'embarque aucune date propre ; on le signale honnêtement.
    s.immoField.asOf = 'non daté dans l’artefact (entrées: coverage-matrix, immo-lots)';
  }
  if (s.readback.data) s.readback.asOf = s.readback.data.generatedAt || null;
  if (s.lotZoneConsistency.data) s.lotZoneConsistency.asOf = s.lotZoneConsistency.data.generatedAt || null;
}
computeAsOf();

// ---- helpers de cellule ----------------------------------------------------
// Cellule "standard" complétion-ville : partition ferme à partitionTotal (=UNIVERSE).
function stdCell({ complete, incomplete, unknown, na, partitionTotal = UNIVERSE, denomMode = 'applicable' }) {
  const denom = denomMode === 'full' ? partitionTotal : partitionTotal - na;
  const cibleNote = denom < partitionTotal ? ` (${fmt(partitionTotal - denom)} N/A explicites)` : '';
  return {
    status: 'ok',
    complete,
    incomplete,
    unknown,
    na,
    denominator: denom,
    partitionTotal,
    display: `${fmt(complete)} / ${fmt(denom)} complete · ${fmt(incomplete)} incomplete · ${fmt(unknown)} unknown · ${fmt(na)} N/A`,
    cible: `${fmt(denom)}${cibleNote}`,
  };
}

function unknownCell(cibleFallback = fmt(UNIVERSE)) {
  return {
    status: 'unknown',
    complete: null,
    incomplete: null,
    unknown: null,
    na: null,
    denominator: null,
    partitionTotal: null,
    display: 'unknown',
    cible: cibleFallback,
  };
}

// ---- extracteurs par KPI ---------------------------------------------------
function kpiZones() {
  const sc = SRC.zonesNormes.data?.lanes?.zones?.state_counts;
  if (!sc) return unknownCell();
  return stdCell({ complete: sc.complete, incomplete: sc.incomplete, unknown: sc.unknown, na: sc['N-A'] || 0 });
}

function kpiNormes() {
  const sc = SRC.zonesNormes.data?.lanes?.normes?.state_counts;
  if (!sc) return unknownCell();
  return stdCell({ complete: sc.complete, incomplete: sc.incomplete, unknown: sc.unknown, na: sc['N-A'] || 0 });
}

function kpiPv() {
  const st = SRC.pv.data?.summary?.states;
  if (!st) return unknownCell();
  // PV conserve ses 2 villes N/A pilotes DANS la cible 1 106 → denomMode 'full'.
  return stdCell({ complete: st.complete, incomplete: st.incomplete, unknown: st.unknown, na: st['N-A'] || 0, denomMode: 'full' });
}

function regdensCell(laneKey) {
  const t = SRC.regdens.data?.totals?.[laneKey];
  if (!t) return unknownCell();
  return stdCell({ complete: t.complete, incomplete: t.incomplete, unknown: t.unknown, na: t['N/A'] || 0 });
}

function kpiProvJointure() {
  const v = SRC.provQuality.data?.validation?.city_identity;
  if (!v) return unknownCell();
  const exact = v.exact_slug_joins;
  const sans = v.cities_without_exact_zone_row;
  return {
    status: 'ok',
    complete: exact,
    incomplete: 0,
    unknown: sans,
    na: 0,
    denominator: UNIVERSE,
    partitionTotal: UNIVERSE,
    display: `${fmt(exact)} / ${fmt(UNIVERSE)} jointures exactes · ${fmt(sans)} sans jointure`,
    cible: fmt(UNIVERSE),
    extra: { jointures_exactes: exact, sans_jointure: sans },
  };
}

function kpiProvQualite() {
  const q = SRC.provQuality.data?.validation?.quality_status_partition?.counts;
  if (!q) return unknownCell();
  const acceptable = q.acceptable;
  const candidate = q.candidate;
  const orphan = q.orphan;
  const unk = q.unknown;
  return {
    status: 'ok',
    complete: acceptable, // "acceptable" = meilleur bucket qualité retained (≠ preuve v2)
    incomplete: candidate + orphan,
    unknown: unk,
    na: 0,
    denominator: UNIVERSE,
    partitionTotal: UNIVERSE,
    display: `${fmt(acceptable)} acceptable · ${fmt(candidate)} candidate · ${fmt(orphan)} orphan · ${fmt(unk)} unknown`,
    cible: fmt(UNIVERSE),
    extra: { acceptable, candidate, orphan, unknown: unk },
  };
}

function kpiProvV2() {
  const q = SRC.provQuality.data?.validation?.quality_status_partition?.counts;
  if (!q) return unknownCell();
  const v2 = q.v2 || 0;
  return {
    status: 'ok',
    complete: v2,
    incomplete: 0,
    unknown: UNIVERSE - v2,
    na: 0,
    denominator: UNIVERSE,
    partitionTotal: UNIVERSE,
    display: `${fmt(v2)} / ${fmt(UNIVERSE)} v2 · toutes les lignes retained sont not-assessed`,
    cible: fmt(UNIVERSE),
    extra: { v2 },
  };
}

// AJOUT qualité #1 : URL de source servie (unité = collection servie, dénominateur = total readback).
function kpiUrlSourceServie() {
  const d = SRC.readback.data;
  if (!d) return { ...unknownCell('871'), unit: 'collection' };
  const total = d.total;
  const stamped = d.stamped; // zone_source_url http réelle
  const stampedNull = d.stamped_null; // champ présent mais null
  const unstamped = d.unstamped; // champ absent
  const readErr = d.read_error || 0;
  // Cross-check défensif : STAMPED doit être http réel.
  if (Array.isArray(d.details)) {
    const httpStamped = d.details.filter((x) => x.status === 'STAMPED' && /^https?:\/\//.test(x.url || '')).length;
    if (httpStamped !== stamped) warn(`readback: STAMPED http (${httpStamped}) ≠ stamped (${stamped})`);
  }
  return {
    status: 'ok',
    unit: 'collection',
    complete: stamped,
    incomplete: stampedNull,
    unknown: unstamped + readErr,
    na: 0,
    denominator: total,
    partitionTotal: total,
    display: `${fmt(stamped)} / ${fmt(total)} collections avec zone_source_url (http) · ${fmt(stampedNull)} stamped-null · ${fmt(unstamped)} unstamped · ${fmt(readErr)} read-error`,
    cible: fmt(total),
    extra: { stamped, stamped_null: stampedNull, unstamped, read_error: readErr },
  };
}

function kpiImmoLotZone() {
  const cs = SRC.immoLotZone.data?.summary?.city_states;
  if (!cs) return unknownCell();
  return stdCell({ complete: cs.complete, incomplete: cs.incomplete, unknown: cs.unknown, na: cs['N/A'] || 0 });
}

function kpiImmoFolded() {
  const cs = SRC.immoFolded.data?.counts?.cityStates;
  if (!cs) return unknownCell();
  return stdCell({ complete: cs.complete, incomplete: cs.incomplete, unknown: cs.unknown, na: cs.not_applicable || 0 });
}

function immoFieldCell(fieldKey) {
  const f = SRC.immoField.data?.summary?.by_field_status?.[fieldKey];
  if (!f) return unknownCell();
  return stdCell({ complete: f.complete, incomplete: f.incomplete, unknown: f.unknown, na: f['N/A'] || 0 });
}

// AJOUT qualité #2 : cohérence lot-zone. Complete si mismatch < 5 %, MAIS seulement
// si le fichier couvre assez de villes ; sinon "donnée insuffisante" (jamais inventé).
function kpiCoherenceLotZone() {
  const d = SRC.lotZoneConsistency.data;
  if (!d) return { status: 'unknown', complete: null, incomplete: null, unknown: null, na: null, denominator: null, partitionTotal: null, display: 'unknown', cible: fmt(UNIVERSE) };
  const cities = Array.isArray(d.cities) ? d.cities : [];
  const audited = cities.length;
  const COVERAGE_MIN = Math.ceil(UNIVERSE * 0.5); // seuil "assez de villes"
  if (audited < COVERAGE_MIN) {
    const ex = cities
      .slice(0, 3)
      .map((c) => `${c.slug} : mismatch ${pctFr(c.mismatch_pct)}`)
      .join(' ; ');
    return {
      status: 'insufficient',
      complete: null,
      incomplete: null,
      unknown: null,
      na: null,
      denominator: null,
      partitionTotal: null,
      display: `donnée insuffisante — ${fmt(audited)} / ${fmt(UNIVERSE)} ville(s) auditée(s)${ex ? ` (${ex})` : ''}`,
      cible: fmt(UNIVERSE),
      extra: { audited, universe: UNIVERSE, coverage_min: COVERAGE_MIN },
    };
  }
  // Couverture suffisante : ville complete si mismatch < 5 %.
  let complete = 0;
  let incomplete = 0;
  for (const c of cities) {
    if (typeof c.mismatch_pct === 'number' && c.mismatch_pct < 5) complete++;
    else incomplete++;
  }
  const unknown = UNIVERSE - audited;
  return stdCell({ complete, incomplete, unknown, na: 0 });
}

// ---- table des KPI (ordre figé) --------------------------------------------
const KPIS = [
  { key: 'zones', label: 'Zones — complétion', extract: kpiZones },
  { key: 'coherence_lot_zone', label: 'Zones — cohérence lot-zone', extract: kpiCoherenceLotZone },
  { key: 'normes', label: 'Normes — complétion', extract: kpiNormes },
  { key: 'pv', label: 'PV — complétion', extract: kpiPv },
  { key: 'reglement', label: 'Règlement — complétion', extract: () => regdensCell('reglement') },
  { key: 'usage_dominant', label: 'Usage dominant — complétion', extract: () => regdensCell('usage_dominant') },
  { key: 'effet_densifiant', label: 'Effet densifiant — complétion', extract: () => regdensCell('effet_densifiant') },
  { key: 'prov_jointure', label: 'Provenance zones — jointure exacte', extract: kpiProvJointure },
  { key: 'prov_qualite', label: 'Provenance zones — qualité retained', extract: kpiProvQualite },
  { key: 'prov_v2', label: 'Provenance zones — preuve v2 exacte', extract: kpiProvV2 },
  { key: 'prov_url_servie', label: 'Provenance zones — URL source servie', extract: kpiUrlSourceServie },
  { key: 'immo_lot_zone', label: 'Immo — assignation lot-zone', extract: kpiImmoLotZone },
  { key: 'immo_normes_pliees', label: 'Immo — normes pliées', extract: kpiImmoFolded },
  { key: 'immo_lots_servis', label: 'Immo champs — lots servis', extract: () => immoFieldCell('lots_served') },
  { key: 'immo_surface', label: 'Immo champs — surface m²', extract: () => immoFieldCell('surface_m2') },
  { key: 'immo_code_postal', label: 'Immo champs — code postal', extract: () => immoFieldCell('postal_code') },
  { key: 'immo_adresse', label: 'Immo champs — adresse civique', extract: () => immoFieldCell('civic_address') },
  { key: 'tod_applicabilite', label: 'Immo champs — applicabilité TOD', extract: () => immoFieldCell('tod_applicability') },
  { key: 'tod_completion', label: 'Immo champs — complétion TOD', extract: () => immoFieldCell('tod_completion') },
];

// ---- snapshot précédent (diff) ---------------------------------------------
function findPreviousSnapshot(todayNum) {
  if (!fs.existsSync(HISTORY_DIR)) return null;
  const files = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => ({ f, num: parseInt(f.slice(0, 8), 10) }))
    .filter((x) => x.num < parseInt(todayNum, 10))
    .sort((a, b) => a.num - b.num);
  if (!files.length) return null;
  const chosen = files[files.length - 1];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, chosen.f), 'utf8'));
    return { date: chosen.f.slice(0, 8), data };
  } catch (e) {
    warn(`Snapshot précédent illisible: ${chosen.f} — ${e.message}`);
    return null;
  }
}

function priorCellFor(prevSnap, kpi) {
  if (!prevSnap) return null;
  const rows = prevSnap.data?.kpis || [];
  const hit = rows.find((r) => r.key === kpi.key) || rows.find((r) => r.kpi === kpi.label);
  return hit ? hit.actuel : null;
}

const DELTA_FIELDS = [
  ['complete', 'complete'],
  ['incomplete', 'incomplete'],
  ['unknown', 'unknown'],
  ['na', 'N/A'],
];

function computeDelta(prior, cur) {
  if (!prior || cur.status !== 'ok') return '—';
  const parts = [];
  for (const [f, label] of DELTA_FIELDS) {
    const a = prior[f];
    const b = cur[f];
    if (typeof a === 'number' && typeof b === 'number') {
      const d = b - a;
      if (d !== 0) parts.push(`${d > 0 ? '+' : ''}${d} ${label}`);
    }
  }
  return parts.length ? parts.join(' · ') : '0';
}

function renderPrecedent(prior) {
  if (!prior) return '—';
  return prior.display || '—';
}

// ---- construction du payload ----------------------------------------------
function build(todayNum) {
  const prevSnap = findPreviousSnapshot(todayNum);
  const kpis = KPIS.map((k) => {
    const cur = k.extract();
    const prior = priorCellFor(prevSnap, k);
    const actuel = {
      complete: cur.complete,
      incomplete: cur.incomplete,
      unknown: cur.unknown,
      na: cur.na,
      denominator: cur.denominator,
      status: cur.status,
      display: cur.display,
    };
    if (cur.extra) actuel.extra = cur.extra;
    if (cur.unit) actuel.unit = cur.unit;
    if (cur.partitionTotal != null) actuel.partitionTotal = cur.partitionTotal;
    return {
      key: k.key,
      kpi: k.label,
      precedent: prior ? renderPrecedent(prior) : '—',
      precedentDate: prevSnap ? prevSnap.date : null,
      actuel,
      delta: computeDelta(prior, cur),
      cible: cur.cible,
    };
  });

  const sourcesMeta = [
    SRC.zonesNormes,
    SRC.pv,
    SRC.regdens,
    SRC.provQuality,
    SRC.immoLotZone,
    SRC.immoFolded,
    SRC.immoField,
    SRC.readback,
    SRC.lotZoneConsistency,
  ]
    .filter((s) => s.path)
    .map((s) => ({ path: s.path, asOf: s.asOf, sha256: s.sha256 ? `sha256:${s.sha256}` : null, present: s.exists }));

  return {
    contract: CONTRACT,
    generatedAt: new Date().toISOString(),
    reportDate: `${todayNum.slice(0, 4)}-${todayNum.slice(4, 6)}-${todayNum.slice(6, 8)}`,
    universe: UNIVERSE,
    execution: { mode: 'local-cpu-only', network: false, s3: false, deployment: false, track_edits: false },
    previousSnapshotDate: prevSnap ? prevSnap.date : null,
    kpis,
    sources: sourcesMeta,
    warnings: WARNINGS.slice(),
  };
}

// ---- validation (fermeture des partitions + états autorisés) ---------------
function validate(payload) {
  const errs = [];
  for (const row of payload.kpis) {
    const a = row.actuel;
    if (a.status === 'ok') {
      const total = a.partitionTotal != null ? a.partitionTotal : UNIVERSE;
      const sum = (a.complete || 0) + (a.incomplete || 0) + (a.unknown || 0) + (a.na || 0);
      if (sum !== total) errs.push(`Partition non fermée pour "${row.kpi}": ${sum} ≠ ${total}`);
      if (a.complete != null && a.unknown != null && a.denominator != null) {
        // unknown ne doit jamais gonfler complete : complete ≤ denominator.
        if (a.complete > a.denominator) errs.push(`complete > denominator pour "${row.kpi}"`);
      }
    } else if (a.status !== 'unknown' && a.status !== 'insufficient') {
      errs.push(`Statut inattendu pour "${row.kpi}": ${a.status}`);
    }
  }
  return errs;
}

// ---- rendu Markdown --------------------------------------------------------
function renderMarkdown(payload) {
  const L = [];
  L.push(`# Portfolio city report — ${payload.reportDate}`);
  L.push('');
  L.push(
    `Rapport **pérenne et reproductible** (généré par \`scripts/portfolio-city-report.mjs\`, format figé: \`docs/spec/SPEC_PORTFOLIO_REPORT.md\`). ` +
      `Déterministe, 0 réseau / S3 / déploiement / Track / commit. Unité = la ville ; \`unknown\` n'est jamais compté \`complete\` ; chaque partition ferme. ` +
      (payload.previousSnapshotDate
        ? `Précédent/Δ = diff avec le snapshot ${payload.previousSnapshotDate}.`
        : `Aucun snapshot antérieur → Précédent/Δ = "—" (aucun Δ fabriqué).`)
  );
  L.push('');
  L.push('| KPI villes | Précédent | Actuel | Δ | Cible |');
  L.push('|---|---:|---|---:|---:|');
  for (const row of payload.kpis) {
    L.push(`| ${row.kpi} | ${row.precedent} | ${row.actuel.display} | ${row.delta} | ${row.cible} |`);
  }
  L.push('');
  L.push('## Réconciliation & notes');
  L.push('');
  L.push(
    '- L’univers est de 1 106 villes canoniques pour chaque KPI ville, sauf dénominateur N/A explicitement documenté (les N/A restent dans la partition qui ferme à 1 106).'
  );
  L.push(
    '- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.'
  );
  const url = payload.kpis.find((k) => k.key === 'prov_url_servie');
  if (url && url.actuel.status === 'ok') {
    L.push(
      `- **URL source servie** : ${fmt(url.actuel.extra.stamped)} / ${fmt(url.actuel.denominator)} collections servies portent une \`zone_source_url\` http réelle ; ` +
        `${fmt(url.actuel.extra.stamped_null)} sont stamped-null et ${fmt(url.actuel.extra.unstamped)} unstamped. ` +
        'Toute ré-acquisition qui n’écrit pas la source de preuve dans la même passe fait CHUTER ce KPI (dé-stampage détectable).'
    );
  }
  const coh = payload.kpis.find((k) => k.key === 'coherence_lot_zone');
  if (coh && coh.actuel.status === 'insufficient') {
    L.push(`- **Cohérence lot-zone** : ${coh.actuel.display}. Marqué "donnée insuffisante" ; rien n’est extrapolé au reste des villes.`);
  }
  const fold = SRC.immoFolded.data?.counts;
  if (fold) {
    L.push(
      `- Normes pliées (contexte lots, non mélangé aux KPI villes) : ${fmt(fold.matchedFoldedNormesLots)} / ${fmt(fold.matchedServedLots)} lots servis pliés (${String(fold.matchedFoldedNormesPct).replace('.', ',')} %) ; ${fmt(fold.matchedMissingFoldedNormesLots)} manquants.`
    );
  }
  L.push(
    '- `acceptable` de provenance = preuve locale retained historique/legacy ; ce n’est PAS une preuve v2. Aucune preuve v2 n’est inférée (0 / 1 106).'
  );
  L.push(
    '- Les slugs `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne` ne sont pas des clés villes canoniques : lignes de sources non liées, sans fusion par alias ni crédit de complétion.'
  );
  L.push('');
  L.push('## Sources locales, as-of et empreintes');
  L.push('');
  for (const s of payload.sources) {
    const present = s.present ? '' : ' — **ABSENTE**';
    L.push(`- \`${s.path}\` — as-of \`${s.asOf || '—'}\` — \`${s.sha256 || 'n/a'}\`${present}`);
  }
  L.push('');
  L.push('## Validation');
  L.push('');
  const okPartitions = payload.kpis.filter((k) => k.actuel.status === 'ok').length;
  L.push(`- ${okPartitions} KPI à partition fermée (somme = partitionTotal) ; \`unknown\` jamais compté \`complete\`.`);
  L.push('- Généré localement, sans réseau, S3, déploiement, Track ni commit. Empreintes sha256 recalculées sur les octets lus.');
  L.push(`- Reproduction : \`node scripts/portfolio-city-report.mjs\` (validation stricte : \`--check\`).`);
  if (payload.warnings.length) {
    L.push('');
    L.push('## Avertissements');
    L.push('');
    for (const w of payload.warnings) L.push(`- ${w}`);
  }
  L.push('');
  return L.join('\n');
}

// ---- rendu tableau console -------------------------------------------------
function printConsoleTable(payload) {
  const rows = payload.kpis.map((r) => [r.kpi, r.precedent, r.actuel.display, r.delta, r.cible]);
  const head = ['KPI villes', 'Précédent', 'Actuel', 'Δ', 'Cible'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cols) => '| ' + cols.map((c, i) => String(c).padEnd(widths[i])).join(' | ') + ' |';
  console.log(line(head));
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
  for (const r of rows) console.log(line(r));
}

// ---- main ------------------------------------------------------------------
function main() {
  const todayNum = todayYYYYMMDD();
  const payload = build(todayNum);
  const errs = validate(payload);

  if (CHECK) {
    // Déterminisme : reconstruire et comparer (hors generatedAt).
    const p2 = build(todayNum);
    const strip = (p) => JSON.stringify({ ...p, generatedAt: null, warnings: null });
    const deterministic = strip(payload) === strip(p2);
    if (!deterministic) errs.push('Sortie non déterministe entre deux constructions.');
    if (errs.length) {
      console.error('CHECK ÉCHOUÉ :');
      for (const e of errs) console.error('  - ' + e);
      process.exit(1);
    }
    console.log('CHECK OK — partitions fermées, sortie déterministe, unknown≠complete.');
    console.log(`KPI: ${payload.kpis.length} · sources présentes: ${payload.sources.filter((s) => s.present).length}/${payload.sources.length}`);
    if (payload.warnings.length) {
      console.log('Avertissements:');
      for (const w of payload.warnings) console.log('  - ' + w);
    }
    return;
  }

  if (errs.length) {
    // On n'échoue pas dur en mode génération (robustesse), mais on signale fort.
    for (const e of errs) warn('VALIDATION: ' + e);
    payload.warnings = WARNINGS.slice();
  }

  const md = renderMarkdown(payload);

  if (STDOUT_ONLY) {
    console.log(md);
    return;
  }

  // Écritures (whitelist stricte).
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const mdPath = path.join(COV, `portfolio-city-report-${todayNum}.md`);
  const jsonPath = path.join(COV, `portfolio-city-report-${todayNum}.json`);
  const histPath = path.join(HISTORY_DIR, `${todayNum}.json`);
  const jsonStr = JSON.stringify(payload, null, 2) + '\n';
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, jsonStr);
  fs.writeFileSync(histPath, jsonStr);

  printConsoleTable(payload);
  console.log('');
  console.log('Fichiers écrits :');
  console.log('  ' + path.relative(ROOT, mdPath));
  console.log('  ' + path.relative(ROOT, jsonPath));
  console.log('  ' + path.relative(ROOT, histPath));
  if (payload.warnings.length) {
    console.log('');
    console.log('Avertissements :');
    for (const w of payload.warnings) console.log('  - ' + w);
  }
}

main();
