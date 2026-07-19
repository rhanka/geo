#!/usr/bin/env tsx
/**
 * _ud-pdf-grep.ts — grep plein-texte d'un PDF, page par page, avec contexte.
 * usage: --pdf <path> --find <regex> [--ctx N] [--flags gi] [--max N]
 * Lane usage_dominant : localiser la table « Abréviation / Fonction dominante ».
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const pdf = arg('pdf');
const find = arg('find');
const ctx = Number(arg('ctx', '3'));
const max = Number(arg('max', '40'));
if (!pdf || !existsSync(pdf) || !find) {
  console.error('usage: --pdf <path existant> --find <regex> [--ctx N] [--max N]');
  process.exit(1);
}

const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8', maxBuffer: 1 << 26 });
const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');
const re = new RegExp(find, 'i');
let hits = 0;

for (let p = 1; p <= pages && hits < max; p++) {
  let txt = '';
  try {
    txt = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', pdf, '-'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    continue;
  }
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    hits++;
    console.log(`\n=== p${p} L${i + 1} ===`);
    for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) {
      console.log(`${j === i ? '>' : ' '} ${lines[j]}`);
    }
    if (hits >= max) break;
    i += ctx;
  }
}
console.log(`\n# ${pages} pages, ${hits} hits pour /${find}/i`);
