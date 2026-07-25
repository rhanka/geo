/**
 * _reglement-owner-gate.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0, natif poppler. DEUX gates que ni `_reglement-numero-probe.ts`
 * (URL du manifest) ni `_reglement-local-probe.ts` (p1-8 du corpus local) ne rendent:
 *
 * 1. GATE PROPRIÉTAIRE — `work/zonage-norms/<slug>/*.pdf` n'est PAS une preuve
 *    d'appartenance au slug. Mesuré: `authier-nord/` porte le règlement d'AUTHIER,
 *    `saint-camille-de-lellis/` celui de SAINT-CAMILLE (Canton), `palmarolle/` celui
 *    des TNO (compétence MRC). Chacun avec numéro et dates parfaitement lisibles —
 *    donc INVISIBLES à tout gate verbatim sur le numéro. Un doc qui ne NOMME pas sa
 *    municipalité ne s'attribue pas: null + _note, jamais de stamp.
 *
 * 2. PLEIN-TEXTE — les grilles sans page de titre cachent le numéro dans une NOTE en
 *    milieu de doc (joliette p94, baie-saint-paul p288). `NO-CANDIDATE-LINE p1-8` est
 *    donc un FAUX NÉGATIF: toujours balayer tout le doc avant de conclure « muet ».
 *
 * ANTI-INVENTION: n'extrait rien, ne décide rien, n'écrit rien. Compte des
 * occurrences et imprime des lignes VERBATIM + leur page. L'opérateur tranche.
 *
 * Outil SÉPARÉ à dessein: `_reglement-numero-probe.ts` est réécrit en parallèle par
 * l'autre shard (fichier chaud) — ne pas l'élargir.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-owner-gate.ts --slugs a,b
 *   npx tsx acquisition/src/_reglement-owner-gate.ts --slugs a --find 'numéro 2013-060'
 *   npx tsx acquisition/src/_reglement-owner-gate.ts --slugs a --all-pdfs --context 2
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/**
 * Insensible aux accents ET à la casse: le corpus mélange « Sainte-Hélène » et
 * « SAINTE-HELENE ». Les classes de séparateur incluent les tirets UNICODE
 * (U+2010..U+2015, soft hyphen): `sainte-lucie-de-beauregard` répondait
 * OWNER-ABSENT alors que sa couverture dit « MUNICIPALITÉ DE SAINTE‑LUCIE‑DE‑
 * BEAUREGARD » — au tiret insécable près. Un faux négatif de gate coûte un null
 * injustifié; un faux positif coûte une fausse provenance. Les deux se paient.
 */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Mots vides d'un toponyme québécois: ne distinguent aucune municipalité. */
const STOP = new Set([
  'saint', 'sainte', 'saints', 'saintes', 'st', 'ste', 'de', 'du', 'des', 'la', 'le', 'les',
  'l', 'd', 'sur', 'aux', 'au', 'et', 'notre', 'dame', 'lac', 'mont', 'ville', 'canton', 'paroisse',
]);

/**
 * Le suffixe `--<mrc>` désambiguïse deux munis homonymes (saint-cyprien--les-etchemins):
 * il n'appartient pas au nom porté par le règlement. On sonde le nom NU.
 */
function nameOf(slug: string): string {
  return slug.split('--')[0]!;
}

/** Séparateurs de toponyme: espace, tirets ASCII **et Unicode**, apostrophes. */
const SEP = "[\\s\\-\\u2010-\\u2015\\u00ad’']";

/** « saint-cleophas-de-brandon » → /saint[\s-]*cleophas[\s-]*de[\s-]*brandon/ (accents pliés). */
function fullNameRe(slug: string): RegExp {
  const parts = nameOf(slug).split('-').filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join(`${SEP}*`), 'gi');
}

/** Jeton le PLUS distinctif: rattrape « Municipalité de Saint-Cléophas » (sans « -de-Brandon »). */
function coreToken(slug: string): string | undefined {
  return nameOf(slug)
    .split('-')
    .filter((t) => t.length > 2 && !STOP.has(t))
    .sort((a, b) => b.length - a.length)[0];
}

function localPdfs(slug: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 4096)
    .sort((a, b) => statSync(b).size - statSync(a).size);
}

function textOf(path: string): string | undefined {
  try {
    return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch {
    return undefined;
  }
}

/** Compte les occurrences d'un motif dans le texte plié. */
function count(hay: string, re: RegExp): number {
  return (hay.match(re) ?? []).length;
}

/**
 * Le nom du slug peut n'être qu'un PRÉFIXE du vrai toponyme: `saint-rene/` porte le
 * règlement de SAINT-RENÉ-DE-MATANE (muni distincte). Un compteur de nom nu répond
 * OWNER-OK et laisse stamper une provenance FAUSSE — mesuré 2026-07-17.
 *
 * On relève donc la FORME DE SURFACE réelle (nom + jusqu'à 4 jetons liés) et on la
 * rend à l'opérateur. On ne tranche pas: `saint-cyprien` vs «SAINT-CYPRIEN-DES-
 * ETCHEMINS» est la MÊME muni (le suffixe du slug est la MRC), alors que `saint-rene`
 * vs «SAINT-RENÉ-DE-MATANE» en fait deux. Seul un humain lit cette différence.
 *
 * `fold()` (NFD + purge des diacritiques) préserve la longueur sur du français
 * précomposé — les index du texte plié adressent donc le texte BRUT, qu'on tranche
 * pour afficher la casse et les accents d'origine.
 */
function surfaceForms(raw: string, folded: string, slug: string): Map<string, number> {
  const parts = nameOf(slug).split('-').filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`${parts.join(`${SEP}*`)}(?:${SEP}+[a-z']{1,20}){0,4}`, 'gi');
  const forms = new Map<string, number>();
  for (const m of folded.matchAll(re)) {
    if (m.index === undefined) continue;
    const form = raw.slice(m.index, m.index + m[0].length).replace(/\s+/g, ' ').trim();
    forms.set(form, (forms.get(form) ?? 0) + 1);
  }
  return forms;
}

function report(slug: string, path: string, find?: RegExp, context = 0): void {
  const raw = textOf(path);
  const rel = path.replace(ROOT + '/', '');
  if (raw === undefined) {
    console.log(`${slug}\tERR-PDFTOTEXT\t${rel}`);
    return;
  }
  if (raw.replace(/\s/g, '').length < 40) {
    console.log(`${slug}\tNO-TEXT-LAYER\t${rel} — route vision requise`);
    return;
  }
  const folded = fold(raw);
  const full = count(folded, fullNameRe(slug));
  const token = coreToken(slug);
  const core = token ? count(folded, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) : 0;
  // OWNER-OK exige le nom COMPLET; le jeton seul est ambigu (Authier ⊂ Authier-Nord).
  const verdict = full > 0 ? 'OWNER-OK' : core > 0 ? 'OWNER-WEAK' : 'OWNER-ABSENT';
  const pages = raw.split('\f').length;
  console.log(`\n===== ${slug} (${rel}, pages≈${pages}) =====`);
  console.log(`${slug}\t${verdict}\tnom-complet=${full}\tjeton«${token ?? '-'}»=${core}`);
  // Les formes de surface tranchent le préfixe-piège (saint-rene ⊂ SAINT-RENÉ-DE-MATANE).
  const forms = [...surfaceForms(raw, folded, slug)].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [form, n] of forms) console.log(`\tFORME\t${n}×\t«${form}»`);

  if (!find) return;
  const lines = raw.split('\f').flatMap((p, i) => p.split(/\r?\n/).map((l) => ({ page: i + 1, l })));
  let shown = 0;
  lines.forEach(({ page, l }, idx) => {
    if (!find.test(fold(l))) return;
    if (shown++ > 40) return;
    for (let k = -context; k <= context; k++) {
      const row = lines[idx + k];
      if (!row) continue;
      const text = row.l.trim();
      if (!text) continue;
      console.log(`p${page}\t${k === 0 ? '>>' : '  '}\t${text.slice(0, 160)}`);
    }
  });
  if (shown === 0) console.log(`${slug}\tFIND-0 (motif absent du PLEIN TEXTE, ${pages} pages)`);
}

function main(): void {
  const slugs = (arg('slugs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const findRaw = arg('find');
  const context = Number(arg('context', '0'));
  const allPdfs = process.argv.includes('--all-pdfs');
  if (!slugs.length) {
    console.log("usage: _reglement-owner-gate.ts --slugs a,b [--find <regex>] [--context 1] [--all-pdfs]");
    process.exit(1);
  }
  const find = findRaw ? new RegExp(fold(findRaw), 'i') : undefined;
  for (const slug of slugs) {
    const pdfs = localPdfs(slug);
    if (!pdfs.length) {
      console.log(`${slug}\tNO-LOCAL-PDF`);
      continue;
    }
    for (const p of allPdfs ? pdfs : [pdfs[0]!]) report(slug, p, find, context);
  }
}

main();
