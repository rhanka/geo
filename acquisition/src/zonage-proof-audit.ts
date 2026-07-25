/** Local staging gate for qc-zonage GeoJSON files. Read-only: no S3 writes. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertServedZoneGeojson, type ServedZoneGeoJson } from "./lib/zonage-proof.js";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(dir, entry.name))
      : /^qc-zonage-[a-z0-9-]+\.geojson$/.test(entry.name)
        ? [resolve(dir, entry.name)]
        : [],
  );
}
const get = (key: string): string | undefined => {
  const index = process.argv.indexOf(`--${key}`);
  return index < 0 ? undefined : process.argv[index + 1];
};

const dir = get("dir");
if (!dir) throw new Error("usage: tsx src/zonage-proof-audit.ts --dir <staging-directory> [--out report.json]");
const rows = files(resolve(dir)).map((file) => {
  const collection = file.match(/qc-zonage-([a-z0-9-]+)\.geojson$/)?.[1];
  let fc: ServedZoneGeoJson | undefined;
  try {
    fc = JSON.parse(readFileSync(file, "utf8")) as ServedZoneGeoJson;
    if (!collection) throw new Error("invalid served collection filename");
    assertServedZoneGeojson(`normalized/ca-qc-zonage/qc-zonage-${collection}.geojson`, fc);
    return { file, collection, zones: fc.features.length, status: "exact_source_eligible" };
  } catch (e) {
    return {
      file,
      collection,
      zones: fc?.features?.length ?? 0,
      status: "quarantine",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
});
const report = {
  generated_at: new Date().toISOString(),
  collections: rows.length,
  exact_source_eligible: rows.filter((row) => row.status === "exact_source_eligible").length,
  quarantine: rows.filter((row) => row.status !== "exact_source_eligible").length,
  zones: rows.reduce((count, row) => count + row.zones, 0),
  rows,
};
console.log(JSON.stringify(report, null, 2));
if (get("out")) writeFileSync(get("out")!, JSON.stringify(report, null, 2) + "\n");
if (report.quarantine > 0) process.exitCode = 2;
