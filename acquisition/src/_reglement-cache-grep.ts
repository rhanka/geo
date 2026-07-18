/**
 * _reglement-cache-grep.ts — helper $0 (lane P0_1). Grep VERBATIM des PDF déjà
 * téléchargés par `_reglement-numero-probe.ts` (dossier `<cache>/p0-reglement/`).
 *
 * La sonde numero-probe met le PDF dans `SCRATCH_DIR ?? <défaut>/p0-reglement/<slug>.pdf`.
 * Ce helper cherche le PDF sous plusieurs racines de cache connues et imprime les
 * lignes (avec page) qui matchent un motif — pour lire le numéro de base / la date
 * d'adoption verbatim dans le CORPS quand la fenêtre p1-14 de la sonde ne suffit pas.
 *
 * Anti-invention: n'extrait ni ne décide rien; imprime du texte verbatim + sa page.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-cache-grep.ts --slug sainte-emelie-de-lenergie --pattern 'no\\.?\\s*\\d|numéro\\s*\\d|adopt|vigueur' --pages 12
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const CACHE_ROOTS = [
  process.env.SCRATCH_DIR ?? '',
  '/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/bcd0da34-2c40-4718-8585-16eaf6856f29/scratchpad',
  '/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/bf501b44-afb9-4e90-8caa-0b6f6b58cbd6/scratchpad',
].filter(Boolean);

function findPdf(slug: string): string | null {
  for (const root of CACHE_ROOTS) {
    const p = resolve(root, 'p0-reglement', `${slug}.pdf`);
    if (existsSync(p)) return p;
  }
  return null;
}

function main(): void {
  const slug = arg('slug') ?? '';
  const pattern = arg('pattern') ?? 'r[eè]glement';
  const firstPage = Number(arg('from', '1'));
  const lastPage = Number(arg('pages', '20'));
  const explicit = arg('pdf');
  const pdf = explicit ?? findPdf(slug);
  if (!pdf || !existsSync(pdf)) {
    console.log(`NO-CACHED-PDF slug=${slug} (racines: ${CACHE_ROOTS.join(' | ')})`);
    process.exit(1);
  }
  const rx = new RegExp(pattern, 'i');
  const txt = execFileSync(
    'pdftotext',
    ['-f', String(firstPage), '-l', String(lastPage), '-layout', '-enc', 'UTF-8', pdf, '-'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
  );
  const pages = txt.split('\f');
  let hits = 0;
  pages.forEach((pg, i) => {
    for (const raw of pg.split(/\r?\n/)) {
      const l = raw.trim().replace(/\s+/g, ' ');
      if (l.length < 3 || l.length > 200) continue;
      if (!rx.test(l)) continue;
      console.log(`p${firstPage + i}\t${l}`);
      if (++hits > 80) { console.log('... (>80 hits, stop)'); process.exit(0); }
    }
  });
  console.log(`\n[${slug}] pdf=${pdf} hits=${hits} pattern=/${pattern}/i pages=${firstPage}-${lastPage}`);
}

main();
