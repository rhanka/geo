/**
 * Materialise an immutable local worklist for the cluster capture orchestrator.
 * It reads the committed audit only and never reads or writes served objects.
 *
 * Usage (repository root):
 *   npx tsx acquisition/src/served-zonage-immo-proof-url-capture-worklist.ts \
 *     --out=work/coverage/zonage-proof-url-recapture-20260727-p4.json --limit=32
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCaptureWorklist } from "../../packages/qc-sources/src/capture/index.js";
import {
  probeArcgisGeometryQuery,
  resolveArcgisProofUrlRecaptureWorklist,
  selectProofUrlRecaptureWorklist,
  type ProofUrlAuditRow,
} from "./lib/served-zonage-immo-proof-url-capture-worklist.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_AUDIT = "work/coverage/served-zonage-immo-proof-url-audit-20260727.json";
const DEFAULT_SAMPLE = "work/coverage/served-zonage-immo-proof-url-substitution-sample-10-20260727.state.json";

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function integerOption(name: string, fallback: number, min: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return value;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

async function main(): Promise<void> {
  const out = option("out");
  if (!out) throw new Error("--out=<path> is required");
  const auditPath = insideRepo(option("audit") ?? DEFAULT_AUDIT, "audit");
  const samplePath = insideRepo(option("sample") ?? DEFAULT_SAMPLE, "sample");
  const outPath = insideRepo(out, "out");
  const offset = integerOption("offset", 0, 0);
  const limit = integerOption("limit", 100, 1);
  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { complete?: unknown; rows?: unknown };
  if (audit.complete !== true || !Array.isArray(audit.rows)) throw new Error(`audit incomplete or incompatible: ${auditPath}`);
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as { selected?: unknown };
  if (!Array.isArray(sample.selected) || !sample.selected.every((row) => row !== null && typeof row === "object" && typeof (row as { slug?: unknown }).slug === "string")) {
    throw new Error(`test sample incompatible: ${samplePath}`);
  }
  const excluded = new Set(sample.selected.map((row) => (row as { slug: string }).slug));
  const selected = selectProofUrlRecaptureWorklist(audit.rows as ProofUrlAuditRow[], excluded, offset, limit);
  if (selected.length !== limit) throw new Error(`selection exhausted: requested ${limit}, found ${selected.length}`);
  const resolved = await resolveArcgisProofUrlRecaptureWorklist(selected, probeArcgisGeometryQuery);
  const worklist = parseCaptureWorklist(resolved.worklist);
  if (worklist.length === 0) throw new Error("all selected targets were refused by ArcGIS geometry probes");
  const probePath = outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.arcgis-probes.json` : `${outPath}.arcgis-probes.json`;
  if (resolve(probePath) === outPath) throw new Error("probe report path conflicts with --out");
  writeFileSync(outPath, `${JSON.stringify(worklist, null, 2)}\n`, { flag: "wx" });
  writeFileSync(probePath, `${JSON.stringify({
    contract: "arcgis-geometry-worklist-probes/v1",
    generated_at: new Date().toISOString(),
    selected_targets: selected.length,
    retained_targets: worklist.length,
    probes: resolved.probes,
  }, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ out: outPath, probe_report: probePath, targets: worklist.length, arcgis_probes: resolved.probes.length, offset, excluded_test_collections: excluded.size }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
