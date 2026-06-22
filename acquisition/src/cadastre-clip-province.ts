/**
 * cadastre-clip-province.ts — Batch PROVINCE du clip-fix cadastre via frontières
 * SDA (en masse, sans Overpass).
 *
 * Port fidèle de `acquisition/cadastre_clip_province.py`. Parcourt
 * normalized/qc-cadastre-lots/*.geojson (~1102 munis QC) et clippe chacun à sa
 * frontière municipale SDA officielle (index local, 0 appel réseau/ville).
 *
 * GATE (commit seulement si) : boundary_match ; retained_pct > MIN_RETAINED et
 * <= 100 ; si parquet rôle dispo : join_after >= MIN_JOIN.
 * COMMIT (non-destructif) : backup original -> qc-cadastre-lots-preclip/<slug> ;
 * upload clippé -> qc-cadastre-lots/<slug> (canonical).
 *
 * IDEMPOTENT & RESUMABLE : skip si preclip existe / si déjà dans le checkpoint
 * /tmp/clip_province_progress.json ; borné par --max-seconds.
 *
 * Usage :
 *   tsx src/cadastre-clip-province.ts [--max-seconds 3000] [--chunk N]
 *       [--only SLUG] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, exists, getBytes, putBytes, copyObject, listSlugs } from "./lib/s3.js";
import { SDAIndex, clipSlug, norm } from "./cadastre-clip-sda.js";
import { fetchIndex } from "./role-foncier.js";
import { readParquetRows } from "./lib/parquet-read.js";

const PROG = "/tmp/clip_province_progress.json";
const WORK = "/tmp/clip_province";
const BOUNDARIES = WORK + "/qc-municipalites.geojson";
const ROLE_INDEX = WORK + "/role_index.json";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const PRECLIP_PREFIX = "normalized/qc-cadastre-lots-preclip/";
const ROLE_PREFIX = "registry/role-foncier/";
const SDA_BOUNDARIES_KEY = "normalized/qc-admin-boundaries/qc-municipalites.geojson";

const MIN_RETAINED = 2.0; // % — en deçà = polygone douteux -> skip
const MIN_JOIN = 75.0; // % — exigé uniquement si parquet rôle dispo

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

interface DoneEntry {
  sda_code?: string;
  before: number;
  after: number;
  ret: number;
  join_after?: number;
  method?: string;
}
interface GateFail {
  slug: string;
  before: number;
  after: number;
  ret: number;
  join_after?: number;
  method?: string;
}
interface Prog {
  done: Record<string, DoneEntry>;
  skip_preclip: string[];
  no_boundary: string[];
  gate_fail: GateFail[];
  errors: [string, string][];
}

function loadProg(): Prog {
  try {
    return JSON.parse(readFileSync(PROG, "utf8")) as Prog;
  } catch {
    return { done: {}, skip_preclip: [], no_boundary: [], gate_fail: [], errors: [] };
  }
}
function saveProg(p: Prog): void {
  const tmp = PROG + ".tmp";
  writeFileSync(tmp, JSON.stringify(p));
  renameSync(tmp, PROG);
}

// ---------------------------------------------------------------------------
// Inputs : frontières SDA + index rôle (fallback code)
// ---------------------------------------------------------------------------

async function ensureInputs(s3: S3Client): Promise<void> {
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(BOUNDARIES)) {
    writeFileSync(BOUNDARIES, await getBytes(s3, SDA_BOUNDARIES_KEY));
  }
  if (!existsSync(ROLE_INDEX)) {
    // index rôle MAMH {norm(nom): [code_geo, nom]} pour le fallback code (best effort)
    try {
      const index = await fetchIndex(2026);
      const ri: Record<string, [string, string]> = {};
      for (const e of Object.values(index)) {
        if (e.code_geo) ri[norm(e.nom)] = [e.code_geo, e.nom];
      }
      writeFileSync(ROLE_INDEX, JSON.stringify(ri));
    } catch (e) {
      console.log(`WARN role index fetch failed (${String(e)}) — fallback désactivé`);
    }
  }
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

  const s3 = s3Client();
  await ensureInputs(s3);
  const idx = new SDAIndex(BOUNDARIES);
  if (existsSync(ROLE_INDEX)) idx.attachRoleIndex(ROLE_INDEX);

  const prog = loadProg();
  prog.done ??= {};
  prog.skip_preclip ??= [];
  prog.no_boundary ??= [];
  prog.gate_fail ??= [];
  prog.errors ??= [];

  let allSlugs = (await listSlugs(s3, CAD_PREFIX, ".geojson")).sort();
  const roleSlugs = new Set(await listSlugs(s3, ROLE_PREFIX, ".parquet"));
  const preclipSlugs = new Set(await listSlugs(s3, PRECLIP_PREFIX, ".geojson"));

  if (a.only) allSlugs = allSlugs.filter((s) => s === a.only);

  mkdirSync(WORK + "/lots", { recursive: true });
  mkdirSync(WORK + "/clipped", { recursive: true });
  mkdirSync(WORK + "/role", { recursive: true });

  const t0 = Date.now();
  let processed = 0;
  for (const slug of allSlugs) {
    if (slug in prog.done) continue;
    if (preclipSlugs.has(slug)) {
      if (!prog.skip_preclip.includes(slug)) prog.skip_preclip.push(slug);
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

    const lots = WORK + `/lots/${slug}.geojson`;
    try {
      if (!existsSync(lots)) {
        writeFileSync(lots, await getBytes(s3, CAD_PREFIX + `${slug}.geojson`));
      }
    } catch (e) {
      console.log(`FAIL-DL ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `dl:${String(e)}`]);
      saveProg(prog);
      continue;
    }

    let rolePath: string | null = null;
    let roleRows: { NO_LOT?: unknown; role_usage_cubf?: unknown }[] | null = null;
    if (roleSlugs.has(slug)) {
      rolePath = WORK + `/role/${slug}.parquet`;
      if (!existsSync(rolePath)) {
        try {
          writeFileSync(rolePath, await getBytes(s3, ROLE_PREFIX + `${slug}.parquet`));
        } catch {
          rolePath = null;
        }
      }
      if (rolePath) {
        try {
          roleRows = (await readParquetRows(rolePath, ["NO_LOT", "role_usage_cubf"])) as {
            NO_LOT?: unknown;
            role_usage_cubf?: unknown;
          }[];
        } catch {
          roleRows = null;
        }
      }
    }

    const out = WORK + `/clipped/${slug}.geojson`;
    let r: ReturnType<typeof clipSlug>;
    try {
      r = clipSlug(idx, slug, lots, out, roleRows);
    } catch (e) {
      console.log(`FAIL-CLIP ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `clip:${String(e)}`]);
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    if (!r.boundary_match) {
      console.log(`NO-BOUNDARY ${slug.padEnd(44)} before=${r.before} (skip)`);
      if (!prog.no_boundary.includes(slug)) prog.no_boundary.push(slug);
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    const retained = r.retained_pct;
    const ja = r.join_after;
    let gate = retained > MIN_RETAINED && retained <= 100.0;
    if (ja !== undefined && ja !== null) gate = gate && ja >= MIN_JOIN;

    let msg =
      `${slug.padEnd(44)} code=${r.sda_code} before=${r.before} after=${r.after} ` +
      `ret=${retained.toFixed(1)}% method=${r.resolve_method}`;
    if (ja !== undefined && ja !== null) {
      msg += ` join ${r.join_before}->${ja} cov=${r.matched_coverage}`;
    }
    msg += `  gate=${gate ? "PASS" : "FAIL"}`;
    console.log(msg);

    if (!gate) {
      prog.gate_fail.push({
        slug,
        before: r.before,
        after: r.after,
        ret: retained,
        ...(ja !== undefined ? { join_after: ja } : {}),
        ...(r.resolve_method !== undefined ? { method: r.resolve_method } : {}),
      });
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    if (a.dryRun) {
      cleanup(lots, out);
      continue;
    }

    // COMMIT — backup original (si absent) puis upload clippé
    const pre = PRECLIP_PREFIX + `${slug}.geojson`;
    try {
      if (!(await exists(s3, pre))) {
        await copyObject(s3, CAD_PREFIX + `${slug}.geojson`, pre);
      }
      await putBytes(s3, CAD_PREFIX + `${slug}.geojson`, readFileSync(out), "application/geo+json");
    } catch (e) {
      console.log(`FAIL-UPLOAD ${slug.padEnd(44)} ${String(e)}`);
      prog.errors.push([slug, `upload:${String(e)}`]);
      saveProg(prog);
      cleanup(lots, out);
      continue;
    }

    prog.done[slug] = {
      ...(r.sda_code !== undefined ? { sda_code: r.sda_code } : {}),
      before: r.before,
      after: r.after,
      ret: retained,
      ...(ja !== undefined ? { join_after: ja } : {}),
      ...(r.resolve_method !== undefined ? { method: r.resolve_method } : {}),
    };
    saveProg(prog);
    cleanup(lots, out);
  }

  console.log(
    `=== chunk fin : done=${Object.keys(prog.done).length} skip_preclip=${prog.skip_preclip.length} ` +
      `no_boundary=${prog.no_boundary.length} gate_fail=${prog.gate_fail.length} ` +
      `errors=${prog.errors.length} (sur ${allSlugs.length} slugs) ===`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
