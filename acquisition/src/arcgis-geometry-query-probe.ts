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

import {
  capturedFetch,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
} from "../../packages/qc-sources/src/capture/index.js";

import { openCaptureRun } from "./lib/capture-s3.js";
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
  // La sonde interroge des serveurs ArcGIS TIERS : regle C-0, elle passe par le
  // chokepoint de capture. Elle ne conserve toujours pas les corps de reponse --
  // seule la classification est ecrite dans le rapport -- mais chaque appel
  // laisse desormais sa ligne de manifeste, donc « quelles URL ont ete
  // interrogees, quand, avec quel statut » cesse d'etre invisible.
  const run = openCaptureRun({ lane: "zones" });
  const capturedArcgisFetch = async (url: string) => {
    const captured = await capturedFetch(url, {}, {
      run,
      lane: "zones",
      source: "arcgis-geometry-query-probe",
      // La sonde CLASSIFIE le corps (features + coordonnees) : sans les octets,
      // elle ne pourrait juger que sur le content-type -- exactement l'erreur
      // qui a fait passer 93 pages HTML pour de la geometrie.
      retainBody: true,
      // Le `fetch` nu remplace n'imposait ni delai ni limite de redirections plus
      // stricte que Node : preserver cette semantique, sinon on changerait ce que
      // la sonde MESURE en croyant seulement la tracer.
      timeoutMs: null,
      maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
    });
    // Aucune reponse (DNS/TLS/timeout/robots) : lever, pour que la sonde le
    // journalise en `transport_error` au lieu de le confondre avec un refus
    // documente du format.
    if (captured.response === null) throw new Error(captured.line.error ?? "capture sans réponse");
    const bytes = captured.bytes;
    const response = captured.response;
    return {
      status: response.status,
      headers: response.headers,
      // Les octets sont deja lus et haches par le chokepoint; re-consommer le
      // corps echouerait.
      arrayBuffer: async () => (bytes === null ? new ArrayBuffer(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
    };
  };
  const probes = [];
  for (const endpoint of parsed.endpoints) {
    const probe = await probeArcgisGeometryQuery(endpoint, capturedArcgisFetch);
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
