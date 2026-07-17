/**
 * _reglement-numero-probe.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0 (natif poppler, aucun OCR payant). Pour chaque slug:
 *   1. résout l'URL source depuis registry/qc-zonage-norms/manifest.json,
 *   2. télécharge le doc dans le scratchpad (cache: re-run gratuit),
 *   3. imprime VERBATIM les lignes candidates portant un numéro de règlement de
 *      zonage + les lignes d'adoption / entrée en vigueur, AVEC leur page.
 *
 * ANTI-INVENTION: cette sonde n'EXTRAIT rien et ne décide rien. Elle affiche du
 * texte verbatim + son numéro de page; c'est l'opérateur qui relève le numéro
 * officiel dans le document (le nom de fichier / l'URL ne font PAS foi — piège
 * prouvé sur coaticook où l'URL portait « 6-1 » = règlement ABROGÉ).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-numero-probe.ts --slugs a,b,c
 *   npx tsx acquisition/src/_reglement-numero-probe.ts --slugs a --pages 12
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { s3Client, getBytes } from './lib/s3.js';

const CACHE = resolve(
  process.env.SCRATCH_DIR ??
    '/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/bf501b44-afb9-4e90-8caa-0b6f6b58cbd6/scratchpad',
  'p0-reglement',
);

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** Lignes qui PEUVENT porter le numéro officiel du règlement de zonage. */
const NUM_RE =
  /(r[eè]glement[s]?\s+(de\s+)?(zonage|d[eu]\s+zonage)|zonage\s+(num[eé]ro|n[°ºo]))|r[eè]glement\s*(num[eé]ro|n[°ºo]|#)\s*[:.]?\s*[0-9]/i;
/** Lignes de millésime: adoption / entrée en vigueur / codification. */
const DATE_RE =
  /(entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le|adopt[eé]|adoption|codification\s+administrative|mise\s+[àa]\s+jour|consolid)/i;

/** UA navigateur: plusieurs hôtes municipaux renvoient 403 à un UA non-navigateur. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Résultat de fetch: le chemin OU la RAISON du refus (diagnostic actionnable —
 *  « FETCH-FAIL » indifférencié faisait passer un cert TLS périmé pour un doc
 *  absent, et une URL périmée pour un blocage réseau). */
type Fetched = { path: string; insecure: boolean } | { path: null; why: string };

function curlTo(path: string, url: string, insecure: boolean): { code: string; type: string } {
  const out = execFileSync(
    'curl',
    [
      insecure ? '-skL' : '-sL',
      '--max-time', '90',
      '-A', UA,
      '-o', path,
      url,
      '-w', '%{http_code}\t%{content_type}',
    ],
    { encoding: 'utf8', timeout: 100_000 },
  );
  const [code, type] = out.trim().split('\t');
  return { code: code ?? '000', type: type ?? '' };
}

function isPdf(path: string): boolean {
  return execFileSync('head', ['-c', '4', path], { encoding: 'latin1' }).startsWith('%PDF');
}

function fetchDoc(slug: string, url: string): Fetched {
  mkdirSync(CACHE, { recursive: true });
  const path = resolve(CACHE, `${slug}.pdf`);
  // Cache: ne ré-utiliser QUE si c'est un vrai PDF. Une page HTML (404 mou) mise
  // en cache par un run antérieur passait le test de taille et était re-servie à
  // pdftotext, qui crachait 120 lignes de « Illegal character » pour un doc
  // jamais téléchargé.
  if (existsSync(path) && statSync(path).size > 4096 && isPdf(path)) {
    return { path, insecure: false };
  }

  let res: { code: string; type: string } | null = null;
  let insecure = false;
  try {
    res = curlTo(path, url, false);
  } catch {
    // curl exit != 0 (cert TLS invalide = 60, DNS = 6...). On retente en -k: ces
    // docs sont PUBLICS et la garantie d'intégrité est le gate verbatim (on lit le
    // numéro DANS le doc), pas le certificat de l'hôte. Le repli est TRACÉ.
    try {
      res = curlTo(path, url, true);
      insecure = true;
    } catch {
      return { path: null, why: 'RESEAU-KO (curl échoue même en --insecure: DNS/TLS/hôte mort)' };
    }
  }
  if (!existsSync(path) || statSync(path).size < 1024) {
    return { path: null, why: `VIDE http=${res.code} type=${res.type}` };
  }
  // Un PDF commence par %PDF ; sinon c'est une page HTML (portail), pas le doc.
  if (!isPdf(path)) {
    return {
      path: null,
      why: `PAS-UN-PDF http=${res.code} type=${res.type} (URL manifest périmée → page portail/404 mou)`,
    };
  }
  return { path, insecure };
}

function probe(slug: string, path: string, maxPages: number): void {
  let info = '';
  try {
    info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  } catch {
    /* pdfinfo peut échouer sur un PDF exotique; on continue sur pdftotext */
  }
  const pagesTotal = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');
  let txt = '';
  try {
    txt = execFileSync(
      'pdftotext',
      ['-f', '1', '-l', String(maxPages), '-layout', '-enc', 'UTF-8', path, '-'],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
    );
  } catch {
    console.log(`${slug}\tERR-PDFTOTEXT (doc image / protégé ?) pages=${pagesTotal}`);
    return;
  }
  const chars = txt.replace(/\s/g, '').length;
  if (chars < 40) {
    console.log(`${slug}\tNO-TEXT-LAYER (scan image) pages=${pagesTotal} — route vision requise`);
    return;
  }
  console.log(`\n===== ${slug} (pages=${pagesTotal}, sonde p1-${Math.min(maxPages, pagesTotal || maxPages)}) =====`);
  const pages = txt.split('\f');
  let shown = 0;
  pages.forEach((p, i) => {
    for (const raw of p.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.length < 3 || l.length > 160) continue;
      const isNum = NUM_RE.test(l);
      const isDate = DATE_RE.test(l);
      if (!isNum && !isDate) continue;
      if (shown++ > 60) return;
      console.log(`p${i + 1}\t${isNum ? 'NUM ' : 'DATE'}\t${l}`);
    }
  });
  if (shown === 0) console.log(`${slug}\tNO-CANDIDATE-LINE (aucun motif règlement/vigueur p1-${maxPages})`);
}

async function main(): Promise<void> {
  const slugs = (arg('slugs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxPages = Number(arg('pages', '8'));
  if (!slugs.length) {
    console.log('usage: _reglement-numero-probe.ts --slugs a,b [--pages 8]');
    process.exit(1);
  }
  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'),
  ) as { entries?: Array<{ slug: string; source_url?: string }> };
  const bySlug = new Map((manifest.entries ?? []).map((e) => [e.slug, e.source_url ?? '']));

  for (const slug of slugs) {
    const url = bySlug.get(slug);
    if (!url) {
      console.log(`\n===== ${slug} =====\n${slug}\tNO-URL (pas de source_url au manifest)`);
      continue;
    }
    const got = fetchDoc(slug, url);
    if (got.path === null) {
      console.log(`\n===== ${slug} =====\n${slug}\tFETCH-FAIL ${got.why} url=${url}`);
      continue;
    }
    console.log(`# ${slug} url=${url}${got.insecure ? ' [fetch --insecure: cert TLS hôte invalide]' : ''}`);
    probe(slug, got.path, maxPages);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
