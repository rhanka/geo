#!/usr/bin/env node
// AUDIT DE PROVENANCE & FRAÎCHEUR des colonnes du palier (réconciliation
// complétion-vs-capté — duty QA #3). Après la correction de la col 4 (PV capté,
// pas déclaratif : 666 indexé vs 1062 « done » déclaré), cette sonde généralise
// la question à TOUTES les colonnes : « le vert de cette colonne reflète-t-il une
// donnée CAPTÉE/SERVIE, ou un statut DÉCLARÉ ? » et « la source est-elle FRAÎCHE
// ou figée pendant que l'acquisition avance ? ».
//
// Elle n'invente rien : elle lit les MÊMES fichiers que le générateur de matrice
// (scripts/palier-matrix-report.mjs), extrait leur horodatage interne et les
// classe. Deux signaux pour l'owner et le conducteur :
//   1. NATURE — servi/read-back (capté) vs déclaratif vs manifeste-local corroboré.
//      Un « complete » déclaratif SANS contre-preuve captée = risque « vert par
//      omission » (principe fondateur). Col 4 déjà corrigée en réf.
//   2. FRAÎCHEUR — âge de la source vs la date du rapport. Une source FIGÉE
//      pendant que l'acquisition dépose (zones re-lancé) crée un ANGLE MORT :
//      la colonne ne bougera pas tant que sa matrice-source n'est pas régénérée
//      depuis S3. C'est le lien mesure↔garant-recalage à remonter.
//
// Usage : node scripts/palier-source-freshness-audit.mjs [--date=YYYYMMDD]
//         node scripts/palier-source-freshness-audit.mjs --check
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { latestZoneProvenanceQualityMatrix } from './lib/latest-coverage-matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');
const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes('--check');
const optArg = (name, fb = null) => {
  const p = `--${name}=`; const v = ARGV.find((a) => a.startsWith(p));
  return v === undefined ? fb : v.slice(p.length);
};
const reportDate = (() => {
  const f = optArg('date');
  if (f) { if (!/^\d{8}$/.test(f)) throw new Error('--date doit être YYYYMMDD'); return f; }
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
})();

const sha256File = (p) => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function pickLatestByPrefix(re) {
  if (!fs.existsSync(COV)) return null;
  const hits = fs.readdirSync(COV).filter((f) => re.test(f)).sort();
  return hits.length ? path.join(COV, hits[hits.length - 1]) : null;
}
function readJson(abs) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } }

// Extrait un horodatage « as_of » d'un objet, en balayant les clés connues.
function asOfOf(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of ['as_of', 'analysis_as_of', 'generatedAt', 'retrieved_at', 'reportDate', 'generated_at']) {
    if (obj[k]) return String(obj[k]);
  }
  return null;
}
// Normalise un as_of (date ou ISO) en YYYYMMDD pour comparer à reportDate.
function toYmd(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? m[1] + m[2] + m[3] : null;
}
function ageDays(ymd) {
  if (!ymd) return null;
  const d = (y) => Date.UTC(+y.slice(0, 4), +y.slice(4, 6) - 1, +y.slice(6, 8));
  return Math.round((d(reportDate) - d(ymd)) / 86400000);
}

const qualityName = latestZoneProvenanceQualityMatrix(fs.existsSync(COV) ? fs.readdirSync(COV) : []);

// Classes de nature de provenance (du plus fort au plus faible en garantie) :
//   SERVED-READBACK  : lu en retour depuis la donnée SERVIE (S3) — capté vérifié.
//   CAPTURED-INDEX   : présence d'octets INDEXÉS côté production (capté).
//   SERVED-FACT      : fait dérivé d'une jointure/collection réellement servie.
//   DECLARED+PROVEN  : porte les DEUX axes (déclaré ET preuve live) séparément.
//   LOCAL-MANIFEST   : corroboré par un manifeste LOCAL (s3:false) — capté au
//                      moment T de la capture, mais NON re-vérifié servi ; fige.
//   DECLARATIVE      : statut déclaré (coverage-status) — risque vert-par-omission.
//   DERIVED-METRIC   : seuil sur une métrique mesurée (ex. mismatch_pct).
//   GAP              : aucune source per-ville (colonne track/plafond).
const SPEC = [
  { cols: '1', source: /^completion-1-zones-matrix-\d{8}\.json$/, nature: 'LOCAL-MANIFEST',
    note: 'complete = coverage-matrix zones.status=done ET ligne slug dans le manifeste LOCAL (execution s3:false). Capté au moment de la capture, PAS re-vérifié servi.' },
  { cols: '3', source: /^completion-1-normes-matrix-\d{8}\.json$/, nature: 'LOCAL-MANIFEST',
    note: 'idem zones : status=done + corroboration manifeste local (s3:false).' },
  { cols: '2', source: /^lot-zone-consistency-scale-\d{8}\.json$/, nature: 'DERIVED-METRIC',
    note: 'seuil mismatch_pct<5 sur une mesure de cohérence lot-zone.' },
  { cols: '4', source: /^pv-couverture-municipale-.*\.json$/, nature: 'CAPTURED-INDEX',
    note: 'RÉCONCILIÉE : complete ssi ≥1 PV INDEXÉ owner-confirmé (capté). Le déclaratif (pv-completion-city-audit) ne sert plus qu\'à N-A/incomplete. Réf de la duty #3.' },
  { cols: '5', source: /^completion-regdens-percity-\d{8}\.json$/, nature: 'DECLARED+PROVEN',
    note: 'deux axes : reglement_declared (numéro connu) ET reglement_proven (capture live). proven=complete ⇒ capté ; declared seul ⇒ incomplete.', axis: 'reglement_proven' },
  { cols: '6', source: /^completion-regdens-percity-\d{8}\.json$/, nature: 'DECLARATIVE',
    note: 'usage_dominant : état de complétion déclaré per-city (pas de contre-preuve captée séparée dans le palier).', axis: 'usage_dominant' },
  { cols: '7', source: /^completion-regdens-percity-\d{8}\.json$/, nature: 'DECLARATIVE',
    note: 'effet_densifiant : plafond documentaire ; état déclaré.', axis: 'effet_densifiant' },
  { cols: '8,9,10', source: qualityName ? new RegExp('^' + qualityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : /___nomatch___/, nature: 'SERVED-FACT',
    note: 'matrice qualité de provenance zones : collection_key servie (8), quality_status (9), preuve-v2 (10). Dérivé de collections réellement servies.' },
  { cols: '11', source: /^zone-source-readback-audit-\d{8}\.json$/, nature: 'SERVED-READBACK',
    note: 'read-back de l\'URL source SERVIE (STAMPED). Le capté vérifié le plus fort — étalon.' },
  { cols: '12', source: /^immo-lot-zone-assignment-matrix-\d{8}\.json$/, nature: 'SERVED-FACT',
    note: 'assignation lot-zone depuis matrice immo.' },
  { cols: '13', source: /^immo-folded-normes-city-matrix-\d{8}\.json$/, nature: 'SERVED-FACT',
    note: 'normes pliées depuis matrice immo.' },
  { cols: '14-19', source: null, fixed: path.join(ROOT, 'work', 'immo-field-completion-matrices', 'immo-field-completion-matrix.json'), nature: 'SERVED-FACT',
    note: 'champs immo servis (lots/surface/CP/adresse/TOD) — statut par champ depuis la matrice de complétion immo.' },
  { cols: '20', source: null, nature: 'GAP', note: 'aucune source recall/précision v3.4 per-ville (WP5) — colonne track.' },
];

const rows = [];
for (const s of SPEC) {
  const abs = s.fixed ?? (s.source ? pickLatestByPrefix(s.source) : null);
  const present = abs && fs.existsSync(abs);
  const j = present ? readJson(abs) : null;
  let asOf = j ? asOfOf(j) : null;
  // regdens : préférer l'as_of de l'axe précis si dispo.
  if (s.axis && j?.source_as_of?.[s.axis]) asOf = j.source_as_of[s.axis];
  const ymd = toYmd(asOf);
  rows.push({
    cols: s.cols,
    nature: present ? s.nature : (s.nature === 'GAP' ? 'GAP' : 'MISSING'),
    source: present ? path.relative(ROOT, abs) : (s.fixed ? path.relative(ROOT, s.fixed) : null),
    sha256: present ? sha256File(abs) : null,
    as_of: asOf ?? null,
    age_days: ageDays(ymd),
    note: s.note,
  });
}

// Signaux d'alerte pour le conducteur (déterministes, dérivés — pas d'invention).
const STALE_DAYS = 7; // au-delà, la source est « figée » vs la cadence du sprint.
const alerts = [];
for (const r of rows) {
  if (r.nature === 'DECLARATIVE') {
    alerts.push({ level: 'DECLARATIF', cols: r.cols,
      msg: `colonne ${r.cols} déclarative sans contre-preuve captée dans le palier — vérifier qu'un « complete » n'est pas « vert par omission » (cf. réconciliation col 4 PV).` });
  }
  if (r.nature === 'LOCAL-MANIFEST') {
    alerts.push({ level: 'MANIFESTE-LOCAL', cols: r.cols,
      msg: `colonne ${r.cols} corroborée par manifeste LOCAL (s3:false) — non re-vérifiée servi.` });
  }
  if (typeof r.age_days === 'number' && r.age_days > STALE_DAYS && r.nature !== 'GAP') {
    alerts.push({ level: 'FIGÉ', cols: r.cols,
      msg: `source de la colonne ${r.cols} figée à ${r.as_of} (${r.age_days} j) — un dépôt d'acquisition FRAIS n'y apparaîtra pas tant que la matrice-source n'est pas régénérée depuis S3. ANGLE MORT mesure↔acquisition.` });
  }
  if (r.nature === 'MISSING') {
    alerts.push({ level: 'ABSENT', cols: r.cols, msg: `source absente pour la colonne ${r.cols}.` });
  }
}

const out = {
  contract: 'palier-source-freshness-audit/v1',
  reportDate,
  stale_threshold_days: STALE_DAYS,
  reference: 'réconciliation complétion-vs-capté (duty QA #3) — col 4 PV corrigée au capté en réf.',
  columns: rows,
  alerts,
};

if (CHECK) {
  // fermeture : chaque SPEC produit exactement une ligne ; natures dans le vocabulaire.
  const VOCAB = new Set(['SERVED-READBACK', 'CAPTURED-INDEX', 'SERVED-FACT', 'DECLARED+PROVEN', 'LOCAL-MANIFEST', 'DECLARATIVE', 'DERIVED-METRIC', 'GAP', 'MISSING']);
  if (rows.length !== SPEC.length) throw new Error('lignes ≠ SPEC');
  for (const r of rows) if (!VOCAB.has(r.nature)) throw new Error('nature hors vocabulaire: ' + r.nature);
  console.log(`CHECK OK — ${rows.length} colonnes classées, natures fermées. ${alerts.length} alertes.`);
  process.exit(0);
}

const outPath = path.join(COV, `palier-source-freshness-${reportDate}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

// Résumé console (lisible conducteur).
console.log(`# Audit provenance & fraîcheur — palier (${reportDate})\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('col', 8) + pad('nature', 18) + pad('as_of', 27) + 'âge(j)');
for (const r of rows) console.log(pad(r.cols, 8) + pad(r.nature, 18) + pad(r.as_of ?? '—', 27) + (r.age_days ?? '—'));
console.log(`\nAlertes (${alerts.length}) :`);
for (const a of alerts) console.log(`  [${a.level}] ${a.msg}`);
console.log(`\nÉcrit : ${path.relative(ROOT, outPath)}`);
