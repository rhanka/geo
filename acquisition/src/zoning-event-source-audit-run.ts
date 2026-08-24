/**
 * Read-only S3 audit for source-less served qc-zoning-events in one cohort.
 *
 * Usage (the network guards are mandatory and enforced):
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/zoning-event-source-audit-run.ts \
 *     --cohort=work/coverage/cohorte-vivier-b-6mo.slugs.tsv
 *
 * This runner imports no S3 write primitive and has no apply/publish flag.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, s3Client } from "./lib/s3.js";
import {
  auditZoningEventSourceCohort,
  parseZoningEventCohortTsv,
} from "./lib/zoning-event-source-audit-runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const argv = process.argv.slice(2);

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} doit être un entier ${min}..${max}`);
  }
  return value;
}

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length === 0 || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

function assertReadOnlyRunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("NODE_OPTIONS=--dns-result-order=ipv4first est requis pour tout run S3");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("AWS_MAX_ATTEMPTS=10 est requis pour tout run S3");
  }
}

export async function main(): Promise<void> {
  assertReadOnlyRunEnvironment();
  const cohortPath = resolve(ROOT, option("cohort") ?? "work/coverage/cohorte-vivier-b-6mo.slugs.tsv");
  const outputPath = resolve(ROOT, option("output") ?? "work/coverage/zoning-event-source-audit-selection-b.json");
  if (!inside(ROOT, cohortPath)) throw new Error("--cohort doit rester dans le checkout reproductible");
  if (!inside(COVERAGE, outputPath)) throw new Error("--output doit rester sous work/coverage/");

  const cohortBytes = readFileSync(cohortPath, "utf8");
  const slugs = parseZoningEventCohortTsv(cohortBytes);
  const expectedCount = boundedInt("expected-count", 127, 1, 1106);
  const concurrency = boundedInt("concurrency", 4, 1, 16);
  const s3 = s3Client();
  const report = await auditZoningEventSourceCohort(
    {
      source: relative(ROOT, cohortPath),
      sha256: sha256(cohortBytes),
      expected_count: expectedCount,
      slugs,
    },
    async (_slug, key) => {
      const body = await getBytes(s3, key);
      return {
        document: JSON.parse(body.toString("utf8")) as unknown,
        sha256: sha256(body),
      };
    },
    { concurrency },
  );
  writeAtomic(outputPath, report);
  console.error(JSON.stringify({
    output: relative(ROOT, outputPath),
    report_sha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
    ...report.totals,
  }));
  if (report.totals.cities_unknown > 0) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
