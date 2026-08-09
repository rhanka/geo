/**
 * extract-dict.ts — pull the authoritative zone-code list from a municipal
 * zoning bylaw's plain text (pdftotext output) into a { slug, count, codes[] }
 * dict for the T2/T1 vision label lanes (--dict). Codes are matched by a
 * lettered-prefix + number signature and deduped; nothing is invented.
 *
 *   npx tsx work/zonage-dicts/extract-dict.ts --in <text> --slug <slug> --out <json>
 */
import { readFileSync, writeFileSync } from "node:fs";

function get(k: string): string | undefined { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; }

// Lettered zone prefix (1-4 letters) + optional separator + 1-3 digits.
// e.g. H-01, MIX-03, CN-2, EF-12, REC-5, P-7, C-14, I-3, AGR-1.
const CODE_RE = /\b([A-Z]{1,4})[-. ]?(\d{1,3})\b/g;

function main(): void {
  const inPath = get("in"); const slug = get("slug") ?? ""; const out = get("out");
  if (!inPath || !slug || !out) { console.error("usage: --in <text> --slug <slug> --out <json>"); process.exit(2); }
  const text = readFileSync(inPath, "utf8");
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = CODE_RE.exec(text)) !== null) {
    const prefix = m[1]!; const num = m[2]!;
    // Normalize to PREFIX-NUM (single dash), preserve leading zeros as written.
    const code = `${prefix}-${num}`;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  // Keep codes that appear at least twice (grid header + map/legend) to drop
  // one-off false positives from prose (e.g. an article number).
  const codes = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([c]) => c)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const byPrefix = new Map<string, number>();
  for (const c of codes) { const p = c.split("-")[0]!; byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1); }
  console.error(`[extract-dict] ${slug}: ${codes.length} distinct codes (>=2 occ); prefixes: ${[...byPrefix.entries()].map(([p, n]) => `${p}:${n}`).join(" ")}`);
  console.error(`[extract-dict] sample: ${JSON.stringify(codes.slice(0, 24))}`);
  writeFileSync(out, JSON.stringify({ slug, count: codes.length, codes }, null, 2) + "\n");
  console.error(`[extract-dict] wrote ${out}`);
}
main();
