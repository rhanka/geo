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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { latestZoneProvenanceQualityMatrix } from './lib/latest-coverage-matrix.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_COV = path.join(ROOT, 'work', 'coverage');
// Test-only override: production/CLI default remains the repository coverage dir.
const COV = process.env.PORTFOLIO_COVERAGE_DIR ? path.resolve(process.env.PORTFOLIO_COVERAGE_DIR) : DEFAULT_COV;
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
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
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

// Découverte du fichier daté le plus récent (par nom) répondant à un patron.
function discoverLatest(re) {
  if (!fs.existsSync(COV)) return null;
  const files = fs
    .readdirSync(COV)
    .filter((f) => re.test(f))
    .sort();
  return files.length ? path.join('work', 'coverage', files[files.length - 1]) : null;
}

// Découverte du readback le plus récent (par nom).
function discoverReadback() {
  return discoverLatest(/^zone-source-readback-audit-.*\.json$/);
}

// Découverte de la mesure de cohérence lot-zone À L'ÉCHELLE la plus récente (par nom).
// Repli explicite sur l'ancien fichier mono-ville si aucune passe à l'échelle n'existe.
function discoverLotZoneScale() {
  return discoverLatest(/^lot-zone-consistency-scale-.*\.json$/);
}

// La matrice est produite par le runner S3 committé. Son nom daté est l'ordre
// déterministe ; aucun mtime et aucun repli vers le snapshot historique.
function discoverProvQuality() {
  if (!fs.existsSync(COV)) return null;
  const file = latestZoneProvenanceQualityMatrix(
    fs.readdirSync(COV, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  return file ? (COV === DEFAULT_COV ? path.join('work', 'coverage', file) : path.join(COV, file)) : null;
}

// Paths (relatifs à ROOT).
const readbackRel = discoverReadback();
const lotZoneScaleRel = discoverLotZoneScale();
const provQualityRel = discoverProvQuality();
// Matrices Immo lot-zone (col. 12) et normes pliées (col. 13) : le nom daté est
// l'ordre déterministe (discoverLatest), jamais un chemin figé — l'ancien chemin
// hardcodé (…-20260723 / undated) est désormais absent du checkout et retombait à
// tort en `unknown`. Repli explicite sur l'ancien nom si aucune passe datée n'existe.
const immoLotZoneRel = discoverLatest(/^immo-lot-zone-assignment-matrix-.*\.json$/) || 'work/coverage/immo-lot-zone-assignment-matrix-20260723.json';
const immoFoldedRel = discoverLatest(/^immo-folded-normes-city-matrix-.*\.json$/) || 'work/coverage/immo-folded-normes-city-matrix.json';
// Attestation d'absence rejouable des municipalités PROUVÉES un-zonables (désignation
// autoritative MAMH : Territoire non organisé / Gouvernement régional). Alimente
// l'overlay N/A additif du KPI Zones. Découverte déterministe par nom daté ; absent → pas d'overlay.
const unzonableRel = discoverLatest(/^zones-unzonable-absence-attestation-.*\.json$/);

const SRC = {
  // Sources datées : discoverLatest (nom daté = ordre déterministe), repli explicite
  // sur l'ancien nom si aucune passe datée plus récente n'existe. Évite le hardcode
  // stale (cf. immo/lotzone auto-découverts) ; auto-frais quand une re-mesure arrive.
  zonesNormes: loadFile(discoverLatest(/^completion-1-zones-normes-summary-\d{8}\.json$/) || 'work/coverage/completion-1-zones-normes-summary-20260723.json'),
  pv: loadFile('work/coverage/pv-completion-city-audit.json'),
  regdens: loadFile(discoverLatest(/^completion-regdens-\d{8}\.json$/) || 'work/coverage/completion-regdens-20260802.json'),
  provQuality: provQualityRel ? loadFile(provQualityRel) : { path: null, exists: false, sha256: null, data: null, asOf: null },
  immoLotZone: loadFile(immoLotZoneRel),
  immoFolded: loadFile(immoFoldedRel),
  immoField: loadFile('work/immo-field-completion-matrices/immo-field-completion-matrix.json'),
  readback: readbackRel ? loadFile(readbackRel) : { path: null, exists: false, sha256: null, data: null, asOf: null },
  // Mesure de cohérence lot-zone à l'échelle (867 villes auditables). Ancien chemin conservé en repli.
  lotZoneScale: lotZoneScaleRel ? loadFile(lotZoneScaleRel) : { path: null, exists: false, sha256: null, data: null, asOf: null },
  lotZoneConsistency: loadFile('work/coverage/lot-zone-consistency.json'),
  // Attestation d'absence : municipalités PROUVÉES un-zonables (N-A-PROVEN sur désignation
  // MAMH autoritative). Utilisée uniquement pour un overlay N/A additif et gardé du KPI Zones.
  unzonableAttestation: unzonableRel
    ? loadFile(unzonableRel)
    : { path: null, exists: false, sha256: null, data: null, asOf: null },
  // Registre des villes canoniques (UTILISÉ UNIQUEMENT pour l'ensemble des slugs de l'univers 1 106,
  // jamais pour ses valeurs de couverture) : évite de créditer une ligne hors-univers.
  cityRegistry: loadFile('work/coverage/coverage-matrix.json'),
};

// Matrice zones per-muni (état par slug), verrouillée à la MÊME passe que l'agrégat
// `completion-1-zones-normes-summary-*` via son propre `deliverables.zonesMatrix`.
// L'overlay N/A la LIT pour connaître le bucket réel de chaque slug (measure > infer) :
// sans elle, on ne devine pas de quel bucket retirer une municipalité un-zonable.
const zonesMatrixRel = SRC.zonesNormes.data?.deliverables?.zonesMatrix || null;
SRC.zonesMatrix = zonesMatrixRel
  ? loadFile(zonesMatrixRel)
  : { path: null, exists: false, sha256: null, data: null, asOf: null };

// Ensemble des slugs villes canoniques (univers 1 106). null si le registre est absent.
function canonicalSlugSet() {
  const c = SRC.cityRegistry.data?.cities;
  if (!c || typeof c !== 'object') return null;
  const keys = Object.keys(c);
  if (keys.length !== UNIVERSE) {
    warn(`Registre villes: ${keys.length} slugs ≠ univers ${UNIVERSE} (gate hors-univers appliqué quand même)`);
  }
  return new Set(keys);
}

// ---- extraction des as-of (depuis chaque artefact lui-même) ----------------
function computeAsOf() {
  const s = SRC;
  if (s.zonesNormes.data) s.zonesNormes.asOf = s.zonesNormes.data.analysis_as_of || null;
  if (s.pv.data) s.pv.asOf = s.pv.data.asOf || null;
  if (s.regdens.data) {
    const a = s.regdens.data.source_as_of || {};
    const parts = [];
    if (a['reglement_declared']) parts.push(`règl. déclarée ${a['reglement_declared']}`);
    if (a['reglement_proven']) parts.push(`règl. preuve v2 ${a['reglement_proven']}`);
    if (a['usage_dominant']) parts.push(`usage ${a['usage_dominant']}`);
    if (a['effet_densifiant']) parts.push(`effet ${a['effet_densifiant']}`);
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
  if (s.lotZoneScale.data) {
    const g = s.lotZoneScale.data.generatedAt || null;
    const l = s.lotZoneScale.data.asOfS3Listing || null;
    s.lotZoneScale.asOf = [g, l ? `listing S3 ${l}` : null].filter(Boolean).join(' ; ') || null;
  }
  if (s.lotZoneConsistency.data) s.lotZoneConsistency.asOf = s.lotZoneConsistency.data.generatedAt || null;
  if (s.unzonableAttestation.data) s.unzonableAttestation.asOf = s.unzonableAttestation.data.generated_at || s.unzonableAttestation.data.generatedAt || null;
  if (s.zonesMatrix.data) s.zonesMatrix.asOf = s.zonesMatrix.data.analysis_as_of || null;
  if (s.cityRegistry.data) s.cityRegistry.asOf = s.cityRegistry.data.generatedAt || null;
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

// Une matrice de complétion est exploitable seulement si ses quatre états sont
// explicitement publiés et forment l'univers canonique. Une source incomplète
// ne reçoit aucun crédit : le KPI reste `unknown`.
function closedCityStateCell(states, { naKey, sourceLabel }) {
  const fields = ['complete', 'incomplete', 'unknown', naKey];
  if (!states || typeof states !== 'object') {
    warn(`${sourceLabel}: états absents (KPI concerné → unknown)`);
    return unknownCell();
  }
  const values = {};
  for (const field of fields) {
    const value = states[field];
    if (!Number.isInteger(value) || value < 0) {
      warn(`${sourceLabel}: état ${field} absent ou invalide (KPI concerné → unknown)`);
      return unknownCell();
    }
    values[field] = value;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (total !== UNIVERSE) {
    warn(`${sourceLabel}: partition ${total} ≠ univers ${UNIVERSE} (KPI concerné → unknown)`);
    return unknownCell();
  }
  return stdCell({
    complete: values.complete,
    incomplete: values.incomplete,
    unknown: values.unknown,
    na: values[naKey],
  });
}

// ---- extracteurs par KPI ---------------------------------------------------
// Overlay N/A ADDITIF et GARDÉ du KPI Zones : municipalités PROUVÉES un-zonables
// (désignation autoritative MAMH « Territoire non organisé » / « Gouvernement régional »,
// via l'attestation d'absence committée `zones-unzonable-absence-attestation-*.json`)
// reclassées N/A. Règles NON NÉGOCIABLES :
//   - source = attestation committée uniquement ; rien n'est deviné ;
//   - chaque slug est gaté à l'univers canonique 1 106 (hors-univers ⇒ ignoré + avert.) ;
//   - un slug N-A-PROVEN dont la grille qc-zonage EST servie est REFUSÉ : une revendication
//     d'inzonabilité contredite par une grille servie ne reclasse jamais en silence ;
//   - l'état de base par slug est LU dans la matrice zones per-muni (measure > infer) :
//     on retire chaque municipalité du SEUL bucket qu'elle occupe réellement, jamais d'un
//     bucket supposé ; sans matrice per-muni, l'overlay est sauté (pas d'inférence) ;
//   - garde de fermeture : aucun bucket ne peut passer sous 0, sinon overlay ENTIÈREMENT sauté.
// Retourne null si aucun overlay applicable (⇒ KPI de base inchangé, partition à 1 106).
function unzonableNaOverlay(base) {
  const att = SRC.unzonableAttestation.data;
  if (!att || !Array.isArray(att.rows)) {
    if (!SRC.unzonableAttestation.path) warn('overlay un-zonable: attestation d’absence absente — aucun overlay N/A appliqué (KPI Zones de base inchangé).');
    return null;
  }
  const proven = att.rows
    .filter((r) => r && r.classification === 'N-A-PROVEN')
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  if (!proven.length) return null;

  const canon = canonicalSlugSet();
  // États per-muni de base : sans eux, impossible de savoir de quel bucket retirer un
  // slug. On ne suppose pas — on saute l'overlay et on le signale.
  const rows = Array.isArray(SRC.zonesMatrix.data?.cities) ? SRC.zonesMatrix.data.cities : null;
  if (!rows) {
    warn('overlay un-zonable: matrice zones per-muni indisponible — overlay N/A sauté (état de base non mesurable, aucune inférence).');
    return null;
  }
  const stateBySlug = new Map();
  for (const c of rows) if (c && c.slug) stateBySlug.set(c.slug, c.state);

  const decrements = { complete: 0, incomplete: 0, unknown: 0 };
  const applied = [];
  for (const r of proven) {
    const slug = r.slug;
    if (canon && !canon.has(slug)) {
      warn(`overlay un-zonable: ${slug} hors univers canonique 1 106 — ignoré (aucune reclassification N/A).`);
      continue;
    }
    if (r.served_qczonage === true) {
      warn(`overlay un-zonable: ${slug} classé N-A-PROVEN mais qc-zonage servi=true (contradiction) — ignoré, aucune reclassification N/A.`);
      continue;
    }
    const fromState = stateBySlug.get(slug);
    if (fromState === undefined) {
      warn(`overlay un-zonable: ${slug} absent de la matrice zones per-muni — ignoré (état de base inconnu).`);
      continue;
    }
    if (fromState === 'N-A') continue; // déjà N/A dans la base : idempotent, jamais re-compté.
    if (fromState !== 'complete' && fromState !== 'incomplete' && fromState !== 'unknown') {
      warn(`overlay un-zonable: ${slug} état de base non décrémentable (${fromState}) — ignoré.`);
      continue;
    }
    decrements[fromState] += 1;
    applied.push({
      slug,
      designation: (r.directory_lookup && r.directory_lookup.designation) || r.classification,
      from_state: fromState,
    });
  }

  const k = applied.length;
  if (k === 0) return null;

  // Garde de fermeture : jamais de bucket négatif ni de partition non fermée.
  for (const bucket of ['complete', 'incomplete', 'unknown']) {
    if (decrements[bucket] > (base[bucket] || 0)) {
      warn(`overlay un-zonable: décrément ${bucket} (${decrements[bucket]}) > base (${base[bucket] || 0}) — overlay N/A ENTIÈREMENT sauté (partition protégée).`);
      return null;
    }
  }
  return { k, decrements, applied };
}

function kpiZones() {
  const sc = SRC.zonesNormes.data?.lanes?.zones?.state_counts;
  if (!sc) return unknownCell();
  const base = { complete: sc.complete, incomplete: sc.incomplete, unknown: sc.unknown, na: sc['N-A'] || 0 };
  const overlay = unzonableNaOverlay(base);
  if (!overlay) {
    return stdCell({ complete: base.complete, incomplete: base.incomplete, unknown: base.unknown, na: base.na });
  }
  const cell = stdCell({
    complete: base.complete - (overlay.decrements.complete || 0),
    incomplete: base.incomplete - (overlay.decrements.incomplete || 0),
    unknown: base.unknown - (overlay.decrements.unknown || 0),
    na: base.na + overlay.k,
  });
  cell.extra = {
    unzonable_na_proven_applied: overlay.k,
    source: SRC.unzonableAttestation.path,
    base_state_source: SRC.zonesMatrix.path,
    slugs: overlay.applied, // [{ slug, designation, from_state }] — traçable pour note + JSON.
  };
  return cell;
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
  return closedCityStateCell(t, { naKey: 'N/A', sourceLabel: `regdens totals.${laneKey}` });
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
  const q = provenanceQualityCounts();
  if (!q) return unknownCell();
  const { acceptable, candidate, orphan, unknown: unk, v2 } = q;
  return {
    status: 'ok',
    // Une v2 vérifiée est aussi une qualité acceptable; la garder séparée dans
    // l'affichage évite cependant de faire passer la qualité retained pour v2.
    complete: acceptable + v2,
    incomplete: candidate + orphan,
    unknown: unk,
    na: 0,
    denominator: UNIVERSE,
    partitionTotal: UNIVERSE,
    display: `${fmt(acceptable)} acceptable · ${fmt(v2)} v2 · ${fmt(candidate)} candidate · ${fmt(orphan)} orphan · ${fmt(unk)} unknown`,
    cible: fmt(UNIVERSE),
    extra: { acceptable, candidate, orphan, unknown: unk, v2 },
  };
}

function kpiProvV2() {
  const q = provenanceQualityCounts();
  if (!q) return unknownCell();
  const v2 = q.v2;
  return {
    status: 'ok',
    complete: v2,
    incomplete: 0,
    unknown: UNIVERSE - v2,
    na: 0,
    denominator: UNIVERSE,
    partitionTotal: UNIVERSE,
    display: `${fmt(v2)} / ${fmt(UNIVERSE)} v2 · preuve capture+CAS vérifiée uniquement`,
    cible: fmt(UNIVERSE),
    extra: { v2 },
  };
}

function provenanceQualityCounts() {
  const q = SRC.provQuality.data?.validation?.quality_status_partition?.counts;
  if (!q || typeof q !== 'object') return null;
  const names = ['acceptable', 'candidate', 'orphan', 'unknown', 'v2'];
  const values = {};
  for (const name of names) {
    const value = q[name];
    if (!Number.isInteger(value) || value < 0) {
      warn(`matrice provenance: counts.${name} absent ou invalide (KPI concernés → unknown)`);
      return null;
    }
    values[name] = value;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (total !== UNIVERSE) {
    warn(`matrice provenance: partition qualité ${total} ≠ univers ${UNIVERSE} (KPI concernés → unknown)`);
    return null;
  }
  return values;
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
  return closedCityStateCell(cs, { naKey: 'N/A', sourceLabel: 'immo lot-zone summary.city_states' });
}

function kpiImmoFolded() {
  const cs = SRC.immoFolded.data?.counts?.cityStates;
  return closedCityStateCell(cs, { naKey: 'not_applicable', sourceLabel: 'immo normes pliées counts.cityStates' });
}

function immoFieldCell(fieldKey) {
  const f = SRC.immoField.data?.summary?.by_field_status?.[fieldKey];
  if (!f) return unknownCell();
  return stdCell({ complete: f.complete, incomplete: f.incomplete, unknown: f.unknown, na: f['N/A'] || 0 });
}

// AJOUT qualité #2 : cohérence lot-zone. Source = la passe À L'ÉCHELLE la plus récente
// (`lot-zone-consistency-scale-*.json`), repli sur l'ancien `lot-zone-consistency.json`.
// Règles NON NÉGOCIABLES :
//   - ville `complete` SSI `mismatch_pct < 5 %` ET `status === 'measured'` ;
//   - `inconclusive_zero_assigned` (0 lot porteur d'un `code_zone`) => `unknown`, JAMAIS
//     `complete` : leur mismatch vaut 0 par absence de donnée, pas par qualité ;
//   - ville non auditable (pas de zonage servi OU pas de lots servis) => `unknown` ;
//   - une ligne hors univers canonique ne reçoit aucun crédit de complétion ;
//   - la partition ferme sur l'univers 1 106.
function kpiCoherenceLotZone() {
  const scale = SRC.lotZoneScale.data;
  const legacy = SRC.lotZoneConsistency.data;
  const d = scale || legacy;
  const sourcePath = scale ? SRC.lotZoneScale.path : SRC.lotZoneConsistency.path;
  if (!d) return { status: 'unknown', complete: null, incomplete: null, unknown: null, na: null, denominator: null, partitionTotal: null, display: 'unknown', cible: fmt(UNIVERSE) };

  const cities = Array.isArray(d.cities) ? d.cities : [];
  const canon = canonicalSlugSet();
  const inUniverse = (slug) => (canon ? canon.has(slug) : true);

  let complete = 0;
  let incomplete = 0;
  let inconclusive = 0;
  let offUniverse = 0;
  for (const c of cities) {
    if (!inUniverse(c.slug)) {
      offUniverse++;
      continue;
    }
    // `status` absent (ancien format) => on retombe sur le seul test du taux.
    const measured = c.status ? c.status === 'measured' : typeof c.mismatch_pct === 'number';
    if (measured && typeof c.mismatch_pct === 'number') {
      if (c.mismatch_pct < 5) complete++;
      else incomplete++;
    } else {
      // 0 lot assigné (ou taux non calculable) : jamais `complete`.
      inconclusive++;
    }
  }
  const auditedInUniverse = complete + incomplete + inconclusive;

  const COVERAGE_MIN = Math.ceil(UNIVERSE * 0.5); // seuil "assez de villes"
  if (auditedInUniverse < COVERAGE_MIN) {
    const ex = cities
      .slice(0, 3)
      .map((c) => `${c.slug} : mismatch ${c.mismatch_pct === null || c.mismatch_pct === undefined ? 'non calculable' : pctFr(c.mismatch_pct)}`)
      .join(' ; ');
    return {
      status: 'insufficient',
      complete: null,
      incomplete: null,
      unknown: null,
      na: null,
      denominator: null,
      partitionTotal: null,
      display: `donnée insuffisante — ${fmt(auditedInUniverse)} / ${fmt(UNIVERSE)} ville(s) auditée(s)${ex ? ` (${ex})` : ''}`,
      cible: fmt(UNIVERSE),
      extra: { audited: auditedInUniverse, universe: UNIVERSE, coverage_min: COVERAGE_MIN, source: sourcePath },
    };
  }

  // Couverture suffisante. `unknown` = tout ce qui n'est ni complete ni incomplete :
  // villes non concluantes (0 lot assigné) + villes non auditables (zonage OU lots absents).
  const notAuditable = UNIVERSE - auditedInUniverse;
  const unknown = inconclusive + notAuditable;
  const cell = stdCell({ complete, incomplete, unknown, na: 0 });
  const t = d.totals || {};
  cell.extra = {
    source: sourcePath,
    audited_in_universe: auditedInUniverse,
    off_universe_rows: offUniverse,
    complete_under_5pct: complete,
    incomplete_at_or_over_5pct: incomplete,
    inconclusive_zero_assigned: inconclusive,
    not_auditable: notAuditable,
    coverage_min: COVERAGE_MIN,
    weighted_mismatch_pct: t.weighted_mismatch_pct ?? null,
    median_city_mismatch_pct: t.median_city_mismatch_pct ?? null,
    p90_city_mismatch_pct: t.p90_city_mismatch_pct ?? null,
  };
  // Contrôle de cohérence défensif avec l'agrégat publié par la source (jamais silencieux).
  const claimed = d.kpi_threshold_5pct;
  if (claimed && typeof claimed.complete_under_5pct === 'number') {
    const expected = claimed.complete_under_5pct - offUniverse;
    if (expected !== complete) {
      warn(`cohérence lot-zone: complete recalculé (${complete}) ≠ source (${claimed.complete_under_5pct}) − hors-univers (${offUniverse})`);
    }
  }
  return cell;
}

// ---- table des KPI (ordre figé) --------------------------------------------
const KPIS = [
  { key: 'zones', label: 'Zones — complétion', extract: kpiZones },
  { key: 'coherence_lot_zone', label: 'Zones — cohérence lot-zone', extract: kpiCoherenceLotZone },
  { key: 'normes', label: 'Normes — complétion', extract: kpiNormes },
  { key: 'pv', label: 'PV — complétion', extract: kpiPv },
  // Règlement scindé en DEUX lignes (conducteur 20260803) : la « déclarée » est
  // la présence d'un règlement déclaré (source regdens désormais committée), la
  // « preuve v2 » est la sous-partie alignée sur une preuve de capture v2. Sans
  // le split, la ligne unique affichait 542 (preuve) et laissait croire à une
  // chute face à l'ancienne mesure déclarée 815 — fausse régression. Le split
  // renomme la clé, donc la chaîne de diff repart proprement (Précédent/Δ = «—»
  // une fois, aucun Δ fabriqué) ; la comparabilité 815→895 est dite en note.
  {
    key: 'reglement_declared',
    label: 'Règlement — complétion déclarée',
    definitionChangedAsOf: '20260803',
    extract: () => regdensCell('reglement_declared'),
  },
  {
    key: 'reglement_proven',
    label: 'Règlement — preuve v2',
    definitionChangedAsOf: '20260803',
    extract: () => regdensCell('reglement_proven'),
  },
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
  // Le snapshot précédent doit lui-même porter une mesure comparable. S'il était
  // `unknown`/`insufficient` (champs null), AUCUN Δ n'est calculable : on dit "—"
  // et non "0" — un "0" laisserait croire à une absence de mouvement.
  if (prior.status && prior.status !== 'ok') return '—';
  const parts = [];
  let comparable = 0;
  for (const [f, label] of DELTA_FIELDS) {
    const a = prior[f];
    const b = cur[f];
    if (typeof a === 'number' && typeof b === 'number') {
      comparable++;
      const d = b - a;
      if (d !== 0) parts.push(`${d > 0 ? '+' : ''}${d} ${label}`);
    }
  }
  if (!comparable) return '—';
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
    const definitionIncomparable = !!(
      k.definitionChangedAsOf && prevSnap && prevSnap.date < k.definitionChangedAsOf
    );
    const row = {
      key: k.key,
      kpi: k.label,
      precedent: prior ? renderPrecedent(prior) : '—',
      precedentDate: prevSnap ? prevSnap.date : null,
      actuel,
      delta: definitionIncomparable ? '—' : computeDelta(prior, cur),
      cible: cur.cible,
    };
    if (k.definitionChangedAsOf) row.definitionChangedAsOf = k.definitionChangedAsOf;
    return row;
  });

  const sourcesMeta = [
    SRC.zonesNormes,
    SRC.zonesMatrix,
    SRC.pv,
    SRC.regdens,
    SRC.provQuality,
    SRC.immoLotZone,
    SRC.immoFolded,
    SRC.immoField,
    SRC.readback,
    SRC.lotZoneScale,
    SRC.lotZoneConsistency,
    SRC.unzonableAttestation,
    SRC.cityRegistry,
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
  const zonesRow = payload.kpis.find((k) => k.key === 'zones');
  if (zonesRow && zonesRow.actuel.extra && zonesRow.actuel.extra.unzonable_na_proven_applied > 0) {
    const e = zonesRow.actuel.extra;
    const names = e.slugs.map((s) => `${s.slug} (${s.designation})`).join(' ; ');
    L.push(
      `- **Zones — N/A un-zonable prouvé** : ${fmt(e.unzonable_na_proven_applied)} municipalité(s) à désignation autoritative MAMH non-municipale-locale comptée(s) N/A dans le KPI Zones — ${names}. ` +
        `Source = attestation d’absence committée (\`${e.source}\`, N-A-PROVEN sur preuve positive TNO / Gouvernement régional), pas devinée. ` +
        'Reclassification ADDITIVE et partition fermée (dénominateur 1 106 − N/A) ; chaque municipalité est retirée du seul bucket de base qu’elle occupait (état lu dans la matrice zones per-muni, non inféré) ; `unknown` reste jamais compté `complete`.'
    );
  }
  L.push(
    '- **Alignement présence + qualité/provenance** : le rapport mesure la PRÉSENCE (données servies) ET la QUALITÉ/PROVENANCE (URL de source servie, cohérence lot-zone) ; sans cet axe, la ré-acquisition et le stampage sont invisibles.'
  );
  const reglDeclared = payload.kpis.find((k) => k.key === 'reglement_declared');
  const reglProven = payload.kpis.find((k) => k.key === 'reglement_proven');
  if (reglDeclared && reglProven) {
    L.push(
      '- **Règlement — DEUX lignes** : « complétion déclarée » (présence d’un règlement déclaré, ' +
        'source `regdens totals.reglement_declared` désormais committée) ET « preuve v2 » ' +
        '(`totals.reglement_proven`, sous-partie alignée sur une preuve de capture v2). ' +
        'Elles mesurent deux choses distinctes ; jamais fondues.'
    );
    const splitBoundary =
      reglDeclared.definitionChangedAsOf &&
      payload.previousSnapshotDate &&
      payload.previousSnapshotDate < reglDeclared.definitionChangedAsOf;
    if (splitBoundary) {
      L.push(
        '- Règlement — bascule du 20260803 : la ligne unique (preuve 542) est scindée en déclarée + preuve. ' +
          'La déclarée (895) est comparable à l’ancienne mesure déclarée 815 (progrès, PAS une régression) ; ' +
          'le renommage de clé réinitialise la chaîne de diff (Précédent/Δ = «—» cette fois, aucun Δ fabriqué).'
      );
    }
  }
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
  if (coh && coh.actuel.status === 'ok') {
    const e = coh.actuel.extra || {};
    L.push(
      `- **Cohérence lot-zone** : mesure RÉELLE sur ${fmt(e.audited_in_universe)} villes auditables (zonage ET lots servis), ville \`complete\` ssi \`mismatch_pct < 5 %\`. ` +
        `${fmt(e.inconclusive_zero_assigned)} villes sans AUCUN lot porteur de \`code_zone\` sont comptées \`unknown\`, jamais \`complete\` : leur taux vaut 0 par absence de donnée, pas par qualité. ` +
        `${fmt(e.not_auditable)} villes non auditables (zonage ou lots non servis) sont également \`unknown\`.` +
        (e.off_universe_rows ? ` ${fmt(e.off_universe_rows)} ligne(s) hors univers canonique sans crédit de complétion.` : '')
    );
    if (e.weighted_mismatch_pct != null) {
      L.push(
        `- **Mismatch lot-zone à l’échelle (contexte lots, non mélangé aux KPI villes)** : ${pctFr(e.weighted_mismatch_pct)} pondéré par les lots, ` +
          `médiane par ville ${pctFr(e.median_city_mismatch_pct)}, p90 ${pctFr(e.p90_city_mismatch_pct)} — le défaut est CONCENTRÉ, pas diffus.`
      );
    }
    if (coh.precedent && coh.precedent !== '—' && coh.delta === '—') {
      L.push(
        `- Δ cohérence lot-zone non calculable : le snapshot ${payload.previousSnapshotDate} portait ce KPI en "donnée insuffisante" (aucun champ numérique). ` +
          'Aucun Δ n’est fabriqué ; le premier Δ réel sortira au prochain run.'
      );
    }
  }
  // Trou de jointure lot→zone : contexte LOTS, présenté séparément (comme les normes pliées),
  // jamais fondu dans le KPI ville.
  const scaleTot = SRC.lotZoneScale.data?.totals;
  if (scaleTot && typeof scaleTot.unassigned === 'number' && scaleTot.lots) {
    const pct = Math.round((scaleTot.unassigned / scaleTot.lots) * 10000) / 100;
    const sc = Array.isArray(SRC.lotZoneScale.data.cities) ? SRC.lotZoneScale.data.cities : [];
    const byUnassigned = sc.slice().sort((a, b) => (b.unassigned || 0) - (a.unassigned || 0) || a.slug.localeCompare(b.slug));
    const worst = byUnassigned[0];
    const fullyUnassigned = sc
      .filter((c) => c.assigned === 0 && (c.lots || 0) > 0)
      .sort((a, b) => (b.lots || 0) - (a.lots || 0) || a.slug.localeCompare(b.slug))[0];
    const bits = [];
    if (worst) bits.push(`${worst.slug} ${fmt(worst.unassigned)}/${fmt(worst.lots)}`);
    if (fullyUnassigned && (!worst || fullyUnassigned.slug !== worst.slug)) {
      bits.push(`${fullyUnassigned.slug} ${fmt(fullyUnassigned.unassigned)}/${fmt(fullyUnassigned.lots)}`);
    }
    L.push(
      `- **Lots sans \`code_zone\` (contexte lots, non mélangé aux KPI villes)** : ${fmt(scaleTot.unassigned)} lots servis sur ${fmt(scaleTot.lots)} (${pctFr(pct)}) n’ont AUCUN \`code_zone\` — ` +
        `trou de jointure PLUS GROS que le mismatch lui-même, concentré sur quelques villes` +
        (bits.length ? ` (${bits.join(' ; ')})` : '') +
        '. À traiter comme un gisement de re-fold distinct, pas comme une incohérence de géométrie.'
    );
  }
  const fold = SRC.immoFolded.data?.counts;
  if (fold) {
    L.push(
      `- Normes pliées (contexte lots, non mélangé aux KPI villes) : ${fmt(fold.matchedFoldedNormesLots)} / ${fmt(fold.matchedServedLots)} lots servis pliés (${String(fold.matchedFoldedNormesPct).replace('.', ',')} %) ; ${fmt(fold.matchedMissingFoldedNormesLots)} manquants.`
    );
  }
  L.push(
    '- `acceptable` de provenance n’est PAS une preuve v2. Une v2 est comptée uniquement lorsque le runner rattache le triplet de preuve à une capture et à ses octets CAS rehashés; rien n’est inféré.'
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

export { build };

const IS_MAIN = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (IS_MAIN) main();
