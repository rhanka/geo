// Helper: grep a file for a JS regex (no shell grep — hook policy).
// Usage: npx tsx acquisition/src/_grep.ts <file> <regex> [--max N] [--i] [--invert] [--count]
import { readFileSync } from 'node:fs';

const [file, pattern, ...rest] = process.argv.slice(2);
const mi = rest.indexOf('--max');
const max = mi >= 0 ? parseInt(rest[mi + 1]!, 10) : 200;
const flags = rest.includes('--i') ? 'i' : '';
const invert = rest.includes('--invert');
const countOnly = rest.includes('--count');

const rx = new RegExp(pattern!, flags);
const lines = readFileSync(file!, 'utf8').split('\n');
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const hit = rx.test(lines[i]!);
  if (hit === invert) continue;
  n++;
  if (!countOnly && n <= max) console.log(`${i + 1}:${lines[i]}`);
}
if (countOnly || n > max) console.log(`(${n} ligne(s) au total)`);
