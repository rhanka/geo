/**
 * dump-norms-dict.ts — export a municipality's AUTHORITATIVE zone-code dictionary
 * from its deposited norms product, for the dict-gated vision label lanes
 * (`t1-build --labels claude|gpt55|gpt54 --dict <out>`).
 *
 * The `qc-zonage-norms-<slug>.parquet` product carries the by-law grille's
 * verbatim `zone_code` set (the same anti-invention list `zone-codes-report.ts`
 * cross-validates against). This CLI reads that column and writes a plain
 * `{ slug, codes: [...] }` JSON the vision lanes load as `--dict`. It invents
 * nothing: every code is verbatim from the parquet; duplicates and blanks are
 * dropped; the codes are sorted numerically-aware for a stable file.
 *
 * Usage:
 *   npx tsx acquisition/src/dump-norms-dict.ts <slug> [--out <path>]
 *   # default out: work/zonage-dicts/<slug>.codes.json
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, getBytes, exists } from "./lib/s3.js";
import { normsKey } from "./lib/zonage-norms.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", ".."); // geo/

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!slug) throw new Error("usage: npx tsx acquisition/src/dump-norms-dict.ts <slug> [--out <path>]");
  const out = argVal("out") ?? join(REPO, "work", "zonage-dicts", `${slug}.codes.json`);

  const s3 = s3Client();
  const key = normsKey(slug);
  if (!(await exists(s3, key))) {
    throw new Error(`norms product ABSENT for ${slug} (${key}) — no dict available; extract normes first`);
  }
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, key), ["zone_code"]);
  const seen = new Set<string>();
  for (const r of rows) {
    const c = r["zone_code"];
    if (c === null || c === undefined) continue;
    const s = String(c).trim();
    if (s) seen.add(s);
  }
  const codes = [...seen].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(out, JSON.stringify({ slug, source: key, codes }, null, 2) + "\n", "utf8");
  console.error(`[dump-norms-dict] ${slug}: ${codes.length} distinct zone codes → ${out}`);
  console.log(JSON.stringify({ slug, count: codes.length, codes }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
