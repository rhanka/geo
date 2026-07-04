/**
 * zonage-opendata-deposit.ts — dépose le VRAI zonage municipal vectoriel à partir
 * d'un jeu de données OUVERT statique (GeoJSON), pour la famille de munis dont le
 * SIG servi n'expose qu'une AFFECTATION grossière (8 catégories AGF/AGR/CON/URB…)
 * au lieu du zonage réglementaire — donc dont les normes (grille d'usage / RA-106)
 * ne joignent pas.
 *
 * Cas fondateur — Repentigny : le portail ArcGIS de la ville
 * (carte.ville.repentigny.qc.ca .../ZonageMunicipalExterne/MapServer) affiche une
 * couche dont le champ de rendu est AFFECTATION (1-8, Habitation/Commerciale…) et
 * dont la /query est CASSÉE (« Pagination is not supported » / « Unable to complete
 * operation ») → inexploitable. MAIS la Géomatique de la ville publie le VRAI
 * zonage réglementaire (Règlement n°437, champ NUMEROZONE ex. C4-132 / P2-448) en
 * GeoJSON WGS84 CC-BY sur Données Québec. Ce script ingère ce GeoJSON statique,
 * valide les codes (anti-invention réutilisée de zones-obscura-run), vérifie
 * l'OVERLAP avec la grille de normes déjà déposée (jointure zone_code ↔ grille),
 * normalise au schéma de serving et dépose
 * `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson` (remplace l'affectation).
 *
 * ANTI-INVENTION : ≥3 codes distincts à signature lettrée (validateExplicitZoneField),
 * OVERLAP ≠ 0 avec la grille normes si `--norms-codes` fourni (REJET sinon), gate
 * spatial. Rien n'est inventé : les zone_code proviennent tels quels du champ
 * open-data choisi par l'opérateur. Aucun secret loggé.
 *
 * NE met PAS à jour la matrice (coverage-reconcile.ts réconciliera sur S3). L'ancien
 * dépôt (affectation) est sauvegardé sous une clé NON-matchée avant remplacement.
 *
 * USAGE :
 *   npx tsx src/zonage-opendata-deposit.ts --slug repentigny \
 *     --url https://www.donneesquebec.ca/.../zonage_municipal.geojson \
 *     --zone-field NUMEROZONE --norms-codes <codes.json> --deposit
 *   (--file <path> au lieu de --url ; --no-deposit pour probe/classement seul)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, putBytes, copyObject, deleteObject, exists } from "./lib/s3.js";
import { validateExplicitZoneField } from "./zones-obscura-run.js";
// MÊME canon que la JOINTURE runtime lot⋈zone⋈norms et que le gate de dépôt des
// normes (lib/zonage-norms.canonZone délègue à ceci) : l'overlap qu'on MESURE ici
// est, par construction, exactement celui que la jointure RÉALISE (aucun drift).
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo/0.1";

interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features: GeoFeature[] }

interface Args {
  slug: string;
  url?: string;
  file?: string;
  zoneField: string;
  deposit: boolean;
  confidence: string;
  source?: string;
  spatialKm: number;
  normsCodes?: string;
  outFile?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  return {
    slug: (get("slug") ?? "").trim(),
    ...(get("url") ? { url: get("url")!.trim() } : {}),
    ...(get("file") ? { file: get("file")!.trim() } : {}),
    zoneField: (get("zone-field") ?? "").trim(),
    deposit: has("deposit") && !has("no-deposit"),
    confidence: (get("confidence") ?? "opendata-zone-vector").trim(),
    ...(get("source") ? { source: get("source")!.trim() } : {}),
    spatialKm: Number(get("spatial-km") ?? 25),
    ...(get("norms-codes") ? { normsCodes: get("norms-codes")!.trim() } : {}),
    ...(get("out") ? { outFile: get("out")!.trim() } : {}),
  };
}

function* positionsOf(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    yield [coords[0] as number, coords[1] as number];
    return;
  }
  for (const c of coords) yield* positionsOf(c);
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalise un code-zone brut : trim, null si vide. (agnostique du nom de champ) */
function normCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

async function loadFeatures(args: Args): Promise<GeoFeature[]> {
  let text: string;
  if (args.file) {
    text = readFileSync(args.file, "utf8");
  } else if (args.url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const r = await fetch(args.url, { signal: ctrl.signal, headers: { "user-agent": HTTP_UA, accept: "application/geo+json,application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status} @ ${args.url}`);
      text = await r.text();
    } finally { clearTimeout(t); }
  } else {
    throw new Error("ni --file ni --url fourni");
  }
  const fc = JSON.parse(text) as GeoFC;
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) throw new Error("pas un FeatureCollection GeoJSON");
  return fc.features.filter((f) => f && f.geometry && f.properties);
}

/**
 * Charge la liste de codes de la grille de normes, tolérant plusieurs formes :
 *   - un JSON array de strings ;
 *   - `{ codes: [...] }` / `{ zoneCodes: [...] }` ;
 *   - la sortie de diagnose-code-mismatch.ts (`{ extractedRaw|extractedRawSample: [...] }`,
 *     les codes de la grille lus depuis le PDF staté).
 */
function loadNormsCodes(path: string): Set<string> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const p = parsed as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : (p?.["codes"] as unknown[]) ?? (p?.["zoneCodes"] as unknown[])
      ?? (p?.["extractedRaw"] as unknown[]) ?? (p?.["extractedRawSample"] as unknown[]) ?? [];
  const out = new Set<string>();
  for (const c of arr) { const s = normCode(c); if (s) out.add(s); }
  return out;
}

/** Normalise les features au schéma de serving (zone_code depuis le champ choisi). */
function normalize(features: GeoFeature[], zoneField: string, source: string, confidence: string): GeoFeature[] {
  return features.map((f) => ({
    type: "Feature" as const,
    geometry: f.geometry,
    properties: { zone_code: normCode(f.properties?.[zoneField]), kind: null, affectation: null, num_zone: null, source, confidence },
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.zoneField || (!args.url && !args.file)) {
    console.error("usage: --slug <slug> (--url <geojson> | --file <path>) --zone-field <F> [--norms-codes <json>] [--deposit] [--no-deposit] [--spatial-km N] [--confidence C] [--source S]");
    process.exit(2);
  }
  const source = args.source ?? args.url ?? args.file ?? "opendata";

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const muni = munis.find((m) => m.slug === args.slug);

  const features = await loadFeatures(args);
  console.error(`[opendata] slug=${args.slug} champ='${args.zoneField}' features=${features.length} source=${source}`);

  // 1) Anti-invention (champ opérateur) : valeurs = vrais codes-zone.
  const verdict = validateExplicitZoneField(features as never, args.zoneField);
  const st = verdict.stats;
  console.error(`[opendata] gate zone-field: ok=${verdict.ok} (${verdict.reason}) — total=${st.total} nonNull=${st.nonNull} distinct=${st.distinct} codeLike=${(st.codeLikeRatio * 100).toFixed(0)}% maxLen=${st.maxLen} seq=${st.sequentialIdLike}`);
  console.error(`[opendata] échantillon codes: ${JSON.stringify(st.sample.slice(0, 12))}`);
  if (!verdict.ok) { console.error(`[opendata] REJET anti-invention: ${verdict.reason}`); if (!args.outFile) process.exit(1); }

  const norm = normalize(features, args.zoneField, source, args.confidence);
  const distinctCodes = new Set<string>();
  for (const f of norm) { const c = f.properties.zone_code; if (typeof c === "string") distinctCodes.add(c); }

  // 2) Gate spatial : centre bbox WGS84 ≈ centroïde registre.
  let distanceKm: number | undefined;
  if (muni) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
    for (const f of norm) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
    }
    if (n > 0) {
      distanceKm = haversineKm(muni.lat, muni.lon, (miny + maxy) / 2, (minx + maxx) / 2);
      console.error(`[opendata] gate spatial: bbox à ${distanceKm.toFixed(1)}km du centroïde (seuil ${Math.max(args.spatialKm, 35)}km)`);
      if (distanceKm > Math.max(args.spatialKm, 35)) { console.error(`[opendata] REJET spatial`); if (!args.outFile) process.exit(1); }
    }
  } else {
    console.error(`[opendata] AVERTISSEMENT: slug '${args.slug}' absent du registre — gate spatial ignoré`);
  }

  // 3) Gate OVERLAP normes (jointure zone_code ↔ grille) — REJET si 0.
  let overlap: number | undefined;
  let normsTotal: number | undefined;
  let missingSample: string[] = [];
  if (args.normsCodes) {
    // Canon de JOINTURE (canonicalizeZoneCodeForJoin) des DEUX côtés : l'overlap
    // mesuré ici = celui que la jointure lot⋈zone⋈norms réalisera (ex. NUMEROZONE
    // "A1-155" ⋈ grille "A1-036" via canon "A-1-155").
    const normsRaw = loadNormsCodes(args.normsCodes);
    const normsSet = new Set<string>();
    for (const c of normsRaw) normsSet.add(canonicalizeZoneCodeForJoin(c));
    normsTotal = normsRaw.size;
    overlap = 0;
    const missing: string[] = [];
    for (const c of distinctCodes) { if (normsSet.has(canonicalizeZoneCodeForJoin(c))) overlap++; else missing.push(c); }
    missingSample = missing.slice(0, 15);
    const ratio = distinctCodes.size ? (overlap / distinctCodes.size) * 100 : 0;
    console.error(`[opendata] gate normes (canon jointure): grille=${normsTotal} codes | zones distinctes=${distinctCodes.size} | JOINTES=${overlap} (${ratio.toFixed(0)}%) | non-jointes(ex)=${JSON.stringify(missingSample)}`);
    if (overlap === 0) { console.error(`[opendata] REJET: overlap normes = 0 (ces codes ne joignent PAS la grille — affectation/CMM suspecté)`); if (!args.outFile) process.exit(1); }
  } else {
    console.error(`[opendata] (pas de --norms-codes : gate jointure normes NON exécuté)`);
  }

  const report = {
    generatedAt: new Date().toISOString(), slug: args.slug, source, zoneField: args.zoneField,
    features: norm.length, distinctCodes: distinctCodes.size, sample: st.sample.slice(0, 20),
    gate: { antiInvention: verdict.ok, reason: verdict.reason, distanceKm, normsTotal, overlap, missingSample },
    deposited: false as boolean, key: `${S3_PREFIX}qc-zonage-${args.slug}.geojson`,
  };

  const allGatesOk = verdict.ok && (distanceKm === undefined || distanceKm <= Math.max(args.spatialKm, 35)) && (overlap === undefined || overlap > 0);

  if (args.deposit && allGatesOk) {
    const s3 = s3Client();
    // On dépose au layout PLAT `qc-zonage-<slug>.geojson` que resolveGridKey PRÉFÈRE
    // (lib/zonage-norms.resolveGridKey : plat d'abord, puis sous-dossier). L'ancien
    // dépôt (affectation) peut être au layout plat OU sous-dossier ; on sauvegarde
    // les deux sous `_replaced/` (clé NON-matchée par coverage/resolver) et on
    // SUPPRIME la variante sous-dossier pour que seule la vraie zonage soit servie.
    const flatKey = `${S3_PREFIX}qc-zonage-${args.slug}.geojson`;
    const subKey = `${S3_PREFIX}qc-zonage-${args.slug}/qc-zonage-${args.slug}.geojson`;
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
    for (const oldKey of [flatKey, subKey]) {
      if (!(await exists(s3, oldKey))) continue;
      const backup = `${S3_PREFIX}_replaced/${oldKey.slice(S3_PREFIX.length).replace(/\//g, "__")}.${ts}.geojson`;
      await copyObject(s3, oldKey, backup);
      if (oldKey === subKey) { await deleteObject(s3, oldKey); console.error(`[opendata] ancien dépôt (sous-dossier) sauvegardé → s3://${backup} + SUPPRIMÉ`); }
      else console.error(`[opendata] ancien dépôt (plat) sauvegardé → s3://${backup} (sera écrasé)`);
    }
    const fc: GeoFC = { type: "FeatureCollection", features: norm };
    await putBytes(s3, flatKey, JSON.stringify(fc), "application/geo+json");
    report.deposited = true;
    report.key = flatKey;
    console.error(`[opendata] DÉPOSÉ → s3://${flatKey} (${norm.length} zones, ${distinctCodes.size} codes distincts)`);
  } else if (args.deposit) {
    console.error(`[opendata] NON déposé : au moins un gate a échoué`);
  } else {
    console.error(`[opendata] PROBE (non déposé) : ${norm.length} zones, ${distinctCodes.size} codes distincts`);
  }

  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/zonage-opendata-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`[opendata] rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
