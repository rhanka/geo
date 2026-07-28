/**
 * Materialise an immutable local worklist for the cluster capture orchestrator.
 * It reads the committed audit only and never reads or writes served objects.
 *
 * Usage (repository root):
 *   npx tsx acquisition/src/served-zonage-immo-proof-url-capture-worklist.ts \
 *     --out=work/coverage/zonage-proof-url-recapture-20260727-p4.json --limit=32
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  capturedFetch,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
  parseCaptureWorklist,
} from "../../packages/qc-sources/src/capture/index.js";

import { openCaptureRun } from "./lib/capture-s3.js";
import {
  distinctProofUrlCaptures,
  excludeMeasuredProofUrls,
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

function options(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.slice(2)
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length));
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
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

function readExcludedUrls(): Set<string> {
  const excluded = new Set<string>();
  for (const path of options("exclude-worklist")) {
    const worklist = parseCaptureWorklist(JSON.parse(readFileSync(insideRepo(path, "exclude-worklist"), "utf8")));
    for (const target of worklist) for (const url of target.urls) excluded.add(url);
  }
  for (const path of options("exclude-probe")) {
    const report = JSON.parse(readFileSync(insideRepo(path, "exclude-probe"), "utf8")) as { probes?: unknown };
    if (!Array.isArray(report.probes)) throw new Error(`probe report incompatible: ${path}`);
    for (const value of report.probes) {
      if (value === null || typeof value !== "object") throw new Error(`probe report contains an invalid probe: ${path}`);
      const probe = value as { endpoint?: unknown; selected_url?: unknown; attempts?: unknown };
      if (typeof probe.endpoint !== "string" || !Array.isArray(probe.attempts)) {
        throw new Error(`probe report contains an invalid probe: ${path}`);
      }
      excluded.add(probe.endpoint);
      if (typeof probe.selected_url === "string") excluded.add(probe.selected_url);
      for (const attemptValue of probe.attempts) {
        if (attemptValue === null || typeof attemptValue !== "object" || typeof (attemptValue as { url?: unknown }).url !== "string") {
          throw new Error(`probe report contains an invalid attempt: ${path}`);
        }
        excluded.add((attemptValue as { url: string }).url);
      }
    }
  }
  return excluded;
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
  if (hasFlag("candidates-only")) {
    const candidates = hasFlag("distinct") ? distinctProofUrlCaptures(selected) : selected;
    if (existsSync(outPath)) throw new Error(`refusing to overwrite existing candidate worklist: ${out}`);
    writeFileSync(outPath, `${JSON.stringify(candidates, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({
      out: outPath,
      candidate_targets: selected.length,
      unique_candidate_urls: new Set(selected.flatMap((target) => target.urls)).size,
      materialized_targets: candidates.length,
      offset,
      excluded_test_collections: excluded.size,
    }, null, 2));
    return;
  }
  const excludedUrls = readExcludedUrls();
  const unmeasured = excludeMeasuredProofUrls(selected, excludedUrls);
  // Les sondes ArcGIS interrogent des serveurs TIERS : regle C-0, elles passent
  // par le chokepoint de capture. Le `fetch()` nu qui servait de defaut avait
  // rouvert la dette que le cliquet ne laisse que decroitre.
  const run = openCaptureRun({ lane: "zones" });
  const resolved = await resolveArcgisProofUrlRecaptureWorklist(unmeasured, (endpoint) =>
    probeArcgisGeometryQuery(endpoint, async (url) => {
      const captured = await capturedFetch(url, {}, {
        run,
        lane: "zones",
        source: "arcgis-geometry-query-probe",
        // La sonde classifie le CORPS; sans octets elle ne jugerait que sur le
        // content-type, l'erreur exacte qui a fait passer 93 pages HTML pour de
        // la geometrie.
        retainBody: true,
        timeoutMs: null,
        maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
      });
      if (captured.response === null) throw new Error(captured.line.error ?? "capture sans réponse");
      const bytes = captured.bytes;
      const response = captured.response;
      return {
        status: response.status,
        headers: response.headers,
        arrayBuffer: async () => (bytes === null ? new ArrayBuffer(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      };
    }));
  const distinct = distinctProofUrlCaptures(resolved.worklist);
  const worklist = distinct.length === 0 ? [] : parseCaptureWorklist(distinct);
  const probePath = outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.arcgis-probes.json` : `${outPath}.arcgis-probes.json`;
  if (resolve(probePath) === outPath) throw new Error("probe report path conflicts with --out");
  if (worklist.length > 0) writeFileSync(outPath, `${JSON.stringify(worklist, null, 2)}\n`, { flag: "wx" });
  writeFileSync(probePath, `${JSON.stringify({
    contract: "arcgis-geometry-worklist-probes/v1",
    generated_at: new Date().toISOString(),
    selected_targets: selected.length,
    unique_selected_urls: new Set(selected.flatMap((target) => target.urls)).size,
    excluded_measured_urls: excludedUrls.size,
    unmeasured_targets: unmeasured.length,
    unique_unmeasured_urls: new Set(unmeasured.flatMap((target) => target.urls)).size,
    retained_slug_targets: resolved.worklist.length,
    unique_retained_urls: worklist.length,
    retained_targets: worklist.length,
    probes: resolved.probes,
  }, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    out: worklist.length === 0 ? null : outPath,
    probe_report: probePath,
    targets: worklist.length,
    arcgis_probes: resolved.probes.length,
    offset,
    excluded_test_collections: excluded.size,
    excluded_measured_urls: excludedUrls.size,
    unmeasured_targets: unmeasured.length,
    unique_unmeasured_urls: new Set(unmeasured.flatMap((target) => target.urls)).size,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
