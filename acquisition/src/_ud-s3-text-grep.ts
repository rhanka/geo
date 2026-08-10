/**
 * _ud-s3-text-grep.ts — lecture seule, lane usage_dominant.
 *
 * Cherche un motif dans un document textuel déjà capturé sur S3. Les octets
 * restent en mémoire : aucun fichier source n'est matérialisé localement.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_ud-s3-text-grep.ts \
 *     --key raw/usage-dominant-reglement-index/cas/<sha256>.html \
 *     --find 'zonage|urbanisme' [--context]
 */
import { getBytes, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const key = arg("key");
const pattern = arg("find");
const context = process.argv.includes("--context");
if (!key || !pattern) {
  throw new Error("usage: --key raw/<source>/cas/<sha256>.<ext> --find <regex> [--context]");
}

let rx: RegExp;
try {
  rx = new RegExp(pattern, "i");
} catch (error) {
  throw new Error(`--find invalide: ${error instanceof Error ? error.message : String(error)}`);
}

const bytes = await getBytes(s3Client(), key);
// Les pages HTML des portails sont souvent minifiées ; séparer les balises rend
// le résultat auditable sans modifier les octets capturés.
const lines = bytes.toString("utf8").replace(/></g, ">\n<").split(/\r?\n/);
let hits = 0;
for (const [index, line] of lines.entries()) {
  if (!rx.test(line)) continue;
  const shown = context ? lines.slice(Math.max(0, index - 1), index + 2) : [line];
  for (const value of shown) {
    const trimmed = value.trim();
    if (trimmed) console.log(`L${index + 1}: ${trimmed.slice(0, 600)}`);
  }
  if (context) console.log("    ---");
  hits++;
}
console.log(`\n[ud-s3-text-grep] key=${key} bytes=${bytes.length} lines=${lines.length} hits=${hits} find=/${pattern}/i`);
