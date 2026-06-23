/**
 * recompose-zones-pdf.ts — Recette industrialisée « zones-géométrie depuis GeoPDF »
 *
 * CONTEXTE (la-sarre, prouvé 2026-06-23):
 *   Une ville publie un plan de zonage en PDF géoréférencé (GeoPDF Adobe/ArcGIS/QGIS).
 *   GDAL 3.8+ lit ces fichiers via son driver PDF: deux sous-types coexistent —
 *     TYPE A (VECTEUR) : les zones sont des polygones vectoriels dans le PDF → ogr2ogr
 *                        extrait les géométries reprojetées en WGS84.
 *     TYPE B (RASTER)  : le fond de carte est un raster géoréférencé (PNG/JPEG dans PDF)
 *                        → ogr2ogr ne donne rien; on peut récupérer les labels via
 *                        pdftotext + GeoTransform mais sans polygones de zones propres
 *                        → classifié pdf-georef-raster, NON publié par cette recette.
 *
 * RECETTE COMPLÈTE (TYPE A uniquement) :
 *   1. `gdalinfo` → détecte le géoréférencement (GeoTransform OU Pixel Size) + CRS.
 *   2. `ogr2ogr -f GeoJSON … -t_srs EPSG:4326` → polygones zones en WGS84.
 *   3. `pdftotext -bbox-layout` → mots + positions pixel PDF (GRATUIT, zéro OCR).
 *   4. Filtrage labels : heuristiques code-zone (short alphanum ≤ 24 chars, pas stopwords).
 *   5. GeoTransform GDAL : position pixel PDF → CRS natif → WGS84 (proj4).
 *   6. turf booleanPointInPolygon → zone_code par polygone (STRICT, anti-invention).
 *   7. Vérif spatiale : centroïde du dataset < 10 km du centroïde registre munis.
 *   8. Schéma feature : {zone_code(réel|null), kind, affectation:null, num_zone, source, confidence}.
 *   9. Publication S3 : normalized/ca-qc-zonage/qc-zonage-<slug>/qc-zonage-<slug>.geojson
 *
 * USAGE :
 *   npx tsx src/recompose-zones-pdf.ts --slug la-sarre --pdf /path/to/plan.pdf
 *   npx tsx src/recompose-zones-pdf.ts --slug delson --pdf https://…/plan.pdf
 *   npx tsx src/recompose-zones-pdf.ts --slug la-sarre --pdf /path/to/plan.pdf --dry-run
 *   npx tsx src/recompose-zones-pdf.ts --slug la-sarre --pdf /path/to/plan.pdf --pages 2-4
 *
 * OPTIONS :
 *   --slug <slug>      Slug canonique de la ville (OBLIGATOIRE)
 *   --pdf  <url|path>  URL HTTPS ou chemin local du PDF (OBLIGATOIRE)
 *   --pages <n|n-m>    Pages à extraire via ogr2ogr (défaut: toutes)
 *   --dry-run          Affiche le plan sans écrire sur S3
 *   --spatial-km <n>   Tolérance vérif spatiale en km (défaut: 10)
 *   --min-codes <n>    Nombre min de zone_code uniques pour valider (défaut: 3)
 *
 * ANTI-INVENTION :
 *   - zone_code = null si aucun label ne tombe dans le polygone (jamais inventé).
 *   - Vérif spatiale élimine les datasets hors territoire de la ville.
 *   - Les labels filtrés par stopwords évitent d'affecter des noms de rue comme code.
 *
 * Node/TS pur. JAMAIS de secret loggé. GDAL + pdftotext = outils locaux.
 */
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import proj4 from "proj4";

import { s3Client, putBytes, BUCKET } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNI_REGISTRY = resolve(
  REPO,
  "packages/qc-sources/src/geo/municipalities.qc.json",
);
const S3_PREFIX = "normalized/ca-qc-zonage/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MuniEntry {
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

interface GdalInfo {
  /** Vrai si le PDF est géoréférencé (a un Pixel Size ou GeoTransform). */
  isGeoref: boolean;
  /** CRS WKT ou null. */
  wkt: string | null;
  /** EPSG code extrait du WKT ou null. */
  epsg: string | null;
  /** Définition proj4 du CRS source (pour reprojection). */
  projDef: string | null;
  /** GeoTransform [gt0..gt5] : [originX, pxW, rotX, originY, rotY, pxH]. */
  geoTransform: number[] | null;
  /** Page size in pixels [width, height]. */
  pixelSize: [number, number] | null;
  /** True si GDAL a pu ouvrir via driver PDF (a un Coordinate System). */
  hasCoordSystem: boolean;
}

interface PdfLabel {
  /** Texte brut du mot. */
  text: string;
  /** Coordonnées centre en unités page PDF (points, origine coin supérieur gauche). */
  pdfX: number;
  pdfY: number;
  /** Dimensions de la page PDF en points. */
  pageW: number;
  pageH: number;
}

// ---------------------------------------------------------------------------
// Constantes de filtrage des labels
// ---------------------------------------------------------------------------

/** Mots exclus du matching zone_code (noms de rues, légende, annotations). */
const STOPWORDS = new Set([
  "rue",
  "rte",
  "route",
  "chemin",
  "boulevard",
  "ave",
  "avenue",
  "ch",
  "blvd",
  "rang",
  "montee",
  "montée",
  "côte",
  "cote",
  "nord",
  "sud",
  "est",
  "ouest",
  "n",
  "s",
  "e",
  "o",
  "km",
  "m",
  "ha",
  "ft",
  "plan",
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "zonage",
  "zone",
  "zones",
  "affectation",
  "règlement",
  "reglement",
  "echelle",
  "légende",
  "legende",
  "nord",
  "annexe",
  "titre",
  "date",
  "source",
  "projection",
  "datum",
  "note",
  "page",
]);

/** Pattern : code de zone valide (court alphanumérique, ex. A-1, H2, RB-300, PA). */
const ZONE_CODE_RE = /^[A-Z]{1,4}[-.]?\d{0,4}[A-Z]?$/i;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Distance haversine km entre deux [lon, lat]. */
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

/** Centroïde bbox d'une liste de positions WGS84 [lon, lat][]. */
function bboxCentroid(pts: [number, number][]): [number, number] | null {
  if (pts.length === 0) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Parse les arguments CLI → Record<string, string | boolean>. */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. gdalinfo — détection géoréférencement + GeoTransform
// ---------------------------------------------------------------------------

/**
 * Exécute `gdalinfo <pdf>` et optionnellement `gdalsrsinfo <pdf>` pour parser
 * les champs nécessaires. Ne lève pas d'exception — retourne isGeoref=false si GDAL échoue.
 *
 * Stratégie CRS :
 *  1. gdalsrsinfo → PROJ.4 string directe (le plus fiable, évite les faux EPSG du datum).
 *  2. Fallback : look-up par nom CRS dans le WKT de gdalinfo.
 */
function runGdalinfo(pdfPath: string): GdalInfo {
  const res: GdalInfo = {
    isGeoref: false,
    wkt: null,
    epsg: null,
    projDef: null,
    geoTransform: null,
    pixelSize: null,
    hasCoordSystem: false,
  };

  let output: string;
  try {
    output = execSync(`gdalinfo "${pdfPath}" 2>&1`, {
      encoding: "utf8",
      timeout: 30_000,
    });
  } catch {
    return res;
  }

  // Coordinate System présent → PDF géoréférencé.
  if (output.includes("Coordinate System is:")) {
    res.hasCoordSystem = true;
  }

  // Pixel Size = (…) OU GeoTransform = → géoréférencé.
  const pixelSizeMatch = output.match(/Pixel Size\s*=\s*\(([^,]+),([^)]+)\)/);
  const geoTransformMatch = output.match(
    /GeoTransform\s*=\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)\s*\n\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)/m,
  );

  if (pixelSizeMatch || geoTransformMatch) {
    res.isGeoref = true;
  }

  if (!res.isGeoref) return res;

  // GeoTransform [gt0..gt5].
  if (geoTransformMatch) {
    res.geoTransform = [
      parseFloat(geoTransformMatch[1]!),
      parseFloat(geoTransformMatch[2]!),
      parseFloat(geoTransformMatch[3]!),
      parseFloat(geoTransformMatch[4]!),
      parseFloat(geoTransformMatch[5]!),
      parseFloat(geoTransformMatch[6]!),
    ];
  } else if (pixelSizeMatch) {
    // Reconstruit GeoTransform depuis Pixel Size + Origin.
    const pxW = parseFloat(pixelSizeMatch[1]!);
    const pxH = parseFloat(pixelSizeMatch[2]!);
    const originMatch = output.match(/Origin\s*=\s*\(([^,]+),([^)]+)\)/);
    if (originMatch) {
      const ox = parseFloat(originMatch[1]!);
      const oy = parseFloat(originMatch[2]!);
      res.geoTransform = [ox, pxW, 0, oy, 0, pxH];
    }
  }

  // Taille raster en pixels.
  const sizeMatch = output.match(/Size is (\d+),\s*(\d+)/);
  if (sizeMatch) {
    res.pixelSize = [parseInt(sizeMatch[1]!, 10), parseInt(sizeMatch[2]!, 10)];
  }

  // ── Stratégie CRS robuste ────────────────────────────────────────────────
  // 1. gdalsrsinfo donne la chaîne PROJ.4 directement (évite les EPSG de datum).
  try {
    const srsOut = execSync(`gdalsrsinfo "${pdfPath}" 2>/dev/null`, {
      encoding: "utf8",
      timeout: 15_000,
    });
    const proj4Match = srsOut.match(/PROJ\.4\s*:\s*(.+)/);
    if (proj4Match) {
      const p4 = proj4Match[1]!.trim();
      if (p4 && p4 !== "+proj=longlat +datum=WGS84 +no_defs") {
        res.projDef = p4;
      }
    }
    // Extrait l'EPSG depuis le WKT2 (cherche la dernière ligne ID["EPSG",…] du bloc CRS).
    const epsgMatches = [...srsOut.matchAll(/ID\["EPSG",\s*(\d+)\]/g)];
    if (epsgMatches.length > 0) {
      // Le dernier ID est celui du CRS complet (pas du datum).
      res.epsg = epsgMatches[epsgMatches.length - 1]![1]!;
    }
  } catch {
    // gdalsrsinfo non disponible ou échec → fallback ci-dessous.
  }

  // 2. Fallback : look-up par nom CRS dans le WKT de gdalinfo.
  if (!res.projDef) {
    const crsNameMap: Array<[RegExp, string]> = [
      [/MTM zone 7/i, "+proj=tmerc +lat_0=0 +lon_0=-70.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs"],
      [/MTM zone 8/i, "+proj=tmerc +lat_0=0 +lon_0=-73.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs"],
      [/MTM zone 9/i, "+proj=tmerc +lat_0=0 +lon_0=-76.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs"],
      [/UTM zone 18N/i, "+proj=utm +zone=18 +ellps=GRS80 +datum=NAD83 +units=m +no_defs"],
      [/WGS 84/i, "+proj=longlat +datum=WGS84 +no_defs"],
    ];
    for (const [re, def] of crsNameMap) {
      if (re.test(output)) {
        res.projDef = def;
        break;
      }
    }
  }

  return res;
}

// ---------------------------------------------------------------------------
// 2. ogr2ogr — extraction des polygones vectoriels
// ---------------------------------------------------------------------------

/**
 * Tente d'extraire les polygones du PDF via ogr2ogr (TYPE A — vecteur géoréférencé).
 * Retourne null si le PDF n'a pas de couche vecteur ou si ogr2ogr échoue.
 * `pages` optionnel: filtre les pages à extraire (ex: "2-4").
 */
function runOgr2ogr(
  pdfPath: string,
  outPath: string,
  pages?: string,
): FeatureCollection | null {
  const pagesOpt = pages ? `-oo PAGES=${pages}` : "";
  // Note: -skipfailures est nécessaire pour les GeoPDF ArcMap multi-layer dont certains
  // layers ont des noms avec caractères spéciaux que GeoJSON ne peut pas créer (ex: accents, ':').
  // ogr2ogr retourne exit 1 dans ce cas mais produit quand même un GeoJSON valide avec les
  // layers qui ont réussi. On ignore l'exception et on vérifie le fichier produit.
  const cmd = `ogr2ogr -f GeoJSON "${outPath}" "${pdfPath}" ${pagesOpt} -t_srs EPSG:4326 -skipfailures 2>&1`;
  try {
    execSync(cmd, { encoding: "utf8", timeout: 120_000 });
  } catch {
    // -skipfailures peut quand même lever une exception si AUCUN layer n'a réussi.
    // On continue pour vérifier si un fichier a été produit.
  }

  if (!existsSync(outPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(outPath, "utf8");
  } catch {
    return null;
  }

  let gj: FeatureCollection;
  try {
    gj = JSON.parse(raw) as FeatureCollection;
  } catch {
    return null;
  }

  const polys = (gj.features ?? []).filter(
    (f) =>
      f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );

  if (polys.length === 0) return null;

  return { type: "FeatureCollection", features: polys };
}

// ---------------------------------------------------------------------------
// 3. pdftotext -bbox-layout — extraction des labels avec positions
// ---------------------------------------------------------------------------

/**
 * Exécute `pdftotext -bbox-layout <pdf>` et parse le XML retourné pour en
 * extraire chaque mot avec ses coordonnées en unités page (points PDF, origine
 * coin SUPÉRIEUR gauche).
 */
function runPdftotext(pdfPath: string): PdfLabel[] {
  let xml: string;
  try {
    xml = execSync(`pdftotext -bbox-layout "${pdfPath}" - 2>/dev/null`, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return [];
  }

  const labels: PdfLabel[] = [];

  // Page dimensions.
  const pageMatch = xml.match(/page width="([\d.]+)"\s+height="([\d.]+)"/);
  if (!pageMatch) return [];
  const pageW = parseFloat(pageMatch[1]!);
  const pageH = parseFloat(pageMatch[2]!);

  // Chaque mot : <word xMin="…" yMin="…" xMax="…" yMax="…">TEXT</word>
  const wordRe = /xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([^<]+)<\/word>/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(xml)) !== null) {
    const xMin = parseFloat(m[1]!);
    const yMin = parseFloat(m[2]!);
    const xMax = parseFloat(m[3]!);
    const yMax = parseFloat(m[4]!);
    const text = (m[5] ?? "").trim();
    if (!text) continue;
    labels.push({
      text,
      pdfX: (xMin + xMax) / 2,
      pdfY: (yMin + yMax) / 2,
      pageW,
      pageH,
    });
  }

  return labels;
}

// ---------------------------------------------------------------------------
// 4. Filtrage des labels zone_code
// ---------------------------------------------------------------------------

/**
 * Filtre les labels pour ne garder que les candidats zone_code plausibles.
 * Critères : longueur ≤ 24, pas stopword, respecte ZONE_CODE_RE OU est un
 * code numérique court (ex: "300", "1A"), pas un chiffre seul > 3 digits
 * (numéro de lot/plan).
 */
function filterZoneLabels(labels: PdfLabel[]): PdfLabel[] {
  return labels.filter((l) => {
    const t = l.text.trim();
    if (t.length === 0 || t.length > 24) return false;
    const lower = t.toLowerCase();
    if (STOPWORDS.has(lower)) return false;
    // Exclure les purs numériques > 4 chiffres (numéros de lot).
    if (/^\d{5,}$/.test(t)) return false;
    // Exclure les mesures (123m, 45.6m).
    if (/^\d+\.?\d*m$/i.test(t)) return false;
    // Doit correspondre au pattern code-zone OU être alphanumérique court.
    return ZONE_CODE_RE.test(t) || /^[A-Z]\d{1,4}$/i.test(t) || /^\d{1,3}[A-Z]?$/i.test(t);
  });
}

// ---------------------------------------------------------------------------
// 5. GeoTransform : position PDF → WGS84
// ---------------------------------------------------------------------------

/**
 * Convertit une position (pdfX, pdfY) en unités page PDF vers WGS84 [lon, lat].
 *
 * Algorithme :
 *  - PDF (pdfX, pdfY) en points (72 DPI), origine coin supérieur gauche.
 *  - GDAL pixel (col, row) : col = pdfX * pixW / pageW; row = pdfY * pixH / pageH
 *  - CRS natif via GeoTransform affine :
 *      CRS_X = GT[0] + col * GT[1] + row * GT[2]
 *      CRS_Y = GT[3] + col * GT[4] + row * GT[5]
 *  - CRS natif → WGS84 via proj4.
 */
function pdfCoordToWgs84(
  pdfX: number,
  pdfY: number,
  pageW: number,
  pageH: number,
  pixW: number,
  pixH: number,
  gt: number[],
  projDef: string,
): [number, number] | null {
  const col = (pdfX / pageW) * pixW;
  const row = (pdfY / pageH) * pixH;

  const crsX = gt[0]! + col * gt[1]! + row * gt[2]!;
  const crsY = gt[3]! + col * gt[4]! + row * gt[5]!;

  try {
    const wgs84 = proj4(projDef, "+proj=longlat +datum=WGS84 +no_defs", [crsX, crsY]);
    if (!Array.isArray(wgs84) || wgs84.length < 2) return null;
    const lon = wgs84[0]!;
    const lat = wgs84[1]!;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. Point-in-polygon : zone_code par polygone (anti-invention stricte)
// ---------------------------------------------------------------------------

/**
 * Pour chaque polygone de la collection, trouve le zone_code en cherchant
 * quel label zone (WGS84) tombe STRICTEMENT à l'intérieur (boundary excluded).
 *
 * Retourne null si aucun label ne tombe dans ce polygone (ANTI-INVENTION).
 * En cas de conflit (plusieurs labels différents), retourne null (ambigu).
 */
function assignZoneCodes(
  polygons: FeatureCollection,
  labelPoints: Array<{ wgs84: [number, number]; text: string }>,
): Map<number, string | null> {
  const result = new Map<number, string | null>();

  for (let i = 0; i < polygons.features.length; i++) {
    const feat = polygons.features[i]!;
    const geom = feat.geometry as Polygon | MultiPolygon;
    const matches = new Set<string>();

    for (const lp of labelPoints) {
      try {
        const inside = booleanPointInPolygon(lp.wgs84 as [number, number], geom, {
          ignoreBoundary: true,
        });
        if (inside) matches.add(lp.text.trim());
      } catch {
        // skip
      }
    }

    if (matches.size === 1) {
      result.set(i, [...matches][0]!);
    } else {
      // 0 matches → null (pas de code connu); >1 matches → null (ambigu).
      result.set(i, null);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7. Construction du GeoJSON de sortie
// ---------------------------------------------------------------------------

function buildOutputGeoJSON(
  polygons: FeatureCollection,
  zoneCodes: Map<number, string | null>,
  slug: string,
  pdfSource: string,
): FeatureCollection {
  const features: Feature[] = polygons.features.map((f, i) => {
    const zone_code = zoneCodes.get(i) ?? null;
    const props = f.properties ?? {};

    // Extrait num_zone depuis les propriétés source si disponible.
    const num_zone =
      props["num_zone"] ??
      props["NO_ZONE"] ??
      props["no_zone"] ??
      props["NUMERO"] ??
      null;

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        zone_code, // code réel ou null (jamais inventé)
        kind: "zone",
        affectation: null,
        num_zone: num_zone ?? null,
        source: `pdf-georef-${slug}`,
        confidence: `pdf-georef:${pdfSource}`,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// CLI principal
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const slug = args["slug"] as string | undefined;
  const pdfArg = args["pdf"] as string | undefined;
  const pages = args["pages"] as string | undefined;
  const dryRun = args["dry-run"] === true;
  const spatialKm = parseFloat((args["spatial-km"] as string) || "10");
  const minCodes = parseInt((args["min-codes"] as string) || "3", 10);

  if (!slug || !pdfArg) {
    console.error(
      "Usage: npx tsx src/recompose-zones-pdf.ts --slug <slug> --pdf <url|path> [--pages N-M] [--dry-run]",
    );
    process.exit(2);
  }

  // Charger le registre munis.
  const munis = JSON.parse(readFileSync(MUNI_REGISTRY, "utf8")) as MuniEntry[];
  const muniEntry = munis.find((m) => m.slug === slug);
  if (!muniEntry) {
    console.error(`[recompose] ERREUR: slug "${slug}" introuvable dans le registre munis.`);
    process.exit(2);
  }

  console.error(`[recompose] slug=${slug} (${muniEntry.name}) lat=${muniEntry.lat} lon=${muniEntry.lon}`);
  console.error(`[recompose] pdf=${pdfArg}${pages ? " pages=" + pages : ""}${dryRun ? " [DRY-RUN]" : ""}`);

  // ── ÉTAPE 0 : résolution du PDF (URL → fichier local temporaire) ────────
  const tmpDir = `/tmp/geo-recompose-${slug}-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });

  let pdfPath: string;
  const isUrl = pdfArg.startsWith("https://") || pdfArg.startsWith("http://");
  if (isUrl) {
    pdfPath = join(tmpDir, "plan.pdf");
    console.error(`[recompose] Téléchargement ${pdfArg} → ${pdfPath}`);
    const curlResult = spawnSync("curl", ["-sL", "-o", pdfPath, pdfArg], {
      timeout: 60_000,
    });
    if (curlResult.status !== 0 || !existsSync(pdfPath)) {
      console.error(`[recompose] ERREUR: curl a échoué (status=${curlResult.status})`);
      process.exit(1);
    }
  } else {
    pdfPath = resolve(pdfArg);
    if (!existsSync(pdfPath)) {
      console.error(`[recompose] ERREUR: fichier introuvable: ${pdfPath}`);
      process.exit(1);
    }
  }

  // ── ÉTAPE 1 : gdalinfo ──────────────────────────────────────────────────
  console.error("[recompose] Étape 1/7: gdalinfo…");
  const gdal = runGdalinfo(pdfPath);

  if (!gdal.isGeoref) {
    console.error("[recompose] RÉSULTAT: pdf-non-georef (pas de GeoTransform/Pixel Size).");
    console.error("[recompose] → Calage manuel requis (V2). Non publié.");
    process.exit(0);
  }

  console.error(
    `[recompose] Géoréférencé ✓ | EPSG=${gdal.epsg ?? "??"} | hasCoordSys=${gdal.hasCoordSystem} | GT=${gdal.geoTransform ? "présent" : "absent"}`,
  );

  // ── ÉTAPE 2 : ogr2ogr — tente l'extraction vectorielle ─────────────────
  console.error("[recompose] Étape 2/7: ogr2ogr (extraction polygones vecteur)…");
  const outGeoJSON = join(tmpDir, "raw.geojson");
  const vectorGJ = runOgr2ogr(pdfPath, outGeoJSON, pages);

  if (!vectorGJ) {
    console.error(
      "[recompose] RÉSULTAT: pdf-georef-raster (géoréférencé mais sans couche vecteur OGR).",
    );
    console.error(
      `[recompose] → ${gdal.epsg ? "CRS=" + gdal.epsg : "CRS inconnu"}. Calage raster V2 requis. Non publié.`,
    );
    process.exit(0);
  }

  const polyCount = vectorGJ.features.length;
  console.error(`[recompose] ${polyCount} polygone(s) vecteur extrait(s). TYPE A confirmé.`);

  if (polyCount === 0) {
    console.error("[recompose] RÉSULTAT: 0 polygones — PDF vecteur vide ou couche non reconnue.");
    process.exit(0);
  }

  // ── ÉTAPE 3 : pdftotext -bbox-layout ────────────────────────────────────
  console.error("[recompose] Étape 3/7: pdftotext -bbox-layout…");
  const rawLabels = runPdftotext(pdfPath);
  console.error(`[recompose] ${rawLabels.length} mots extraits.`);

  // ── ÉTAPE 4 : filtrage labels zone_code ─────────────────────────────────
  console.error("[recompose] Étape 4/7: filtrage labels zone_code…");
  const zoneLabels = filterZoneLabels(rawLabels);
  console.error(
    `[recompose] ${zoneLabels.length} candidats zone_code retenus sur ${rawLabels.length} mots.`,
  );

  // ── ÉTAPE 5 : GeoTransform → WGS84 ─────────────────────────────────────
  console.error("[recompose] Étape 5/7: GeoTransform → WGS84…");

  let labelPoints: Array<{ wgs84: [number, number]; text: string }> = [];

  if (gdal.geoTransform && gdal.pixelSize && gdal.projDef && zoneLabels.length > 0) {
    const gt = gdal.geoTransform;
    const [pixW, pixH] = gdal.pixelSize;
    let converted = 0;

    for (const lbl of zoneLabels) {
      const wgs84 = pdfCoordToWgs84(
        lbl.pdfX,
        lbl.pdfY,
        lbl.pageW,
        lbl.pageH,
        pixW,
        pixH,
        gt,
        gdal.projDef,
      );
      if (wgs84) {
        labelPoints.push({ wgs84, text: lbl.text });
        converted++;
      }
    }

    console.error(
      `[recompose] ${converted}/${zoneLabels.length} labels convertis en WGS84.`,
    );
  } else if (zoneLabels.length === 0) {
    console.error(
      "[recompose] 0 labels zone_code → zone_code sera null sur tous les polygones (PDF sans texte vectoriel).",
    );
  } else {
    const missing = [];
    if (!gdal.geoTransform) missing.push("GeoTransform");
    if (!gdal.pixelSize) missing.push("PixelSize");
    if (!gdal.projDef) missing.push(`projDef(EPSG:${gdal.epsg ?? "?"})`);
    console.error(
      `[recompose] AVERTISSEMENT: impossible de localiser les labels (manque: ${missing.join(", ")}). zone_code sera null.`,
    );
    labelPoints = [];
  }

  // ── ÉTAPE 6 : point-in-polygon ──────────────────────────────────────────
  console.error("[recompose] Étape 6/7: point-in-polygon (turf)…");
  const zoneCodes = assignZoneCodes(vectorGJ, labelPoints);

  const withCode = [...zoneCodes.values()].filter((v) => v !== null).length;
  const uniqueCodes = new Set([...zoneCodes.values()].filter((v) => v !== null));
  console.error(
    `[recompose] ${withCode}/${polyCount} polygones avec zone_code | ${uniqueCodes.size} codes uniques.`,
  );

  if (uniqueCodes.size < minCodes) {
    console.error(
      `[recompose] RÉSULTAT: trop peu de codes uniques (${uniqueCodes.size} < ${minCodes} requis). Vérifier le PDF.`,
    );
    console.error(
      "[recompose] → Indique probablement un PDF raster mal classé ou labels absents. Non publié.",
    );
    process.exit(0);
  }

  // ── ÉTAPE 7 : vérification spatiale ─────────────────────────────────────
  console.error("[recompose] Étape 7/7: vérification spatiale…");

  const pts: [number, number][] = vectorGJ.features
    .map((f) => {
      const coords = f.geometry?.type === "Polygon"
        ? (f.geometry as Polygon).coordinates[0]
        : f.geometry?.type === "MultiPolygon"
        ? (f.geometry as MultiPolygon).coordinates[0]?.[0]
        : null;
      if (!coords) return null;
      const cx = coords.reduce((s, p) => s + p[0]!, 0) / coords.length;
      const cy = coords.reduce((s, p) => s + p[1]!, 0) / coords.length;
      return [cx, cy] as [number, number];
    })
    .filter((p): p is [number, number] => p !== null);

  const datasetCenter = bboxCentroid(pts);
  if (!datasetCenter) {
    console.error("[recompose] ERREUR: impossible de calculer le centroïde du dataset.");
    process.exit(1);
  }

  const muniCenter: [number, number] = [muniEntry.lon, muniEntry.lat];
  const distKm = haversineKm(datasetCenter, muniCenter);
  console.error(
    `[recompose] Centroïde dataset: [${datasetCenter[1].toFixed(4)}N, ${datasetCenter[0].toFixed(4)}E] | Distance registre: ${distKm.toFixed(1)}km (seuil=${spatialKm}km)`,
  );

  if (distKm > spatialKm) {
    console.error(
      `[recompose] ERREUR spatiale: dataset trop loin du centroïde registre (${distKm.toFixed(1)}km > ${spatialKm}km). PDF hors territoire?`,
    );
    process.exit(1);
  }

  console.error(`[recompose] Vérification spatiale OK ✓ (${distKm.toFixed(1)} km)`);

  // ── Construction du GeoJSON de sortie ────────────────────────────────────
  const outGj = buildOutputGeoJSON(vectorGJ, zoneCodes, slug, isUrl ? pdfArg : pdfPath);
  const s3Key = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;

  console.error(`\n[recompose] ===== RÉSUMÉ =====`);
  console.error(`[recompose] Slug      : ${slug} (${muniEntry.name})`);
  console.error(`[recompose] Polygones : ${polyCount}`);
  console.error(`[recompose] Codes     : ${withCode} avec zone_code | ${uniqueCodes.size} uniques`);
  console.error(`[recompose] Exemples  : ${[...uniqueCodes].slice(0, 8).join(", ")}`);
  console.error(`[recompose] Spatial   : ${distKm.toFixed(1)} km du centroïde registre`);
  console.error(`[recompose] S3 key    : ${s3Key}`);

  if (dryRun) {
    console.error("[recompose] DRY-RUN: pas d'écriture S3.");
    // Écrit le GeoJSON en local pour inspection.
    const localOut = join(tmpDir, `qc-zonage-${slug}.geojson`);
    writeFileSync(localOut, JSON.stringify(outGj, null, 2));
    console.error(`[recompose] DRY-RUN: GeoJSON local → ${localOut}`);
  } else {
    console.error(`[recompose] Publication S3 → s3://${BUCKET}/${s3Key}`);
    const s3 = s3Client();
    await putBytes(s3, s3Key, JSON.stringify(outGj), "application/geo+json");
    console.error(`[recompose] PUBLIÉ ✓ | ${polyCount} features | ${uniqueCodes.size} codes uniques`);
  }

  // Nettoyage des fichiers temporaires.
  try {
    if (existsSync(outGeoJSON)) unlinkSync(outGeoJSON);
    if (isUrl && existsSync(pdfPath)) unlinkSync(pdfPath);
  } catch {
    // Nettoyage best-effort.
  }
}

main().catch((e: unknown) => {
  console.error("[recompose] FATAL:", e);
  process.exit(1);
});
