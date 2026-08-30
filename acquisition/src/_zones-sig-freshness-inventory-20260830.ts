/**
 * _zones-sig-freshness-inventory-20260830.ts — SONDE DIAGNOSTIC (lecture seule S3).
 *
 * INVENTAIRE PAR VILLE de la FRAÎCHEUR du SIG de zonage SERVI (géométrie + codes) :
 * le `retrieved_at` (instant de capture) de la géométrie servie là où il est
 * MESURABLE, plus tout signal de millésime/version embarqué dans les propriétés
 * servies ou l'URL source. Classe chaque muni MEASURED-FRESH / MEASURED-STALE
 * (périmé) / SOURCE-GAP (fraîcheur NON mesurable). Ne DÉPOSE / N'ÉCRIT RIEN sur S3.
 *
 * ⚠ ANTI-INVENTION : `retrieved_at` et tout millésime sont reportés VERBATIM depuis
 * la donnée servie. Là où la fraîcheur n'est pas directement mesurable (pas de
 * retrieved_at, level legacy/orphan/null) → **source-gap**, JAMAIS une date inventée.
 *
 * MÉTHODE (lecture seule S3) :
 *   1. LISTE + sélection des collections servies sous normalized/ca-qc-zonage/
 *      (autorité-layout niché-gagne — `selectServedZoneCollections`, même règle
 *      que les sondes _zones-layout-authority-scan / _zones-v2-upgrade-scoping).
 *   2. Pour CHAQUE muni servi :
 *      - HeadObject → content_length (taille = proxy d'échelle).
 *      - Lecture COMPLÈTE (getBytes) si taille ≤ FULL_CAP → feature_count exact
 *        (parseFeatureCollectionBuffer) + propriétés de la 1re feature (objet JSON)
 *        + preuve de collection (fenêtre de queue). Sinon (objet énorme) → range
 *        head+tail, feature_count = null (non compté, noté), signaux par regex.
 *      - Extraction : retrieved_at (feature-proof v2/v1 + collection-proof),
 *        zone_source_url / zone_source_level / geometry_grain / method,
 *        featureHasV2Proof, et signaux de millésime (clés date_maj/annee/version/…
 *        + année 2015-2026 dans l'URL) — verbatim.
 *   3. CLASSIFIE : MEASURED-FRESH (retrieved_at récent), MEASURED-STALE/périmé
 *      (retrieved_at ≥ STALE_MONTHS), SOURCE-GAP (pas de retrieved_at → fraîcheur
 *      non mesurable). Numéros MESURÉS, un objet illisible est noté, jamais deviné.
 *
 * USAGE (lecture seule) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-sig-freshness-inventory-20260830.ts
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-sig-freshness-inventory-20260830.json
 *   work/coverage/zones-sig-freshness-inventory-20260830.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  s3Client,
  s3Target,
  listObjectEntries,
  objectHead,
  getBytes,
  parseFeatureCollectionBuffer,
} from "./lib/s3.js";
import { selectServedZoneCollections, SERVED_ZONE_PREFIX } from "./lib/zone-provenance-quality.js";
import { featureHasV2Proof, isRealGeometryUrl } from "./lib/zonage-proof.js";

const OUT_JSON = "work/coverage/zones-sig-freshness-inventory-20260830.json";
const OUT_MD = "work/coverage/zones-sig-freshness-inventory-20260830.md";

const TODAY = new Date("2026-08-30T00:00:00Z");
/** Heuristique préliminaire (le seuil périmé FINAL dépend de la déf. geo-archi §3).
 *  ~18-24 mois demandés ; on retient 18 mois pour le flag, l'âge exact est reporté
 *  pour re-tuner sans re-scanner. */
const STALE_MONTHS = 18;

const FULL_CAP = 120 * 1024 * 1024; // au-delà : range-read seul, feature_count non compté
const HEAD_WINDOW = 512 * 1024;
const TAIL_WINDOW = 256 * 1024;
const CONC = 8;

/** Municipalités citées par geo-archi comme périmées — à vérifier explicitement. */
const GEOARCHI_CITED = ["repentigny", "beaupre", "mont-tremblant"];

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

const target = s3Target();
const s3 = s3Client();

async function rangeBytes(key: string, start: number, end: number): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: target.bucket, Key: key, Range: `bytes=${start}-${end}` }));
  const body = r.Body as AsyncIterable<Buffer>;
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function monthsBetween(fromIso: string): number | null {
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  const from = new Date(t);
  const months = (TODAY.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (TODAY.getUTCMonth() - from.getUTCMonth())
    + (TODAY.getUTCDate() >= from.getUTCDate() ? 0 : -1);
  return months;
}

/** Année (2015-2026) présente dans une chaîne — pour l'URL source. Déclarées distinctes. */
function yearsIn(value: string): string[] {
  const out = new Set<string>();
  for (const m of value.matchAll(/\b(20(?:1[5-9]|2[0-6]))\b/g)) out.add(m[1]!);
  return [...out].sort();
}

/**
 * Marqueur AMONT de couche SUPERSÉDÉE/périmée dans l'URL source : quand la couche
 * fetchée est elle-même l'ANCIEN zonage (ex. mont-tremblant sert
 * `.../Ancien_zonage/FeatureServer/1`), le retrieved_at est frais (capture récente)
 * mais la DONNÉE amont est périmée. C'est l'axe périmé de geo-archi, distinct de la
 * fraîcheur de capture. Conservateur : on ne matche que des marqueurs explicites.
 */
// NB: "archive" est volontairement EXCLU — il matchait web.archive.org (miroir de
// capture Wayback d'un PDF), un faux positif : c'est un enjeu de LIVENESS de la
// source, pas de vintage périmé. On ne garde que des marqueurs de couche AMONT
// explicitement ancienne/superseded.
const STALE_URL_MARKER_RE = /(ancien|abrog|perim|obsolet|supersed|retir[ée]|\bold[_-]?zon|zon[_-]?old)/i;
function staleUrlMarker(url: string): string | null {
  const m = STALE_URL_MARKER_RE.exec(url);
  return m ? m[1]! : null;
}
/** Source servie depuis un miroir Wayback (source d'origine possiblement disparue) —
 *  enjeu de LIVENESS, reporté séparément du périmé-vintage. */
function isWaybackSource(url: string): boolean {
  return /(^|\/\/)web\.archive\.org\//i.test(url);
}

/** Vrai si la clé (normalisée) ressemble à un signal de millésime/version/date. */
const MILLESIME_KEY_RE = /(millesime|datemaj|date_maj|date_mise|maj_date|last_?update|annee|adoption|vigueur|date_saisie|dt_maj|date_creation|date_revision|revision|version|^date$|^annee$|^year$|_date$|date_)/;
function normKey(k: string): string {
  return k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
/** Clés de provenance/preuve à NE PAS traiter comme millésime source (ce sont des champs système). */
const EXCLUDE_MILLESIME = new Set([
  "zone_source_url", "zone_source_level", "geometry_grain", "retrieved_at", "proof",
]);

interface MillesimeSignal { key: string; value: unknown }

/** Extrait les signaux de millésime des propriétés (objet) de la 1re feature. */
function millesimeFromProps(props: Record<string, unknown>): MillesimeSignal[] {
  const out: MillesimeSignal[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (EXCLUDE_MILLESIME.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    const nk = normKey(k);
    const isDateKey = MILLESIME_KEY_RE.test(nk);
    // Valeur qui ressemble à une date ISO ou à une année isolée.
    const sv = String(v);
    const looksIsoDate = /^\d{4}-\d{2}-\d{2}/.test(sv);
    const looksYear = /^(20(?:1[5-9]|2[0-6]))$/.test(sv.trim());
    if (isDateKey || looksIsoDate || (looksYear && /(annee|year|maj|date|millesime|version)/.test(nk))) {
      out.push({ key: k, value: v });
    }
  }
  return out;
}

/** Regex de secours (objets énormes, range-only) — extrait les mêmes signaux d'une fenêtre texte. */
function signalsFromHeadText(s: string): {
  zone_source_url: string | null | undefined;
  zone_source_level: string | null | undefined;
  geometry_grain: string | null | undefined;
  method: string | null | undefined;
  feature_retrieved_at: string | null;
  has_v2_proof: boolean;
} {
  const mU = /"zone_source_url"\s*:\s*(null|"([^"]*)")/.exec(s);
  const mL = /"zone_source_level"\s*:\s*(null|"([^"]*)")/.exec(s);
  const mG = /"geometry_grain"\s*:\s*(null|"([^"]*)")/.exec(s);
  const mM = /"method"\s*:\s*"(natif|georeference)"/.exec(s);
  const mR = /"retrieved_at"\s*:\s*"([^"]+)"/.exec(s);
  const v2 = /"geometry_source"\s*:\s*\{[^}]*"sha256"\s*:\s*"sha256:[a-f0-9]{64}"/.test(s)
    || (/"schema_version"\s*:\s*"2\.0"/.test(s) && /"geometry_source"/.test(s));
  return {
    zone_source_url: mU ? (mU[1] === "null" ? null : mU[2]!) : undefined,
    zone_source_level: mL ? (mL[1] === "null" ? null : mL[2]!) : undefined,
    geometry_grain: mG ? (mG[1] === "null" ? null : mG[2]!) : undefined,
    method: mM ? mM[1]! : undefined,
    feature_retrieved_at: mR ? mR[1]! : null,
    has_v2_proof: v2,
  };
}

/** Preuve de COLLECTION (top-level) depuis la fenêtre de queue : la dernière
 *  occurrence de chaque champ appartient au bloc `proof` terminal du fichier. */
function collectionProofFromTail(tail: string): {
  coll_retrieved_at: string | null;
  coll_method: string | null;
  coll_schema_version: string | null;
  coll_sha256_present: boolean;
  coll_url: string | null;
} {
  const last = (re: RegExp): string | null => {
    let m: RegExpExecArray | null;
    let val: string | null = null;
    const g = new RegExp(re.source, "g");
    while ((m = g.exec(tail)) !== null) val = m[1]!;
    return val;
  };
  return {
    coll_retrieved_at: last(/"retrieved_at"\s*:\s*"([^"]+)"/),
    coll_method: last(/"method"\s*:\s*"(natif|georeference)"/),
    coll_schema_version: last(/"schema_version"\s*:\s*"([^"]+)"/),
    coll_sha256_present: /"sha256"\s*:\s*"sha256:[a-f0-9]{64}"/.test(tail),
    coll_url: last(/"url"\s*:\s*"([^"]+)"/),
  };
}

type FreshnessClass = "MEASURED-FRESH" | "MEASURED-STALE" | "SOURCE-GAP" | "READ-ERROR";
type PerimeFlag = "yes" | "no" | "unknown";

interface Row {
  slug: string;
  key: string;
  layout: "flat" | "nested";
  content_length_bytes: number | null;
  feature_count: number | null;
  retrieved_at: string | null;
  retrieved_at_source: "feature-proof" | "collection-proof" | null;
  retrieved_at_age_months: number | null;
  zone_source_level: string | null;
  zone_source_url: string | null;
  method: string | null;
  geometry_grain: string | null;
  feature_has_v2_proof: boolean;
  collection_proof_schema: string | null;
  source_millesime: MillesimeSignal[] | null;
  source_vintage_years: string[] | null;
  source_url_years: string[] | null;
  source_url_stale_marker: string | null;
  /** Enjeu de LIVENESS (distinct du périmé-vintage) : source servie depuis un miroir Wayback. */
  source_wayback: boolean;
  /** Axe DISTINCT de la fraîcheur de capture : la donnée AMONT servie est-elle
   *  périmée/superseded (marqueur explicite dans l'URL source) ? */
  source_perime_suspect: "yes" | "no";
  source_perime_basis: string | null;
  freshness_class: FreshnessClass;
  perime_flag: PerimeFlag;
  notes: string;
  read_error: string | null;
}

interface Feat { properties?: Record<string, unknown> | null }

async function inventoryOne(item: { slug: string; key: string; layout: "flat" | "nested" }): Promise<Row> {
  const row: Row = {
    slug: item.slug, key: item.key, layout: item.layout,
    content_length_bytes: null, feature_count: null,
    retrieved_at: null, retrieved_at_source: null, retrieved_at_age_months: null,
    zone_source_level: null, zone_source_url: null, method: null, geometry_grain: null,
    feature_has_v2_proof: false, collection_proof_schema: null,
    source_millesime: null, source_vintage_years: null, source_url_years: null,
    source_url_stale_marker: null, source_wayback: false, source_perime_suspect: "no", source_perime_basis: null,
    freshness_class: "SOURCE-GAP", perime_flag: "unknown", notes: "", read_error: null,
  };
  try {
    const head = await objectHead(s3, item.key);
    const len = head.contentLength ?? null;
    row.content_length_bytes = len;

    let firstProps: Record<string, unknown> | null = null;
    let headSignals: ReturnType<typeof signalsFromHeadText> | null = null;
    let tailText = "";
    const notes: string[] = [];

    if (len !== null && len > FULL_CAP) {
      // Objet énorme : range head + tail seulement, feature_count non compté.
      const headBuf = await rangeBytes(item.key, 0, HEAD_WINDOW - 1);
      const tailBuf = await rangeBytes(item.key, Math.max(0, len - TAIL_WINDOW), len - 1);
      headSignals = signalsFromHeadText(headBuf.toString("utf8"));
      tailText = tailBuf.toString("utf8");
      notes.push(`large-object ${len}B > FULL_CAP: feature_count non compté, signaux par regex head/tail`);
    } else {
      // Lecture complète : feature_count exact + 1re feature comme objet JSON.
      const buf = await getBytes(s3, item.key);
      const parsed = parseFeatureCollectionBuffer<Feat>(buf, item.key);
      row.feature_count = parsed.features.length;
      firstProps = parsed.features[0]?.properties ?? {};
      const tailStart = Math.max(0, buf.length - TAIL_WINDOW);
      tailText = buf.subarray(tailStart).toString("utf8");
    }

    // Signaux niveau-feature (objet JSON préféré, sinon regex).
    let zsu: string | null | undefined;
    let zsl: string | null | undefined;
    let grain: string | null | undefined;
    let featMethod: string | null | undefined;
    let featRetrieved: string | null = null;
    let hasV2 = false;

    if (firstProps) {
      zsu = firstProps["zone_source_url"] as string | null | undefined;
      zsl = firstProps["zone_source_level"] as string | null | undefined;
      grain = firstProps["geometry_grain"] as string | null | undefined;
      hasV2 = featureHasV2Proof({ properties: firstProps });
      const proof = firstProps["proof"] as
        | { schema_version?: unknown; geometry_source?: { retrieved_at?: unknown; method?: unknown }; sources?: { geometry?: { retrieved_at?: unknown; method?: unknown } } }
        | null | undefined;
      const gs = proof?.geometry_source;
      const v1g = proof?.sources?.geometry;
      const fr = (typeof gs?.retrieved_at === "string" && gs.retrieved_at)
        || (typeof v1g?.retrieved_at === "string" && v1g.retrieved_at) || null;
      featRetrieved = fr && ISO_RE.test(fr) ? fr : (typeof fr === "string" ? fr : null);
      featMethod = (typeof gs?.method === "string" ? gs.method : undefined)
        ?? (typeof v1g?.method === "string" ? v1g.method : undefined);
      row.source_millesime = (() => { const s = millesimeFromProps(firstProps); return s.length ? s : null; })();
    } else if (headSignals) {
      zsu = headSignals.zone_source_url;
      zsl = headSignals.zone_source_level;
      grain = headSignals.geometry_grain;
      featMethod = headSignals.method;
      featRetrieved = headSignals.feature_retrieved_at;
      hasV2 = headSignals.has_v2_proof;
      if (zsu === undefined) notes.push("zone_source_url non trouvé dans la fenêtre head (1re feature à géométrie volumineuse ?)");
    }

    const coll = collectionProofFromTail(tailText);

    row.zone_source_url = zsu === undefined ? null : zsu;
    row.zone_source_level = zsl === undefined ? null : zsl;
    row.geometry_grain = grain === undefined ? null : grain;
    row.method = (featMethod ?? coll.coll_method) ?? null;
    row.feature_has_v2_proof = hasV2;
    row.collection_proof_schema = coll.coll_schema_version;

    // retrieved_at effectif : feature-proof d'abord, sinon collection-proof.
    if (featRetrieved) {
      row.retrieved_at = featRetrieved;
      row.retrieved_at_source = "feature-proof";
    } else if (coll.coll_retrieved_at) {
      row.retrieved_at = coll.coll_retrieved_at;
      row.retrieved_at_source = "collection-proof";
    }

    // Années embarquées dans l'URL source (verbatim, signal faible — jamais une date de capture).
    if (typeof row.zone_source_url === "string") {
      const ys = yearsIn(row.zone_source_url);
      if (ys.length) row.source_url_years = ys;
      row.source_url_stale_marker = staleUrlMarker(row.zone_source_url);
      row.source_wayback = isWaybackSource(row.zone_source_url);
    }
    // Années de millésime issues des propriétés (verbatim) — vintage de la donnée amont.
    if (row.source_millesime) {
      const vy = new Set<string>();
      for (const m of row.source_millesime) {
        for (const y of yearsIn(String(m.value))) vy.add(y);
      }
      if (vy.size) row.source_vintage_years = [...vy].sort();
    }
    // AXE AMONT (distinct de la capture) : la couche source elle-même est-elle superseded ?
    // Base HAUTE-CONFIANCE = marqueur explicite "ancien/old/…" dans l'URL source.
    if (row.source_url_stale_marker) {
      row.source_perime_suspect = "yes";
      row.source_perime_basis = `zone_source_url marque une couche amont périmée/superseded ("${row.source_url_stale_marker}")` +
        `${row.source_vintage_years ? `; millésime propriété ${row.source_vintage_years.join(",")}` : ""}`;
    }

    // ── CLASSIFICATION ──
    if (row.retrieved_at && ISO_RE.test(row.retrieved_at)) {
      const age = monthsBetween(row.retrieved_at);
      row.retrieved_at_age_months = age;
      if (age !== null && age >= STALE_MONTHS) {
        row.freshness_class = "MEASURED-STALE";
        row.perime_flag = "yes";
        notes.push(`retrieved_at=${row.retrieved_at} (${age} mois ≥ ${STALE_MONTHS}) → périmé`);
      } else {
        row.freshness_class = "MEASURED-FRESH";
        row.perime_flag = "no";
        notes.push(`retrieved_at=${row.retrieved_at} (${age ?? "?"} mois < ${STALE_MONTHS})`);
      }
    } else if (row.retrieved_at) {
      // retrieved_at présent mais non-ISO (verbatim conservé) — non datable de façon fiable.
      row.freshness_class = "SOURCE-GAP";
      row.perime_flag = "unknown";
      notes.push(`retrieved_at=${row.retrieved_at} non-ISO → non datable, fraîcheur non mesurable`);
    } else {
      row.freshness_class = "SOURCE-GAP";
      row.perime_flag = "unknown";
      const hints: string[] = [];
      if (row.source_millesime) hints.push(`millésime propriété: ${row.source_millesime.map((m) => `${m.key}=${JSON.stringify(m.value)}`).join(", ")}`);
      if (row.source_url_years) hints.push(`année(s) dans l'URL: ${row.source_url_years.join(",")}`);
      notes.push(`aucun retrieved_at (level=${row.zone_source_level ?? "∅"}) → fraîcheur NON mesurable${hints.length ? `; indice: ${hints.join("; ")}` : ""}`);
    }
    if (row.source_perime_suspect === "yes") {
      notes.push(`⚠ SOURCE-PÉRIMÉ-SUSPECT (axe amont, distinct de la capture): ${row.source_perime_basis}`);
    } else if (row.source_vintage_years) {
      notes.push(`millésime amont (informatif, ≠ preuve de péremption): ${row.source_vintage_years.join(",")}`);
    }
    row.notes = notes.join(" | ");
    return row;
  } catch (e) {
    row.read_error = e instanceof Error ? e.message : String(e);
    row.freshness_class = "READ-ERROR";
    row.perime_flag = "unknown";
    row.notes = `read error: ${row.read_error}`;
    return row;
  }
}

async function main(): Promise<void> {
  requireS3();
  process.stdout.write("[list] énumération des collections servies…\n");
  const listed = await listObjectEntries(s3, SERVED_ZONE_PREFIX);
  const selected = selectServedZoneCollections(listed.map((o) => o.key));
  process.stdout.write(`[list] collections servies sélectionnées (niché-gagne): ${selected.length}\n`);

  const rows: Row[] = [];
  const queue = [...selected];
  let done = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const row = await inventoryOne({ slug: item.slug, key: item.key, layout: item.layout });
      rows.push(row);
      if (++done % 50 === 0) process.stdout.write(`  [inv ${done}/${selected.length}]\n`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  rows.sort((a, b) => a.slug.localeCompare(b.slug));

  // ── Comptes de synthèse ──
  const byClass: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  let measurable = 0;
  let readErrors = 0;
  let sourcePerimeSuspects = 0;
  let waybackSources = 0;
  for (const r of rows) {
    byClass[r.freshness_class] = (byClass[r.freshness_class] ?? 0) + 1;
    const lv = r.zone_source_level ?? "(absent/null)";
    byLevel[lv] = (byLevel[lv] ?? 0) + 1;
    const mt = r.method ?? "(aucun)";
    byMethod[mt] = (byMethod[mt] ?? 0) + 1;
    if (r.retrieved_at && ISO_RE.test(r.retrieved_at)) measurable++;
    if (r.read_error) readErrors++;
    if (r.source_perime_suspect === "yes") sourcePerimeSuspects++;
    if (r.source_wayback) waybackSources++;
  }
  const sourcePerimeRows = rows.filter((r) => r.source_perime_suspect === "yes");

  // Cross-tab classe × level : montre que "documented/historical-verified" ne garantit
  // PAS un retrieved_at mesurable (level stampé additivement sans capture v2).
  const crossClassLevel: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const lv = r.zone_source_level ?? "(absent/null)";
    (crossClassLevel[lv] ??= {})[r.freshness_class] = (crossClassLevel[lv]?.[r.freshness_class] ?? 0) + 1;
  }

  // ── Worklist pré-scopée (STALE + SOURCE-GAP), tri par staleness/sévérité de provenance ──
  const levelSeverity = (lv: string | null): number => {
    switch (lv) {
      case null: case undefined: return 0;              // pas de level → pire
      case "orphan": return 1;
      case "unknown": return 2;
      case "candidate": return 3;
      case "legacy-traceable": return 4;
      case "documented": return 5;
      case "historical-verified": return 6;
      default: return 3;
    }
  };
  // Rang de candidature au re-source : 0 = capture périmée (le pire), 1 = capture
  // fraîche mais SOURCE amont superseded (ex. mont-tremblant "Ancien_zonage"),
  // 2 = source-gap (fraîcheur non mesurable).
  const candidateRank = (r: Row): number | null => {
    if (r.freshness_class === "MEASURED-STALE") return 0;
    if (r.source_perime_suspect === "yes") return 1;
    if (r.freshness_class === "SOURCE-GAP") return 2;
    return null; // MEASURED-FRESH sans marqueur amont → pas candidat
  };
  const worklist = rows
    .filter((r) => candidateRank(r) !== null)
    .sort((a, b) => {
      const ra = candidateRank(a)!;
      const rb = candidateRank(b)!;
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (b.retrieved_at_age_months ?? 0) - (a.retrieved_at_age_months ?? 0); // plus vieux d'abord
      if (ra === 1) return a.slug.localeCompare(b.slug);
      // source-gap : provenance la moins prouvée d'abord, puis alpha.
      const sev = levelSeverity(a.zone_source_level) - levelSeverity(b.zone_source_level);
      if (sev !== 0) return sev;
      return a.slug.localeCompare(b.slug);
    })
    .map((r) => ({
      slug: r.slug,
      candidate_reason: candidateRank(r) === 0 ? "capture-stale" : candidateRank(r) === 1 ? "source-perime-suspect" : "source-gap",
      freshness_class: r.freshness_class, perime_flag: r.perime_flag,
      source_perime_suspect: r.source_perime_suspect, source_perime_basis: r.source_perime_basis,
      source_url_stale_marker: r.source_url_stale_marker,
      retrieved_at: r.retrieved_at, age_months: r.retrieved_at_age_months,
      zone_source_level: r.zone_source_level, zone_source_url: r.zone_source_url,
      source_millesime: r.source_millesime, source_vintage_years: r.source_vintage_years, source_url_years: r.source_url_years,
    }));

  const citedRows = GEOARCHI_CITED.map((slug) => rows.find((r) => r.slug === slug) ?? { slug, missing: true });

  const report = {
    contract: "zones-sig-freshness-inventory/diagnostic",
    generated_at_utc: new Date().toISOString(),
    read_only: true,
    s3_bucket: target.bucket,
    s3_endpoint: target.endpoint,
    served_prefix: SERVED_ZONE_PREFIX,
    today: TODAY.toISOString().slice(0, 10),
    stale_months_heuristic: STALE_MONTHS,
    method_note:
      "retrieved_at extrait VERBATIM de la preuve v2/v1 (feature puis collection). Fraîcheur non mesurable (pas de retrieved_at) → SOURCE-GAP, aucune date inventée. Seuil périmé PRÉLIMINAIRE (18 mois) — âge exact reporté, re-tunable sans re-scan.",
    totals: {
      served_collections_selected: selected.length,
      inventoried: rows.length,
      read_errors: readErrors,
      measurable_retrieved_at: measurable,
      not_measurable_source_gap: rows.length - measurable - readErrors,
      source_perime_suspects: sourcePerimeSuspects,
      wayback_mirror_sources: waybackSources,
    },
    axis_note:
      "DEUX axes distincts. (1) FRAÎCHEUR DE CAPTURE = retrieved_at (quand la géométrie a été fetchée). (2) VINTAGE AMONT = âge de la donnée source elle-même. Un retrieved_at frais sur une couche amont périmée (ex. mont-tremblant servi depuis .../Ancien_zonage, règlement 2008) reste MEASURED-FRESH en capture mais SOURCE-PÉRIMÉ-SUSPECT en vintage. Le vintage amont n'est mesurable que par un marqueur explicite (URL 'ancien/old/…' ou millésime propriété) — sinon non mesurable, jamais inventé.",
    by_freshness_class: byClass,
    by_zone_source_level: byLevel,
    by_method: byMethod,
    cross_class_by_level: crossClassLevel,
    source_perime_suspects: {
      count: sourcePerimeSuspects,
      note: "Capture fraîche MAIS couche amont marquée superseded/ancienne dans zone_source_url. Axe périmé de geo-archi §3, distinct de la fraîcheur de capture.",
      items: sourcePerimeRows.map((r) => ({
        slug: r.slug, retrieved_at: r.retrieved_at, zone_source_level: r.zone_source_level,
        zone_source_url: r.zone_source_url, source_url_stale_marker: r.source_url_stale_marker,
        source_vintage_years: r.source_vintage_years, source_perime_basis: r.source_perime_basis,
      })),
    },
    geoarchi_cited_perimes: citedRows,
    resource_worklist_prescoped: {
      count: worklist.length,
      note: "Candidats au re-source OWNER-GATED (pas maintenant). Rang: 0=capture-stale (plus vieux d'abord), 1=source-perime-suspect (capture fraîche mais couche amont superseded), 2=source-gap (fraîcheur non mesurable, provenance la moins prouvée d'abord). Impact lot-count = externe (non calculé ici).",
      items: worklist,
    },
    rows,
  };

  mkdirSync("work/coverage", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

  // ── Companion .md ──
  const staleRows = rows.filter((r) => r.freshness_class === "MEASURED-STALE");
  const freshRows = rows.filter((r) => r.freshness_class === "MEASURED-FRESH");
  const fmtCited = citedRows.map((c) => {
    const r = c as Row & { missing?: boolean };
    if (r.missing) return `- **${r.slug}** : ABSENT du servi (pas de collection sélectionnée)`;
    return `- **${r.slug}** : capture=${r.freshness_class} (retrieved_at=${r.retrieved_at ?? "∅ source-gap"}` +
      `${r.retrieved_at_age_months !== null ? `, ${r.retrieved_at_age_months} mois` : ""}), level=${r.zone_source_level ?? "∅"}, method=${r.method ?? "∅"}` +
      `, **source-périmé-suspect=${r.source_perime_suspect}**${r.source_perime_basis ? ` (${r.source_perime_basis})` : ""}` +
      `${r.source_millesime ? `; millésime propriété: ${r.source_millesime.map((m) => `${m.key}=${JSON.stringify(m.value)}`).join(", ")}` : ""}` +
      `; zone_source_url=\`${r.zone_source_url ?? "∅"}\``;
  }).join("\n");

  const perimeSection = sourcePerimeRows.length
    ? sourcePerimeRows.sort((a, b) => a.slug.localeCompare(b.slug)).map((r) =>
        `- **${r.slug}** : marqueur=\`${r.source_url_stale_marker}\`${r.source_vintage_years ? `, millésime=${r.source_vintage_years.join(",")}` : ""}, retrieved_at=${r.retrieved_at ?? "∅"} (capture ${r.freshness_class}), url=\`${r.zone_source_url ?? "∅"}\``,
      ).join("\n")
    : "_(aucun marqueur amont explicite détecté)_";

  const staleTable = staleRows
    .sort((a, b) => (b.retrieved_at_age_months ?? 0) - (a.retrieved_at_age_months ?? 0))
    .map((r) => `| ${r.slug} | ${r.retrieved_at ?? ""} | ${r.retrieved_at_age_months ?? ""} | ${r.zone_source_level ?? "∅"} | ${r.method ?? "∅"} |`)
    .join("\n");

  const md = `# Inventaire fraîcheur SIG zonage servi — ${TODAY.toISOString().slice(0, 10)} (lecture seule)

Feed de l'axe §3 « zone-SIG-freshness » de geo-archi (fiabilité par priorité owner)
+ pré-scope de la worklist re-source (le re-source réel est OWNER-GATED, PAS maintenant).

## ⚠ Deux axes DISTINCTS (à ne pas confondre)

1. **Fraîcheur de CAPTURE** = \`retrieved_at\` : quand la géométrie a été fetchée.
   Mesurable seulement si une preuve v2/v1 porte un \`retrieved_at\`.
2. **Vintage AMONT** = âge de la donnée source elle-même. Un \`retrieved_at\` FRAIS sur
   une couche amont périmée reste **MEASURED-FRESH en capture** mais
   **SOURCE-PÉRIMÉ-SUSPECT en vintage** — c'est le cas de **mont-tremblant** (servi
   depuis \`.../Ancien_zonage/…\`, règlement 2008). Le vintage amont n'est mesurable que
   par un marqueur EXPLICITE (URL "ancien/old/…" ou millésime propriété) ; sinon non
   mesurable, jamais inventé.

## Méthode & anti-invention

- \`retrieved_at\` extrait **verbatim** de la preuve géométrique servie (feature-proof
  v2/v1 d'abord, puis collection-proof). **Aucune date inventée.**
- Fraîcheur **non mesurable** (pas de \`retrieved_at\`) → **SOURCE-GAP**, jamais un périmé
  affirmé sans base.
- Seuil périmé **préliminaire** : retrieved_at ≥ **${STALE_MONTHS} mois** (aujourd'hui
  ${TODAY.toISOString().slice(0, 10)}). L'âge exact est reporté → re-tunable quand geo-archi fixe le seuil.
- Autorité-layout : niché-gagne (\`selectServedZoneCollections\`), même règle que les sondes voisines.

## Totaux (S3, lecture seule)

- collections servies sélectionnées : **${selected.length}**
- inventoriées : **${rows.length}** (erreurs de lecture : ${readErrors})
- **retrieved_at MESURABLE : ${measurable}** / ${rows.length}
- **fraîcheur NON mesurable (SOURCE-GAP) : ${rows.length - measurable - readErrors}**
- **source-périmé-suspects (vintage amont, axe distinct) : ${sourcePerimeSuspects}**
- sources servies depuis un miroir Wayback (enjeu de liveness, ≠ périmé) : ${waybackSources}

## Comptes par classe de fraîcheur

${Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- **${k}** : ${v}`).join("\n")}

## Par \`zone_source_level\`

${Object.entries(byLevel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k} : ${v}`).join("\n")}

## Par \`method\`

${Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k} : ${v}`).join("\n")}

## Cross-tab classe × \`zone_source_level\`

Un level \`documented\`/\`historical-verified\` ne garantit PAS un \`retrieved_at\` mesurable :
le level a pu être stampé additivement sans capture v2.

| level | MEASURED-FRESH | SOURCE-GAP |
|-------|----------------|------------|
${Object.entries(crossClassLevel).sort((a, b) => (b[1]["MEASURED-FRESH"] ?? 0) - (a[1]["MEASURED-FRESH"] ?? 0)).map(([lv, m]) => `| ${lv} | ${m["MEASURED-FRESH"] ?? 0} | ${m["SOURCE-GAP"] ?? 0} |`).join("\n")}

## Périmés cités par geo-archi (vérif explicite)

${fmtCited}

## SOURCE-PÉRIMÉ-SUSPECT (vintage amont — axe distinct de la capture) — ${sourcePerimeSuspects}

Capture fraîche mais couche source marquée superseded/ancienne dans \`zone_source_url\`.

${perimeSection}

## MEASURED-STALE (capture périmée) — retrieved_at ≥ ${STALE_MONTHS} mois

${staleRows.length ? `| slug | retrieved_at | âge (mois) | level | method |
|------|-------------|-----------|-------|--------|
${staleTable}` : "_(aucun muni avec un retrieved_at mesurable au-delà du seuil)_"}

## MEASURED-FRESH — retrieved_at < ${STALE_MONTHS} mois

${freshRows.length ? freshRows.sort((a, b) => (a.retrieved_at_age_months ?? 0) - (b.retrieved_at_age_months ?? 0)).map((r) => `- ${r.slug} : ${r.retrieved_at} (${r.retrieved_at_age_months} mois), level=${r.zone_source_level ?? "∅"}, method=${r.method ?? "∅"}`).join("\n") : "_(aucun)_"}

## Worklist re-source pré-scopée (OWNER-GATED — pas maintenant)

STALE + SOURCE-GAP = ${worklist.length} candidats. Tri : STALE le plus vieux d'abord,
puis SOURCE-GAP par provenance la moins prouvée. **Impact lot-count = externe.**
Top 40 :

${worklist.slice(0, 40).map((w, i) => `${i + 1}. ${w.slug} — ${w.candidate_reason}${w.retrieved_at ? ` (retrieved_at=${w.retrieved_at}, ${w.age_months} mois)` : ""}, level=${w.zone_source_level ?? "∅"}${w.source_url_stale_marker ? `, marqueur="${w.source_url_stale_marker}"` : ""}`).join("\n")}

${worklist.length > 40 ? `\n_(+ ${worklist.length - 40} autres — voir le JSON.)_\n` : ""}
Liste complète : \`${OUT_JSON}\` → \`resource_worklist_prescoped.items\`.

## Erreurs de lecture

${readErrors ? rows.filter((r) => r.read_error).map((r) => `- ${r.slug}: ${r.read_error}`).join("\n") : "aucune."}
`;
  writeFileSync(OUT_MD, md);

  process.stdout.write(`\n[done] inventoriées=${rows.length} mesurable_retrieved_at=${measurable} read_errors=${readErrors}\n`);
  process.stdout.write(`[done] classes: ${JSON.stringify(byClass)}\n`);
  process.stdout.write(`[done] levels: ${JSON.stringify(byLevel)}\n`);
  process.stdout.write(`[done] source_perime_suspects (vintage amont)=${sourcePerimeSuspects}: ${sourcePerimeRows.map((r) => r.slug).join(", ") || "(none)"} | wayback_sources=${waybackSources}\n`);
  process.stdout.write(`[done] worklist_candidats=${worklist.length}\n`);
  for (const c of citedRows) {
    const r = c as Row & { missing?: boolean };
    if (r.missing) { process.stdout.write(`[cited] ${r.slug}: ABSENT du servi\n`); continue; }
    process.stdout.write(`[cited] ${r.slug}: ${r.freshness_class} perime=${r.perime_flag} retrieved_at=${r.retrieved_at ?? "∅"} age=${r.retrieved_at_age_months ?? "∅"} level=${r.zone_source_level ?? "∅"}\n`);
  }
  process.stdout.write(`[done] wrote ${OUT_JSON} + ${OUT_MD}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
