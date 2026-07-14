/**
 * Fold the verified 330-2018 -> 451-2025 housing metric onto the served
 * saint-stanislas-de-kostka polygon collection.
 *
 * The input collection is parsed as the complete JSON object and mutated in
 * place. Rebuilding only `{features}` would drop the OGC envelope and make the
 * collection unservable.
 *
 * Usage (from acquisition/):
 *   TMPDIR=/tmp npx tsx src/fold-effet-densifiant.ts
 *   TMPDIR=/tmp npx tsx src/fold-effet-densifiant.ts --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { exists, getBytes, putBytes, s3Client } from "./lib/s3.js";

const SLUG = "saint-stanislas-de-kostka";
const PREFIX = "normalized/ca-qc-zonage/";
const ARTIFACT = "../work/effet-densifiant/saint-stanislas-de-kostka.json";
const OLD_REGLEMENT = "330-2018";
const NEW_REGLEMENT = "451-2025";
const OLD_MILLESIME = "2018";
const NEW_MILLESIME = "2025";

type Effet = "densifie" | "reduit" | "stable" | "inconnu";

interface Entry {
  zone_code: string;
  densite_avant: number | null;
  densite_apres: number | null;
  effet_densifiant: Effet;
  effet_densifiant_delta: string | null;
  methode: "explicit" | "deduit";
  confidence: string;
  steve_coherence: "match" | "flag";
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

function zonageKeys(): string[] {
  return [
    `${PREFIX}qc-zonage-${SLUG}.geojson`,
    `${PREFIX}qc-zonage-${SLUG}/qc-zonage-${SLUG}.geojson`,
  ];
}

function readEntries(): Map<string, Entry> {
  if (!existsSync(ARTIFACT)) throw new Error(`artifact introuvable: ${ARTIFACT}`);
  const raw = JSON.parse(readFileSync(ARTIFACT, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("artifact: expected a JSON array");
  const entries = new Map<string, Entry>();
  for (const value of raw) {
    const entry = value as Partial<Entry>;
    if (typeof entry.zone_code !== "string" || !entry.zone_code.trim()) {
      throw new Error("artifact: zone_code manquant");
    }
    if (entries.has(entry.zone_code)) throw new Error(`artifact: zone_code dupliqué ${entry.zone_code}`);
    if (!( ["densifie", "reduit", "stable", "inconnu"] as string[]).includes(entry.effet_densifiant ?? "")) {
      throw new Error(`artifact: effet invalide pour ${entry.zone_code}`);
    }
    entries.set(entry.zone_code, entry as Entry);
  }
  return entries;
}

async function findKey(s3: ReturnType<typeof s3Client>): Promise<string> {
  for (const key of zonageKeys()) if (await exists(s3, key)) return key;
  throw new Error(`collection S3 introuvable: ${zonageKeys().join(" ou ")}`);
}

function applyEntry(props: Record<string, unknown>, entry: Entry): void {
  // Deliberately overwrite every scaffold placeholder.
  props["densite_avant"] = entry.densite_avant;
  props["densite_avant_millesime"] = OLD_MILLESIME;
  props["densite_avant_reglement"] = OLD_REGLEMENT;
  props["densite_apres"] = entry.densite_apres;
  props["densite_apres_millesime"] = NEW_MILLESIME;
  props["densite_apres_reglement"] = NEW_REGLEMENT;
  props["effet_densifiant"] = entry.effet_densifiant;
  props["effet_densifiant_delta"] = entry.effet_densifiant_delta;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const entries = readEntries();
  const s3 = s3Client();
  const key = await findKey(s3);
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
    applyEntry(feature.properties, entry);
    seen.add(zone);
    matched++;
  }
  const missing = [...entries.keys()].filter((zone) => !seen.has(zone));
  if (missing.length > 0) throw new Error(`artifact zones absentes de la collection: ${missing.join(", ")}`);

  console.log(`${dryRun ? "DRY" : "OK"} key=${key} features=${fc.features.length} matched=${matched}`);
  console.log(`envelope type=${String(fc.type)} crs=${fc.crs === undefined ? "absent" : "preserved"}`);
  if (!dryRun) await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

