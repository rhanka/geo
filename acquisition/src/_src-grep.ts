/**
 * _src-grep.ts — committed line-grep over repo source files.
 *
 * The session policy forbids ad-hoc shell (`grep`/`node -e`); this is the
 * committed equivalent used to locate a symbol before Reading the right window
 * of a large file.
 *
 *   npx tsx acquisition/src/_src-grep.ts --file <path> --re "<js regex>" [--ctx 0]
 */
import { readFileSync } from "node:fs";

function parseArgs(argv: string[]): Record<string, string> {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (!t.startsWith("--")) continue;
    const next = argv[i + 1];
    a[t.slice(2)] = next === undefined || next.startsWith("--") ? "true" : (i++, next);
  }
  return a;
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const file = a["file"];
  const re = a["re"];
  if (!file || !re) throw new Error('required: --file <path> --re "<regex>"');
  const ctx = a["ctx"] ? Number(a["ctx"]) : 0;
  const rx = new RegExp(re);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!rx.test(line)) return;
    const from = Math.max(0, i - ctx);
    const to = Math.min(lines.length - 1, i + ctx);
    for (let j = from; j <= to; j++) console.log(`${j + 1}: ${lines[j]}`);
    if (ctx > 0) console.log("--");
  });
}

main();
