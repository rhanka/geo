/**
 * Fold a verified before -> after housing metric onto a served polygon
 * collection without losing the complete OGC FeatureCollection envelope.
 *
 * Usage (from acquisition/):
 *   TMPDIR=/tmp npx tsx src/fold-effet-densifiant.ts --slug saint-stanislas-de-kostka
 *   TMPDIR=/tmp npx tsx src/fold-effet-densifiant.ts --slug sutton \
 *     --old-reglement 115-12-2020 --new-reglement 358 \
 *     --old-millesime 2020 --new-millesime 2026
 *   Add --dry-run to inspect matching without writing.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { exists, getBytes, putBytes, s3Client } from "./lib/s3.js";

const DEFAULT_SLUG = "saint-stanislas-de-kostka";
const PREFIX = "normalized/ca-qc-zonage/";

type Effet = "densifie" | "reduit" | "stable" | "inconnu";
type Methode = "explicit" | "deduit";
type SteveCoherence = "match" | "flag";

interface Entry {
  zone_code: string;
  densite_avant: number | null;
  densite_apres: number | null;
  effet_densifiant: Effet;
  effet_densifiant_delta: string | null;
  source_avant: string;
  source_apres: string;
  methode: Methode;
  confidence: string;
  steve_coherence: SteveCoherence;
}

interface FeatureLike {
  properties?: Record<string, unknown>;
}

interface GeoJsonLike {
  type?: unknown;
  crs?: unknown;
  features?: FeatureLike[];
  [key: string]: unknown;
}

interface FoldConfig {
  slug: string;
  oldReglement: string;
  newReglement: string;
  oldMillesime: string;
  newMillesime: string;
  artifact: string;
}

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf(`--${key}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function configFromArgs(argv: string[]): FoldConfig {
  const slug = arg(argv, "slug") ?? DEFAULT_SLUG;
  const saintDefaults = slug === DEFAULT_SLUG;
  const oldReglement = arg(argv, "old-reglement") ?? (saintDefaults ? "330-2018" : undefined);
  const newReglement = arg(argv, "new-reglement") ?? (saintDefaults ? "451-2025" : undefined);
  const oldMillesime = arg(argv, "old-millesime") ?? (saintDefaults ? "2018" : undefined);
  const newMillesime = arg(argv, "new-millesime") ?? (saintDefaults ? "2025" : undefined);

  if (!oldReglement || !newReglement || !oldMillesime || !newMillesime) {
    throw new Error(
      "usage: --slug <slug> --old-reglement <numero> --new-reglement <numero> " +
        "--old-millesime <yyyy> --new-millesime <yyyy>",
    );
  }

  return {
    slug,
    oldReglement,
    newReglement,
    oldMillesime,
    newMillesime,
    artifact: `../work/effet-densifiant/${slug}.json`,
  };
}

function zonageKeys(slug: string): string[] {
  return [
    `${PREFIX}qc-zonage-${slug}.geojson`,
    `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
}

function readEntries(artifact: string): Map<string, Entry> {
  if (!existsSync(artifact)) throw new Error(`artifact introuvable: ${artifact}`);
  const raw = JSON.parse(readFileSync(artifact, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("artifact: expected a JSON array");

  const entries = new Map<string, Entry>();
  for (const value of raw) {
    const entry = value as Partial<Entry>;
    if (typeof entry.zone_code !== "string" || !entry.zone_code.trim()) {
      throw new Error("artifact: zone_code manquant");
    }
    if (entries.has(entry.zone_code)) {
      throw new Error(`artifact: zone_code dupliqué ${entry.zone_code}`);
    }
    if (!(["densifie", "reduit", "stable", "inconnu"] as string[]).includes(entry.effet_densifiant ?? "")) {
      throw new Error(`artifact: effet invalide pour ${entry.zone_code}`);
    }
    for (const key of ["densite_avant", "densite_apres"] as const) {
      const metric = entry[key];
      if (metric !== null && (typeof metric !== "number" || !Number.isFinite(metric))) {
        throw new Error(`artifact: ${key} invalide pour ${entry.zone_code}`);
      }
    }
    if (!(["explicit", "deduit"] as string[]).includes(entry.methode ?? "")) {
      throw new Error(`artifact: methode invalide pour ${entry.zone_code}`);
    }
    if (!(["match", "flag"] as string[]).includes(entry.steve_coherence ?? "")) {
      throw new Error(`artifact: steve_coherence invalide pour ${entry.zone_code}`);
    }
    entries.set(entry.zone_code, entry as Entry);
  }
  return entries;
}

async function findKey(s3: ReturnType<typeof s3Client>, slug: string): Promise<string> {
  for (const key of zonageKeys(slug)) {
    if (await exists(s3, key)) return key;
  }
  throw new Error(`collection S3 introuvable: ${zonageKeys(slug).join(" ou ")}`);
}

function applyEntry(
  props: Record<string, unknown>,
  entry: Entry,
  config: FoldConfig,
): void {
  // Deliberately overwrite every scaffold placeholder with the verified artifact.
  props["densite_avant"] = entry.densite_avant;
  props["densite_avant_millesime"] = config.oldMillesime;
  props["densite_avant_reglement"] = config.oldReglement;
  props["densite_apres"] = entry.densite_apres;
  props["densite_apres_millesime"] = config.newMillesime;
  props["densite_apres_reglement"] = config.newReglement;
  props["effet_densifiant"] = entry.effet_densifiant;
  props["effet_densifiant_delta"] = entry.effet_densifiant_delta;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const config = configFromArgs(argv);
  const entries = readEntries(config.artifact);
  const s3 = s3Client();
  const key = await findKey(s3, config.slug);

  // Parse and mutate the complete JSON object. Rebuilding only {features} drops
  // type/crs and makes the OGC API collection unservable.
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as GeoJsonLike;
  if (fc.type !== "FeatureCollection") throw new Error(`not a FeatureCollection: ${key}`);
  if (!Array.isArray(fc.features)) throw new Error(`features array missing: ${key}`);

  const seen = new Set<string>();
  let matched = 0;
  for (const feature of fc.features) {
    feature.properties ??= {};
    const zone = feature.properties["zone_code"];
    if (typeof zone !== "string") continue;
    const entry = entries.get(zone);
    if (!entry) continue;
    applyEntry(feature.properties, entry, config);
    seen.add(zone);
    matched++;
  }

  const missing = [...entries.keys()].filter((zone) => !seen.has(zone));
  if (missing.length > 0) {
    throw new Error(`artifact zones absentes de la collection: ${missing.join(", ")}`);
  }

  console.log(
    `${dryRun ? "DRY" : "OK"} slug=${config.slug} key=${key} features=${fc.features.length} matched=${matched}`,
  );
  console.log(
    `old=${config.oldReglement}/${config.oldMillesime} new=${config.newReglement}/${config.newMillesime}`,
  );
  console.log(`envelope type=${String(fc.type)} crs=${fc.crs === undefined ? "absent" : "preserved"}`);

  if (!dryRun) {
    // Write the whole object back, preserving top-level type, crs, and all
    // untouched collection members.
    await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

