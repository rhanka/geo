/** Read-only dry-run runner for the public-notice/PV text-layer adapter. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runZoningEventsDryRun, s3ServedZoneCodesReader } from "./zoning-events-detect-emit.js";
import {
  avisPublicsTextAdapter,
  openReadOnlyZoningEventsRun,
  readOnlyPdfTextReader,
  type AvisPublicsSource,
} from "./zoning-events-source-avis-publics.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argumentValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function insideRepository(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors dépôt: ${path}`);
  return absolute;
}

function sourcesFromFile(path: string): AvisPublicsSource[] {
  const parsed = JSON.parse(readFileSync(insideRepository(path), "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("inventaire: tableau JSON requis");
  const sources: AvisPublicsSource[] = [];
  for (const [index, item] of parsed.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`inventaire[${index}]: objet requis`);
    const row = item as Record<string, unknown>;
    const city = typeof row.city_slug === "string" ? row.city_slug.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!/^[a-z0-9-]+$/u.test(city) || !/^https:\/\//u.test(url)) throw new Error(`inventaire[${index}]: city_slug/url invalides`);
    sources.push({ city_slug: city, url });
  }
  return sources;
}

async function main(): Promise<void> {
  const citiesRaw = argumentValue("--cities");
  const sourcesPath = argumentValue("--sources");
  const outputDirectory = argumentValue("--out");
  if (!citiesRaw || !sourcesPath || !outputDirectory) throw new Error("--cities --sources et --out sont requis");
  const output = insideRepository(outputDirectory);
  if (existsSync(output)) throw new Error(`refus d'écraser l'artefact: ${outputDirectory}`);
  const run = openReadOnlyZoningEventsRun();
  const adapter = avisPublicsTextAdapter({
    sources: sourcesFromFile(sourcesPath),
    readText: readOnlyPdfTextReader(run),
  });
  try {
    const manifest = await runZoningEventsDryRun({
      cities: citiesRaw.split(",").map((city) => city.trim()).filter(Boolean),
      adapter,
      servedZoneCodes: s3ServedZoneCodesReader(),
      outputDirectory,
    });
    const observationsPath = resolve(output, "source-observations.json");
    writeFileSync(observationsPath, `${JSON.stringify(adapter.observations, null, 2)}\n`, { flag: "wx" });
    await run.finish(0);
    process.stdout.write(`${JSON.stringify({ manifest, observations_output: observationsPath })}\n`);
  } catch (error) {
    await run.finish(2);
    throw error;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
