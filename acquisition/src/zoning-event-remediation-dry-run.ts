/**
 * Read-only, reproducible LINK-before-RETRACT dry-run for served zoning events.
 * It reads the nested served objects and durable extraction proofs, then writes
 * only a local review artefact under work/coverage. There is no apply flag.
 *
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 * npx tsx acquisition/src/zoning-event-remediation-dry-run.ts \
 *   --audit=work/coverage/zoning-event-source-audit-selection-b.json \
 *   --inventory=work/coverage/zoning-event-remediation-inventory-selection-b.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, s3Client } from "./lib/s3.js";
import type { ZoningEventSourceAuditReport } from "./lib/zoning-event-source-audit-runner.js";
import {
  buildZoningEventRemediationDryRun,
  parseZoningEventRemediationInventory,
  zoningEventRemediationDryRunSha256,
} from "./lib/zoning-event-remediation-runner.js";
import type { Sha256Ref } from "./lib/zoning-event-remediation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const argv = process.argv.slice(2);
const ALLOWED_OPTIONS = new Set(["audit", "inventory", "output", "concurrency"]);

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function assertArgs(): void {
  for (const arg of argv) {
    const match = /^--([^=]+)=/.exec(arg);
    if (!match || !ALLOWED_OPTIONS.has(match[1]!)) {
      throw new Error(`option dry-run inconnue/interdite: ${arg}`);
    }
  }
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

function sha256(value: string | Buffer): Sha256Ref {
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
  assertArgs();
  assertReadOnlyRunEnvironment();
  const auditPath = resolve(ROOT, option("audit") ?? "work/coverage/zoning-event-source-audit-selection-b.json");
  const inventoryPath = resolve(ROOT, option("inventory") ?? "work/coverage/zoning-event-remediation-inventory-selection-b.json");
  const outputPath = resolve(ROOT, option("output") ?? "work/coverage/zoning-event-remediation-dry-run-selection-b.json");
  if (!inside(COVERAGE, auditPath) || !inside(COVERAGE, inventoryPath) || !inside(COVERAGE, outputPath)) {
    throw new Error("audit, inventaire et sortie doivent rester sous work/coverage/");
  }
  const auditBytes = readFileSync(auditPath, "utf8");
  const inventoryBytes = readFileSync(inventoryPath, "utf8");
  const audit = JSON.parse(auditBytes) as ZoningEventSourceAuditReport;
  const inventory = parseZoningEventRemediationInventory(JSON.parse(inventoryBytes) as unknown);
  const s3 = s3Client();
  const report = await buildZoningEventRemediationDryRun(
    audit,
    inventory,
    { auditSha256: sha256(auditBytes), inventorySha256: sha256(inventoryBytes) },
    async (_slug, key) => {
      const body = await getBytes(s3, key);
      return { document: JSON.parse(body.toString("utf8")) as unknown, sha256: sha256(body) };
    },
    async (key) => getBytes(s3, key),
    { concurrency: boundedInt("concurrency", 4, 1, 16) },
  );
  writeAtomic(outputPath, report);
  console.error(JSON.stringify({
    output: relative(ROOT, outputPath),
    dry_run_sha256: zoningEventRemediationDryRunSha256(report),
    executable: report.executable,
    ...report.totals,
  }));
  if (!report.executable) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
