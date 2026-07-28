/**
 * Read-only probe of ArcGIS layer query formats. It retains only the response
 * classification, never the response body; production geometry capture stays
 * the responsibility of the cluster capture runner.
 *
 * Usage:
 *   npx tsx acquisition/src/arcgis-geometry-query-probe.ts \
 *     --in=work/coverage/arcgis-geometry-query-probe-input-<UTC>.json \
 *     --out=work/coverage/arcgis-geometry-query-probe-<UTC>.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { probeArcgisGeometryQuery } from "./lib/served-zonage-immo-proof-url-capture-worklist.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

async function main(): Promise<void> {
  const input = option("in");
  const output = option("out");
  if (!input || !output) throw new Error("--in=<endpoints.json> and --out=<report.json> are required");
  const inputPath = insideRepo(input, "in");
  const outputPath = insideRepo(output, "out");
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite existing report: ${output}`);
  const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as { endpoints?: unknown };
  if (!Array.isArray(parsed.endpoints) || parsed.endpoints.length === 0 || !parsed.endpoints.every((value) => typeof value === "string")) {
    throw new Error("input must contain a non-empty endpoints string array");
  }
  const probes = [];
  for (const endpoint of parsed.endpoints) {
    const probe = await probeArcgisGeometryQuery(endpoint);
    probes.push(probe);
    console.error(`[arcgis-query-probe] ${probe.selected_format ?? "refused"} ${endpoint}`);
  }
  writeFileSync(outputPath, `${JSON.stringify({
    contract: "arcgis-geometry-query-probes/v1",
    generated_at: new Date().toISOString(),
    endpoints: parsed.endpoints.length,
    geometry: probes.filter((probe) => probe.selected_url !== null).length,
    refused: probes.filter((probe) => probe.selected_url === null).length,
    probes,
  }, null, 2)}\n`, { flag: "wx" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
