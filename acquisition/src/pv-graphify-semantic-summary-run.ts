/** Rebuild the local PV semantic aggregate; it performs no S3 or cluster I/O. */
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizePvGraphifySemantic, type JsonReportInput } from "./lib/pv-graphify-semantic-summary.js";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MAX_REPORT_BYTES = 5 * 1024 * 1024;

function parseDate(argv: readonly string[]): string {
  const dates = argv.filter((argument) => argument.startsWith("--date=")).map((argument) => argument.slice("--date=".length));
  if (dates.length > 1 || argv.length !== dates.length || (dates[0] !== undefined && !/^\d{8}$/u.test(dates[0]))) {
    throw new Error("usage: npx tsx src/pv-graphify-semantic-summary-run.ts [--date=YYYYMMDD]");
  }
  return dates[0] ?? "20260728";
}

function readReports(coverageDirectory: string, matcher: RegExp): JsonReportInput[] {
  return readdirSync(coverageDirectory)
    .filter((name) => matcher.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const absolutePath = resolve(coverageDirectory, name);
      const { size } = statSync(absolutePath);
      if (size > MAX_REPORT_BYTES) throw new Error(`rapport trop grand pour une lecture JSON complète: ${name} (${size} octets)`);
      return {
        path: `work/coverage/${name}`,
        value: require(absolutePath) as unknown,
      };
    });
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function main(): void {
  const date = parseDate(process.argv.slice(2));
  const coverageDirectory = resolve(ROOT, "work", "coverage");
  const classificationReports = readReports(coverageDirectory, new RegExp(`^pv-capture-octets-classification-${date}-.+\\.json$`, "u"));
  const graphifyReports = readReports(coverageDirectory, new RegExp(`^pv-graphify-semantic-all-${date}-(?:batch-\\d+|reindex-[a-z0-9-]*\\d{8})\\.json$`, "u"));
  if (classificationReports.length === 0 || graphifyReports.length === 0) throw new Error(`rapports PV ${date} introuvables`);
  const output = resolve(coverageDirectory, `pv-graphify-semantic-all-${date}-summary.json`);
  const summary = summarizePvGraphifySemantic(classificationReports, graphifyReports);
  writeAtomic(output, summary);
  console.log(JSON.stringify({ report: `work/coverage/pv-graphify-semantic-all-${date}-summary.json`, ...summary }));
}

main();
