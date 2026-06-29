/**
 * disaggregate-zonage.ts — désagrège les collections de zonage ArcGIS AGRÉGÉES
 * (multi-municipalités) en collections per-muni `qc-zonage-<slug>`.
 *
 * CONTEXTE (rhanka/geo#4): geo sert ~329 collections qc-zonage mais seules ~38
 * mappent 1:1 un muni; le reste sont des layers ArcGIS où une seule collection
 * couvre plusieurs munis (ex `ca-qc-zonage-jdube-mrcbellechasse-arcgis` = 1129
 * features sur 20 munis, discriminés par l'attribut `mun_nom`, code zone
 * `no_zone`). immo ne peut pas les puller par ville. Ce script SPLIT ces
 * agrégats par muni → une collection per-muni récupérable.
 *
 * LAYOUT S3 (bucket sentropic-geo):
 *   normalized/ca-qc-zonage/<dir>/<base>.geojson  (+ .meta.json)
 *   où <dir> = "ca-qc-zonage-…-arcgis" et <base> = <dir> sans le préfixe "ca-".
 *   Sortie per-muni: normalized/ca-qc-zonage/qc-zonage-<slug>/qc-zonage-<slug>.geojson
 *
 * ANTI-INVENTION (STRICTE):
 *   - Détection d'attribut muni par HEURISTIQUE (liste ordonnée de candidats);
 *     si aucun attribut ne mappe ≥2 slugs canoniques fiables → SKIP (pas un
 *     agrégat OU non désagrégeable). On ne devine JAMAIS un muni.
 *   - Mapping nom→slug via municipalities.qc.json (normalisation accents/casse,
 *     strip des préfixes "Municipalité de"/"Ville de"/…). Pas de match fiable →
 *     skip+flag, JAMAIS deviné.
 *   - VÉRIF SPATIALE anti-faux-positif: le bbox des features d'un muni doit se
 *     situer près du centroïde connu du muni (municipalities.qc.json lat/lon).
 *     Au-delà de la tolérance (--spatial-km, déf. 25) → muni REJETÉ.
 *   - Le zone_code de sortie est l'attribut code-zone DÉTECTÉ tel quel (trim);
 *     jamais reconstruit.
 *
 * ÉCRITURE (run réel, sans --dry-run):
 *   ADDITIF & idempotent. Si `qc-zonage-<slug>` existe déjà MAIS n'est PAS une
 *   sortie de ce script (confidence != disaggregated-from:*), on NE l'écrase
 *   PAS (log conflit). Si c'est déjà une sortie disaggregated, on ré-écrit
 *   (idempotent). `--dry-run` produit le plan sans écrire S3.
 *
 * USAGE:
 *   npx tsx src/disaggregate-zonage.ts --dry-run --only jdube-mrcbellechasse,mrcdecoaticook
 *   npx tsx src/disaggregate-zonage.ts --dry-run --all        # plan sur tous les agrégats
 *   npx tsx src/disaggregate-zonage.ts --only jdube-mrcbellechasse   # RUN RÉEL (écrit S3)
 *   npx tsx src/disaggregate-zonage.ts --list                 # liste les dirs candidats
 *   options: --spatial-km <n> (déf 25), --min-munis <n> (déf 2)
 *
 * TS-only. Aucun secret loggé.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { s3Client, getBytes, exists, putBytes, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNI_REGISTRY = resolve(
  REPO,
  "packages/qc-sources/src/geo/municipalities.qc.json",
);
const PREFIX = "normalized/ca-qc-zonage/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MuniEntry {
  slug: string;
  name: string;
  mrc: string | null;
  lat: number;
  lon: number;
}

interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}
interface GeoJSON {
  type: string;
  features: GeoFeature[];
  [k: string]: unknown;
}

interface ZonageMeta {
  sourceId?: string;
  datasetId?: string;
  title?: string;
  license?: unknown;
  attribution?: string;
  crs?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
/** slug canonique: NFD, drop accents, lowercase, non-alnum→"-". */
function toSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Retire les préfixes administratifs francophones d'un nom de muni. */
function stripAdminPrefix(s: string): string {
  return s
    .replace(
      /^(municipalit[ée]\s+(du\s+canton\s+de\s+|du\s+|de\s+|des\s+|d')?|ville\s+de\s+|ville\s+|paroisse\s+(de\s+)?|canton\s+(de\s+)?|cant[oô]n\s+(de\s+)?|sd\s+de\s+|vl\s+de\s+|m\s+de\s+|p\s+de\s+|v\s+de\s+)/i,
      "",
    )
    .trim();
}

// ---------------------------------------------------------------------------
// Géométrie (léger — pas de dépendance turf, on raisonne sur bbox/centroïde)
// ---------------------------------------------------------------------------
/** Parcourt récursivement toutes les positions [lon,lat] d'une géométrie. */
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    yield [coords[0] as number, coords[1] as number];
    return;
  }
  for (const c of coords) yield* positions(c);
}

interface BBox {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  n: number;
}
function emptyBBox(): BBox {
  return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity, n: 0 };
}
function extendBBox(b: BBox, geom: GeoFeature["geometry"]): void {
  if (!geom) return;
  for (const [x, y] of positions(geom.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < b.minx) b.minx = x;
    if (x > b.maxx) b.maxx = x;
    if (y < b.miny) b.miny = y;
    if (y > b.maxy) b.maxy = y;
    b.n++;
  }
}
function bboxCenter(b: BBox): [number, number] | null {
  if (b.n === 0 || !Number.isFinite(b.minx)) return null;
  return [(b.minx + b.maxx) / 2, (b.miny + b.maxy) / 2];
}
function pointInBBox(pt: [number, number], b: BBox): boolean {
  if (b.n === 0) return false;
  return pt[0] >= b.minx && pt[0] <= b.maxx && pt[1] >= b.miny && pt[1] <= b.maxy;
}
/** Distance haversine en km entre deux [lon,lat]. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Heuristiques de détection d'attributs
// ---------------------------------------------------------------------------
/**
 * Candidats d'attribut MUNI, par ordre de préférence. On choisit le 1er candidat
 * présent qui produit ≥minMunis slugs canoniques distincts.
 */
const MUNI_ATTR_CANDIDATES = [
  "mun_nom",
  "MuniTopo",
  "municipalite",
  "Municipalite",
  "MUNICIPALITE",
  "NOM_MUN",
  "nom_mun",
  "NOMMUN",
  "Municipali",
  "MUNICIPALI",
  "muni_nom",
  "nom_muni",
  "NomMuni",
  "MUNICIPALITY",
  "municipality",
  "VILLE",
  "Ville",
  "nom_ville",
  "mun_id",
  "MUS_NM_MUN",
  "MUS_CO_GEO",
];

/**
 * Candidats d'attribut CODE-ZONE, par ordre de préférence. Doit être un code
 * court alphanumérique (pas une description en prose).
 */
const ZONE_ATTR_CANDIDATES = [
  "no_zone",
  "NO_ZONE",
  "NUM_ZONE",
  "NO_ZONAGE",
  "zone_code",
  "ZONE_CODE",
  "code_zone",
  "CODE_ZONE",
  "ZONAGE",
  "Zonage",
  "ETIQUETTE",
  "ZONAGEMUNICIPALID",
  "NUMERO",
  "Numero",
  "ZONE",
  "Zone",
  "zone",
  "no_zonage",
  "NOZONE",
  "NUMZONE",
  "ID_ZONE",
];

/** Toutes les clés de propriétés rencontrées dans les features. */
function allPropKeys(feats: GeoFeature[]): Set<string> {
  const keys = new Set<string>();
  for (const f of feats) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  return keys;
}

interface MuniAttrPick {
  attr: string;
  slugs: number; // nb de slugs canoniques distincts atteints
}
/**
 * Choisit l'attribut muni: pour chaque candidat présent, compte combien de
 * slugs canoniques distincts ses valeurs (après strip-préfixe) atteignent dans
 * le registre. Retient le meilleur (≥minMunis). null si aucun.
 */
function pickMuniAttr(
  feats: GeoFeature[],
  byName: Map<string, MuniEntry>,
  minMunis: number,
): MuniAttrPick | null {
  const keys = allPropKeys(feats);
  let best: MuniAttrPick | null = null;
  for (const cand of MUNI_ATTR_CANDIDATES) {
    if (!keys.has(cand)) continue;
    const slugs = new Set<string>();
    for (const f of feats) {
      const v = f.properties?.[cand];
      if (v === null || v === undefined || v === "") continue;
      const s = toSlug(stripAdminPrefix(String(v)));
      if (byName.has(s)) slugs.add(s);
    }
    if (slugs.size >= minMunis && (!best || slugs.size > best.slugs)) {
      best = { attr: cand, slugs: slugs.size };
      // Préférence d'ordre: on garde le premier candidat atteignant le max
      // raisonnable; mais on continue pour préférer un attribut couvrant +.
    }
  }
  return best;
}

/**
 * Choisit l'attribut code-zone: 1er candidat présent dont les valeurs sont
 * majoritairement des codes courts (≤24 chars), non-null sur ≥50% des features.
 */
function pickZoneAttr(feats: GeoFeature[]): string | null {
  const keys = allPropKeys(feats);
  const n = feats.length || 1;
  for (const cand of ZONE_ATTR_CANDIDATES) {
    if (!keys.has(cand)) continue;
    let nonNull = 0;
    let shortCodes = 0;
    for (const f of feats) {
      const v = f.properties?.[cand];
      if (v === null || v === undefined || v === "") continue;
      nonNull++;
      const s = String(v).trim();
      if (s.length > 0 && s.length <= 24) shortCodes++;
    }
    if (nonNull / n >= 0.5 && shortCodes / Math.max(nonNull, 1) >= 0.8) {
      return cand;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Découverte des agrégats
// ---------------------------------------------------------------------------
/** Liste les dirs "ca-qc-zonage-…-arcgis" sous le préfixe. */
async function listAggregateDirs(s3: S3Client): Promise<string[]> {
  const out: string[] = [];
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      Delimiter: "/",
      MaxKeys: 1000,
    }),
  );
  for (const cp of r.CommonPrefixes ?? []) {
    const dir = cp.Prefix!.slice(PREFIX.length).replace(/\/$/, "");
    if (dir.startsWith("ca-qc-zonage-") && dir.endsWith("-arcgis")) out.push(dir);
  }
  return out.sort();
}

function geojsonKey(dir: string): string {
  const base = dir.replace(/^ca-/, "");
  return `${PREFIX}${dir}/${base}.geojson`;
}
function metaKey(dir: string): string {
  const base = dir.replace(/^ca-/, "");
  return `${PREFIX}${dir}/${base}.meta.json`;
}
function outGeojsonKey(slug: string): string {
  return `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
}
function outMetaKey(slug: string): string {
  return `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.meta.json`;
}

// ---------------------------------------------------------------------------
// Désagrégation d'un agrégat
// ---------------------------------------------------------------------------
interface PerMuniResult {
  slug: string;
  muniName: string;
  features: number;
  zoneCodes: number; // nb features avec zone_code non-null
  sampleCodes: string[];
  spatialOk: boolean;
  distKm: number | null;
  reason?: string; // si rejeté/skip
}

interface AggResult {
  dir: string;
  totalFeatures: number;
  muniAttr: string | null;
  zoneAttr: string | null;
  skip?: string; // raison de skip global
  munisProduced: PerMuniResult[]; // tous les groupes (mappés ou non)
  mappedOk: PerMuniResult[]; // mappés slug + spatial OK
}

async function disaggregate(
  s3: S3Client,
  dir: string,
  byName: Map<string, MuniEntry>,
  bySlug: Map<string, MuniEntry>,
  spatialKm: number,
  minMunis: number,
): Promise<AggResult> {
  const gkey = geojsonKey(dir);
  const gj = JSON.parse((await getBytes(s3, gkey)).toString("utf8")) as GeoJSON;
  const feats = gj.features ?? [];
  const res: AggResult = {
    dir,
    totalFeatures: feats.length,
    muniAttr: null,
    zoneAttr: null,
    munisProduced: [],
    mappedOk: [],
  };

  const muniPick = pickMuniAttr(feats, byName, minMunis);
  if (!muniPick) {
    res.skip = `aucun attribut muni fiable (≥${minMunis} slugs canoniques) — non désagrégeable`;
    return res;
  }
  res.muniAttr = muniPick.attr;
  const zoneAttr = pickZoneAttr(feats);
  res.zoneAttr = zoneAttr;

  // Groupe les features par valeur brute de l'attribut muni.
  const groups = new Map<string, GeoFeature[]>();
  for (const f of feats) {
    const v = f.properties?.[muniPick.attr];
    if (v === null || v === undefined || v === "") continue;
    const raw = String(v);
    let g = groups.get(raw);
    if (!g) groups.set(raw, (g = []));
    g.push(f);
  }

  // Pour chaque groupe: mappe au slug, vérifie spatial, comptes.
  for (const [raw, gfeats] of groups) {
    const slug = toSlug(stripAdminPrefix(raw));
    const entry = bySlug.get(slug);
    const per: PerMuniResult = {
      slug,
      muniName: raw,
      features: gfeats.length,
      zoneCodes: 0,
      sampleCodes: [],
      spatialOk: false,
      distKm: null,
    };
    if (!entry) {
      per.reason = `slug "${slug}" non mappé au registre — skip (jamais deviné)`;
      res.munisProduced.push(per);
      continue;
    }
    // bbox + vérif spatiale vs centroïde registre.
    const bb = emptyBBox();
    for (const f of gfeats) extendBBox(bb, f.geometry);
    const ctr = bboxCenter(bb);
    const reg: [number, number] = [entry.lon, entry.lat];
    if (!ctr) {
      per.reason = "géométrie vide/illisible — skip";
      res.munisProduced.push(per);
      continue;
    }
    const dist = haversineKm(ctr, reg);
    per.distKm = dist;
    // OK si le centroïde registre tombe DANS le bbox des features, OU si le
    // centre du bbox est à ≤ spatialKm du centroïde registre (munis ruraux
    // étendus où le centroïde = hôtel de ville, pas le centre du territoire).
    per.spatialOk = pointInBBox(reg, bb) || dist <= spatialKm;
    if (!per.spatialOk) {
      per.reason = `échec spatial: bbox center à ${dist.toFixed(1)}km du centroïde registre (>${spatialKm}km)`;
      res.munisProduced.push(per);
      continue;
    }
    // codes zone (sample + count) si attribut détecté.
    if (zoneAttr) {
      const codes = new Set<string>();
      for (const f of gfeats) {
        const v = f.properties?.[zoneAttr];
        if (v === null || v === undefined || v === "") continue;
        per.zoneCodes++;
        const c = String(v).trim();
        if (codes.size < 5) codes.add(c);
      }
      per.sampleCodes = [...codes];
    }
    res.munisProduced.push(per);
    res.mappedOk.push(per);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Construction du GeoJSON de serving per-muni
// ---------------------------------------------------------------------------
/**
 * Construit le GeoJSON de sortie per-muni au schéma de serving. Conserve la
 * géométrie + un sous-ensemble des propriétés source, AJOUTE zone_code
 * normalisé (issu de l'attribut détecté), source, confidence, et l'overlay
 * geoId/name/level/country attendu par geo-api.
 */
function buildPerMuniGeoJSON(
  feats: GeoFeature[],
  slug: string,
  zoneAttr: string | null,
  sourceDir: string,
): GeoJSON {
  const datasetId = `qc-zonage-${slug}`;
  const outFeats: GeoFeature[] = feats.map((f, i) => {
    const src = f.properties ?? {};
    const zoneRaw = zoneAttr ? src[zoneAttr] : undefined;
    const zone_code =
      zoneRaw !== null && zoneRaw !== undefined && String(zoneRaw).trim() !== ""
        ? String(zoneRaw).trim()
        : null;
    // On conserve toutes les propriétés source (non-destructif) + champs serving.
    const props: Record<string, unknown> = {
      ...src,
      zone_code, // normalisé, issu de l'attr détecté — jamais inventé
      source: sourceDir,
      confidence: `disaggregated-from:${sourceDir}`,
      geoId: `ca/${datasetId}/locality/${i}`,
      name: zone_code ?? String(i),
      level: "locality",
      country: "CA",
    };
    return { type: "Feature", properties: props, geometry: f.geometry };
  });
  return { type: "FeatureCollection", features: outFeats };
}

function buildPerMuniMeta(
  slug: string,
  entry: MuniEntry,
  count: number,
  sourceMeta: ZonageMeta | null,
  sourceDir: string,
): ZonageMeta {
  return {
    sourceId: `ca-qc/zonage-${slug}`,
    datasetId: `qc-zonage-${slug}`,
    title: `Zonage — ${entry.name} (désagrégé de ${sourceDir})`,
    license: sourceMeta?.license ?? "See source metadata",
    attribution:
      sourceMeta?.attribution ??
      "Gouvernement du Québec — zonage municipal (désagrégé)",
    crs: sourceMeta?.crs ?? "EPSG:4326",
    municipalitySlug: slug,
    municipalityName: entry.name,
    confidence: `disaggregated-from:${sourceDir}`,
    disaggregatedFrom: sourceDir,
    fetchedAt: new Date().toISOString(),
    count,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): {
  dryRun: boolean;
  all: boolean;
  list: boolean;
  only: string[] | null;
  spatialKm: number;
  minMunis: number;
} {
  const a = { dryRun: false, all: false, list: false, only: null as string[] | null, spatialKm: 25, minMunis: 2 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--all") a.all = true;
    else if (arg === "--list") a.list = true;
    else if (arg === "--only") a.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--spatial-km") a.spatialKm = Number(argv[++i]);
    else if (arg === "--min-munis") a.minMunis = Number(argv[++i]);
  }
  return a;
}

/** Résout les --only (tokens) vers les dirs candidats correspondants. */
function resolveOnly(dirs: string[], only: string[]): string[] {
  const sel: string[] = [];
  for (const tok of only) {
    const match = dirs.filter(
      (d) => d === tok || d.includes(tok) || `qc-zonage-${tok}-arcgis` === d.replace(/^ca-/, ""),
    );
    if (match.length === 0) console.error(`[disagg] --only "${tok}": aucun dir candidat`);
    for (const m of match) if (!sel.includes(m)) sel.push(m);
  }
  return sel;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const s3 = s3Client();

  // Registre munis.
  const raw = JSON.parse(readFileSync(MUNI_REGISTRY, "utf8")) as MuniEntry[];
  const bySlug = new Map<string, MuniEntry>();
  const byName = new Map<string, MuniEntry>();
  for (const e of raw) {
    if (!e.slug) continue;
    bySlug.set(e.slug, e);
    byName.set(toSlug(e.name), e);
    bySlug.set(toSlug(e.name), e); // alias par nom normalisé
  }

  const dirs = await listAggregateDirs(s3);
  console.error(`[disagg] ${dirs.length} dir(s) candidat(s) "ca-qc-zonage-…-arcgis"`);

  if (args.list) {
    for (const d of dirs) console.log(d);
    return;
  }

  let targets: string[];
  if (args.only) targets = resolveOnly(dirs, args.only);
  else if (args.all) targets = dirs;
  else {
    console.error("[disagg] précise --only <tokens> ou --all (avec --dry-run pour planifier).");
    process.exit(2);
    return;
  }
  console.error(`[disagg] ${targets.length} cible(s) | mode=${args.dryRun ? "DRY-RUN" : "RUN RÉEL (écrit S3)"} | spatial=${args.spatialKm}km min-munis=${args.minMunis}`);

  // Agrégats globaux pour la projection.
  let totalAggProcessed = 0;
  let totalAggSkipped = 0;
  let totalMuniGroups = 0;
  let totalMappedSlugs = 0;
  let totalSpatialOk = 0;
  let totalWritten = 0;
  let totalConflicts = 0;
  const skips: string[] = [];
  const written: string[] = [];

  for (const dir of targets) {
    let res: AggResult;
    try {
      res = await disaggregate(s3, dir, byName, bySlug, args.spatialKm, args.minMunis);
    } catch (e) {
      console.error(`[disagg] ERREUR lecture ${dir}: ${(e as Error).message}`);
      totalAggSkipped++;
      skips.push(`${dir}: erreur lecture (${(e as Error).message})`);
      continue;
    }

    if (res.skip) {
      console.error(`[disagg] SKIP ${dir} (${res.totalFeatures} feats): ${res.skip}`);
      totalAggSkipped++;
      skips.push(`${dir}: ${res.skip}`);
      continue;
    }
    totalAggProcessed++;
    totalMuniGroups += res.munisProduced.length;
    totalMappedSlugs += res.munisProduced.filter((p) => bySlug.has(p.slug)).length;
    totalSpatialOk += res.mappedOk.length;

    console.error(
      `\n[disagg] ${dir} (${res.totalFeatures} feats) muniAttr=${res.muniAttr} zoneAttr=${res.zoneAttr}`,
    );
    console.error(
      `         groupes=${res.munisProduced.length} mappés+spatialOK=${res.mappedOk.length}`,
    );
    // Détails des groupes rejetés (anti-invention: tout skip justifié).
    for (const p of res.munisProduced) {
      if (p.reason) console.error(`         - REJET ${p.muniName} → ${p.reason}`);
    }
    // Exemples (2-3) de munis OK.
    for (const p of res.mappedOk.slice(0, 3)) {
      console.error(
        `         · ${p.slug}: ${p.features} feats, ${p.zoneCodes} zone_code, codes=${JSON.stringify(p.sampleCodes)} dist=${p.distKm?.toFixed(1)}km`,
      );
    }

    // Lecture de la meta source (une fois) pour la propager.
    let sourceMeta: ZonageMeta | null = null;
    try {
      const mk = metaKey(dir);
      if (await exists(s3, mk)) sourceMeta = JSON.parse((await getBytes(s3, mk)).toString("utf8")) as ZonageMeta;
    } catch {
      sourceMeta = null;
    }

    // Re-groupe les features pour l'écriture (on a besoin des features, pas que des comptes).
    if (!res.muniAttr) continue;
    const gj = JSON.parse((await getBytes(s3, geojsonKey(dir))).toString("utf8")) as GeoJSON;
    const groups = new Map<string, GeoFeature[]>();
    for (const f of gj.features ?? []) {
      const v = f.properties?.[res.muniAttr];
      if (v === null || v === undefined || v === "") continue;
      const slug = toSlug(stripAdminPrefix(String(v)));
      let g = groups.get(slug);
      if (!g) groups.set(slug, (g = []));
      g.push(f);
    }

    for (const p of res.mappedOk) {
      const entry = bySlug.get(p.slug)!;
      const gfeats = groups.get(p.slug) ?? [];
      const okey = outGeojsonKey(p.slug);
      const omkey = outMetaKey(p.slug);

      // ADDITIF: ne pas écraser un per-muni propre déjà existant (1:1).
      if (!args.dryRun && (await exists(s3, okey))) {
        let existingConf: unknown;
        try {
          if (await exists(s3, omkey)) {
            const em = JSON.parse((await getBytes(s3, omkey)).toString("utf8")) as ZonageMeta;
            existingConf = em["confidence"];
          }
        } catch {
          existingConf = undefined;
        }
        const isDisagg = typeof existingConf === "string" && existingConf.startsWith("disaggregated-from:");
        if (!isDisagg) {
          console.error(`[disagg]   CONFLIT ${p.slug}: ${okey} existe déjà (non-disaggregated) → NE PAS écraser`);
          totalConflicts++;
          continue;
        }
        // sinon: déjà une sortie de ce script → ré-écriture idempotente OK.
      }

      const outGj = buildPerMuniGeoJSON(gfeats, p.slug, res.zoneAttr, dir);
      const outMeta = buildPerMuniMeta(p.slug, entry, gfeats.length, sourceMeta, dir);

      if (args.dryRun) {
        console.error(`[disagg]   PLAN write ${okey} (${gfeats.length} feats)`);
      } else {
        await putBytes(s3, okey, JSON.stringify(outGj), "application/geo+json");
        await putBytes(s3, omkey, JSON.stringify(outMeta, null, 2), "application/json");
        console.error(`[disagg]   WROTE ${okey} (${gfeats.length} feats)`);
        totalWritten++;
        written.push(`qc-zonage-${p.slug}`);
      }
    }
  }

  // Résumé.
  console.error(`\n[disagg] ===== RÉSUMÉ =====`);
  console.error(`[disagg] agrégats traités=${totalAggProcessed} skippés=${totalAggSkipped}`);
  console.error(`[disagg] groupes muni=${totalMuniGroups} mappés-slug=${totalMappedSlugs} mappés+spatialOK=${totalSpatialOk}`);
  if (args.dryRun) {
    console.error(`[disagg] DRY-RUN: ${totalSpatialOk - totalConflicts} per-muni seraient écrits (conflits=${totalConflicts})`);
  } else {
    console.error(`[disagg] RUN RÉEL: ${totalWritten} per-muni écrits en S3 (conflits non-écrasés=${totalConflicts})`);
    if (written.length) console.error(`[disagg] slugs écrits: ${written.join(", ")}`);
  }
  if (skips.length) {
    console.error(`[disagg] skips justifiés:`);
    for (const s of skips) console.error(`         - ${s}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
