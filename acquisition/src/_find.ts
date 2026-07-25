// Helper: recursive file finder (no shell `find`). Usage:
//   npx tsx acquisition/src/_find.ts <root> --name <glob-ish substring or *pattern*> [--max N] [--ext .pdf]
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const root = argv[0];
function opt(n: string) {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
}
const namePat = opt('--name') || '';
const ext = opt('--ext');
const max = parseInt(opt('--max') || '200', 10);

const rx = namePat
  ? new RegExp('^' + namePat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
  : null;

let n = 0;
function walk(dir: string, depth: number) {
  if (n >= max || depth > 12) return;
  let ents: string[];
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of ents) {
    if (n >= max) return;
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else {
      if (ext && !e.toLowerCase().endsWith(ext.toLowerCase())) continue;
      if (rx && !rx.test(e) && !rx.test(p)) continue;
      console.log(String(st.size).padStart(10) + '  ' + p);
      n++;
    }
  }
}
walk(root, 0);
if (n === 0) console.log('(aucun)');
