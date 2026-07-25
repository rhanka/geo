// Helper: peek at a JSON file's shape/values without shell tools.
// Usage: npx tsx acquisition/src/_json-peek.ts <file.json> [path.to.key] [--full] [--len N]
import { readFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const full = rest.includes('--full');
const li = rest.indexOf('--len');
const maxLen = li >= 0 ? parseInt(rest[li + 1], 10) : 4000;
const path = rest.find((r) => !r.startsWith('--'));

let v: any = JSON.parse(readFileSync(file, 'utf8'));
if (path) for (const seg of path.split('.')) v = v?.[seg];

function summarize(x: any, depth = 0): any {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) {
    if (depth >= 2) return `[array ${x.length}]`;
    return x.length <= 3 ? x.map((e) => summarize(e, depth + 1)) : [...x.slice(0, 3).map((e) => summarize(e, depth + 1)), `…(+${x.length - 3})`];
  }
  const o: any = {};
  for (const [k, val] of Object.entries(x)) o[k] = summarize(val, depth + 1);
  return o;
}

const out = JSON.stringify(full ? v : summarize(v), null, 1);
console.log(out.length > maxLen && !full ? out.slice(0, maxLen) + `\n…(tronqué, ${out.length} car.)` : out);
