/**
 * zones-jmap-run.ts — récupère le ZONAGE municipal RÉGLEMENTAIRE des munis
 * servies par un DIFFUSEUR CARTOGRAPHIQUE **JMap** (K2 Geospatial / Kheops),
 * sans PDF, sans recalage, sans crawl — directement depuis l'API REST JMap.
 *
 * DÉCOUVERTE (Alma, `geo.ville.alma.qc.ca/carte_publique/`) : le diffuseur public
 * est une application **JMap Web** (`data-jmap-user-username="anonymous"`) adossée
 * à un **JMap Server 7.x** dont l'API REST v2.0 est publique à
 * `{base}/services/rest/v2.0`. L'accès public/anonyme se fait via une SESSION WEB
 * anonyme (le même mode que le client navigateur) :
 *
 *   POST {base}/services/rest/v2.0/session
 *        body JSON {"type":"WEB","username":"anonymous","password":""}
 *        -> {result:{sessionId:<int>}}
 *
 * puis, en passant `?sessionId=<int>` sur chaque appel (PAS un header) :
 *   GET  {base}/services/rest/v2.0/projects
 *   GET  {base}/services/rest/v2.0/projects/{project}/layers
 *   GET  {base}/services/rest/v2.0/projects/{project}/layers/{layer}/elements
 *          ?projection=EPSG:4326&pageSize=2000&offset=<n>&withPropertyName=true
 *        -> {result:{features:[{type:"Feature",properties:{...},geometry:{...}}]}}
 *   (les géométries sont DÉJÀ reprojetées en WGS84 par le serveur ; les propriétés
 *    portent les vrais NOMS d'attributs quand withPropertyName=true.)
 *
 * ANTI-INVENTION STRICTE (identique à sigale/obscura/opendata) : le champ code-zone
 * est validé VALEUR-PAR-VALEUR via `validateExplicitZoneField` (≥3 codes distincts,
 * ≥50% non-null, ≥50% à signature code-zone, ≤24 char, ni affectation ni id
 * séquentiel). Une couche qui ne servirait que de l'affectation / du numérique-nu /
 * du séquentiel est REJETÉE — aucun dépôt, aucun code reconstruit. Gate spatial
 * (centre bbox WGS84 ≈ centroïde registre). Un seul slug ciblé (--slug), jamais
 * hors-registre. On EXCLUT explicitement les couches non-zonage (affectation,
 * contraintes, glissements, districts, parcs, hydrographie…).
 *
 * NE met PAS à jour la matrice (S3 = vérité ; `coverage-reconcile.ts` réconcilie).
 * Écrit un rapport JSON. Process unique, HTTP pur (pas de Chromium).
 *
 * USAGE :
 *   # probe (liste les couches + candidate zonage, AUCUN dépôt) :
 *   npx tsx src/zones-jmap-run.ts --slug alma --base https://geo.ville.alma.qc.ca --project 10 --probe
 *   # dépôt du zonage vectoriel réglementaire :
 *   npx tsx src/zones-jmap-run.ts --slug alma --base https://geo.ville.alma.qc.ca --project 10 --deposit
 *   options : --layer <id> (force la couche) --zone-field <F> --spatial-km <n> (déf 30) --out <file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";
import { capturedFetch, capturedText, type CaptureRun } from "../../packages/qc-sources/src/capture/index.js";
import { NODE_FETCH_DEFAULT_MAX_REDIRECTS, type CaptureRequestInit } from "../../packages/qc-sources/src/capture/capturedFetch.js";
import { openCaptureRun } from "./lib/capture-s3.js";
import { s3Client, exists, copyObject, deleteObject } from "./lib/s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneGeojson } from "./lib/zonage-proof.js";
import { validateExplicitZoneField } from "./zones-obscura-run.js";
import { positionsOf, haversineKm } from "./zones-wfs-run.js";

// ── Constantes ────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const MUNIS_PATH = resolve(HERE, "../../packages/qc-sources/src/geo/municipalities.qc.json");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo/0.1";
const HTTP_TIMEOUT_MS = 30_000;
const MAX_FEATURES = 20_000;
const PAGE_SIZE = 2000;
const CAPTURE_SOURCE = "zones-jmap";

// Couche de zonage réglementaire : nom contenant "zonage". On EXCLUT explicitement
// les couches d'affectation / contrainte / risque / thématiques qui ne portent PAS
// le code-zone réglementaire (double garde-fou en amont du gate valeur).
const ZONAGE_LAYER_INCLUDE_RE = /zonage/i;
const ZONAGE_LAYER_EXCLUDE_RE = /affectat|grande|\bverte?\b|inonda|humide|urbanis|destructur|conservation|contrainte|patrimo|bo[iî]s|gliss|expos|district|\bparc|hydro|cadastr|matric|risque|antenn|r[ée]seau|\bvoie|adress|b[aâ]timent|rue|toponym|orthophoto|imagerie/i;
// Champs à ne JAMAIS prendre comme code-zone (métadonnée / id / classe nue). On
// GARDE `nom_objet` : dans une couche JMap de zonage, c'est souvent le VRAI code-zone
// (ex. Alma "Rv2","Ri28"). Le libellé de CLASSE ("classe"/"dominante"/CLASSEZONE) est
// exclu (préfixe de famille, pas le code complet) ; les VALEURS tranchent de toute façon.
const ZONE_FIELD_EXCLUDE_RE = /affectat|^cl_|classe|dominante|^secteur$|^description$|reglement|règlement|adopte|adopté|certificat|^note|created|edited|vigueur|shape|objectid|^jmap_?id$|superfic|^area$|code_?mun|nom_?mun|mamh|^desc_?objet$|^adresse|^mat\d|^lots?$/i;
// Signature d'un vrai nom de champ code-zone (préférence de départage ; les VALEURS font foi).
const ZONE_FIELD_PREFER_RE = /^zonage$|^zone_?code$|^zone$|^num_?zone$|^no_?zone$|^code_?zone$|^codezonage$|^no_?zonage$|^zonage_?id$|^zone_?no$|^zone_?num$|^nom_?objet$/i;
// Copie locale de la signature code-zone (CODE_PATTERN_RE de zones-wfs-run, non exporté)
// — utilisée seulement par le mode diagnostic --dump.
const LOCAL_CODE_RE = /^[A-Za-z]{1,5}[-_. ]?\d|^\d{1,4}[-_. ][A-Za-z]|^[A-Za-z]{1,5}[-_. ][IVXLCDM]{1,6}$|^\d{2,5}[A-Za-z]{1,3}$/;

// ── Types ─────────────────────────────────────────────────────────────────────
interface MuniEntry { slug: string; name: string; mrc: string | null; lat: number; lon: number }
interface GeoFeature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }
interface GeoFC { type: "FeatureCollection"; features: GeoFeature[] }
interface JMapAttribute { name: string; title?: string; type?: string }
interface JMapLayer { id: number; name: string; elementType?: string; geometryType?: string; attributes?: JMapAttribute[] }

interface SlugResult {
  slug: string;
  base: string;
  project: number | null;
  layerId?: number;
  layerName?: string;
  zoneField?: string;
  sourceUrl?: string;
  featureCount?: number;
  distinctCodes?: number;
  distanceKm?: number;
  wasServed?: boolean;
  deposited: boolean;
  status:
    | "deposited"
    | "no-session"
    | "no-project"
    | "no-zonage-layer"
    | "zone-invalid"
    | "spatial-fail"
    | "error";
  detail: string;
  layerCatalog?: Array<{ id: number; name: string; geom?: string; attrs: string[] }>;
}

// ── Args ──────────────────────────────────────────────────────────────────────
interface Args { slug: string; base: string; project?: number; layer?: number; zoneField?: string; deposit: boolean; probe: boolean; dump: boolean; spatialKm: number; outFile?: string }
function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const zoneField = get("zone-field")?.trim();
  const project = get("project"); const layer = get("layer");
  return {
    slug: (get("slug") ?? "").trim(),
    base: (get("base") ?? "").trim().replace(/\/+$/, ""),
    ...(project ? { project: Number(project) } : {}),
    ...(layer ? { layer: Number(layer) } : {}),
    ...(zoneField ? { zoneField } : {}),
    deposit: has("deposit") && !has("no-deposit") && !has("probe") && !has("dump"),
    probe: has("probe"),
    dump: has("dump"),
    spatialKm: Number(get("spatial-km") ?? 30),
    ...(get("out") ? { outFile: get("out")!.trim() } : {}),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
// Le chokepoint a son propre type de requête, plus étroit que `RequestInit` :
// ses en-têtes sont un simple enregistrement et son corps ne peut pas être null.
// Le prendre ici évite d'étaler un `HeadersInit` (tableau ou `Headers`) dans un
// `Record<string, string>`, qui y ferait entrer `length` et consorts.
async function fetchJson<T = unknown>(url: string, init?: CaptureRequestInit, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  try {
    if (!CAPTURE) throw new Error("capture run absent");
    const r = await capturedFetch(url, { ...init, headers: { "user-agent": HTTP_UA, accept: "application/json", ...(init?.headers ?? {}) } }, {
      run: CAPTURE,
      source: CAPTURE_SOURCE,
      slugs: CAPTURE_SLUG ? [CAPTURE_SLUG] : [],
      attempt: 1,
      timeoutMs,
      maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
      version: "zones-jmap-run/1",
    });
    if (!r.ok) return null;
    return JSON.parse(capturedText(r)) as T;
  } catch { return null; }
}

/** Ouvre une session WEB anonyme JMap et renvoie le sessionId (entier), ou null. */
async function openAnonymousSession(base: string): Promise<number | null> {
  const data = await fetchJson<{ result?: { sessionId?: number } }>(
    `${base}/services/rest/v2.0/session`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "WEB", username: "anonymous", password: "" }) },
  );
  const id = data?.result?.sessionId;
  return typeof id === "number" ? id : null;
}

// ── Résolution de la couche zonage + champ ────────────────────────────────────
function findZonageLayer(layers: JMapLayer[]): JMapLayer | null {
  for (const l of layers) {
    if (l.elementType && !/POLYGON/i.test(l.elementType)) continue;
    if (l.geometryType && !/SURFACE|POLYGON/i.test(l.geometryType)) continue;
    if (!ZONAGE_LAYER_INCLUDE_RE.test(l.name)) continue;
    if (ZONAGE_LAYER_EXCLUDE_RE.test(l.name)) continue;
    return l;
  }
  return null;
}

/**
 * Acceptation d'un champ comme code-zone. On PASSE le gate partagé
 * `validateExplicitZoneField` tel quel ; s'il refuse, on ne relâche QUE le cas d'un
 * champ VÉRIFIÉ écrasamment code-zone (signature ≥90%, ≥10 codes distincts, ≥90%
 * peuplé, non-technique, non-séquentiel, maxLen borné à 40) — ce qui tolère de rares
 * valeurs longues (ex. annotation réglementaire "BANDE DE PROTECTION … Zc3") sans
 * jamais admettre un champ d'affectation/label (dont le codeLike est faible). Aucune
 * valeur n'est fabriquée : on sert le champ VERBATIM. Ne touche PAS au gate partagé.
 */
function acceptZoneField(v: ReturnType<typeof validateExplicitZoneField>): { ok: boolean; relaxed: boolean } {
  if (v.ok) return { ok: true, relaxed: false };
  const s = v.stats;
  const overwhelming = !s.fieldExcluded && s.codeLikeRatio >= 0.9 && s.distinct >= 10
    && s.total > 0 && s.nonNull / s.total >= 0.9 && !s.sequentialIdLike && s.maxLen <= 40;
  return { ok: overwhelming, relaxed: overwhelming };
}

/**
 * Champ code-zone piloté par les VALEURS (anti-invention) : parmi les attributs
 * non-techniques, on garde ceux ACCEPTÉS (gate partagé ou champ vérifié code-zone)
 * et on retient le meilleur (distinct × codeLikeRatio), bonus si le NOM matche la
 * signature préférée. Renvoie {field, codeLike, distinct, relaxed} ou null.
 */
function pickZoneFieldByValue(
  features: GeoFeature[], attrs: JMapAttribute[], override?: string,
): { field: string; codeLike: number; distinct: number; relaxed: boolean } | null {
  // On ne filtre PAS par type déclaré (JMap ne le renseigne pas toujours dans la
  // liste des couches) : on écarte les noms techniques et on laisse les VALEURS
  // trancher via le gate code-zone (un champ numérique/géométrique n'y passe pas).
  const names = override
    ? [attrs.find((a) => a.name.toLowerCase() === override.toLowerCase())?.name ?? override]
    : attrs.filter((a) => !ZONE_FIELD_EXCLUDE_RE.test(a.name)).map((a) => a.name);
  let best: { field: string; codeLike: number; distinct: number; relaxed: boolean } | null = null;
  let bestScore = -1;
  for (const name of names) {
    const v = validateExplicitZoneField(features as never, name);
    const acc = acceptZoneField(v);
    if (!override && !acc.ok) continue;
    const s = v.stats;
    const score = (ZONE_FIELD_PREFER_RE.test(name) ? 1e6 : 0) + s.distinct * s.codeLikeRatio;
    if (score > bestScore) { bestScore = score; best = { field: name, codeLike: s.codeLikeRatio, distinct: s.distinct, relaxed: acc.relaxed }; }
  }
  return best;
}

// ── Téléchargement paginé (features JMap déjà WGS84) ──────────────────────────
async function fetchElements(base: string, project: number, layerId: number, sessionId: number): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  let offset = 0;
  while (features.length < MAX_FEATURES) {
    const url = `${base}/services/rest/v2.0/projects/${project}/layers/${layerId}/elements` +
      `?sessionId=${sessionId}&projection=EPSG:4326&pageSize=${PAGE_SIZE}&offset=${offset}&withPropertyName=true`;
    const data = await fetchJson<{ result?: { features?: GeoFeature[] } }>(url);
    const batch = data?.result?.features;
    if (!Array.isArray(batch) || batch.length === 0) break;
    features.push(...batch);
    offset += batch.length;
    if (batch.length < PAGE_SIZE) break;
    await sleep(120);
  }
  return features;
}

/** Normalise au schéma de serving (zone_code = valeur RÉELLE du champ choisi). */
function normalize(features: GeoFeature[], zoneField: string, source: string): GeoFeature[] {
  return features.map((f) => {
    const raw = f.properties?.[zoneField];
    const zone = raw !== null && raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : null;
    return { type: "Feature" as const, geometry: f.geometry, properties: { zone_code: zone, kind: null, affectation: null, num_zone: null, source, confidence: "jmap-zone-vector" } };
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

// ── Traitement ────────────────────────────────────────────────────────────────
async function processSlug(args: Args, muni: MuniEntry | undefined, s3: S3Client | null): Promise<SlugResult> {
  const base: SlugResult = { slug: args.slug, base: args.base, project: args.project ?? null, deposited: false, status: "error", detail: "" };

  const sessionId = await openAnonymousSession(args.base);
  if (sessionId === null) return { ...base, status: "no-session", detail: `session WEB anonyme refusée sur ${args.base}/services/rest/v2.0/session` };

  // Projet : --project explicite, sinon on prend "Public" (diffusion) sinon le 1er.
  let project = args.project ?? null;
  if (project === null) {
    const pj = await fetchJson<{ result?: Array<{ id: number; name?: string; description?: string }> }>(`${args.base}/services/rest/v2.0/projects?sessionId=${sessionId}`);
    const list = pj?.result ?? [];
    const pub = list.find((p) => /public|diffus|internet/i.test(`${p.name ?? ""} ${p.description ?? ""}`)) ?? list[0];
    if (!pub) return { ...base, status: "no-project", detail: "aucun projet JMap listé" };
    project = pub.id;
  }
  base.project = project;

  const lj = await fetchJson<{ result?: { layers?: JMapLayer[] } }>(`${args.base}/services/rest/v2.0/projects/${project}/layers?sessionId=${sessionId}&includeAttributeStatistics=false`);
  const layers = lj?.result?.layers ?? [];
  if (layers.length === 0) return { ...base, status: "no-project", detail: `projet ${project} sans couches lisibles` };

  const catalog = layers.map((l) => ({ id: l.id, name: l.name, geom: l.geometryType, attrs: (l.attributes ?? []).map((a) => a.name) }));
  base.layerCatalog = catalog;

  const layer = args.layer !== undefined
    ? layers.find((l) => l.id === args.layer) ?? null
    : findZonageLayer(layers);
  if (!layer) {
    return { ...base, status: "no-zonage-layer", detail: `aucune couche polygone 'zonage' parmi ${layers.length} couches (candidates: ${catalog.filter((c) => /zon/i.test(c.name)).map((c) => `#${c.id} ${c.name}`).join(" | ") || "aucune"})` };
  }
  base.layerId = layer.id;
  base.layerName = layer.name;
  base.sourceUrl = `${args.base}/services/rest/v2.0/projects/${project}/layers/${layer.id}/elements`;

  const raw = await fetchElements(args.base, project, layer.id, sessionId);
  if (raw.length === 0) return { ...base, status: "no-zonage-layer", detail: `couche '${layer.name}' téléchargée vide` };
  base.featureCount = raw.length;

  if (args.dump) {
    console.error(`\n--- DUMP couche '#${layer.id} ${layer.name}' (${raw.length} features) ---`);
    for (const a of layer.attributes ?? []) {
      const vals = raw.map((f) => f.properties?.[a.name]).map((v) => (v === null || v === undefined ? "" : String(v)));
      const nonEmpty = vals.filter((v) => v.trim() !== "");
      const distinct = [...new Set(nonEmpty)];
      const maxLen = distinct.reduce((m, v) => Math.max(m, v.length), 0);
      const longest = [...distinct].sort((x, y) => y.length - x.length).slice(0, 10);
      const codeLike = distinct.filter((v) => LOCAL_CODE_RE.test(v)).length;
      console.error(`  [${a.name}] nonEmpty=${nonEmpty.length}/${raw.length} distinct=${distinct.length} maxLen=${maxLen} codeLike=${distinct.length ? ((codeLike / distinct.length) * 100).toFixed(0) : 0}%`);
      console.error(`     longest10: ${JSON.stringify(longest)}`);
      console.error(`     sample8:   ${JSON.stringify(distinct.slice(0, 8))}`);
    }
    return { ...base, status: "deposited", deposited: false, detail: `DUMP couche #${layer.id} ${layer.name} (${raw.length} features) — voir stderr` };
  }

  // Champ code-zone piloté par les VALEURS (anti-invention).
  const picked = pickZoneFieldByValue(raw, layer.attributes ?? [], args.zoneField);
  if (!picked) {
    const sampleProps = JSON.stringify(raw[0]?.properties ?? {});
    return { ...base, status: "zone-invalid", detail: `couche '${layer.name}' (#${layer.id}): aucun champ string ne PASSE le gate code-zone (attrs=${(layer.attributes ?? []).map((a) => a.name).join(",")}; ex-props=${sampleProps})` };
  }
  const zoneField = picked.field;
  base.zoneField = zoneField;

  // Anti-invention (valeur-par-valeur) : gate partagé, avec relâche STRICTE pour un
  // champ vérifié écrasamment code-zone (cf. acceptZoneField). REJET sinon.
  const verdict = validateExplicitZoneField(raw as never, zoneField);
  const st = verdict.stats;
  const acc = acceptZoneField(verdict);
  if (!acc.ok) {
    return { ...base, status: "zone-invalid", featureCount: raw.length, detail: `champ '${zoneField}': ${verdict.reason} — REJET anti-invention (sample=${JSON.stringify(st.sample.slice(0, 6))})` };
  }
  const relaxNote = acc.relaxed ? ` [RELÂCHE: gate partagé refuse (${verdict.reason}) mais champ vérifié code-zone à ${(st.codeLikeRatio * 100).toFixed(0)}% — valeurs servies VERBATIM]` : "";

  if (args.probe) {
    return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): couche='#${layer.id} ${layer.name}' champ='${zoneField}' — ${raw.length} features, ${st.distinct} codes distincts, codeLike=${(st.codeLikeRatio * 100).toFixed(0)}%, sample=${JSON.stringify(st.sample.slice(0, 8))}${relaxNote}` };
  }

  const norm = normalize(raw, zoneField, base.sourceUrl);
  const distinctCodes = new Set<string>();
  for (const f of norm) { const c = f.properties.zone_code; if (typeof c === "string") distinctCodes.add(c); }
  base.featureCount = norm.length;
  base.distinctCodes = distinctCodes.size;

  // Gate spatial (features déjà en WGS84).
  if (muni) {
    const c = bboxCenter(norm);
    if (c.n > 0) {
      const distanceKm = haversineKm(muni.lat, muni.lon, c.lat, c.lon);
      base.distanceKm = distanceKm;
      if (distanceKm > Math.max(args.spatialKm, 35)) {
        return { ...base, status: "spatial-fail", detail: `spatial KO: features à ${distanceKm.toFixed(0)}km du centroïde registre` };
      }
    }
  }

  const nonNull = norm.filter((f) => f.properties.zone_code !== null).length;
  if (nonNull / norm.length < 0.5) return { ...base, status: "zone-invalid", detail: `couche '${layer.name}': zone_code null>50% — REJET` };

  const flatKey = `${S3_PREFIX}qc-zonage-${args.slug}.geojson`;
  const subKey = `${S3_PREFIX}qc-zonage-${args.slug}/qc-zonage-${args.slug}.geojson`;
  if (s3) base.wasServed = (await exists(s3, flatKey)) || (await exists(s3, subKey));

  const detail = `${norm.length} zones (${nonNull} avec zone_code, ${distinctCodes.size} distincts, champ '${zoneField}', codeLike=${(st.codeLikeRatio * 100).toFixed(0)}%) via ${base.sourceUrl}${relaxNote}`;
  if (args.deposit && s3) {
    const fc = attachGeometryProof(
      { type: "FeatureCollection" as const, features: norm },
      proofFromFetched({ url: base.sourceUrl!, type: "jmap", method: "natif", reliability: "directe", bytes: JSON.stringify(raw) }),
    );
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
    if (await exists(s3, subKey)) {
      const backup = `${S3_PREFIX}_replaced/qc-zonage-${args.slug}__subdir.${ts}.geojson`;
      await copyObject(s3, subKey, backup);
      await deleteObject(s3, subKey);
      console.error(`[jmap] ${args.slug}: ancienne variante sous-dossier sauvegardée → s3://${backup} + SUPPRIMÉE`);
    }
    await putServedZoneGeojson(s3, flatKey, fc);
    return { ...base, deposited: true, status: "deposited", detail: `${base.wasServed ? "[REMPLACE] " : "[NOUVEAU] "}${detail}` };
  }
  return { ...base, status: "deposited", deposited: false, detail: `PROBE OK (non déposé): ${detail}` };
}

// ── Main ──────────────────────────────────────────────────────────────────────
let CAPTURE: CaptureRun | null = null;
let CAPTURE_SLUG: string | null = null;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.base) {
    console.error("usage: --slug <slug> --base <https://host> [--project <id>] [--layer <id>] [--zone-field <F>] [--probe|--deposit]");
    process.exit(2);
  }

  const munis = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as MuniEntry[];
  const muni = munis.find((m) => m.slug === args.slug);
  const s3 = s3Client();
  CAPTURE_SLUG = args.slug;
  CAPTURE = openCaptureRun({ lane: "zones", s3 });

  console.error(`[jmap] slug=${args.slug} base=${args.base} project=${args.project ?? "auto"} mode=${args.probe ? "probe" : args.deposit ? "deposit" : "dry"}`);
  console.error(`[jmap] capture run=${CAPTURE.runId} manifest=s3://${CAPTURE.keys.manifest}`);
  CAPTURE.log(`[jmap] slug=${args.slug} base=${args.base} project=${args.project ?? "auto"} deposit=${args.deposit}`);
  let r: SlugResult;
  try { r = await processSlug(args, muni, s3); }
  catch (e) { r = { slug: args.slug, base: args.base, project: args.project ?? null, deposited: false, status: "error", detail: e instanceof Error ? e.message : String(e) }; }

  console.error(`\n=== ${r.status.toUpperCase()} ${args.slug}`);
  console.error(r.detail);
  if (r.layerCatalog && (args.probe || r.status !== "deposited")) {
    console.error(`\n--- CATALOGUE ${r.layerCatalog.length} couches ---`);
    for (const c of r.layerCatalog) console.error(`  #${c.id} [${c.geom ?? "?"}] ${c.name}  ::attrs=${c.attrs.join(",")}`);
  }

  const report = { generatedAt: new Date().toISOString(), ...r };
  const out = args.outFile ?? resolve(HERE, "../../work/delegation-mass/zones-jmap-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.error(`\nrapport → ${out}`);
}

async function closeCapture(exitCode: number): Promise<void> {
  if (!CAPTURE) return;
  try { await CAPTURE.finish(exitCode); }
  catch (e) { console.error(`[jmap] WARN clôture capture: ${e instanceof Error ? e.message : String(e)}`); }
}

main()
  .then(async () => { await closeCapture(typeof process.exitCode === "number" ? process.exitCode : 0); })
  .catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    await closeCapture(1);
    process.exit(1);
  });
