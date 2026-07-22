/**
 * zones-geocentriq-run.ts — récupère le ZONAGE municipal RÉGLEMENTAIRE des munis
 * servies par le viewer Geocentriq / CIM (`app.geocentriq.com`), sans PDF ni crawl.
 *
 * DÉCOUVERTE (réseau du viewer, capturée via Playwright sur
 * `app.geocentriq.com/mrc/temiscamingue/municipalite/notre-dame-du-nord`) :
 * Geocentriq est une SPA propriétaire, MAIS son fond de carte n'est pas un backend
 * opaque : le viewer charge ses couches en tuiles **WMS** depuis un **GeoServer
 * PUBLIC standard** hébergé par CIM :
 *
 *   https://gs202.geocentriq.com/geoserver/…
 *
 * Ce GeoServer expose aussi le **WFS standard** (GetCapabilities/GetFeature),
 * public et sans auth. Chaque municipalité a son propre WORKSPACE nommé
 * `M<codeMAMH>_<Nom>` (ex. `M85090_Notre_dame_nord`, 85090 = code géographique
 * MAMH de Notre-Dame-du-Nord). La couche de zonage réglementaire est le
 * FeatureType polygone **`…_zonagemunicipal[e]_actuelle`** (ex.
 * `M85090_Notre_dame_nord:090_zonagemunicipal_actuelle`), champ code-zone RÉEL
 * **`zone`** (ex. "Ea10", "Ha3", "C1" — lettre(s) de classe + n°). À NE PAS
 * confondre avec : `usage` (libellé de CLASSE, ex "Ea", PAS un code), la couche
 * `siadmi_zagr_s` (zone agricole CPTAQ), ni un éventuel `…_zonage_projete`.
 * Discriminant muni : le workspace lui-même (déjà mono-muni) → pas de filtre WHERE.
 *
 * STRATÉGIE (discover-once-deposit-many, miroir de sigale/wfs) : on lit le
 * GetCapabilities WFS du node UNE fois → map `codeMAMH → FeatureType zonage`, puis
 * pour chaque muni on GetFeature ce layer (GeoJSON WGS84, paginé startIndex/count),
 * on choisit le champ code-zone, on VALIDE valeur-par-valeur, gate spatial, dépôt.
 *
 * ANTI-INVENTION STRICTE (identique à obscura/sigale/wfs) : le champ code-zone est
 * validé VALEUR-PAR-VALEUR via `validateExplicitZoneField` (≥3 codes distincts,
 * ≥50% non-null, ≥50% à signature code-zone, ≤24 char, ni séquentiel ni technique).
 * Une couche qui ne servirait que de l'affectation / du numérique-nu / du
 * séquentiel est REJETÉE — aucun dépôt, aucun code reconstruit. Gate spatial
 * (centre bbox WGS84 ≈ centroïde registre). Aucun slug hors-registre.
 *
 * NE met PAS à jour la matrice (S3 = vérité ; `coverage-reconcile.ts` réconcilie).
 * Écrit un rapport JSON. Process unique, HTTP pur (pas de Chromium).
 *
 * USAGE :
 *   # les 20 munis de la MRC Témiscamingue (défaut si --slugs absent) :
 *   npx tsx src/zones-geocentriq-run.ts --mrc temiscamingue --deposit
 *   # un sous-ensemble :
 *   npx tsx src/zones-geocentriq-run.ts --slugs notre-dame-du-nord,ville-marie --deposit
 *   # probe/classement seul (aucun dépôt) :
 *   npx tsx src/zones-geocentriq-run.ts --no-deposit
 *   options : --mrc <clef> (déf temiscamingue) --geoserver <url> (override node)
 *             --zone-field <F> (déf auto→zone) --spatial-km <n> (déf 25) --out <file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { s3Client, exists, copyObject, deleteObject } from "./lib/s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneGeojson } from "./lib/zonage-proof.js";
// Anti-invention value-based (agnostique du NOM de champ) — le MÊME gate que le
// dépôt obscura --service, opendata, sigale et wfs.
import { validateExplicitZoneField } from "./zones-obscura-run.js";
// Helpers géo + stats code-zone partagés (WGS84).
import { positionsOf, haversineKm, zoneCodeStats } from "./zones-wfs-run.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const MUNI_DIRECTORY_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/qc-municipal-directory.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 30_000;
const MAX_FEATURES = 20_000;
const PAGE = 1000;

// Node GeoServer hébergeant les workspaces mono-muni `M<codeMAMH>_<Nom>` d'une MRC.
// N'ajouter une MRC ici qu'après avoir CONSTATÉ son node dans le viewer réseau
// (les WMS tiles du viewer révèlent `gsNNN.geocentriq.com` + le workspace).
const MRC_NODE: Record<string, { node: string; mamhPrefix: string; name: string }> = {
  temiscamingue: { node: "https://gs202.geocentriq.com/geoserver", mamhPrefix: "85", name: "Témiscamingue" },
  // Bellechasse (node gs201) — DÉCOUVERT en énumérant les nodes gs2xx : gs201 est
  // le seul node (hors gs202) qui publie de vraies couches `#####y_zonage`
  // réglementaires (6 workspaces M19xxx). gs200/gs203 existent mais ne publient
  // que du cadastre/matrice/zone-agricole (aucune couche zonage → aucun dépôt).
  bellechasse: { node: "https://gs201.geocentriq.com/geoserver", mamhPrefix: "19", name: "Bellechasse" },
};
const DEFAULT_MRC = "temiscamingue";

// Couche de zonage réglementaire : nom local contient "zonage". On EXCLUT
// explicitement zone agricole (CPTAQ) / affectation / contrainte, et on PRÉFÈRE
// la variante "…municipal…actuelle" à un éventuel "…projete/propose/ancien".
const ZONAGE_LAYER_INCLUDE_RE = /zonage/i;
// EXCLUT la zone agricole/affectation ET les couches d'ANNOTATION/étiquette ou
// LIGNE qui accompagnent le polygone de zonage chez CIM (ex. `NNNl_txtzonage`
// = MultiLineString de libellés, à ne pas confondre avec le polygone `NNNy_zonage`).
// Servir/joindre le zonage exige des POLYGONES ; `txt|label|annot|ligne` évite de
// sélectionner l'étiquette linéaire (un garde géométrique en aval double la garde).
const ZONAGE_LAYER_EXCLUDE_RE = /agricole|\bzagr\b|\bverte?\b|affectat|inonda|humide|contrainte|patrimo|conservation|servitude|txt|label|annot|ligne/i;
const ZONAGE_LAYER_PROJET_RE = /projet|propos|ancien|anterieur|antérieur|abrog/i;
// Champs à NE JAMAIS prendre comme code-zone (classe d'usage / géométrie / méta).
const ZONE_FIELD_EXCLUDE_RE = /^usage$|^angle$|^echelle|^orientation|^shape|shape_|geom|^objectid$|^fid$|gml_?id|^id$|superfic|^area$|_area$|_leng|longueur|length|perimet|affectat|municipalit|nom_?mun|code_?mun|mamh|matricule|adresse|no_?lot/i;
// Signature d'un vrai nom de champ code-zone (préférence ; les VALEURS font foi).
const ZONE_FIELD_PREFER_RE = /^zonage$|^zone_?code$|^zone$|^num_?zone$|^no_?zone$|^code_?zone$|^no_?zonage$|^zonage_?id$/i;

// ── Types ─────────────────────────────────────────────────────────────────────
interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features?: GeoFeature[]; totalFeatures?: number; numberReturned?: number }
interface ZonageLayer { workspace: string; typeName: string }

interface SlugResult {
  slug: string;
  mamhCode: string | null;
  typeName?: string | null;
  layerUrl?: string;
  zoneField?: string;
  featureCount?: number;
  distinctCodes?: number;
  distanceKm?: number;
  wasServed?: boolean;      // un dépôt zonage existait-il déjà (overlap/Δ)
  deposited: boolean;
  status:
    | "deposited"
    | "no-code"
    | "no-zonage-layer"
    | "layer-empty"
    | "layer-nonpolygon"
    | "no-zone-field"
    | "zone-invalid"
    | "spatial-fail"
    | "error";
  detail: string;
}

// ── Args ──────────────────────────────────────────────────────────────────────
interface Args { slugs: string[]; mrc: string; node?: string; deposit: boolean; zoneField?: string; spatialKm: number; outFile?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const csv = (k: string): string[] => (get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const zoneField = get("zone-field")?.trim();
  const node = get("geoserver")?.trim();
  return {
    slugs: csv("slugs"),
    mrc: (get("mrc") ?? DEFAULT_MRC).trim().toLowerCase(),
    deposit: has("deposit") && !has("no-deposit"),
    spatialKm: Number(get("spatial-km") ?? 25),
    ...(node ? { node } : {}),
    ...(zoneField ? { zoneField } : {}),
    ...(get("out") ? { outFile: get("out")!.trim() } : {}),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
async function fetchText(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": HTTP_UA } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}
async function fetchJson<T = unknown>(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  const txt = await fetchText(url, timeoutMs);
  if (txt === null) return null;
  try { return JSON.parse(txt) as T; } catch { return null; }
}

// ── Crosswalk slug → code MAMH (répertoire committé, jamais deviné) ───────────
function loadMamhCodes(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = JSON.parse(readFileSync(MUNI_DIRECTORY_PATH, "utf8")) as { entries?: Record<string, { slug?: string; mamhCode?: string }> };
  for (const e of Object.values(dir.entries ?? {})) {
    if (e.slug && e.mamhCode) out.set(e.slug, String(e.mamhCode).trim());
  }
  return out;
}

// ── Découverte WFS : GetCapabilities → map codeMAMH → FeatureType zonage ──────
/**
 * Parse le GetCapabilities WFS du node et retient, pour chaque workspace mono-muni
 * `M<code5>_…`, le FeatureType de zonage réglementaire (nom local /zonage/, hors
 * agricole/affectation, en préférant "…actuelle" à un "…projete"). Aucun code
 * n'est deviné : on ne garde que ce que le serveur publie.
 */
async function loadZonageLayers(node: string): Promise<Map<string, ZonageLayer>> {
  const url = `${node}/ows?service=WFS&version=2.0.0&request=GetCapabilities`;
  const xml = await fetchText(url);
  const byCode = new Map<string, ZonageLayer[]>();
  if (!xml) return new Map();
  const re = /<(?:[A-Za-z0-9]+:)?Name>\s*(M(\d{5})_[^:<\s]+:[^<\s]+)\s*<\/(?:[A-Za-z0-9]+:)?Name>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const typeName = m[1]!;
    const code = m[2]!;
    const [workspace, local = ""] = typeName.split(":");
    if (!ZONAGE_LAYER_INCLUDE_RE.test(local)) continue;
    if (ZONAGE_LAYER_EXCLUDE_RE.test(local)) continue;
    const list = byCode.get(code) ?? [];
    list.push({ workspace: workspace!, typeName });
    byCode.set(code, list);
  }
  // Sélection : préférer "…municipal…actuelle", rejeter "…projete/propose".
  const out = new Map<string, ZonageLayer>();
  for (const [code, list] of byCode) {
    const scored = list
      .map((l) => {
        const local = l.typeName.split(":")[1] ?? "";
        let score = 0;
        if (/actuelle/i.test(local)) score += 3;
        if (/municipal/i.test(local)) score += 2;
        if (ZONAGE_LAYER_PROJET_RE.test(local)) score -= 10;
        return { l, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score > -10) out.set(code, best.l);
  }
  return out;
}

// ── Résolution du champ code-zone (valeur-par-valeur, GeoJSON sans types) ─────
function collectKeys(features: GeoFeature[]): string[] {
  const keys = new Set<string>();
  for (const f of features.slice(0, 80)) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  return [...keys];
}
/** Champ code-zone : override explicite, sinon nom préféré, sinon meilleur codeLike. */
function pickZoneField(features: GeoFeature[], override?: string): string | null {
  const keys = collectKeys(features);
  if (override) return keys.find((k) => k.toLowerCase() === override.toLowerCase()) ?? null;
  const usable = keys.filter((k) => !ZONE_FIELD_EXCLUDE_RE.test(k));
  for (const k of usable) if (ZONE_FIELD_PREFER_RE.test(k)) return k;
  // Sinon : champ non-exclu au meilleur ratio de signature code-zone (≥3 distincts).
  let best: string | null = null;
  let bestScore = -1;
  for (const k of usable) {
    const st = zoneCodeStats(features as never, k);
    if (st.distinct < 3) continue;
    if (st.codeLikeRatio > bestScore) { bestScore = st.codeLikeRatio; best = k; }
  }
  return best;
}

// ── GetFeature paginé (GeoJSON WGS84 ; workspace déjà mono-muni) ──────────────
async function fetchFeatures(node: string, layer: ZonageLayer): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let startIndex = 0;
  while (features.length < MAX_FEATURES) {
    const params = new URLSearchParams({
      service: "WFS", version: "2.0.0", request: "GetFeature",
      typeNames: layer.typeName, outputFormat: "application/json",
      srsName: "EPSG:4326", count: String(PAGE), startIndex: String(startIndex),
    });
    const url = `${node}/${layer.workspace}/ows?${params.toString()}`;
    const fc = await fetchJson<GeoFC>(url);
    if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) break;
    features.push(...fc.features);
    if (fc.features.length < PAGE) break;
    startIndex += fc.features.length;
    await sleep(120);
  }
  return features;
}

function sourceUrl(node: string, layer: ZonageLayer): string {
  const params = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: layer.typeName, outputFormat: "application/json",
    srsName: "EPSG:4326", count: String(PAGE), startIndex: "0",
  });
  return `${node}/${layer.workspace}/ows?${params.toString()}`;
}

/** Normalise au schéma de serving (zone_code = valeur RÉELLE du champ choisi). */
function normalize(features: GeoFeature[], zoneField: string, source: string): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return { type: "Feature" as const, geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source, confidence: "geocentriq-wfs-zone-vector" } };
  });
}

function bboxCenter(features: GeoFeature[]): { lat: number; lon: number; n: number } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
  for (const f of features) for (const [x, y] of positionsOf(f.geometry?.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; n++;
  }
  return { lat: (miny + maxy) / 2, lon: (minx + maxx) / 2, n };
}

// ── Traitement d'une muni ─────────────────────────────────────────────────────
async function processMuni(
  slug: string, muni: MuniEntry | undefined, mamhCode: string | null,
  node: string, layers: Map<string, ZonageLayer>, s3: S3Client | null, args: Args,
): Promise<SlugResult> {
  const base: SlugResult = { slug, mamhCode, deposited: false, status: "no-code", detail: "" };
  if (!mamhCode) return { ...base, status: "no-code", detail: "aucun code MAMH au répertoire pour ce slug" };

  const layer = layers.get(mamhCode);
  if (!layer) return { ...base, status: "no-zonage-layer", detail: `aucun FeatureType de zonage pour le workspace M${mamhCode}_… (node ${node})` };
  const layerUrl = sourceUrl(node, layer);
  base.typeName = layer.typeName;
  base.layerUrl = layerUrl;

  const raw = await fetchFeatures(node, layer);
  if (raw.length === 0) return { ...base, status: "layer-empty", detail: `couche '${layer.typeName}' téléchargée vide` };

  // Garde géométrique : le zonage servi/joint DOIT être polygonal. Un layer de
  // libellé/ligne mal sélectionné (points/MultiLineString) est REJETÉ ici plutôt
  // que déposé — sinon le join lot↔zone (polygones only) échouerait à la revente.
  const polyCount = raw.filter((f) => { const t = f.geometry?.type; return t === "Polygon" || t === "MultiPolygon"; }).length;
  if (polyCount / raw.length < 0.5) {
    return { ...base, featureCount: raw.length, status: "layer-nonpolygon", detail: `couche '${layer.typeName}' non-polygonale (${polyCount}/${raw.length} polygones) — REJET (besoin de polygones pour le join lot↔zone)` };
  }

  const zoneField = pickZoneField(raw, args.zoneField);
  if (!zoneField) return { ...base, status: "no-zone-field", detail: `couche '${layer.typeName}' sans champ code-zone exploitable (champs: ${collectKeys(raw).join(",")})` };
  base.zoneField = zoneField;

  // Anti-invention (valeur-par-valeur) : REJET si le champ ne porte pas de vrais codes.
  const verdict = validateExplicitZoneField(raw as never, zoneField);
  const st = verdict.stats;
  if (!verdict.ok) {
    return { ...base, featureCount: raw.length, status: "zone-invalid", detail: `champ '${zoneField}': ${verdict.reason} — REJET anti-invention (sample=${JSON.stringify(st.sample.slice(0, 6))})` };
  }

  const norm = normalize(raw, zoneField, layer.typeName);
  const distinctCodes = new Set<string>();
  for (const f of norm) { const c = f.properties.zone_code; if (typeof c === "string") distinctCodes.add(c); }
  base.featureCount = norm.length;
  base.distinctCodes = distinctCodes.size;

  // Gate spatial (projection-free ; features déjà en WGS84 lon,lat).
  if (muni) {
    const c = bboxCenter(norm);
    if (c.n > 0) {
      const distanceKm = haversineKm(muni.lat, muni.lon, c.lat, c.lon);
      base.distanceKm = distanceKm;
      if (distanceKm > Math.max(args.spatialKm, 35)) {
        return { ...base, status: "spatial-fail", detail: `spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde (${layer.typeName})` };
      }
    }
  }

  const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
  if (nonNull / norm.length < 0.5) return { ...base, status: "zone-invalid", detail: `couche '${layer.typeName}': zone_code null>50% — REJET` };

  // Un dépôt zonage existait-il déjà ? (overlap/Δ, sans toucher la matrice)
  const flatKey = `${S3_PREFIX}qc-zonage-${slug}.geojson`;
  const subKey = `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (s3) base.wasServed = (await exists(s3, flatKey)) || (await exists(s3, subKey));

  const detail = `${norm.length} zones (${nonNull} avec zone_code, ${distinctCodes.size} distincts, champ '${zoneField}', codeLike=${(st.codeLikeRatio * 100).toFixed(0)}%) via ${layer.typeName}`;
  if (args.deposit && s3) {
    const fc = attachGeometryProof(
      { type: "FeatureCollection" as const, features: norm },
      proofFromFetched({ url: layerUrl, type: "wfs", method: "natif", reliability: "directe", bytes: JSON.stringify(raw) }),
    );
    // Dépôt PLAT (layout préféré par resolveZonesKey). On sauvegarde puis SUPPRIME
    // une éventuelle variante sous-dossier pour éviter le double-service.
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
    if (await exists(s3, subKey)) {
      const backup = `${S3_PREFIX}_replaced/qc-zonage-${slug}__subdir.${ts}.geojson`;
      await copyObject(s3, subKey, backup);
      await deleteObject(s3, subKey);
      console.error(`[geocentriq] ${slug}: ancienne variante sous-dossier sauvegardée → s3://${backup} + SUPPRIMÉE`);
    }
    await putServedZoneGeojson(s3, flatKey, fc);
    return { ...base, deposited: true, status: "deposited", detail: `${base.wasServed ? "[REMPLACE] " : "[NOUVEAU] "}${detail}` };
  }
  return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${detail}` };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mrc = MRC_NODE[args.mrc];
  if (!mrc && !args.node) { console.error(`[geocentriq] MRC '${args.mrc}' inconnue — préciser --geoserver <url> et --slugs`); process.exit(2); }
  const node = args.node ?? mrc!.node;

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const bySlug = new Map(munis.map((m) => [m.slug, m]));
  const mamhBySlug = loadMamhCodes();
  const slugByMamh = new Map([...mamhBySlug.entries()].map(([slug, code]) => [code, slug]));
  const layers = await loadZonageLayers(node);

  // Lot de munis : --slugs explicite, sinon toutes les munis du registre dont le
  // code MAMH porte le préfixe MRC (ex. "85" = Témiscamingue). En mode
  // --geoserver sans MRC connue, dérive les slugs depuis les workspaces WFS
  // `M<code>_...` publiés par le node. Jamais hors-registre.
  let slugs = args.slugs;
  if (slugs.length === 0) {
    if (mrc) {
      slugs = munis
        .map((m) => m.slug)
        .filter((s) => (mamhBySlug.get(s) ?? "").startsWith(mrc.mamhPrefix))
        .sort();
    } else {
      slugs = [...layers.keys()].map((code) => slugByMamh.get(code)).filter((s): s is string => !!s).sort();
      if (slugs.length === 0) { console.error(`[geocentriq] --geoserver sans MRC connue: aucun workspace M<code>_... relié au registre — préciser --slugs`); process.exit(2); }
    }
  }

  const s3 = s3Client(); // requis même en probe (check wasServed / dépôt éventuel)
  console.error(`[geocentriq] mrc=${args.mrc} node=${node} zonageLayers=${layers.size} munis=${slugs.length} deposit=${args.deposit} zoneField=${args.zoneField ?? "auto→zone"}`);

  const results: SlugResult[] = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    let r: SlugResult;
    try { r = await processMuni(slug, bySlug.get(slug), mamhBySlug.get(slug) ?? null, node, layers, s3, args); }
    catch (e) { r = { slug, mamhCode: mamhBySlug.get(slug) ?? null, deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }
    results.push(r);
    console.error(`[${i + 1}/${slugs.length}] ${r.status.padEnd(16)} ${slug} :: ${r.detail}`);
  }

  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const deposited = results.filter((r) => r.deposited).map((r) => r.slug);
  const report = { generatedAt: new Date().toISOString(), mrc: args.mrc, node, deposit: args.deposit, byStatus, deposited, results };
  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/zones-geocentriq-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n=== STATUS ${JSON.stringify(byStatus)}`);
  console.error(`déposés=${deposited.length} [${deposited.join(",")}]`);
  console.error(`rapport → ${out}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
