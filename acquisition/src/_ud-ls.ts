#!/usr/bin/env tsx
/**
 * _ud-ls.ts — lister récursivement les fichiers sous des racines, filtrés par regex.
 * usage: --roots work/zonage-norms,work/zonage-plans --match "ogden|boileau"
 * Lane usage_dominant : inventorier le corpus local sans bash ad-hoc.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arg(name: string, dflt = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const roots = arg('roots', 'work').split(',').filter(Boolean);
const match = arg('match');
const re = match ? new RegExp(match, 'i') : null;
const max = Number(arg('max', '400'));
let n = 0;

function walk(dir: string, depth = 0): void {
  if (n >= max || depth > 8) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (n >= max) return;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (!re || re.test(p)) {
      console.log(`${String(Math.round(st.size / 1024)).padStart(8)} Ko  ${p}`);
      n++;
    }
  }
}

for (const r of roots) walk(r);
console.log(`# ${n} fichiers`);
