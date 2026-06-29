/**
 * enrich-lots-codezone.ts — FIX FÉDÉRATION : enrichit le cadastre clippé avec
 * code_zone (immo-ready).
 *
 * Port fidèle de `acquisition/enrich_lots_codezone.py`. On AJOUTE
 * properties.code_zone à chaque feature du geojson cadastre, par jointure no_lot
 * normalisé (espaces retirés) depuis registry/index-immo/<slug>.parquet (qui
 * possède déjà no_lot -> code_zone), puis re-upload le geojson enrichi.
 *
 * Éligibilité : un muni n'est traité que si son parquet index a > --min-pct
 * (déf. 50%) de code_zone non-null.
 *
 * ANTI-INVENTION : code_zone = lookup[normalize(no_lot)] OU null. Jamais deviné.
 * NON-DESTRUCTIF : on ajoute/écrase la seule clé code_zone.
 * Idempotent : checkpoint /tmp/enrich_codezone_progress.json (skip sauf --force).
 *
 * Usage :
 *   tsx src/enrich-lots-codezone.ts --only chelsea
 *   tsx src/enrich-lots-codezone.ts
 *   tsx src/enrich-lots-codezone.ts --no-upload --only chelsea
 *   tsx src/enrich-lots-codezone.ts --force
 *   tsx src/enrich-lots-codezone.ts --list
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, exists, getBytes, getJson, putBytes, listSlugs } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";

const INDEX_PREFIX = "registry/index-immo/";
const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const PROG = "/tmp/enrich_codezone_progress.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Liste les slugs ayant un parquet registry/index-immo/<slug>.parquet. */
async function listIndexSlugs(s3: S3Client): Promise<string[]> {
  return (await listSlugs(s3, INDEX_PREFIX, ".parquet")).sort();
}

/** Normalisation canonique du no_lot : retirer TOUS les espaces (contrat §3). */
function normLot(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).replace(/ /g, "");
}

/**
 * Charge le parquet index -> [{norm(no_lot): code_zone}, code_zone_pct, n_rows].
 * Anti-invention : une valeur null reste null ; on ne fabrique jamais de code.
 */
async function buildLookup(
  s3: S3Client,
  slug: string,
): Promise<[Map<string, string | null> | null, number, number]> {
  const key = `${INDEX_PREFIX}${slug}.parquet`;
  if (!(await exists(s3, key))) return [null, 0.0, 0];
  const buf = await getBytes(s3, key);
  const rows = await readParquetRowsFromBuffer(buf, ["no_lot", "code_zone"]);
  const n = rows.length;
  let nn = 0;
  const lookup = new Map<string, string | null>();
  for (const r of rows) {
    const cz = r["code_zone"];
    if (cz !== null && cz !== undefined && cz !== "") nn++;
    const k = normLot(r["no_lot"]);
    if (k === null) continue;
    const czVal = cz !== null && cz !== undefined && cz !== "" ? (cz as string) : null;
    // Première occurrence non-vide gagne ; on n'écrase pas un code par un null.
    if (!lookup.has(k)) lookup.set(k, czVal);
    else if (lookup.get(k) === null && czVal !== null) lookup.set(k, czVal);
  }
  const pct = n ? (100.0 * nn) / n : 0.0;
  return [lookup, pct, n];
}

interface EnrichStats {
  lots: number;
  with_code_zone: number;
  code_zone_pct: number;
  lot_in_index: number;
  lot_in_index_pct: number;
  uploaded: boolean;
  error?: string;
  index_code_zone_pct?: number;
}

/**
 * Charge le geojson cadastre, ajoute properties.code_zone, re-upload.
 * NON-DESTRUCTIF : ne touche que la clé code_zone.
 */
async function enrichCity(
  s3: S3Client,
  slug: string,
  lookup: Map<string, string | null>,
  noUpload = false,
): Promise<EnrichStats> {
  const cadKey = `${CAD_PREFIX}${slug}.geojson`;
  if (!(await exists(s3, cadKey))) {
    return {
      lots: 0,
      with_code_zone: 0,
      code_zone_pct: 0,
      lot_in_index: 0,
      lot_in_index_pct: 0,
      uploaded: false,
      error: `cadastre geojson absent: ${cadKey}`,
    };
  }
  const gj = (await getJson(s3, cadKey)) as {
    features?: { properties?: Record<string, unknown> }[];
  };
  const feats = gj.features ?? [];
  const n = feats.length;
  let withCz = 0;
  let matched = 0;
  for (const f of feats) {
    const p = (f.properties ??= {});
    let nl = p["NO_LOT"];
    if (nl === null || nl === undefined) nl = p["noLot"];
    const k = normLot(nl);
    const cz = k !== null ? lookup.get(k) ?? null : null;
    if (k !== null && lookup.has(k)) matched++;
    // Ajout/écrasement de la SEULE clé code_zone (idempotent, non-destructif).
    p["code_zone"] = cz; // null si pas de match — JAMAIS inventé.
    if (cz !== null) withCz++;
  }
  const pct = n ? (100.0 * withCz) / n : 0.0;
  const matchPct = n ? (100.0 * matched) / n : 0.0;
  if (!noUpload) {
    const body = Buffer.from(JSON.stringify(gj), "utf8");
    await putBytes(s3, cadKey, body, "application/geo+json");
  }
  return {
    lots: n,
    with_code_zone: withCz,
    code_zone_pct: round2(pct),
    lot_in_index: matched,
    lot_in_index_pct: round2(matchPct),
    uploaded: !noUpload,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

interface Prog {
  done: Record<string, EnrichStats>;
}
function loadProg(): Prog {
  try {
    return JSON.parse(readFileSync(PROG, "utf8")) as Prog;
  } catch {
    return { done: {} };
  }
}
function saveProg(prog: Prog): void {
  writeFileSync(PROG, JSON.stringify(prog, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Args {
  only?: string;
  minPct: number;
  noUpload: boolean;
  force: boolean;
  list: boolean;
  maxSeconds: number;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { minPct: 50.0, noUpload: false, force: false, list: false, maxSeconds: 3600 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--only") a.only = argv[++i];
    else if (t === "--min-pct") a.minPct = Number(argv[++i]);
    else if (t === "--no-upload") a.noUpload = true;
    else if (t === "--force") a.force = true;
    else if (t === "--list") a.list = true;
    else if (t === "--max-seconds") a.maxSeconds = Number(argv[++i]);
  }
  return a;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));

  const s3 = s3Client();
  let slugs = await listIndexSlugs(s3);
  if (a.only) {
    slugs = slugs.filter((x) => x === a.only);
    if (slugs.length === 0) {
      console.log(`slug introuvable dans l'index: ${a.only}`);
      return;
    }
  }

  // 1) Évaluer l'éligibilité (lecture seule des parquets).
  const eligible: [string, Map<string, string | null>, number, number][] = [];
  console.log("=== éligibilité (index registry/index-immo, lecture seule) ===");
  for (const slug of slugs) {
    const [lookup, pct, nrows] = await buildLookup(s3, slug);
    if (lookup === null) {
      console.log(`  ${slug.padEnd(44)} parquet absent`);
      continue;
    }
    const elig = pct > a.minPct;
    if (elig) eligible.push([slug, lookup, pct, nrows]);
    if (a.list || elig) {
      console.log(
        `  ${slug.padEnd(44)} code_zone=${fmtPct(pct)} rows=${String(nrows).padEnd(6)} ` +
          `${elig ? "ELIGIBLE" : `skip(<${a.minPct.toFixed(0)}%)`}`,
      );
    }
  }

  console.log(
    `\n=== ${eligible.length} éligibles (>${a.minPct.toFixed(0)}% code_zone) sur ${slugs.length} parquets ===\n`,
  );
  if (a.list) return;

  // 2) Enrichir + re-upload.
  const prog = a.force ? { done: {} } : loadProg();
  const t0 = Date.now();
  let enriched = 0;
  for (const [slug, lookup, idxPct] of eligible) {
    if (slug in prog.done && !a.force) {
      console.log(`SKIP(done) ${slug}`);
      continue;
    }
    if ((Date.now() - t0) / 1000 > a.maxSeconds) {
      console.log("STOP wall-clock; relancer pour continuer");
      break;
    }
    let stats: EnrichStats;
    try {
      stats = await enrichCity(s3, slug, lookup, a.noUpload);
    } catch (e) {
      console.log(`FAIL ${slug.padEnd(44)} ${String(e)}`);
      await sleep(1000);
      continue;
    }
    if (stats.error) {
      console.log(`FAIL ${slug.padEnd(44)} ${stats.error}`);
      continue;
    }
    console.log(
      `OK   ${slug.padEnd(44)} lots=${String(stats.lots).padEnd(6)} ` +
        `code_zone=${fmtPct(stats.code_zone_pct)} in_index=${fmtPct(stats.lot_in_index_pct)} ` +
        `upload=${stats.uploaded ? "Y" : "DRY"}`,
    );
    stats.index_code_zone_pct = round2(idxPct);
    prog.done[slug] = stats;
    saveProg(prog);
    enriched++;
    await sleep(100);
  }

  console.log(`\n=== fin: ${enriched} enrichis (${Object.keys(prog.done).length} done cumulés) ===`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
/** Format Python "%5.1f%%". */
function fmtPct(x: number): string {
  return `${x.toFixed(1).padStart(5)}%`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
