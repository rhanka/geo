/**
 * _zones-unzonable-absence-attestation-20260830.ts — SONDE DIAGNOSTIC (lecture seule).
 *
 * ATTESTATION D'ABSENCE REJOUABLE pour 14 municipalités "candidat-un-zonable"
 * (routées par une HEURISTIQUE géographique, aujourd'hui toutes UNKNOWN/source-gap,
 * NOT-N-A). Le but : promouvoir UNKNOWN → **N-A-PROVEN uniquement là où il existe
 * une preuve POSITIVE, autoritative et rejouable** que l'entité N'EST PAS une
 * municipalité locale capable de zonage (TNO, gouvernement régional, entité de
 * niveau MRC/régional, ou absence du répertoire municipal autoritatif comme
 * municipalité locale). Partout ailleurs → reste UNKNOWN/source-gap.
 *
 * ⚠ CONTRAT ANTI-INVENTION (crown-jewel discipline — i-arch CONTRAT_ATTESTATION_ABSENCE_SOURCE) :
 *   - Absence-de-preuve ≠ preuve-d'absence. "Aucune grille trouvée dans les sources
 *     vérifiées" n'est JAMAIS N-A → reste UNKNOWN/source-gap.
 *   - N-A-PROVEN exige une preuve POSITIVE autoritative : le type/désignation
 *     VERBATIM du registre autoritatif (MAMH Répertoire) montrant que l'entité
 *     n'est pas une municipalité locale de zonage.
 *   - Une vraie municipalité locale (Ville / Municipalité avec désignation + conseil)
 *     → l'absence de grille est un **source-gap**, JAMAIS N-A.
 *   - verbatim-or-null : jamais un type, une date ou un N-A fabriqué.
 *
 * MÉTHODE (aucune capture, aucun scraping ; lecture seule) :
 *   1. PREUVE PRIMAIRE (porteuse) — registre autoritatif committé, sans réseau :
 *      MAMH Répertoire des municipalités du Québec
 *      (packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json).
 *      Lecture VERBATIM du champ `designation` (Ville, Municipalité, Paroisse,
 *      Canton, Territoire non organisé, Gouvernement régional, …) + mamhCode +
 *      mamhName + snapshot (generatedAt + entry.verifiedAt).
 *   2. RECOUPEMENT (découpage administratif MRNF SDA), committé, sans réseau :
 *      data/normalized/ca-qc-sda/qc-municipalites.geojson — match par code
 *      géographique (MUS_CO_GEO == mamhCode) sinon par nom normalisé ; report
 *      VERBATIM de MUS_NM_MRC / MUS_CO_DES / MUS_NM_REG + fetchedAt du snapshot.
 *   3. EMPREINTE SERVIE (signal SECONDAIRE), lecture seule S3, best-effort :
 *      HEAD sur qc-lots-<slug> et qc-zonage-<slug> (layouts plat + niché). Un
 *      qc-lots servi (parcelles cadastrales) renforce "vraie muni habitée ⇒
 *      source-gap". Si S3 non configuré/injoignable → axe = "unknown" (JAMAIS
 *      bloquant, JAMAIS deviné). La classification NE DÉPEND PAS de cet axe.
 *
 * CLASSIFICATION (dérivée UNIQUEMENT de la preuve primaire) :
 *   - N-A-PROVEN  ssi designation ∈ {Territoire non organisé, Gouvernement régional}
 *                 (preuve positive : pas une municipalité locale de zonage).
 *   - UNKNOWN-source-gap  sinon (vraie municipalité/ville locale ⇒ absence de
 *                 grille non prouvable en lecture seule ; OU designation absente).
 *
 * FAIL-LOUD : toute des 14 slugs absente du répertoire, ou partition qui ne ferme
 * pas à 14, fait échouer le run (exit 1).
 *
 * USAGE (lecture seule ; l'axe S3 est best-effort — préfixer pour une sonde live) :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-unzonable-absence-attestation-20260830.ts
 *   (sans creds S3, le run reste complet en mode répertoire-seul : axe servi = unknown.)
 *
 * ÉCRIT (fichiers locaux du dépôt, PAS S3) :
 *   work/coverage/zones-unzonable-absence-attestation-20260830.json
 *   work/coverage/zones-unzonable-absence-attestation-20260830.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, s3Target, S3ENV, parseFeatureCollectionBuffer } from "./lib/s3.js";

const RUN_AT = new Date().toISOString();

// ── Chemins committés (résolus depuis l'emplacement du script, cwd-agnostiques) ──
const DIR_JSON_URL = new URL(
  "../../packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json",
  import.meta.url,
);
const DIR_JSON_REPO = "packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json";
const SDA_GEOJSON_URL = new URL("../../data/normalized/ca-qc-sda/qc-municipalites.geojson", import.meta.url);
const SDA_META_URL = new URL("../../data/normalized/ca-qc-sda/qc-municipalites.meta.json", import.meta.url);
const SDA_GEOJSON_REPO = "data/normalized/ca-qc-sda/qc-municipalites.geojson";

const OUT_JSON_URL = new URL("../../work/coverage/zones-unzonable-absence-attestation-20260830.json", import.meta.url);
const OUT_MD_URL = new URL("../../work/coverage/zones-unzonable-absence-attestation-20260830.md", import.meta.url);
const OUT_DIR_URL = new URL("../../work/coverage/", import.meta.url);

// ── Les 14 slugs candidat-un-zonable (routés par heuristique géographique) ──
// Source : work/coverage/zones-220-acquisition-backlog-20260821.md (lignes 43-56).
const CANDIDATES: ReadonlyArray<{ slug: string; origine: "220" | "16-data-gap" }> = [
  { slug: "baie-johan-beetz", origine: "220" },
  { slug: "blanc-sablon", origine: "220" },
  { slug: "bonne-esperance", origine: "220" },
  { slug: "gros-mecatina", origine: "220" },
  { slug: "longue-pointe-de-mingan", origine: "220" },
  { slug: "matagami", origine: "220" },
  { slug: "natashquan", origine: "220" },
  { slug: "riviere-saint-jean", origine: "220" },
  { slug: "saint-augustin--le-golfe-du-saint-laurent", origine: "220" },
  { slug: "la-tuque", origine: "16-data-gap" },
  { slug: "eeyou-istchee-james-bay", origine: "16-data-gap" },
  { slug: "aguanish", origine: "16-data-gap" },
  { slug: "caniapiscau", origine: "16-data-gap" },
  { slug: "cote-nord-du-golfe-du-saint-laurent", origine: "16-data-gap" },
];

/**
 * Désignations MAMH qui prouvent POSITIVEMENT que l'entité n'est PAS une
 * municipalité locale capable de zonage municipal. Liste conservatrice et
 * EXPLICITE : toute désignation hors de cet ensemble (Ville, Municipalité,
 * Paroisse, Canton, Village, Cité, …) est traitée comme une municipalité locale
 * → source-gap. Une désignation absente/nulle reste aussi source-gap.
 */
const NON_LOCAL_MUNI_DESIGNATIONS = new Set<string>([
  "Territoire non organisé",
  "Gouvernement régional",
]);

// ── Types ──
interface DirEntry {
  slug: string;
  name: string;
  mamhCode: string;
  mamhName: string;
  designation: string | null;
  website: string | null;
  email: string | null;
  source: string;
  verifiedAt: string;
}
interface DirDoc {
  generatedAt: string;
  source: { name: string; dataset: string; datasetUrl: string; license: string };
  entries: Record<string, DirEntry>;
}
type Tri = true | false | "unknown";

interface AttSource {
  source: string;
  query: string;
  result: string;
  retrieved_at: string;
}
interface Row {
  slug: string;
  origine: "220" | "16-data-gap";
  directory_lookup: {
    found: boolean;
    source_file: string;
    entity_type: string | null;
    designation: string | null;
    mrc: string | null;
    snapshot_or_retrieved_at: string;
  };
  served_qclots: Tri;
  served_qczonage: Tri;
  classification: "N-A-PROVEN" | "UNKNOWN-source-gap";
  basis: string;
  attestation: { sources: AttSource[] };
}

// ── Normalisation de nom (NFD, sans accents, minuscule) pour le recoupement SDA ──
function normName(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ── Recoupement SDA (découpage administratif MRNF) ──
interface SdaProps {
  MUS_CO_GEO?: unknown;
  MUS_NM_MUN?: unknown;
  MUS_NM_MRC?: unknown;
  MUS_CO_DES?: unknown;
  MUS_NM_REG?: unknown;
}
interface SdaMatch {
  co_geo: string;
  nm_mun: string;
  nm_mrc: string;
  co_des: string;
  nm_reg: string;
}

function buildSdaIndex(): {
  byCode: Map<string, SdaMatch>;
  byName: Map<string, SdaMatch[]>;
  fetchedAt: string;
  count: number;
} {
  const buf = readFileSync(SDA_GEOJSON_URL);
  const fc = parseFeatureCollectionBuffer<{ properties?: SdaProps | null }>(buf, SDA_GEOJSON_REPO);
  const byCode = new Map<string, SdaMatch>();
  const byName = new Map<string, SdaMatch[]>();
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const m: SdaMatch = {
      co_geo: String(p.MUS_CO_GEO ?? "").trim(),
      nm_mun: String(p.MUS_NM_MUN ?? "").trim(),
      nm_mrc: String(p.MUS_NM_MRC ?? "").trim(),
      co_des: String(p.MUS_CO_DES ?? "").trim(),
      nm_reg: String(p.MUS_NM_REG ?? "").trim(),
    };
    if (m.co_geo) byCode.set(m.co_geo, m);
    const key = normName(m.nm_mun);
    if (key) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(m);
    }
  }
  let fetchedAt = "unknown";
  let count = fc.features.length;
  try {
    const meta = JSON.parse(readFileSync(SDA_META_URL, "utf8")) as { fetchedAt?: string; count?: number };
    if (typeof meta.fetchedAt === "string") fetchedAt = meta.fetchedAt;
    if (typeof meta.count === "number") count = meta.count;
  } catch {
    // meta absente → fetchedAt reste "unknown", count = features.length (recompté)
  }
  return { byCode, byName, fetchedAt, count };
}

function sdaLookup(
  idx: ReturnType<typeof buildSdaIndex>,
  entry: DirEntry,
): { match: SdaMatch | null; how: "by-code" | "by-name" | "not-matched" } {
  const byCode = idx.byCode.get(entry.mamhCode);
  if (byCode) return { match: byCode, how: "by-code" };
  const cands = idx.byName.get(normName(entry.mamhName)) ?? idx.byName.get(normName(entry.name)) ?? [];
  if (cands.length === 1) return { match: cands[0]!, how: "by-name" };
  return { match: null, how: "not-matched" };
}

// ── Empreinte servie S3 (best-effort, borné, jamais bloquant) ──
const LOTS_KEYS = (slug: string): string[] => [
  `normalized/qc-lots/qc-lots-${slug}.geojson`,
  `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.geojson`,
];
const ZONAGE_KEYS = (slug: string): string[] => [
  `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`,
  `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
];

const HEAD_TIMEOUT_MS = 8000;
const S3_GLOBAL_DEADLINE_MS = 90_000;

type HeadResult = "exists" | "absent" | "error";

function isMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const d = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return d.name === "NotFound" || d.name === "NoSuchKey" || d.$metadata?.httpStatusCode === 404;
}

async function headWithTimeout(
  s3: ReturnType<typeof s3Client>,
  bucket: string,
  key: string,
): Promise<HeadResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: ctrl.signal });
    return "exists";
  } catch (err) {
    if (isMissing(err)) return "absent";
    return "error";
  } finally {
    clearTimeout(t);
  }
}

interface ServedProbe {
  configured: boolean;
  reachable: boolean;
  note: string;
  bucket: string | null;
  results: Map<string, { lots: Tri; zonage: Tri; lots_keys_seen: string[]; zonage_keys_seen: string[] }>;
}

async function probeServed(slugs: readonly string[]): Promise<ServedProbe> {
  const out: ServedProbe = {
    configured: false,
    reachable: false,
    note: "",
    bucket: null,
    results: new Map(),
  };
  const hasCreds = existsSync(S3ENV) || !!process.env["S3_ACCESS_KEY"];
  if (!hasCreds) {
    out.note = `S3 non configuré (ni ${S3ENV} ni S3_ACCESS_KEY) → empreinte servie = unknown (répertoire-seul, run complet)`;
    return out;
  }
  out.configured = true;
  let s3: ReturnType<typeof s3Client>;
  let bucket: string;
  try {
    s3 = s3Client();
    bucket = s3Target().bucket;
    out.bucket = bucket;
  } catch (err) {
    out.note = `client S3 indisponible (${(err as Error).message}) → empreinte servie = unknown`;
    return out;
  }
  // Sonde de connectivité : un HEAD sur une clé bénigne connue-servie. Résout
  // (exists|absent) ⇒ joignable ; error/timeout ⇒ injoignable → tout = unknown.
  const connKey = "normalized/qc-lots/qc-lots-montreal.geojson";
  const conn = await headWithTimeout(s3, bucket, connKey);
  if (conn === "error") {
    out.note = `S3 injoignable (HEAD ${connKey} a échoué/timeout) → empreinte servie = unknown`;
    return out;
  }
  out.reachable = true;
  const deadline = Date.now() + S3_GLOBAL_DEADLINE_MS;
  for (const slug of slugs) {
    if (Date.now() > deadline) {
      out.results.set(slug, { lots: "unknown", zonage: "unknown", lots_keys_seen: [], zonage_keys_seen: [] });
      continue;
    }
    const lotsSeen: string[] = [];
    const zonSeen: string[] = [];
    let lots: Tri = false;
    let zonage: Tri = false;
    let lotsErr = false;
    let zonErr = false;
    for (const k of LOTS_KEYS(slug)) {
      const r = await headWithTimeout(s3, bucket, k);
      if (r === "exists") { lots = true; lotsSeen.push(k); }
      else if (r === "error") lotsErr = true;
    }
    for (const k of ZONAGE_KEYS(slug)) {
      const r = await headWithTimeout(s3, bucket, k);
      if (r === "exists") { zonage = true; zonSeen.push(k); }
      else if (r === "error") zonErr = true;
    }
    if (lots !== true && lotsErr) lots = "unknown";
    if (zonage !== true && zonErr) zonage = "unknown";
    out.results.set(slug, { lots, zonage, lots_keys_seen: lotsSeen, zonage_keys_seen: zonSeen });
  }
  out.note = `S3 joignable (bucket ${bucket}) — HEAD lecture seule, aucune écriture`;
  return out;
}

// ── Main ──
async function main(): Promise<void> {
  const dir = JSON.parse(readFileSync(DIR_JSON_URL, "utf8")) as DirDoc;
  const sda = buildSdaIndex();
  const served = await probeServed(CANDIDATES.map((c) => c.slug));

  const rows: Row[] = [];
  const missing: string[] = [];

  for (const { slug, origine } of CANDIDATES) {
    const entry = dir.entries[slug];
    if (!entry) {
      missing.push(slug);
      continue;
    }
    const sdaRes = sdaLookup(sda, entry);
    const dirSnapshot = `generatedAt=${dir.generatedAt}; entry.verifiedAt=${entry.verifiedAt}`;

    // Classification — dérivée UNIQUEMENT de la désignation autoritative MAMH.
    const designation = entry.designation;
    const isNonLocal = designation !== null && NON_LOCAL_MUNI_DESIGNATIONS.has(designation);

    const sdaResultStr = sdaRes.match
      ? `MUS_NM_MUN="${sdaRes.match.nm_mun}", MUS_CO_GEO=${sdaRes.match.co_geo}, MUS_NM_MRC="${sdaRes.match.nm_mrc}", MUS_CO_DES=${sdaRes.match.co_des}, MUS_NM_REG="${sdaRes.match.nm_reg}" (match ${sdaRes.how})`
      : `not-matched-in-SDA (no MUS_CO_GEO==${entry.mamhCode} nor unique normalized-name match)`;

    const svc = served.results.get(slug);
    const servedLots: Tri = served.configured && served.reachable ? svc?.lots ?? "unknown" : "unknown";
    const servedZon: Tri = served.configured && served.reachable ? svc?.zonage ?? "unknown" : "unknown";
    const servedRetrieved = served.configured && served.reachable ? RUN_AT : "unknown";
    const lotsKeys = svc?.lots_keys_seen.length ? ` [${svc.lots_keys_seen.join(", ")}]` : "";
    const zonKeys = svc?.zonage_keys_seen.length ? ` [${svc.zonage_keys_seen.join(", ")}]` : "";
    const servedResultStr =
      served.configured && served.reachable
        ? `qc-lots=${String(servedLots)}${lotsKeys}, qc-zonage=${String(servedZon)}${zonKeys}`
        : `unknown — ${served.note}`;

    let classification: Row["classification"];
    let basis: string;
    if (isNonLocal) {
      classification = "N-A-PROVEN";
      const nuance =
        designation === "Territoire non organisé"
          ? " Nuance (contexte, ne renverse pas la classe) : le territoire d'un TNO peut être couvert par un zonage de niveau MRC (produit distinct) ; le slug-muni reste N-A sur le zonage MUNICIPAL, valide pour le KPI 1106-muni."
          : " Nuance (contexte) : entité régionale gouvernant un territoire (produit de zonage éventuel de niveau régional, distinct du zonage municipal local).";
      basis =
        `Désignation autoritative "${designation}" pour ${entry.mamhName} (mamhCode ${entry.mamhCode}) ` +
        `dans ${DIR_JSON_REPO} (MAMH Répertoire, ${dirSnapshot}) ⇒ n'est PAS une municipalité locale capable de zonage municipal.` +
        nuance;
    } else {
      classification = "UNKNOWN-source-gap";
      const desigTxt = designation === null ? "désignation absente/null" : `désignation autoritative "${designation}"`;
      basis =
        `${entry.mamhName} (mamhCode ${entry.mamhCode}) porte une ${desigTxt} dans ${DIR_JSON_REPO} ` +
        `(MAMH Répertoire, ${dirSnapshot}) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un ` +
        `source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.`;
    }

    const sources: AttSource[] = [
      {
        source: DIR_JSON_REPO,
        query: `QC_MUNICIPAL_DIRECTORY.entries["${slug}"].designation`,
        result: `designation="${designation ?? "null"}", mamhName="${entry.mamhName}", mamhCode=${entry.mamhCode}`,
        retrieved_at: dirSnapshot,
      },
      {
        source: SDA_GEOJSON_REPO,
        query: `feature where MUS_CO_GEO=="${entry.mamhCode}" (fallback: unique normalized MUS_NM_MUN)`,
        result: sdaResultStr,
        retrieved_at: `fetchedAt=${sda.fetchedAt}`,
      },
      {
        source: served.bucket ? `s3://${served.bucket}/normalized/{qc-lots,ca-qc-zonage}/…-${slug}` : "s3 (non configuré)",
        query: `HEAD qc-lots-${slug} + qc-zonage-${slug} (layouts plat + niché)`,
        result: servedResultStr,
        retrieved_at: servedRetrieved,
      },
    ];

    rows.push({
      slug,
      origine,
      directory_lookup: {
        found: true,
        source_file: DIR_JSON_REPO,
        entity_type: designation,
        designation,
        mrc: sdaRes.match ? sdaRes.match.nm_mrc || null : null,
        snapshot_or_retrieved_at: dirSnapshot,
      },
      served_qclots: servedLots,
      served_qczonage: servedZon,
      classification,
      basis,
      attestation: { sources },
    });
  }

  // ── FAIL-LOUD : toutes présentes, partition fermée à 14 ──
  if (missing.length > 0) {
    throw new Error(
      `FAIL-LOUD: ${missing.length} slug(s) absent(s) du répertoire committé — attendu 14/14 présents : ${missing.join(", ")}`,
    );
  }
  const naProven = rows.filter((r) => r.classification === "N-A-PROVEN");
  const sourceGap = rows.filter((r) => r.classification === "UNKNOWN-source-gap");
  if (naProven.length + sourceGap.length !== CANDIDATES.length || rows.length !== CANDIDATES.length) {
    throw new Error(
      `FAIL-LOUD: la partition ne ferme pas à ${CANDIDATES.length} ` +
        `(N-A-PROVEN=${naProven.length} + UNKNOWN-source-gap=${sourceGap.length} = ${naProven.length + sourceGap.length}, rows=${rows.length})`,
    );
  }

  const summary = {
    total: CANDIDATES.length,
    "N-A-PROVEN": { count: naProven.length, slugs: naProven.map((r) => r.slug) },
    "UNKNOWN-source-gap": { count: sourceGap.length, slugs: sourceGap.map((r) => r.slug) },
    partition_closes_to_14: naProven.length + sourceGap.length === CANDIDATES.length,
  };

  const doc = {
    generated_at: RUN_AT,
    title: "Attestation d'absence rejouable — 14 municipalités candidat-un-zonable",
    method:
      "Preuve primaire = désignation autoritative MAMH (verbatim) ; recoupement SDA MRNF ; empreinte servie S3 best-effort. N-A-PROVEN uniquement sur preuve positive de non-municipalité-locale (TNO / Gouvernement régional). Absence-de-preuve ≠ preuve-d'absence.",
    primary_source: {
      file: DIR_JSON_REPO,
      dataset: dir.source?.dataset ?? "repertoire-des-municipalites-du-quebec",
      name: dir.source?.name ?? "MAMH — Répertoire des municipalités du Québec",
      license: dir.source?.license ?? "cc-by-4.0",
      generatedAt: dir.generatedAt,
    },
    crosscheck_source: { file: SDA_GEOJSON_REPO, fetchedAt: sda.fetchedAt, feature_count: sda.count },
    served_probe: {
      configured: served.configured,
      reachable: served.reachable,
      bucket: served.bucket,
      note: served.note,
    },
    non_local_muni_designations: [...NON_LOCAL_MUNI_DESIGNATIONS],
    summary,
    rows,
  };

  mkdirSync(OUT_DIR_URL, { recursive: true });
  writeFileSync(OUT_JSON_URL, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(OUT_MD_URL, renderMd(doc));

  // Log console (bref) — pour l'audit du run.
  console.log(`[attestation] generated_at=${RUN_AT}`);
  console.log(`[attestation] served: configured=${served.configured} reachable=${served.reachable} — ${served.note}`);
  console.log(`[attestation] N-A-PROVEN (${naProven.length}): ${naProven.map((r) => r.slug).join(", ") || "—"}`);
  console.log(`[attestation] UNKNOWN-source-gap (${sourceGap.length}): ${sourceGap.map((r) => r.slug).join(", ")}`);
  for (const r of naProven) console.log(`[attestation] N-A basis — ${r.slug}: ${r.basis}`);
  console.log(`[attestation] partition closes to ${CANDIDATES.length}: OK`);
  console.log(`[attestation] wrote ${OUT_JSON_URL.pathname} + ${OUT_MD_URL.pathname}`);
}

// ── Rendu Markdown ──
type Doc = {
  generated_at: string;
  primary_source: { file: string; name: string; generatedAt: string; license: string; dataset: string };
  crosscheck_source: { file: string; fetchedAt: string; feature_count: number };
  served_probe: { configured: boolean; reachable: boolean; bucket: string | null; note: string };
  non_local_muni_designations: string[];
  summary: {
    total: number;
    "N-A-PROVEN": { count: number; slugs: string[] };
    "UNKNOWN-source-gap": { count: number; slugs: string[] };
  };
  rows: Row[];
};

function renderMd(doc: Doc): string {
  const s = doc.summary;
  const lines: string[] = [];
  lines.push("# Attestation d'absence rejouable — 14 municipalités candidat-un-zonable");
  lines.push("");
  lines.push(`_Généré : ${doc.generated_at} — sonde \`acquisition/src/_zones-unzonable-absence-attestation-20260830.ts\` (lecture seule)._`);
  lines.push("");
  lines.push("## Contrat (anti-invention)");
  lines.push("");
  lines.push("Absence-de-preuve ≠ preuve-d'absence. **N-A-PROVEN** exige une preuve POSITIVE autoritative que l'entité n'est pas une municipalité locale capable de zonage (TNO, gouvernement régional, entité régionale/MRC, ou absence du répertoire municipal comme municipalité locale). Une vraie Ville/Municipalité locale → l'absence de grille est un **source-gap**, jamais N-A. verbatim-or-null.");
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push(`- **Primaire (porteuse)** : \`${doc.primary_source.file}\` — ${doc.primary_source.name} (${doc.primary_source.license}), generatedAt=${doc.primary_source.generatedAt}. Champ \`designation\` lu VERBATIM.`);
  lines.push(`- **Recoupement** : \`${doc.crosscheck_source.file}\` — découpage administratif MRNF SDA, fetchedAt=${doc.crosscheck_source.fetchedAt}, ${doc.crosscheck_source.feature_count} features.`);
  lines.push(`- **Empreinte servie (secondaire)** : S3 HEAD lecture seule. configured=${doc.served_probe.configured}, reachable=${doc.served_probe.reachable}${doc.served_probe.bucket ? `, bucket=${doc.served_probe.bucket}` : ""}. ${doc.served_probe.note}`);
  lines.push(`- Désignations traitées comme non-municipalité-locale : ${doc.non_local_muni_designations.map((d) => `\`${d}\``).join(", ")}.`);
  lines.push("");
  lines.push("## Résumé (partition fermée)");
  lines.push("");
  lines.push(`- **Total** : ${s.total}`);
  lines.push(`- **N-A-PROVEN** : ${s["N-A-PROVEN"].count} — ${s["N-A-PROVEN"].slugs.join(", ") || "—"}`);
  lines.push(`- **UNKNOWN-source-gap** : ${s["UNKNOWN-source-gap"].count} — ${s["UNKNOWN-source-gap"].slugs.join(", ")}`);
  lines.push(`- Partition ferme à ${s.total} : ${s["N-A-PROVEN"].count + s["UNKNOWN-source-gap"].count === s.total ? "OK" : "FAIL"}`);
  lines.push("");
  lines.push("## Table");
  lines.push("");
  lines.push("| slug | origine | designation (MAMH, verbatim) | mrc (SDA) | qc-lots servi | qc-zonage servi | classification |");
  lines.push("|------|---------|------------------------------|-----------|---------------|-----------------|----------------|");
  for (const r of doc.rows) {
    lines.push(
      `| ${r.slug} | ${r.origine} | ${r.directory_lookup.designation ?? "null"} | ${r.directory_lookup.mrc ?? "—"} | ${String(r.served_qclots)} | ${String(r.served_qczonage)} | ${r.classification} |`,
    );
  }
  lines.push("");
  lines.push("## Bases (verbatim)");
  lines.push("");
  for (const r of doc.rows) {
    lines.push(`### ${r.slug} — ${r.classification}`);
    lines.push("");
    lines.push(r.basis);
    lines.push("");
    for (const src of r.attestation.sources) {
      lines.push(`- \`${src.source}\` — ${src.query} → ${src.result} (retrieved_at: ${src.retrieved_at})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
