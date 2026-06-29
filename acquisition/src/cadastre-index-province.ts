/**
 * cadastre-index-province.ts — Batch PROVINCE de l'INDEX ZERO-COPIE IMMO.
 *
 * Port fidèle de `acquisition/cadastre_index_province.py`. Met à l'échelle le
 * module PROUVÉ build-index-immo (cadastre clippé ⋈ rôle ⋈ grille zonage) à toute
 * la province (~1080 munis QC), en réutilisant SES fonctions de join.
 *
 * Federation-first : l'index NE COPIE PAS la géométrie ; il référence feature_id
 * (geoId) + no_lot, ajoute code_zone (point-in-polygon centroïde sur grille
 * zonage si dispo) + attrs bâtiment (jointure rôle par no_lot normalisé).
 *
 * CLÉ D'UPLOAD = le slug cadastre EXACT (accents préservés), JAMAIS slugify.
 * IDEMPOTENT & RESUMABLE : skip si parquet existe / si déjà dans le checkpoint
 * /tmp/index_province_progress.json ; borné par --max-seconds.
 *
 * Usage :
 *   tsx src/cadastre-index-province.ts [--max-seconds 86400] [--chunk N]
 *       [--only SLUG] [--no-upload] [--manifest-only]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { listSlugs, putBytes, s3Client as core_s3Client } from "./lib/s3.js";
import * as core from "./build-index-immo.js";

const BUCKET = core.BUCKET;
const GRIDS_MAP = core.GRIDS_MAP;

const PROG = "/tmp/index_province_progress.json";
const WORK = "/tmp/index_province";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const INDEX_PREFIX = "registry/index-immo/";
const MANIFEST_KEY = INDEX_PREFIX + "manifest.json";

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

/** Grilles zonage CLEAN top-level : normalized/ca-qc-zonage/qc-zonage-*.geojson. */
async function listCleanGridSlugs(s3: S3Client): Promise<Set<string>> {
  const out = new Set<string>();
  const slugs = await listSlugs(s3, ZONAGE_PREFIX, ".geojson", true);
  for (const rest of slugs) {
    if (rest.startsWith("qc-zonage-")) out.add(rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Résolution grille zonage : slug cadastre -> grid_slug (ou null, honnête)
// ---------------------------------------------------------------------------

class GridResolver {
  mapped: Map<string, string>;
  clean: Set<string>;

  constructor(gridsMap: Record<string, string | null | undefined>, cleanGridSlugs: Set<string>) {
    // grids-slug-map.json : entrées non-null = grilles curées (peut différer du slug)
    this.mapped = new Map();
    for (const [k, v] of Object.entries(gridsMap)) {
      if (v) this.mapped.set(k, v);
    }
    this.clean = new Set(cleanGridSlugs);
  }

  /** Retourne [grid_slug, method] ou [null, 'no-grid']. */
  resolve(slug: string): [string | null, string] {
    const g = this.mapped.get(slug);
    if (g) {
      if (this.clean.has(g) || g.startsWith("qc-zonage-")) return [g, "map"];
    }
    const auto = `qc-zonage-${slug}`;
    if (this.clean.has(auto)) return [auto, "auto"];
    return [null, "no-grid"];
  }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

interface DoneEntry {
  lots: number;
  with_code_zone: number;
  with_building_attrs: number;
  join_matched: number;
  code_zone_pct: number;
  building_pct: number;
  join_pct: number;
  has_grid: boolean;
  grid_slug: string | null;
  grid_method: string | null;
}

interface Prog {
  done: Record<string, DoneEntry>;
  skip_exists: string[];
  no_cadastre: string[];
  errors: [string, string][];
}

function loadProg(): Prog {
  try {
    return JSON.parse(readFileSync(PROG, "utf8")) as Prog;
  } catch {
    return { done: {}, skip_exists: [], no_cadastre: [], errors: [] };
  }
}

function saveProg(p: Prog): void {
  const tmp = PROG + ".tmp";
  writeFileSync(tmp, JSON.stringify(p));
  renameSync(tmp, PROG);
}

// ---------------------------------------------------------------------------
// Manifest province
// ---------------------------------------------------------------------------

function buildManifest(prog: Prog): Record<string, unknown> {
  const done = prog.done ?? {};
  const cities = Object.keys(done).sort();
  const nCities = cities.length;
  const withGrid = cities.filter((c) => done[c]?.has_grid);
  const totalLots = cities.reduce((s, c) => s + (done[c]?.lots ?? 0), 0);
  const totalZone = cities.reduce((s, c) => s + (done[c]?.with_code_zone ?? 0), 0);
  const totalAttrs = cities.reduce((s, c) => s + (done[c]?.with_building_attrs ?? 0), 0);
  const totalJoin = cities.reduce((s, c) => s + (done[c]?.join_matched ?? 0), 0);

  return {
    dataset: "index-immo (zero-copie z∩m∩p, federation-first)",
    snapshot: core.SNAPSHOT,
    source: core.SOURCE,
    schema: core.OUT_SCHEMA.map(([n, t]) => ({ name: n, type: t })),
    join_key:
      "no_lot normalisé (sans espaces) vs role-foncier ; " +
      "feature_id=geoId pour join geo (PMTiles/cadastre)",
    code_zone_method:
      "point-in-polygon centroïde (representative_point) sur " +
      "grille zonage normalized/ca-qc-zonage/<grid_slug>.geojson",
    anti_invention:
      "code_zone=null si pas de grille ou hors polygone ; " +
      "attrs bâtiment=null si pas de match rôle",
    counts: {
      munis_indexed: nCities,
      munis_with_zonage_grid: withGrid.length,
      total_lots: totalLots,
    },
    coverage_pct: {
      munis_with_code_zone_grid: nCities ? round2((100 * withGrid.length) / nCities) : 0.0,
      lots_with_code_zone: totalLots ? round2((100 * totalZone) / totalLots) : 0.0,
      lots_with_building_attrs: totalLots ? round2((100 * totalAttrs) / totalLots) : 0.0,
      lots_role_join: totalLots ? round2((100 * totalJoin) / totalLots) : 0.0,
    },
    munis_with_grid: [...withGrid].sort(),
    cities: Object.fromEntries(
      cities.map((c) => [
        c,
        {
          lots: done[c]?.lots ?? 0,
          has_grid: !!done[c]?.has_grid,
          grid_slug: done[c]?.grid_slug ?? null,
          code_zone_pct: done[c]?.code_zone_pct ?? 0.0,
          building_pct: done[c]?.building_pct ?? 0.0,
          join_pct: done[c]?.join_pct ?? 0.0,
        },
      ]),
    ),
  };
}

async function writeManifest(
  s3: S3Client,
  prog: Prog,
  noUpload = false,
): Promise<{ manifest: Record<string, unknown>; local: string }> {
  const manifest = buildManifest(prog);
  mkdirSync(WORK, { recursive: true });
  const local = WORK + "/manifest.json";
  writeFileSync(local, JSON.stringify(manifest, null, 2));
  if (!noUpload) {
    await putBytes(s3, MANIFEST_KEY, readFileSync(local), "application/json");
  }
  return { manifest, local };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Args {
  maxSeconds: number;
  chunk: number;
  only?: string;
  noUpload: boolean;
  manifestOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { maxSeconds: 86400, chunk: 0, noUpload: false, manifestOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--max-seconds") a.maxSeconds = Number(argv[++i]);
    else if (t === "--chunk") a.chunk = Number(argv[++i]);
    else if (t === "--only") a.only = argv[++i];
    else if (t === "--no-upload") a.noUpload = true;
    else if (t === "--manifest-only") a.manifestOnly = true;
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
  const s3 = core_s3Client();

  const prog = loadProg();
  prog.done ??= {};
  prog.skip_exists ??= [];
  prog.no_cadastre ??= [];
  prog.errors ??= [];

  if (a.manifestOnly) {
    const { manifest, local } = await writeManifest(s3, prog, a.noUpload);
    const counts = manifest["counts"] as { munis_indexed: number; munis_with_zonage_grid: number; total_lots: number };
    console.log(
      `MANIFEST ${a.noUpload ? local : MANIFEST_KEY} munis=${counts.munis_indexed} ` +
        `with_grid=${counts.munis_with_zonage_grid} lots=${counts.total_lots}`,
    );
    return;
  }

  // Résolveur de grille (map curée + auto-match grilles clean)
  const gridsMap = JSON.parse(readFileSync(GRIDS_MAP, "utf8")) as Record<string, string | null>;
  const cleanGrids = await listCleanGridSlugs(s3);
  const resolver = new GridResolver(gridsMap, cleanGrids);
  console.log(`grilles zonage clean disponibles: ${cleanGrids.size} ; map non-null: ${resolver.mapped.size}`);

  let allSlugs = (await listSlugs(s3, CAD_PREFIX, ".geojson", true)).sort();
  const indexSlugs = new Set(await listSlugs(s3, INDEX_PREFIX, ".parquet", true));

  if (a.only) {
    allSlugs = allSlugs.filter((s) => s === a.only);
    if (allSlugs.length === 0) {
      console.log(`ERREUR: slug --only=${a.only} introuvable dans ${CAD_PREFIX}`);
      return;
    }
  }

  console.log(`cadastre slugs: ${allSlugs.length} ; index-immo déjà présents: ${indexSlugs.size}`);

  const t0 = Date.now();
  let processed = 0;
  for (const slug of allSlugs) {
    if (slug in prog.done) continue;
    if (indexSlugs.has(slug)) {
      if (!prog.skip_exists.includes(slug)) {
        prog.skip_exists.push(slug);
        saveProg(prog);
      }
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

    const [gridSlug, gmethod] = resolver.resolve(slug);

    let rows: Awaited<ReturnType<typeof core.buildCity>>["rows"];
    let stats: Awaited<ReturnType<typeof core.buildCity>>["stats"];
    try {
      const r = await core.buildCity(s3, slug, gridSlug);
      rows = r.rows;
      stats = r.stats;
    } catch (e) {
      console.log(`FAIL-BUILD  ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `build:${String(e)}`]);
      saveProg(prog);
      await sleep(500);
      continue;
    }
    if (rows === null) {
      console.log(`NO-CADASTRE ${slug.padEnd(44)} ${stats.error ?? ""}`);
      if (!prog.no_cadastre.includes(slug)) {
        prog.no_cadastre.push(slug);
        saveProg(prog);
      }
      continue;
    }

    const out = WORK + `/${slug}.parquet`;
    let nrows: number;
    try {
      nrows = await core.writeParquet(rows, out);
    } catch (e) {
      console.log(`FAIL-PARQUET ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `parquet:${String(e)}`]);
      saveProg(prog);
      cleanup(out);
      continue;
    }

    if (!a.noUpload) {
      try {
        // clé EXACTE = slug cadastre canonique (jamais slugify ascii)
        await putBytes(s3, INDEX_PREFIX + `${slug}.parquet`, readFileSync(out), "application/octet-stream");
      } catch (e) {
        console.log(`FAIL-UPLOAD ${slug.padEnd(44)} ${String(e)}`);
        prog.errors.push([slug, `upload:${String(e)}`]);
        saveProg(prog);
        cleanup(out);
        continue;
      }
    }

    const s = stats as core.CityStats;
    console.log(
      `OK  ${slug.padEnd(44)} lots=${String(nrows).padEnd(6)} ` +
        `code_zone=${fmtPct(s.code_zone_pct)} building=${fmtPct(s.building_pct)} ` +
        `join=${fmtPct(s.join_pct)} grid=${s.has_grid ? "Y" : "-"}(${s.has_grid ? gmethod : "no-grid"})`,
    );

    prog.done[slug] = {
      lots: s.lots,
      with_code_zone: s.with_code_zone,
      with_building_attrs: s.with_building_attrs,
      join_matched: s.join_matched,
      code_zone_pct: s.code_zone_pct,
      building_pct: s.building_pct,
      join_pct: s.join_pct,
      has_grid: s.has_grid,
      grid_slug: s.has_grid ? gridSlug : null,
      grid_method: s.has_grid ? gmethod : null,
    };
    saveProg(prog);
    cleanup(out);

    // Rafraîchit le manifest périodiquement (toutes les 25 munis).
    if (!a.noUpload && Object.keys(prog.done).length % 25 === 0) {
      try {
        await writeManifest(s3, prog);
      } catch (e) {
        console.log(`WARN manifest refresh: ${String(e)}`);
      }
    }
  }

  // Manifest final du run
  if (!a.noUpload) {
    try {
      const { manifest } = await writeManifest(s3, prog);
      const counts = manifest["counts"] as { munis_indexed: number; munis_with_zonage_grid: number; total_lots: number };
      console.log(
        `MANIFEST ${MANIFEST_KEY} munis=${counts.munis_indexed} ` +
          `with_grid=${counts.munis_with_zonage_grid} lots=${counts.total_lots}`,
      );
    } catch (e) {
      console.log(`WARN manifest final: ${String(e)}`);
    }
  }

  console.log(
    `=== chunk fin : done=${Object.keys(prog.done).length} skip_exists=${prog.skip_exists.length} ` +
      `no_cadastre=${prog.no_cadastre.length} errors=${prog.errors.length} (sur ${allSlugs.length} slugs) ===`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
/** Reproduit le format Python "%5.1f%%" (largeur 5, 1 décimale). */
function fmtPct(x: number): string {
  return `${x.toFixed(1).padStart(5)}%`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
