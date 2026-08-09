/**
 * fsa-boundaries-prep.ts — Stage les polygones RTA/FSA du Québec en S3 (once).
 *
 * SOURCE (ouverte) : Statistique Canada, « Fichier des limites des régions de
 * tri d'acheminement (RTA), Recensement 2021 » — servi par le service ArcGIS
 * REST public de StatCan (Cartographic_boundary_files / couche 14 « FSA »).
 * La RTA = **3 premiers caractères du code postal** (ex. « J4P »). Le code
 * postal complet (6 car.) appartient à Postes Canada et n'a AUCUNE source
 * ouverte joignable en bulk ; la RTA est le plafond ouvert honnête au Québec.
 *
 * On interroge la couche filtrée sur le Québec (PRUID='24' -> 414 RTA), en
 * GeoJSON WGS84 (le serveur reprojette de EPSG:3347 vers 4326 pour le format
 * geojson), simplifiée côté serveur (maxAllowableOffset ~11 m, geometryPrecision
 * 6) — largement suffisant pour un point-in-polygon de centroïde de lot. On
 * dépose le résultat + un stats sidecar en S3 :
 *   normalized/qc-admin-boundaries/qc-fsa.geojson
 *   normalized/qc-admin-boundaries/qc-fsa.stats.json
 *
 * Idempotent, single-process, réexécutable. Ne dépend d'aucun binaire externe
 * (fetch + parse GeoJSON en Node ; aucune reprojection locale nécessaire).
 *
 * Usage :
 *   tsx src/fsa-boundaries-prep.ts            # fetch StatCan -> upload S3
 *   tsx src/fsa-boundaries-prep.ts --no-upload
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { FSA_KEY } from "./lib/fsa-geocode.js";
import { putBytes, s3Client } from "./lib/s3.js";

const SOURCE_ID = "statcan-fsa-2021";
const SOURCE_NAME =
  "Fichier des limites des régions de tri d'acheminement (RTA/FSA), Recensement 2021 — Statistique Canada";
const SOURCE_PORTAL =
  "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21";
const LICENSE = "Statistics Canada Open Licence";
const SERVICE =
  "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/14";

/** RTA du Québec : PRUID='24'. Les codes RTA du Québec commencent par G/H/J. */
const QC_PRUID = "24";
const STATS_KEY = FSA_KEY.replace(/\.geojson$/, ".stats.json");
/** Simplification serveur (degrés) — ~11 m ; sans effet sensible sur le PIP. */
const MAX_OFFSET = "0.0001";
const GEOM_PRECISION = "6";
/** Motif d'une RTA du Québec : lettre G/H/J, chiffre, lettre. */
const FSA_RE = /^[GHJ]\d[A-Z]$/;

interface Args {
  noUpload: boolean;
}

function parseArgs(argv: string[]): Args {
  let noUpload = false;
  for (const a of argv) {
    if (a === "--no-upload") noUpload = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return { noUpload };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`StatCan HTTP ${res.status} for ${url}`);
  return res.json();
}

function queryUrl(format: "geojson" | "json", extra: Record<string, string>): string {
  const params = new URLSearchParams({
    where: `PRUID='${QC_PRUID}'`,
    outFields: "CFSAUID,PRUID,PRNAME",
    returnGeometry: "true",
    f: format,
    ...extra,
  });
  return `${SERVICE}/query?${params.toString()}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // 1) Compte attendu (garde-fou contre une réponse tronquée).
  const countUrl = `${SERVICE}/query?where=${encodeURIComponent(`PRUID='${QC_PRUID}'`)}&returnCountOnly=true&f=json`;
  const countRes = (await fetchJson(countUrl)) as { count?: number };
  const expected = typeof countRes.count === "number" ? countRes.count : 0;
  console.log(`StatCan RTA Québec attendues : ${expected}`);
  if (expected <= 0) throw new Error("compte RTA attendu <= 0 (service indisponible ?)");

  // 2) GeoJSON WGS84 simplifié (une seule page : 414 < maxRecordCount 6000).
  const url = queryUrl("geojson", { maxAllowableOffset: MAX_OFFSET, geometryPrecision: GEOM_PRECISION });
  console.log(`Téléchargement GeoJSON RTA…`);
  const raw = (await fetchJson(url)) as FeatureCollection & { error?: unknown };
  if (raw.error) throw new Error(`réponse ArcGIS en erreur : ${JSON.stringify(raw.error)}`);
  const rawFeatures = (raw.features ?? []) as Feature[];
  if (rawFeatures.length < expected) {
    throw new Error(`réponse tronquée : ${rawFeatures.length} < ${expected} attendues (pagination requise)`);
  }

  // 3) Validation + normalisation (props minimales, source-fidèle).
  const seen = new Set<string>();
  const features: Feature[] = [];
  let bad = 0;
  for (const f of rawFeatures) {
    const code = String(f.properties?.["CFSAUID"] ?? "").trim().toUpperCase();
    const geom = f.geometry as Geometry | null;
    if (!FSA_RE.test(code) || !geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) {
      bad++;
      continue;
    }
    if (seen.has(code)) continue; // une RTA peut apparaître en plusieurs parts — 1 feature/RTA
    seen.add(code);
    features.push({
      type: "Feature",
      geometry: geom,
      properties: {
        CFSAUID: code,
        PRUID: String(f.properties?.["PRUID"] ?? QC_PRUID),
        PRNAME: String(f.properties?.["PRNAME"] ?? "Quebec / Québec"),
      },
    });
  }
  console.log(`RTA valides : ${features.length} (rejetées : ${bad})`);
  if (features.length === 0) throw new Error("aucune RTA valide après validation");

  const fc: FeatureCollection = { type: "FeatureCollection", features };
  const body = Buffer.from(JSON.stringify(fc), "utf8");

  const stats = {
    source_id: SOURCE_ID,
    source_name: SOURCE_NAME,
    source_portal: SOURCE_PORTAL,
    source_service: SERVICE,
    license: LICENSE,
    precision: "fsa3",
    precision_note:
      "RTA = 3 premiers caractères du code postal (ex. J4P). Le code postal complet (6 car.) " +
      "appartient à Postes Canada — aucune source ouverte joignable en bulk ; la RTA est le plafond ouvert.",
    crs: "EPSG:4326",
    max_allowable_offset_deg: Number(MAX_OFFSET),
    geometry_precision: Number(GEOM_PRECISION),
    province: "Quebec (PRUID=24)",
    fsa_expected: expected,
    fsa_count: features.length,
    fsa_rejected: bad,
    output_key: FSA_KEY,
    generated_at: new Date().toISOString(),
  };

  if (args.noUpload) {
    console.log(`--no-upload : ${(body.length / 1e6).toFixed(1)}MB non déposé`);
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const s3 = s3Client();
  await putBytes(s3, FSA_KEY, body, "application/geo+json");
  await putBytes(s3, STATS_KEY, Buffer.from(JSON.stringify(stats, null, 2), "utf8"), "application/json");
  console.log(`Déposé : s3://sentropic-geo/${FSA_KEY} (${(body.length / 1e6).toFixed(1)}MB) + stats`);
  console.log(`RTA=${features.length} précision=fsa3 licence="${LICENSE}"`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
