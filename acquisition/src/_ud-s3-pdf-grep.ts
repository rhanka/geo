/**
 * _ud-s3-pdf-grep.ts — lecture seule, lane usage_dominant.
 *
 * Extrait le texte natif d'un PDF DEJA capture dans S3 et imprime les lignes qui
 * correspondent a un motif. Les octets transitent uniquement en memoire vers
 * pdftotext (stdin) : aucun PDF n'est ecrit sur le poste.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_ud-s3-pdf-grep.ts \
 *     --key raw/usage-dominant-reglement/cas/<sha256>.pdf \
 *     --find 'identification des zones|usage dominant' [--from 1 --to 20] [--context]
 */
import { spawnSync } from "node:child_process";

import { getBytes, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const key = arg("key");
const pattern = arg("find");
const from = Number(arg("from") ?? "1");
const toRaw = arg("to");
const context = process.argv.includes("--context");

if (!key || !pattern) {
  console.error("usage: --key raw/<source>/cas/<sha256>.pdf --find <regex> [--from N --to N] [--context]");
  process.exit(2);
}

let rx: RegExp;
try {
  rx = new RegExp(pattern, "i");
} catch (error) {
  throw new Error(`--find invalide: ${error instanceof Error ? error.message : String(error)}`);
}

const bytes = await getBytes(s3Client(), key);
const info = spawnSync("pdfinfo", ["-"], { input: bytes, encoding: "utf8", maxBuffer: 1024 * 1024 });
if (info.error || info.status !== 0) {
  throw new Error(`pdfinfo refuse ${key}: ${info.error?.message ?? info.stderr ?? info.status}`);
}
const pages = Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] ?? "0");
const to = Number(toRaw ?? String(pages));
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  throw new Error("--from/--to doivent etre des entiers positifs avec from <= to");
}

const extracted = spawnSync(
  "pdftotext",
  ["-q", "-layout", "-enc", "UTF-8", "-f", String(from), "-l", String(Math.min(to, pages)), "-", "-"],
  { input: bytes, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
);
if (extracted.error || extracted.status !== 0) {
  throw new Error(`pdftotext refuse ${key}: ${extracted.error?.message ?? extracted.stderr ?? extracted.status}`);
}

let hits = 0;
for (const [pageIndex, page] of extracted.stdout.split("\f").entries()) {
  const pageNo = from + pageIndex;
  for (const [lineIndex, line] of page.split(/\r?\n/).entries()) {
    if (!rx.test(line)) continue;
    const lines = context ? page.split(/\r?\n/).slice(Math.max(0, lineIndex - 1), lineIndex + 2) : [line];
    for (const found of lines) {
      const trimmed = found.trimEnd();
      if (trimmed.trim()) console.log(`p${pageNo}: ${trimmed.slice(0, 300)}`);
    }
    if (context) console.log("    ---");
    hits++;
  }
}
console.log(`\n[ud-s3-pdf-grep] key=${key} bytes=${bytes.length} pages=${pages} range=${from}-${Math.min(to, pages)} hits=${hits} find=/${pattern}/i`);
