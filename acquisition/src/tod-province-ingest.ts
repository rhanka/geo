/**
 * tod-province-ingest.ts — province-wide, municipality-centric deposit of the
 * PMAD "aires TOD" (transit-oriented development areas) for every applicable
 * municipality of the Grand Montréal (CMM) — and, when a comparable open layer
 * exists, the région de Québec (CMQ). Feeds the `tod` coverage layer, whose
 * per-muni deposit is `normalized/qc-tod/qc-tod-<slug>.geojson` — the `qc-tod-`
 * filename prefix is what the geo-api turns into the OGC collection id
 * `qc-tod-<slug>` (same basename→id rule as `qc-zonage-<slug>`).
 *
 * Unlike the lot-centric `tod-ingest.ts` (which needs each city's cadastre and
 * also tags lots with `in_tod`), this script is muni-centric and cadastre-free:
 * it downloads the whole aires-TOD layer ONCE, groups the polygons by their
 * source municipality field (`nm_mun`), maps each municipality to its canonical
 * coverage slug (`norm()` — the same slug space as coverage-matrix.json), and
 * writes one FeatureCollection per municipality. This scales the 4 already-done
 * Rive-Sud cities to every municipality carrying a PMAD aire TOD.
 *
 * SOURCE (official, not invented):
 *   CMM — Plan métropolitain d'aménagement et de développement (PMAD),
 *   "Délimitation des aires TOD". Official portal: Observatoire du Grand
 *   Montréal (https://observatoire.cmm.qc.ca/produits/donnees-georeferencees/).
 *   The portal HTML 403s automated fetches, so the identical PMAD layer (verbatim
 *   schema: id_tod, nm_mun, seuil_pmad, statut, ligne, milieu, …) is read from
 *   its public ArcGIS Online mirror (item 4293ab06271f4c899dab7016f5c56146).
 *   Attribution carried in every deposit. Geometries are never synthesised;
 *   the municipality mapping uses the source `nm_mun` field (never guessed).
 *
 * Run:
 *   tsx src/tod-province-ingest.ts --plan                 # dry-run, no upload
 *   tsx src/tod-province-ingest.ts                        # deposit missing munis
 *   tsx src/tod-province-ingest.ts --force                # re-deposit all munis
 *   tsx src/tod-province-ingest.ts --only laval,brossard  # restrict to slugs
 *   tsx src/tod-province-ingest.ts --migrate-legacy       # migrate legacy
 *                                                         # bare-name keys
 *                                                         # normalized/qc-tod/<slug>.geojson
 *                                                         # (pre-`qc-tod-` naming) to
 *                                                         # `qc-tod-<slug>.geojson`, then
 *                                                         # delete the legacy key
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { norm } from "./cadastre-clip-sda.js";
import { copyObject, deleteObject, exists, listSlugs, putBytes, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "..", "..", "work", "coverage", "coverage-matrix.json");

// ── TOD source (CMM PMAD, ArcGIS Online mirror) ──────────────────────────────
const TOD_LAYER_URL =
  "https://services7.arcgis.com/51FKJeyw4LHSTQeV/arcgis/rest/services/Aires_TOD_22_02_2023/FeatureServer/0";
const TOD_ITEM_ID = "4293ab06271f4c899dab7016f5c56146";
const TOD_ATTRIBUTION = "Aires TOD — PMAD, Communauté métropolitaine de Montréal (CMM)";
const TOD_OFFICIAL_PORTAL = "https://observatoire.cmm.qc.ca/produits/donnees-georeferencees/";
const USER_AGENT = "sentropic-geo/acquisition (tod-province-ingest)";
const FETCH_TIMEOUT_MS = 60_000;
const TOD_OUT_FIELDS = [
  "id_tod",
  "nom",
  "nm_mun",
  "nm_mrc",
  "statut",
  "ligne",
  "type",
  "milieu",
  "seuil_pmad",
] as const;

const TOD_OUT_PREFIX = "normalized/qc-tod/";

/**
 * Municipality-name → coverage-slug aliases, for the (rare) case where the
 * source `nm_mun` spelling does not `norm()` onto the canonical coverage slug.
 * Kept empty unless the --plan run surfaces an unmatched municipality that is a
 * genuine spelling variant (never used to invent a mapping).
 */
const NM_MUN_SLUG_ALIAS: Record<string, string> = {};

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type GeoFc = FeatureCollection<Geometry, Record<string, unknown> | null>;

interface TodProps {
  id_tod: string;
  nom: string;
  nm_mun: string;
  nm_mrc: string;
  statut: string;
  ligne: string;
  type: string;
  milieu: string;
  seuil_pmad: number | null;
}

interface Args {
  plan: boolean;
  force: boolean;
  only: Set<string> | null;
  migrateLegacy: boolean;
}

function parseArgs(argv: string[]): Args {
  let plan = false;
  let force = false;
  let only: Set<string> | null = null;
  let migrateLegacy = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--plan" || arg === "--no-upload") plan = true;
    else if (arg === "--force") force = true;
    else if (arg === "--migrate-legacy") migrateLegacy = true;
    else if (arg === "--only") {
      only = new Set(
        String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      );
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { plan, force, only, migrateLegacy };
}

/**
 * Migrate the legacy bare-name deposits `normalized/qc-tod/<slug>.geojson` that
 * predate the `qc-tod-<slug>.geojson` naming onto the new name, then delete the
 * legacy key. A legacy key is any `.geojson` directly under the prefix whose
 * filename does NOT start with `qc-tod-`.
 *
 * For each legacy key: if the `qc-tod-<slug>.geojson` target already exists
 * (typically because this run just re-deposited it from source), the legacy key
 * is simply deleted; otherwise the legacy object is server-side-copied onto the
 * new name FIRST (so no municipality is ever dropped — e.g. a slug that a fresh
 * province run no longer matches), then the legacy key is deleted. Idempotent;
 * respects `plan` (reports, mutates nothing).
 */
async function migrateLegacyKeys(s3: S3Client, plan: boolean): Promise<number> {
  const names = await listSlugs(s3, TOD_OUT_PREFIX, ".geojson");
  const legacy = names.filter((n) => !n.startsWith("qc-tod-") && !n.includes("/"));
  let migrated = 0;
  for (const name of legacy) {
    const legacyKey = `${TOD_OUT_PREFIX}${name}.geojson`;
    const newKey = todGeojsonKey(name);
    const newExists = await exists(s3, newKey);
    if (plan) {
      console.log(
        newExists
          ? `PLAN migrate-legacy -> would delete ${legacyKey} (${newKey} already present)`
          : `PLAN migrate-legacy -> would copy ${legacyKey} -> ${newKey} then delete legacy`,
      );
      continue;
    }
    if (!newExists) {
      await copyObject(s3, legacyKey, newKey);
      console.log(`MIGRATE legacy -> copied ${legacyKey} -> ${newKey}`);
    }
    await deleteObject(s3, legacyKey);
    console.log(`MIGRATE legacy -> deleted ${legacyKey}`);
    migrated++;
  }
  return migrated;
}

// ── coverage slug space (read-only view of the matrix) ───────────────────────
function validSlugSet(): Set<string> {
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, unknown>;
  };
  return new Set(Object.keys(matrix.cities));
}

// ── TOD download (ArcGIS FeatureServer, whole layer, WGS84 GeoJSON, paged) ────
async function fetchAllTod(): Promise<GeoFeature[]> {
  const outFields = encodeURIComponent(TOD_OUT_FIELDS.join(","));
  const out: GeoFeature[] = [];
  let offset = 0;
  const batchSize = 1000;
  for (;;) {
    const url =
      `${TOD_LAYER_URL}/query?where=1%3D1` +
      `&outFields=${outFields}&outSR=4326&geometryPrecision=7` +
      `&resultOffset=${offset}&resultRecordCount=${batchSize}&f=geojson`;
    const fc = await fetchGeoJson(url);
    const feats = (fc.features ?? []) as GeoFeature[];
    out.push(...feats);
    if (feats.length < batchSize) break;
    offset += feats.length;
  }
  return out;
}

async function fetchGeoJson(url: string): Promise<GeoFc> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TOD fetch HTTP ${res.status} for ${url}`);
    const text = await res.text();
    const data = JSON.parse(text) as GeoFc & { error?: { message?: string } };
    if (data.error) throw new Error(`ArcGIS error: ${data.error.message ?? "unknown"}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function cleanTodProps(props: Record<string, unknown> | null): TodProps {
  const p = props ?? {};
  const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    id_tod: str(p["id_tod"]).replace(/\.0+$/, ""),
    nom: str(p["nom"]),
    nm_mun: str(p["nm_mun"]),
    nm_mrc: str(p["nm_mrc"]),
    statut: str(p["statut"]),
    ligne: str(p["ligne"]),
    type: str(p["type"]),
    milieu: str(p["milieu"]),
    seuil_pmad: num(p["seuil_pmad"]),
  };
}

function isPolygonal(f: GeoFeature): boolean {
  return !!f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
}

function slugForMuni(nmMun: string): string {
  const alias = NM_MUN_SLUG_ALIAS[nmMun];
  return alias ?? norm(nmMun);
}

function todFeatureCollection(
  slug: string,
  nmMun: string,
  cleaned: TodProps[],
  geoms: GeoFeature[],
): GeoFc & Record<string, unknown> {
  const features: GeoFeature[] = cleaned.map((props, i) => ({
    type: "Feature",
    geometry: geoms[i]!.geometry,
    properties: props as unknown as Record<string, unknown>,
  }));
  return {
    type: "FeatureCollection",
    metadata: {
      slug,
      source_muni: nmMun,
      source_muni_field: "nm_mun",
      layer: "aires-tod-pmad",
      attribution: TOD_ATTRIBUTION,
      official_portal: TOD_OFFICIAL_PORTAL,
      arcgis_item_id: TOD_ITEM_ID,
      arcgis_layer_url: TOD_LAYER_URL,
      crs: "EPSG:4326",
    },
    features,
  };
}

function todGeojsonKey(slug: string): string {
  return `${TOD_OUT_PREFIX}qc-tod-${slug}.geojson`;
}

interface MuniGroup {
  nmMun: string;
  slug: string;
  cleaned: TodProps[];
  geoms: GeoFeature[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const valid = validSlugSet();

  const all = (await fetchAllTod()).filter(isPolygonal);
  console.log(`FETCH aires_tod features=${all.length}`);

  // Group by source municipality (nm_mun).
  const groups = new Map<string, MuniGroup>();
  const noMuni: number[] = [];
  for (const f of all) {
    const props = cleanTodProps(f.properties);
    if (!props.nm_mun) {
      noMuni.push(1);
      continue;
    }
    const slug = slugForMuni(props.nm_mun);
    let g = groups.get(slug);
    if (!g) {
      g = { nmMun: props.nm_mun, slug, cleaned: [], geoms: [] };
      groups.set(slug, g);
    }
    g.cleaned.push(props);
    g.geoms.push(f);
  }

  const matched: MuniGroup[] = [];
  const unmatched: MuniGroup[] = [];
  for (const g of groups.values()) {
    if (valid.has(g.slug)) matched.push(g);
    else unmatched.push(g);
  }
  matched.sort((a, b) => a.slug.localeCompare(b.slug));
  unmatched.sort((a, b) => a.slug.localeCompare(b.slug));

  const s3: S3Client = s3Client();
  let deposited = 0;
  let skippedExisting = 0;
  let skippedFilter = 0;

  for (const g of matched) {
    if (args.only && !args.only.has(g.slug)) {
      skippedFilter++;
      continue;
    }
    const key = todGeojsonKey(g.slug);
    const already = await exists(s3, key);
    if (already && !args.force) {
      skippedExisting++;
      console.log(`SKIP ${g.slug} nm_mun="${g.nmMun}" areas=${g.cleaned.length} (already deposited)`);
      continue;
    }
    if (args.plan) {
      console.log(
        `PLAN ${g.slug} nm_mun="${g.nmMun}" areas=${g.cleaned.length} -> ${key}${already ? " (would overwrite)" : ""}`,
      );
      continue;
    }
    const fc = todFeatureCollection(g.slug, g.nmMun, g.cleaned, g.geoms);
    const body = Buffer.from(JSON.stringify(fc), "utf8");
    await putBytes(s3, key, body, "application/geo+json");
    const ok = await exists(s3, key);
    if (!ok) throw new Error(`deposit verification failed for ${g.slug} (${key})`);
    deposited++;
    console.log(`OK ${g.slug} nm_mun="${g.nmMun}" areas=${g.cleaned.length} -> ${key}`);
  }

  for (const g of unmatched) {
    console.log(
      `UNMATCHED nm_mun="${g.nmMun}" slug="${g.slug}" areas=${g.cleaned.length} (no coverage city — check alias)`,
    );
  }

  let migrated = 0;
  if (args.migrateLegacy) migrated = await migrateLegacyKeys(s3, args.plan);

  console.log(
    [
      `DONE`,
      `total_features=${all.length}`,
      `munis=${groups.size}`,
      `matched=${matched.length}`,
      `unmatched=${unmatched.length}`,
      args.plan ? `planned` : `deposited=${deposited}`,
      `skipped_existing=${skippedExisting}`,
      args.only ? `skipped_filter=${skippedFilter}` : ``,
      args.migrateLegacy ? `${args.plan ? "would_migrate_legacy" : "migrated_legacy"}=${migrated}` : ``,
      noMuni.length ? `no_muni_features=${noMuni.length}` : ``,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (unmatched.length > 0) {
    console.log(
      `NOTE ${unmatched.length} municipalities have PMAD aires TOD but no coverage city slug; they are reported above, not silently dropped.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
