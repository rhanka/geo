/**
 * pdf-zone-codes.ts — extract an AUTHORITATIVE zone-code dictionary from a LOCAL
 * by-law PDF (règlement de zonage) text, for the dict-gated vision label lanes
 * (`t1-build --labels claude|gpt55|gpt54 --dict <out>`) when no clean
 * `qc-zonage-norms-<slug>.parquet` exists (mis-extraction / rasterized grille).
 *
 * Complements `dump-norms-dict.ts` (which reads the S3 norms parquet): this one
 * reads a MUNICIPAL by-law PDF straight off disk with `pdftotext -layout` and
 * keeps every token matching the Québec zone-code shape — a family prefix
 * (R, Re, C, F, P, A, I, Cons, H, MIX, CN, EF, REC, V, M, …) optionally followed
 * by a digit, then `-`, then 1–3 digits (R1-14, Re2-2, C2-6, P4-3, Cons-1, I1-1).
 *
 * It invents NOTHING: every code is a verbatim substring of the legal text; the
 * hyphen+digits shape filters article numbers (5.11), dates (21 juin) and by-law
 * numbers (no740). Output is a plain `{ slug, source, count, codes }` JSON the
 * vision lanes load as `--dict`. This is an INDEPENDENT authority from the plan
 * being read, so the anti-invention guard stays non-circular.
 *
 * Usage:
 *   npx tsx acquisition/src/pdf-zone-codes.ts <slug> --pdf <path> [--out <path>]
 *   # default out: work/zonage-dicts/<slug>.codes.json
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Family prefix: 1 uppercase letter + up to 3 more letters (Re, Cons, MIX, REC),
// optional single digit, then "-", then 1..3 digits. Anchored on word bounds.
const ZONE_CODE_RE = /\b([A-Z][A-Za-z]{0,3}[0-9]?)-([0-9]{1,3})\b/g;

function main(): void {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const pdf = argVal("pdf");
  if (!slug || !pdf) {
    throw new Error("usage: npx tsx acquisition/src/pdf-zone-codes.ts <slug> --pdf <path> [--out <path>]");
  }
  if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
  const out = argVal("out") ?? join(REPO, "work", "zonage-dicts", `${slug}.codes.json`);

  const text = execFileSync("pdftotext", ["-layout", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  const seen = new Map<string, number>();
  for (const m of text.matchAll(ZONE_CODE_RE)) {
    const code = `${m[1]}-${m[2]}`;
    seen.set(code, (seen.get(code) ?? 0) + 1);
  }
  const codes = [...seen.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(out, JSON.stringify({ slug, source: pdf, count: codes.length, codes }, null, 2) + "\n", "utf8");
  console.error(`[pdf-zone-codes] ${slug}: ${codes.length} distinct zone codes → ${out}`);
  // frequency-sorted preview to sanity-check on stderr (top 40)
  const byFreq = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.error(`[pdf-zone-codes] top: ${byFreq.map(([c, n]) => `${c}×${n}`).join(" ")}`);
  console.log(JSON.stringify({ slug, count: codes.length, codes }));
}

main();
