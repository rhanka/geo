/**
 * cadastre-role-province.ts — Batch PROVINCE du rôle foncier : joint la cadastre
 * CLIPPÉE au rôle MAMH, en masse.
 *
 * Port fidèle de `acquisition/cadastre_role_province.py`. Parcourt les cadastres
 * clippés normalized/qc-cadastre-lots/*.geojson (~1102 munis QC) et, pour chacun,
 * télécharge + parse le rôle MAMH, le joint par matricule (= NO_LOT sans espaces)
 * et dépose un parquet enrichi sous registry/role-foncier/<slug>.parquet.
 *
 * RÉSOLUTION code_geo (sans Overpass) : slug cadastre (norm NFD) ->
 *   1. index frontières SDA local (MUS_NM_MUN -> MUS_CO_GEO)
 *   2. fallback index rôle MAMH (nom -> code_geo)
 * La clé d'upload est TOUJOURS le slug cadastre exact (jamais slugify ascii).
 *
 * IDEMPOTENT & RESUMABLE : skip si parquet existe / checkpoint
 * /tmp/role_province_progress.json ; borné par --max-seconds.
 *
 * Usage :
 *   tsx src/cadastre-role-province.ts [--max-seconds 3000] [--chunk N]
 *       [--only SLUG] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, getBytes, putBytes, listSlugs } from "./lib/s3.js";
import { norm } from "./cadastre-clip-sda.js";
import { fetchIndex, parseRole, joinLotsRole } from "./role-foncier.js";
import { writeRoleParquet } from "./lib/parquet.js";

const PROG = "/tmp/role_province_progress.json";
const WORK = "/tmp/role_province";
const BOUNDARIES = WORK + "/qc-municipalites.geojson";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ROLE_PREFIX = "registry/role-foncier/";
const SDA_BOUNDARIES_KEY = "normalized/qc-admin-boundaries/qc-municipalites.geojson";

const MILLESIME = 2026;

// Alias slug cadastre -> code géo (aligné sur cadastre_clip_sda.ALIAS_SLUG_TO_CODE).
const ALIAS_SLUG_TO_CODE: Record<string, string> = {
  "eeyou-istchee-james-bay": "99060",
  "hatley-township-municipality": "45043",
};

const XML_URL = (codeGeo: string, millesime: number) =>
  `https://donneesouvertes.affmunqc.net/role/RL${codeGeo}_${millesime}.xml`;

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

interface DoneEntry {
  code_geo: string;
  method: string;
  lots: number;
  matricules: number;
  matched: number;
  join_pct: number;
  key: string;
}
interface Prog {
  done: Record<string, DoneEntry>;
  skip_exists: string[];
  no_code: string[];
  no_role: string[];
  errors: [string, string][];
}

function loadProg(): Prog {
  try {
    return JSON.parse(readFileSync(PROG, "utf8")) as Prog;
  } catch {
    return { done: {}, skip_exists: [], no_code: [], no_role: [], errors: [] };
  }
}
function saveProg(p: Prog): void {
  const tmp = PROG + ".tmp";
  writeFileSync(tmp, JSON.stringify(p));
  renameSync(tmp, PROG);
}

// ---------------------------------------------------------------------------
// Résolution code_geo (slug cadastre -> code géographique)
// ---------------------------------------------------------------------------

class CodeResolver {
  byNameSda: Map<string, string> = new Map();
  byNameRole: Map<string, string> = new Map();

  static async create(boundariesPath: string): Promise<CodeResolver> {
    const r = new CodeResolver();
    // 1) index frontières SDA : norm(MUS_NM_MUN) -> MUS_CO_GEO
    try {
      const g = JSON.parse(readFileSync(boundariesPath, "utf8")) as {
        features?: { properties?: Record<string, unknown> }[];
      };
      for (const f of g.features ?? []) {
        const p = f.properties ?? {};
        const code = String(p["MUS_CO_GEO"] ?? p["code"] ?? "").trim();
        const nm = String(p["MUS_NM_MUN"] ?? p["name"] ?? "");
        if (code && nm && !r.byNameSda.has(norm(nm))) r.byNameSda.set(norm(nm), code);
      }
    } catch (e) {
      console.log(`WARN SDA boundaries load failed (${String(e)})`);
    }
    // 2) index rôle MAMH : norm(nom) -> code_geo (fallback)
    try {
      const idx = await fetchIndex(MILLESIME);
      for (const e of Object.values(idx)) {
        const nm = e.nom ?? "";
        const cg = e.code_geo ?? "";
        if (nm && cg && !r.byNameRole.has(norm(nm))) r.byNameRole.set(norm(nm), cg);
      }
    } catch (e) {
      console.log(`WARN role index fetch failed (${String(e)})`);
    }
    return r;
  }

  /** Retourne [code_geo, method] ou [null, 'no-match']. */
  resolve(slug: string): [string | null, string] {
    const s = norm(slug);
    if (ALIAS_SLUG_TO_CODE[s]) return [ALIAS_SLUG_TO_CODE[s]!, "alias"];
    if (this.byNameSda.has(s)) return [this.byNameSda.get(s)!, "sda-name"];
    if (this.byNameRole.has(s)) return [this.byNameRole.get(s)!, "role-index"];
    // strip progressif des suffixes '--<mrc>' / '--2'
    const segs = (slug ?? "").split(/-{2,}/);
    for (let i = segs.length; i > 0; i--) {
      const base = norm(segs.slice(0, i).join("-"));
      if (this.byNameSda.has(base)) return [this.byNameSda.get(base)!, "sda-name-prefix"];
      if (this.byNameRole.has(base)) return [this.byNameRole.get(base)!, "role-index-prefix"];
    }
    return [null, "no-match"];
  }
}

// ---------------------------------------------------------------------------
// Rôle : fetch XML par code_geo (404/403 -> null, sans lever)
// ---------------------------------------------------------------------------

async function fetchRoleBytes(codeGeo: string, millesime = MILLESIME): Promise<Buffer | null> {
  const res = await fetch(XML_URL(codeGeo, millesime));
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`role HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Parquet : écrit les properties du GeoJSON enrichi (schéma 30, sans géométrie)
// ---------------------------------------------------------------------------

async function writeParquet(
  enrichedFc: { features?: { properties?: Record<string, unknown> | null }[] },
  outPath: string,
): Promise<void> {
  const rows = (enrichedFc.features ?? []).map((f) => f.properties ?? {});
  mkdirSync(outPath.slice(0, outPath.lastIndexOf("/")), { recursive: true });
  await writeRoleParquet(rows, outPath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Args {
  maxSeconds: number;
  chunk: number;
  only?: string;
  dryRun: boolean;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { maxSeconds: 3000, chunk: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--max-seconds") a.maxSeconds = Number(argv[++i]);
    else if (t === "--chunk") a.chunk = Number(argv[++i]);
    else if (t === "--only") a.only = argv[++i];
    else if (t === "--dry-run") a.dryRun = true;
  }
  return a;
}

function cleanup(...paths: (string | null | undefined)[]): void {
  for (const p of paths) {
    try {
      if (p && existsSync(p)) rmSync(p);
    } catch {
      /* ignore */
    }
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));

  mkdirSync(WORK, { recursive: true });
  mkdirSync(WORK + "/lots", { recursive: true });
  mkdirSync(WORK + "/out", { recursive: true });

  const s3: S3Client = s3Client();
  if (!existsSync(BOUNDARIES)) {
    writeFileSync(BOUNDARIES, await getBytes(s3, SDA_BOUNDARIES_KEY));
  }

  const resolver = await CodeResolver.create(BOUNDARIES);
  console.log(`resolver: ${resolver.byNameSda.size} noms SDA, ${resolver.byNameRole.size} noms rôle`);

  const prog = loadProg();
  prog.done ??= {};
  prog.skip_exists ??= [];
  prog.no_code ??= [];
  prog.no_role ??= [];
  prog.errors ??= [];

  let allSlugs = (await listSlugs(s3, CAD_PREFIX, ".geojson")).sort();
  const roleSlugs = new Set(await listSlugs(s3, ROLE_PREFIX, ".parquet"));

  if (a.only) {
    allSlugs = allSlugs.filter((s) => s === a.only);
    if (allSlugs.length === 0) {
      console.log(`ERREUR: slug --only=${a.only} introuvable dans ${CAD_PREFIX}`);
      return;
    }
  }

  const t0 = Date.now();
  let processed = 0;
  for (const slug of allSlugs) {
    if (slug in prog.done) continue;
    if (roleSlugs.has(slug)) {
      if (!prog.skip_exists.includes(slug)) prog.skip_exists.push(slug);
      continue;
    }
    if ((Date.now() - t0) / 1000 > a.maxSeconds) {
      console.log("STOP wall-clock; relancer pour continuer");
      break;
    }
    if (a.chunk && processed >= a.chunk) {
      console.log(`STOP chunk limit (${a.chunk}); relancer pour continuer`);
      break;
    }
    processed++;

    // 1) résoudre le code_geo
    const [code, method] = resolver.resolve(slug);
    if (code === null) {
      console.log(`NO-CODE     ${slug.padEnd(44)} (skip)`);
      if (!prog.no_code.includes(slug)) prog.no_code.push(slug);
      saveProg(prog);
      continue;
    }

    // 2) fetch + parse rôle
    let xml: Buffer | null;
    try {
      xml = await fetchRoleBytes(code, MILLESIME);
    } catch (e) {
      console.log(`FAIL-FETCH  ${slug.padEnd(44)} code=${code} ${String(e)}`);
      prog.errors.push([slug, `fetch:${String(e)}`]);
      saveProg(prog);
      continue;
    }
    if (xml === null) {
      console.log(`NO-ROLE     ${slug.padEnd(44)} code=${code} (404, skip)`);
      if (!prog.no_role.includes(slug)) prog.no_role.push(slug);
      saveProg(prog);
      continue;
    }
    let lookup: ReturnType<typeof parseRole>;
    try {
      lookup = parseRole(xml);
    } catch (e) {
      console.log(`FAIL-PARSE  ${slug.padEnd(44)} code=${code} ${String(e)}`);
      prog.errors.push([slug, `parse:${String(e)}`]);
      saveProg(prog);
      continue;
    }

    // 3) charger la cadastre clippée + jointure
    const lots = WORK + `/lots/${slug}.geojson`;
    let lotsFc: { type: string; features: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> | null }[] };
    try {
      if (!existsSync(lots)) {
        writeFileSync(lots, await getBytes(s3, CAD_PREFIX + `${slug}.geojson`));
      }
      lotsFc = JSON.parse(readFileSync(lots, "utf8"));
    } catch (e) {
      console.log(`FAIL-DL     ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `dl:${String(e)}`]);
      saveProg(prog);
      cleanup(lots);
      continue;
    }

    let enrichedFc: ReturnType<typeof joinLotsRole>["enrichedFc"];
    let stats: ReturnType<typeof joinLotsRole>["stats"];
    try {
      const r = joinLotsRole(lotsFc, lookup);
      enrichedFc = r.enrichedFc;
      stats = r.stats;
    } catch (e) {
      console.log(`FAIL-JOIN   ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `join:${String(e)}`]);
      saveProg(prog);
      cleanup(lots);
      continue;
    }

    const nLots = stats.total_lots_cadastre;
    const nMatch = stats.lots_matched_role;
    const joinPct = stats.coverage_pct;
    const nMatricules = Object.keys(lookup).length;
    console.log(
      `JOIN        ${slug.padEnd(44)} code=${code}(${method}) lots=${nLots} ` +
        `matricules=${nMatricules} match=${nMatch} join=${joinPct.toFixed(1)}%`,
    );

    if (a.dryRun) {
      cleanup(lots);
      continue;
    }

    // 4) écrire parquet + upload sous la clé EXACTE slug cadastre
    const out = WORK + `/out/${slug}.parquet`;
    try {
      await writeParquet(enrichedFc, out);
    } catch (e) {
      console.log(`FAIL-PARQUET ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `parquet:${String(e)}`]);
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    const uploadKey = ROLE_PREFIX + `${slug}.parquet`; // clé contrôlée, jamais slugify
    try {
      await putBytes(s3, uploadKey, readFileSync(out), "application/octet-stream");
    } catch (e) {
      console.log(`FAIL-UPLOAD ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `upload:${String(e)}`]);
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    prog.done[slug] = {
      code_geo: code,
      method,
      lots: nLots,
      matricules: nMatricules,
      matched: nMatch,
      join_pct: joinPct,
      key: uploadKey,
    };
    saveProg(prog);
    cleanup(lots, out);
  }

  console.log(
    `=== chunk fin : done=${Object.keys(prog.done).length} skip_exists=${prog.skip_exists.length} ` +
      `no_code=${prog.no_code.length} no_role=${prog.no_role.length} errors=${prog.errors.length} ` +
      `(sur ${allSlugs.length} slugs) ===`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
