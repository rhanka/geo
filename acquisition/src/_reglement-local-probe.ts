/**
 * _reglement-local-probe.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0, sur le CORPUS LOCAL déjà téléchargé par les lanes normes
 * (`work/zonage-norms/<slug>/*.pdf`). Complète `_reglement-numero-probe.ts`, qui
 * ne sait lire QUE l'URL du manifest.
 *
 * POURQUOI (mesuré 2026-07-17, shard 1/2): le verdict « extraction épuisée » du
 * lot 18 comptait les cibles restantes sur le seul `source_url` du manifest et
 * concluait « défaut de DÉCOUVERTE » dès qu'il valait `non-disponible`. C'est un
 * FAUX NÉGATIF: `non-disponible` note l'absence de provenance ENREGISTRÉE, pas
 * l'absence de document — 4 slugs sur 5 testés au hasard portaient bien leur PDF
 * en local. Le document est là, lisible en natif, gratuitement.
 *
 * ANTI-INVENTION: n'extrait rien, ne décide rien, n'écrit rien. Imprime des
 * lignes VERBATIM + leur page; l'opérateur relève le numéro. Le nom du fichier
 * ne fait PAS foi (piège coaticook: l'URL portait un règlement ABROGÉ).
 *
 * PIÈGE CORRIGÉ (mesuré 2026-07-17, 4 faux « null » prouvés): la sonde ne lisait
 * QUE `pdfs[0]`, le plus GROS fichier du dossier. Or le plus gros est presque
 * toujours le cahier de GRILLES (des centaines de planches nues, sans numéro),
 * tandis que le CORPS du règlement — qui porte le numéro en couverture — est un
 * PDF frère plus petit (`corps-*`, `*-body`, `src.pdf`). Lire le seul plus gros
 * rendait un verdict « le doc ne porte pas de numéro » sur un doc qui n'était pas
 * le bon. `--all-pdfs` (défaut) sonde CHAQUE PDF du dossier et s'arrête au premier
 * qui porte une ligne NUM; `--biggest-only` restaure l'ancien comportement.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-local-probe.ts --slugs a,b [--pages 8]
 *   npx tsx acquisition/src/_reglement-local-probe.ts --slugs-file lot.txt
 *   npx tsx acquisition/src/_reglement-local-probe.ts --slugs a --inventory
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** Lignes qui PEUVENT porter le numéro officiel du règlement de zonage. Large
 *  exprès: on AFFICHE tout ce qui parle règlement/zonage, l'opérateur tranche. */
const NUM_RE =
  /(r[eè]glement[s]?\s+(de\s+)?(zonage|d[eu]\s+zonage)|zonage\s+(num[eé]ro|n[°ºo]))|r[eè]glement\s*(num[eé]ro|n[°ºo]|#)\s*[:.]?\s*[0-9]|identifi[eé]\s+par\s+le\s+num[eé]ro/i;

/** FAUX POSITIF DE MOTIF (mesuré la-pocatiere/saint-lin-laurentides 2026-07-17):
 *  « Voir les dispositions au règlement de zonage (Chapitre 4, section 4) » et
 *  « Annexe 2 du Règlement de zonage — Zone A-1 » matchent NUM_RE alors qu'aucun
 *  NUMÉRO n'y figure. Un cahier de grilles en est tapissé; s'arrêter dessus fait
 *  rendre « pas de numéro » sans jamais ouvrir le corps frère qui le porte.
 *  Le critère d'ARRÊT exige donc qu'un numéro suive VRAIMENT le mot-clé. */
const STRONG_NUM_RE =
  /(r[eè]glement|zonage)\s*(de\s+zonage\s*)?(num[eé]ro|n[°ºo]s?\.?|#)\s*[:.]?\s*[A-Za-z]*[-. ]?\d/i;
/** Lignes de millésime: adoption / entrée en vigueur / codification. */
const DATE_RE =
  /(entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le|adopt[eé]\s|adoption|codification\s+administrative|consolid)/i;

/** Tous les PDF du dossier corpus d'un slug, plus gros d'abord (le corps du
 *  règlement porte le numéro; une annexe isolée souvent pas). */
function localPdfs(slug: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 4096)
    .sort((a, b) => statSync(b).size - statSync(a).size);
}

/** Sonde UN pdf. Retourne true si au moins une ligne NUM a été imprimée (le doc
 *  est un candidat sérieux), false sinon — l'appelant enchaîne alors sur le PDF
 *  frère suivant plutôt que de conclure « pas de numéro ». */
function probe(slug: string, path: string, maxPages: number): boolean {
  let info = '';
  try {
    info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  } catch {
    /* pdfinfo échoue sur certains PDF reconstruits; pdftotext peut réussir quand même */
  }
  const pagesTotal = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');
  let txt = '';
  try {
    txt = execFileSync('pdftotext', ['-f', '1', '-l', String(maxPages), '-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch {
    console.log(`${slug}\tERR-PDFTOTEXT ${path.replace(ROOT + '/', '')}`);
    return false;
  }
  if (txt.replace(/\s/g, '').length < 40) {
    console.log(`${slug}\tNO-TEXT-LAYER (scan image) ${path.replace(ROOT + '/', '')} pages=${pagesTotal} — route vision requise`);
    return false;
  }
  const lines: string[] = [];
  let numHits = 0;
  txt.split('\f').forEach((p, i) => {
    for (const raw of p.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.length < 3 || l.length > 160) continue;
      const isNum = NUM_RE.test(l);
      if (!isNum && !DATE_RE.test(l)) continue;
      const strong = isNum && STRONG_NUM_RE.test(l);
      if (strong) numHits++;
      if (lines.length > 50) continue;
      lines.push(`p${i + 1}\t${strong ? 'NUM*' : isNum ? 'num ' : 'DATE'}\t${l}`);
    }
  });
  if (lines.length === 0) {
    console.log(`${slug}\tNO-CANDIDATE-LINE ${path.replace(ROOT + '/', '')} (aucun motif règlement/vigueur p1-${maxPages})`);
    return false;
  }
  console.log(`\n===== ${slug} (${path.replace(ROOT + '/', '')}, pages=${pagesTotal}) =====`);
  for (const l of lines) console.log(l);
  return numHits > 0;
}

function main(): void {
  const slugsFile = arg('slugs-file');
  const raw = slugsFile
    ? readFileSync(resolve(slugsFile), 'utf8').split(/[\s,]+/)
    : (arg('slugs') ?? '').split(',');
  const slugs = raw.map((s) => s.trim()).filter(Boolean);
  const maxPages = Number(arg('pages', '8'));
  const inventory = process.argv.includes('--inventory');
  const biggestOnly = process.argv.includes('--biggest-only');
  if (!slugs.length) {
    console.log('usage: _reglement-local-probe.ts (--slugs a,b | --slugs-file f) [--pages 8] [--inventory] [--biggest-only]');
    process.exit(1);
  }
  let hit = 0;
  for (const slug of slugs) {
    const pdfs = localPdfs(slug);
    if (!pdfs.length) {
      console.log(`${slug}\tNO-LOCAL-PDF (rien dans work/zonage-norms/${slug}/)`);
      continue;
    }
    hit++;
    if (inventory) {
      console.log(`${slug}\tLOCAL=${pdfs.length}\t${pdfs.map((p) => p.split('/').pop()).join(',')}`);
      continue;
    }
    // Le plus gros d'abord (souvent le corps quand il n'y a qu'un doc), puis les
    // frères: on ne s'arrête qu'à un PDF qui porte VRAIMENT une ligne NUM.
    const list = biggestOnly ? pdfs.slice(0, 1) : pdfs;
    let found = false;
    for (const p of list) {
      if (probe(slug, p, maxPages)) { found = true; break; }
    }
    if (!found) console.log(`${slug}\tNO-NUM-IN-ANY-PDF (${list.length} pdf sondés)`);
  }
  console.log(`\n# slugs=${slugs.length} avec-PDF-local=${hit} sans=${slugs.length - hit}`);
}

main();
