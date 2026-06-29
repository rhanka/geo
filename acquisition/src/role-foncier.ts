/**
 * role-foncier.ts — Parse du Rôle d'évaluation foncière du Québec (MAMH).
 *
 * Port TypeScript fidèle de `acquisition/role_foncier.py`. Source : Données
 * Québec / MAMH, fichiers XML par municipalité (RL{code_geo}_{millesime}.xml),
 * répertoire 2.5 / 2.8.
 *
 * Champs bâtiment extraits (anti-invention : null si absent dans la source) —
 * voir le module Python pour le tableau RL0105A / RL0306A / … / RL0404A.
 *
 * Clé de liaison cadastre ↔ rôle : RL0103Ax = matricule cadastral = NO_LOT
 * (sans espaces). Jointure : NO_LOT.replace(' ', '') == RL0103Ax.
 *
 * Usage module :
 *   import { fetchIndex, parseRole, joinLotsRole } from "./role-foncier.js";
 *
 * Usage CLI :
 *   tsx src/role-foncier.ts <code_geo|slug> [--millesime 2026] [--lots f.geojson]
 *       [--output out.parquet] [--s3] [--xml-only]
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { XMLParser } from "fast-xml-parser";

import { s3Client, putBytes } from "./lib/s3.js";
import { writeRoleParquet } from "./lib/parquet.js";

export const DEFAULT_MILLESIME = 2026;
export const SOURCE_ID = "mamh-role-foncier";
export const SOURCE_URL =
  "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec";
export const LICENSE = "CC BY 4.0";

const INDEX_URL = (m: number) =>
  `https://donneesouvertes.affmunqc.net/role/indexRole${m}.csv`;
const XML_URL = (code: string, m: number) =>
  `https://donneesouvertes.affmunqc.net/role/RL${code}_${m}.xml`;

export interface IndexEntry {
  code_geo: string;
  nom: string;
  url: string;
}

/** Slug lowercase sans accents — IDENTIQUE à `role_foncier._slugify`
 * (NFC -> drop non-ASCII -> lower -> espaces/apostrophes en tirets).
 * ⚠️ Destructif sur les accents (Montréal -> montral) : conservé tel quel pour
 * la compatibilité de l'index CSV ; la résolution province utilise `norm()`. */
export function slugify(name: string): string {
  const nfc = name.normalize("NFC");
  // drop non-ASCII (equivalent to encode('ascii','ignore'))
  // eslint-disable-next-line no-control-regex
  const ascii = nfc.replace(/[^\x00-\x7F]/g, "");
  return ascii
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/'/g, "-")
    .replace(/’/g, "-");
}

/** Minimal CSV parser for the MAMH index (quoted fields, comma sep, header). */
function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQ) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // skip
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, idx) => {
      o[h] = r[idx] ?? "";
    });
    return o;
  });
}

/**
 * Télécharge l'index CSV -> dict { code_geo | slug -> {code_geo, nom, url} }.
 * Le BOM utf-8 est strippé (decode utf-8-sig côté Python).
 */
export async function fetchIndex(
  millesime: number = DEFAULT_MILLESIME,
): Promise<Record<string, IndexEntry>> {
  const res = await fetch(INDEX_URL(millesime));
  if (!res.ok) throw new Error(`index HTTP ${res.status}`);
  let content = await res.text();
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const result: Record<string, IndexEntry> = {};
  for (const r of parseCsv(content)) {
    const code_geo = (r["code géographique"] ?? "").trim();
    const nom = (r["nom du territoire"] ?? "").trim();
    const url = (r["lien"] ?? "").trim();
    if (!code_geo) continue;
    const entry: IndexEntry = { code_geo, nom, url };
    result[code_geo] = entry;
    result[slugify(nom)] = entry;
  }
  return result;
}

export async function resolveMuni(
  key: string,
  millesime: number = DEFAULT_MILLESIME,
): Promise<IndexEntry> {
  const index = await fetchIndex(millesime);
  if (index[key]) return index[key]!;
  const slug = slugify(key);
  if (index[slug]) return index[slug]!;
  throw new Error(
    `Municipalité '${key}' non trouvée dans l'index ${millesime}. ` +
      `Vérifier le code géo (ex. '34128') ou le nom (ex. 'Saint-Raymond').`,
  );
}

/** Télécharge le XML du rôle (cache local optionnel). */
export async function fetchRole(
  codeGeo: string,
  millesime: number = DEFAULT_MILLESIME,
  cachePath?: string,
): Promise<Buffer> {
  if (cachePath && existsSync(cachePath)) return readFileSync(cachePath);
  const res = await fetch(XML_URL(codeGeo, millesime));
  if (!res.ok) {
    const err = new Error(`role HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, buf);
  }
  return buf;
}

function safeInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function safeFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface RoleAttrs {
  usage_cubf: string | null;
  nb_etages_max: number | null;
  annee_construction: number | null;
  annee_est_reelle: string | null;
  superficie_batiment_m2: number | null;
  nb_logements: number | null;
  nb_locaux_non_resid: number | null;
  superficie_terrain_m2_role: number | null;
  frontage_role_m: number | null;
  valeur_terrain: number | null;
  valeur_batiment: number | null;
  valeur_immeuble: number | null;
  _source: string;
  _source_code_geo: string;
  _source_millesime: string;
}

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep raw strings; we coerce ourselves (verbatim)
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse un XML de rôle MAMH -> { matricule (RL0103Ax) -> attrs bâtiment }.
 * Une unité peut référencer N lots ; un lot vu plusieurs fois : la première
 * occurrence gagne, sauf si une occurrence ultérieure a une superficie bâtiment
 * alors que la première non (priorité aux données bâtiment) — IDENTIQUE au .py.
 */
export function parseRole(xmlBytes: Buffer | string): Record<string, RoleAttrs> {
  const root = xml.parse(xmlBytes.toString()) as Record<string, unknown>;
  const rl = (root["RL"] ?? root) as Record<string, unknown>;
  const codeGeo = txt(rl["RLM01A"]) ?? "";
  const millesime = txt(rl["RLM02A"]) ?? "";

  const lookup: Record<string, RoleAttrs> = {};
  for (const unit of asArray(rl["RLUEx"]) as Record<string, unknown>[]) {
    const rl0103 = unit["RL0103"] as Record<string, unknown> | undefined;
    const matricules: string[] = [];
    if (rl0103) {
      for (const x of asArray(rl0103["RL0103x"]) as Record<string, unknown>[]) {
        const ax = txt(x?.["RL0103Ax"]);
        if (ax) matricules.push(ax);
      }
    }
    if (matricules.length === 0) continue;

    const attrs: RoleAttrs = {
      usage_cubf: txt(unit["RL0105A"]),
      nb_etages_max: safeInt(unit["RL0306A"]),
      annee_construction: safeInt(unit["RL0307A"]),
      annee_est_reelle: txt(unit["RL0307B"]),
      superficie_batiment_m2: safeFloat(unit["RL0308A"]),
      nb_logements: safeInt(unit["RL0311A"]),
      nb_locaux_non_resid: safeInt(unit["RL0313A"]),
      superficie_terrain_m2_role: safeFloat(unit["RL0302A"]),
      frontage_role_m: safeFloat(unit["RL0301A"]),
      valeur_terrain: safeFloat(unit["RL0402A"]),
      valeur_batiment: safeFloat(unit["RL0403A"]),
      valeur_immeuble: safeFloat(unit["RL0404A"]),
      _source: SOURCE_ID,
      _source_code_geo: codeGeo,
      _source_millesime: millesime,
    };

    for (const m of matricules) {
      if (!(m in lookup)) lookup[m] = attrs;
      else if (
        attrs.superficie_batiment_m2 !== null &&
        lookup[m]!.superficie_batiment_m2 === null
      ) {
        lookup[m] = attrs;
      }
    }
  }
  return lookup;
}

export interface JoinStats {
  total_lots_cadastre: number;
  lots_matched_role: number;
  lots_unmatched: number;
  coverage_pct: number;
  with_superficie_batiment: number;
  with_nb_etages: number;
  with_annee_construction: number;
  with_usage_cubf: number;
  batiment_coverage_pct: number;
  source: string;
  source_url: string;
  license: string;
}

type GeoJSONFeature = {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown> | null;
};
type FeatureCollection = { type: string; features: GeoJSONFeature[] };

/**
 * Jointure lots cadastraux (WGS84) ↔ lookup rôle. Le NO_LOT cadastre a des
 * espaces (séparateurs de milliers) ; on les retire avant la jointure.
 * Anti-invention : attrs role_* = null si pas de match (jamais inventés).
 */
export function joinLotsRole(
  lotsFc: FeatureCollection,
  roleLookup: Record<string, RoleAttrs>,
  lotIdField = "NO_LOT",
): { enrichedFc: FeatureCollection; stats: JoinStats } {
  const featuresOut: GeoJSONFeature[] = [];
  const feats = lotsFc.features ?? [];
  const total = feats.length;
  let matched = 0;
  let withBatiment = 0;
  let withEtages = 0;
  let withAnnee = 0;
  let withCubf = 0;

  for (const feat of feats) {
    const props: Record<string, unknown> = { ...(feat.properties ?? {}) };
    const noLotRaw = String(props[lotIdField] ?? "").replace(/ /g, "");
    const ra = roleLookup[noLotRaw];
    if (ra) {
      matched++;
      props["role_usage_cubf"] = ra.usage_cubf;
      props["role_nb_etages_max"] = ra.nb_etages_max;
      props["role_annee_construction"] = ra.annee_construction;
      props["role_annee_est_reelle"] = ra.annee_est_reelle;
      props["role_superficie_batiment_m2"] = ra.superficie_batiment_m2;
      props["role_nb_logements"] = ra.nb_logements;
      props["role_nb_locaux_non_resid"] = ra.nb_locaux_non_resid;
      props["role_superficie_terrain_m2"] = ra.superficie_terrain_m2_role;
      props["role_frontage_m"] = ra.frontage_role_m;
      props["role_valeur_terrain"] = ra.valeur_terrain;
      props["role_valeur_batiment"] = ra.valeur_batiment;
      props["role_valeur_immeuble"] = ra.valeur_immeuble;
      props["_role_source"] = ra._source;
      props["_role_millesime"] = ra._source_millesime;
      if (ra.superficie_batiment_m2 !== null) withBatiment++;
      if (ra.nb_etages_max !== null) withEtages++;
      if (ra.annee_construction !== null) withAnnee++;
      if (ra.usage_cubf !== null) withCubf++;
    } else {
      for (const k of [
        "role_usage_cubf",
        "role_nb_etages_max",
        "role_annee_construction",
        "role_annee_est_reelle",
        "role_superficie_batiment_m2",
        "role_nb_logements",
        "role_nb_locaux_non_resid",
        "role_superficie_terrain_m2",
        "role_frontage_m",
        "role_valeur_terrain",
        "role_valeur_batiment",
        "role_valeur_immeuble",
      ]) {
        props[k] = null;
      }
      props["_role_source"] = SOURCE_ID;
      props["_role_millesime"] = null;
    }
    featuresOut.push({ type: "Feature", geometry: feat.geometry, properties: props });
  }

  const stats: JoinStats = {
    total_lots_cadastre: total,
    lots_matched_role: matched,
    lots_unmatched: total - matched,
    coverage_pct: total ? round1((matched / total) * 100) : 0,
    with_superficie_batiment: withBatiment,
    with_nb_etages: withEtages,
    with_annee_construction: withAnnee,
    with_usage_cubf: withCubf,
    batiment_coverage_pct: matched ? round1((withBatiment / matched) * 100) : 0,
    source: SOURCE_ID,
    source_url: SOURCE_URL,
    license: LICENSE,
  };
  return { enrichedFc: { type: "FeatureCollection", features: featuresOut }, stats };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  muni?: string;
  millesime: number;
  lots?: string;
  output?: string;
  s3: boolean;
  cacheXml?: string;
  xmlOnly: boolean;
} {
  const out = {
    millesime: DEFAULT_MILLESIME,
    s3: false,
    xmlOnly: false,
  } as ReturnType<typeof parseArgs>;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--millesime") out.millesime = Number(argv[++i]);
    else if (a === "--lots") out.lots = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--s3") out.s3 = true;
    else if (a === "--cache-xml") out.cacheXml = argv[++i];
    else if (a === "--xml-only") out.xmlOnly = true;
    else if (!a.startsWith("--") && !out.muni) out.muni = a;
  }
  return out;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (!a.muni) {
    console.error(
      "Usage: tsx src/role-foncier.ts <code_geo|slug> [--millesime 2026] " +
        "[--lots f.geojson] [--output out.parquet] [--s3] [--xml-only]",
    );
    process.exit(1);
  }

  const entry = await resolveMuni(a.muni, a.millesime);
  const slug = slugify(entry.nom);
  console.log(`Municipalité : ${entry.nom} (code ${entry.code_geo}, slug: ${slug})`);

  console.log(`Téléchargement rôle ${a.millesime}...`);
  const xmlBytes = await fetchRole(entry.code_geo, a.millesime, a.cacheXml);
  console.log(`  XML ${(xmlBytes.length / 1024 / 1024).toFixed(2)} MB`);

  console.log("Parsing XML...");
  const lookup = parseRole(xmlBytes);
  console.log(`  ${Object.keys(lookup).length} matricules uniques extraits`);

  if (a.xmlOnly || !a.lots) {
    const vals = Object.values(lookup);
    const n = vals.length || 1;
    const withBat = vals.filter((v) => v.superficie_batiment_m2).length;
    const withEtg = vals.filter((v) => v.nb_etages_max).length;
    const withYr = vals.filter((v) => v.annee_construction).length;
    console.log("Stats rôle (sans jointure lots) :");
    console.log(`  superficie_batiment_m2  : ${withBat}/${n} = ${((withBat / n) * 100).toFixed(1)}%`);
    console.log(`  nb_etages_max           : ${withEtg}/${n} = ${((withEtg / n) * 100).toFixed(1)}%`);
    console.log(`  annee_construction      : ${withYr}/${n}  = ${((withYr / n) * 100).toFixed(1)}%`);
    return;
  }

  console.log(`Chargement lots : ${a.lots}`);
  const lotsFc = JSON.parse(readFileSync(a.lots, "utf8")) as FeatureCollection;
  console.log("Jointure lots ↔ rôle...");
  const { enrichedFc, stats } = joinLotsRole(lotsFc, lookup);
  console.log("Résultats :");
  for (const [k, v] of Object.entries(stats)) {
    if (!["source", "source_url", "license"].includes(k)) console.log(`  ${k}: ${v}`);
  }

  if (a.output) {
    if (a.output.endsWith(".geojson")) {
      mkdirSync(dirname(a.output), { recursive: true });
      writeFileSync(a.output, JSON.stringify(enrichedFc));
      console.log(`GeoJSON écrit : ${a.output}`);
    } else if (a.output.endsWith(".parquet")) {
      mkdirSync(dirname(a.output), { recursive: true });
      const rows = enrichedFc.features.map((f) => f.properties ?? {});
      await writeRoleParquet(rows, a.output);
      console.log(`Parquet écrit : ${a.output}`);
    } else {
      console.log(`Format inconnu pour : ${a.output}. Utiliser .geojson ou .parquet`);
    }
  }

  if (a.s3 && a.output && a.output.endsWith(".parquet")) {
    const s3Key = `registry/role-foncier/${slug}.parquet`;
    console.log(`Upload S3 → ${s3Key}...`);
    const s3 = s3Client();
    await putBytes(s3, s3Key, readFileSync(a.output), "application/octet-stream");
    console.log(`  Uploadé : s3://sentropic-geo/${s3Key}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
