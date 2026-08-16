#!/usr/bin/env node
// REVALIDATION du référentiel RÈGLEMENT (geo est LE référentiel — priorité owner).
// Émet un VERDICT PAR VILLE = source de vérité du KPI Règlement (def3b561).
// Contrôles STRUCTURELS (lecture seule, déterministe, anti-invention) sur
// acquisition/config/reglement-provenance.json :
//   1. url-sans-numero  : reglement_url présent mais reglement_numero vide.
//   2. url-malformee    : reglement_url ne commence pas par http(s).
//   3. millesime-hors-plage : reglement_millesime hors [1980..2026].
//   4. numero-long-duplique : reglement_numero « long/complet » présent dans ≥2 villes
//      (copie-colle suspect). « long » = contient séparateur -/ OU longueur ≥6 OU
//      contient une année 4-chiffres. Les numéros courts (ex '47') dupliqués =
//      numérotation municipale indépendante LÉGITIME → JAMAIS flaggés.
//   5. liveness (url morte) : NON testée localement (un fetch local est faux/bloqué).
//      La sonde tourne SUR LE CLUSTER (--kubeconfig /tmp/ovh.kubeconfig). Ce script
//      accepte --liveness=<json {url: {alive:bool|status}}> et marque 'a-capturer'
//      pour une url morte ; sans fichier, liveness = 'non-testee' (JAMAIS deviné).
//
// ANTI-INVENTION : numéro/url RÉELS lus de la source ; url morte = verdict
// 'a-capturer' (recapture), JAMAIS null inventé ; ville sans défaut = 'ok'.
// Partitions fermées : chaque ville a exactement un verdict.
//
// Usage : node scripts/reglement-revalidation.mjs [--liveness=<file.json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const opt = (n) => { const p = `--${n}=`; const v = ARGV.find((a) => a.startsWith(p)); return v ? v.slice(p.length) : null; };
const AS_OF = '2026-08-10';
const SRC_REL = 'acquisition/config/reglement-provenance.json';

const srcAbs = path.join(ROOT, SRC_REL);
const raw = fs.readFileSync(srcAbs, 'utf8');
const src = JSON.parse(raw);
const srcSha = 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
const slugs = src.slugs && typeof src.slugs === 'object' ? src.slugs : {};

// liveness optionnelle (résultats sonde cluster).
let liveness = null;
const livenessFile = opt('liveness');
if (livenessFile) {
  try { liveness = JSON.parse(fs.readFileSync(path.resolve(ROOT, livenessFile), 'utf8')); } catch { liveness = null; }
}
const isDead = (url) => {
  if (!liveness) return null; // non testée
  const e = liveness[url];
  if (e == null) return null;
  if (typeof e === 'boolean') return e === false ? true : false; // true=alive
  if (typeof e === 'object' && e.alive != null) return e.alive === false;
  if (typeof e === 'number') return e >= 400 || e === 0; // code http
  if (typeof e === 'string') return /dead|morte|error|timeout|4\d\d|5\d\d/i.test(e);
  return null;
};

const hasNum = (n) => typeof n === 'string' && n.trim().length > 0;
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const isLongNumero = (n) => hasNum(n) && (/[\-\/]/.test(n) || n.trim().length >= 6 || /\d{4}/.test(n));

// index des numéros longs pour la détection de doublons.
const longNumToSlugs = new Map();
for (const [slug, e] of Object.entries(slugs)) {
  const n = e?.reglement_numero;
  if (isLongNumero(n)) {
    const key = String(n).trim();
    (longNumToSlugs.get(key) ?? longNumToSlugs.set(key, []).get(key)).push(slug);
  }
}
const dupLongNums = new Set([...longNumToSlugs.entries()].filter(([, s]) => s.length >= 2).map(([k]) => k));

const cities = [];
for (const [slug, e] of Object.entries(slugs)) {
  const num = e?.reglement_numero ?? null;
  const url = e?.reglement_url ?? null;
  const mil = e?.reglement_millesime ?? null;
  const raisons = [];

  // 2 url malformée (si une url est présente mais non-http).
  if (url != null && String(url).trim() !== '' && !isHttp(url)) raisons.push('url-malformee');
  // 1 url sans numéro (url http présente mais numéro absent).
  if (isHttp(url) && !hasNum(num)) raisons.push('url-sans-numero');
  // 3 millésime hors plage. NB : reglement_millesime est parfois une STRING ("2013")
  // — on coerce en nombre ; on ne flagge QUE si la valeur numérique est vraiment hors
  // [1980,2026] ou non-parseable (jamais une année valide écrite en texte).
  const milNum = (typeof mil === 'string' && mil.trim() !== '') ? Number(mil) : mil;
  if (mil != null && String(mil).trim() !== '' && (typeof milNum !== 'number' || Number.isNaN(milNum) || milNum < 1980 || milNum > 2026)) raisons.push('millesime-hors-plage');
  // 4 numéro long dupliqué.
  if (isLongNumero(num) && dupLongNums.has(String(num).trim())) raisons.push('numero-long-duplique');

  // 5 liveness → a-capturer (prioritaire sur ok, mais informatif si déjà incohérent).
  const dead = isHttp(url) ? isDead(url) : null;

  let verdict;
  if (raisons.length) verdict = 'incoherent';
  else if (dead === true) verdict = 'a-capturer';
  else verdict = 'ok';

  cities.push({
    slug, verdict,
    raisons: raisons.length ? raisons : undefined,
    liveness: isHttp(url) ? (dead === null ? 'non-testee' : (dead ? 'morte' : 'vivante')) : 'na',
    reglement_numero: num, reglement_url: url, reglement_millesime: mil,
    dup_num_slugs: (isLongNumero(num) && dupLongNums.has(String(num).trim())) ? longNumToSlugs.get(String(num).trim()) : undefined,
  });
}

const byVerdict = cities.reduce((m, c) => { m[c.verdict] = (m[c.verdict] ?? 0) + 1; return m; }, {});
const byRaison = cities.flatMap((c) => c.raisons ?? []).reduce((m, r) => { m[r] = (m[r] ?? 0) + 1; return m; }, {});
const httpUrls = cities.filter((c) => isHttp(c.reglement_url));
const livenessCounts = httpUrls.reduce((m, c) => { m[c.liveness] = (m[c.liveness] ?? 0) + 1; return m; }, {});

const out = {
  contract: 'reglement-revalidation/v1',
  as_of: AS_OF,
  source: { path: SRC_REL, sha256: srcSha, slugs: Object.keys(slugs).length },
  method: {
    controles: ['url-sans-numero', 'url-malformee', 'millesime-hors-plage[1980-2026]', 'numero-long-duplique(sep -/ | len>=6 | annee)', 'liveness-cluster'],
    long_numero: 'contient -/ OU longueur>=6 OU annee 4-chiffres ; courts (ex 47) non flaggés',
    liveness: livenessFile ? `depuis ${livenessFile}` : 'NON TESTÉE (sonde cluster requise : HEAD/GET via --kubeconfig /tmp/ovh.kubeconfig, jamais local ; url morte=a-capturer, jamais null)',
    anti_invention: 'numéro/url réels ; url morte=a-capturer ; jamais deviné ; partitions fermées',
  },
  totals: { cities: cities.length, http_urls: httpUrls.length, by_verdict: byVerdict, by_raison: byRaison, liveness: livenessCounts },
  cities,
};

const outRel = `work/coverage/reglement-revalidation-${AS_OF.replaceAll('-', '')}.json`;
fs.writeFileSync(path.join(ROOT, outRel), JSON.stringify(out, null, 2) + '\n');
console.log(`écrit: ${outRel}`);
console.log(JSON.stringify({ by_verdict: byVerdict, by_raison: byRaison, liveness: livenessCounts, slugs: cities.length }, null, 2));
console.log('\nINCOHÉRENTS :');
for (const c of cities.filter((c) => c.verdict === 'incoherent')) console.log(`  ${c.slug} : ${c.raisons.join(', ')}${c.dup_num_slugs ? ' [' + c.reglement_numero + ' dans ' + c.dup_num_slugs.join('+') + ']' : ''}`);
