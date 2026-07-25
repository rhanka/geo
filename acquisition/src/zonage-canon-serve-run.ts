/**
 * zonage-canon-serve-run.ts — canonicalise the SERVED zone_code ORDER to ONE
 * LETTER-NUMBER surface form on the two served OGC collections of a muni, so
 * immo's EXACT passthrough join folds the norm onto the lot.
 *
 * PROBLEM — the SIG zonage layer (`normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`,
 * collection `qc-zonage-<slug>`) and the norms grille
 * (`normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson`, collection
 * `qc-zonage-norms-<slug>`) frequently serve the SAME code in DIFFERENT surface
 * forms: `103-R` vs `R-103` (champlain), `1M` vs `1-M` (plaisance), `A 10` vs
 * `A-10` (saint-frederic). The lot⋈norms JOIN reconciles these through the
 * order-INVARIANT `canonZone`, so it matched internally — but immo joins the two
 * SERVED strings EXACTLY, so a surface mismatch scored 0% and the norm NEVER
 * folded. This rewrites BOTH served geojson so the join field carries ONE
 * deterministic LETTER-NUMBER form (`canonZoneCodeServe`).
 *
 * SAFETY (anti-invention / anti-regression):
 *   • A slug is rewritten ONLY when doing so STRICTLY IMPROVES the RAW exact
 *     overlap between the two served layers (`--min-gain`, default any gain). A
 *     muni whose served forms already match (coaticook, mont-tremblant) is left
 *     UNTOUCHED — the rewrite never reduces a working overlap.
 *   • `canonZoneCodeServe` is idempotent and NON-DESTRUCTIVE: it only reorders a
 *     digit-first code and collapses a space separator; it never renumbers,
 *     zero-strips, re-cases, or blanks a value. Re-running is a no-op.
 *   • The ORIGINAL object is copied to `registry/_backups/canon-serve/…` (once)
 *     before the first overwrite, so the pre-canon form is always recoverable.
 *
 * Usage (npx tsx, from acquisition/):
 *   tsx src/zonage-canon-serve-run.ts                 # scan every FOCUS_30 slug, apply
 *   tsx src/zonage-canon-serve-run.ts --slugs champlain,plaisance
 *   tsx src/zonage-canon-serve-run.ts --dry-run       # report before/after, write nothing
 */
import { pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { FOCUS_30_SLUGS } from "./focus30-status.js";
import { copyObject, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import {
  canonZoneCodeServe,
  resolveGridKey,
  SIG_ZONE_CODE_FIELDS,
  sigZoneCodesFromGeojsonRaw,
} from "./lib/zonage-norms.js";

const SERVED_NORMS_PREFIX = "normalized/qc-zonage-norms/";
const BACKUP_PREFIX = "registry/_backups/canon-serve/";
/** Skip a served geojson larger than this (single-process re-serialisation guard). */
const DEFAULT_MAX_MB = 200;

function servedGrilleKey(slug: string): string {
  return `${SERVED_NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
}

interface Args {
  slugs: string[];
  dryRun: boolean;
  minGain: number;
  maxMb: number;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let dryRun = false;
  let minGain = 1e-9; // any strict improvement
  let maxMb = DEFAULT_MAX_MB;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--slug" || a === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--min-gain") minGain = Math.max(1e-9, Number(argv[++i] ?? "") || 1e-9);
    else if (a === "--max-mb") maxMb = Math.max(1, parseInt(String(argv[++i] ?? ""), 10) || DEFAULT_MAX_MB);
    else throw new Error(`unknown argument: ${a}`);
  }
  return { slugs: slugs.length ? [...new Set(slugs)] : [...FOCUS_30_SLUGS], dryRun, minGain, maxMb };
}

interface FeatureCollectionLike {
  type?: unknown;
  features?: Array<{ id?: unknown; properties?: Record<string, unknown> | null } & Record<string, unknown>>;
}

/**
 * Rewrite every whitelisted zone-code column (and a matching feature `id`) to its
 * `canonZoneCodeServe` form. Returns the new JSON text + how many code cells and
 * ids changed. `canonZoneCodeServe` is a no-op on already-canonical values and on
 * non-code values (numbers, GUIDs), so non-code columns are never disturbed.
 */
function rewriteGeojson(body: string): { text: string; changedCells: number; changedIds: number } | null {
  let parsed: FeatureCollectionLike;
  try {
    parsed = JSON.parse(body) as FeatureCollectionLike;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.features)) return null;
  let changedCells = 0;
  let changedIds = 0;
  for (const f of parsed.features) {
    const props = f.properties ?? {};
    const rawValuesInFeature = new Set<string>();
    for (const name of SIG_ZONE_CODE_FIELDS) {
      const v = props[name];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue; // NEVER blank a real value; leave empty cells as-is
      rawValuesInFeature.add(s);
      const canon = canonZoneCodeServe(s);
      if (canon && canon !== String(v)) {
        props[name] = canon;
        changedCells++;
      }
    }
    // Update a feature id that IS one of this feature's zone codes (grille sets id=zone_code).
    if (typeof f.id === "string") {
      const idTrim = f.id.trim();
      if (idTrim && rawValuesInFeature.has(idTrim)) {
        const canonId = canonZoneCodeServe(idTrim);
        if (canonId && canonId !== f.id) {
          f.id = canonId;
          changedIds++;
        }
      }
    }
  }
  return { text: JSON.stringify(parsed), changedCells, changedIds };
}

/** Exact-string overlap fraction |a∩b|/|a| (what immo's passthrough join realizes). */
function overlapFrac(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let common = 0;
  for (const c of a) if (b.has(c)) common++;
  return common / a.size;
}

function mapServe(codes: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const c of codes) {
    const v = canonZoneCodeServe(c);
    if (v) out.add(v);
  }
  return out;
}

interface SlugResult {
  slug: string;
  zone_key: string | null;
  grille_key: string | null;
  grille_present: boolean;
  before_raw: number;
  after_raw: number;
  wrote: boolean;
  skip_reason: string | null;
  changed_zone_cells: number;
  changed_grille_cells: number;
}

async function getOrNull(s3: S3Client, key: string): Promise<Buffer | null> {
  try {
    return await getBytes(s3, key);
  } catch (e) {
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NoSuchKey" || err.name === "NotFound" || err.Code === "NoSuchKey") {
      return null;
    }
    throw e;
  }
}

/** Backup the original object ONCE (idempotent — never clobber a prior backup). */
async function backupOnce(s3: S3Client, key: string): Promise<void> {
  const dest = BACKUP_PREFIX + key;
  if (await exists(s3, dest)) return; // keep the true pre-canon original
  await copyObject(s3, key, dest);
}

function pct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

async function runSlug(s3: S3Client, slug: string, args: Args): Promise<SlugResult> {
  const zoneKey = await resolveGridKey(s3, slug);
  const grilleKey = servedGrilleKey(slug);
  const base: SlugResult = {
    slug,
    zone_key: zoneKey,
    grille_key: null,
    grille_present: false,
    before_raw: 0,
    after_raw: 0,
    wrote: false,
    skip_reason: null,
    changed_zone_cells: 0,
    changed_grille_cells: 0,
  };
  if (!zoneKey) return { ...base, skip_reason: "zonage-absent" };

  const [zoneBuf, grilleBuf] = await Promise.all([getBytes(s3, zoneKey), getOrNull(s3, grilleKey)]);
  const grillePresent = grilleBuf !== null;
  base.grille_present = grillePresent;
  base.grille_key = grillePresent ? grilleKey : null;
  if (!grillePresent) return { ...base, skip_reason: "grille-non-servie" };

  const zoneMb = zoneBuf.byteLength / 1e6;
  const grilleMb = grilleBuf.byteLength / 1e6;
  if (zoneMb > args.maxMb || grilleMb > args.maxMb) {
    return { ...base, skip_reason: `oversized (zone ${zoneMb.toFixed(0)}MB / grille ${grilleMb.toFixed(0)}MB > ${args.maxMb}MB)` };
  }

  const zoneBody = zoneBuf.toString("utf8");
  const grilleBody = grilleBuf.toString("utf8");
  const zoneRaw = sigZoneCodesFromGeojsonRaw(zoneBody);
  const grilleRaw = sigZoneCodesFromGeojsonRaw(grilleBody);
  const beforeRaw = overlapFrac(zoneRaw, grilleRaw);
  const afterRaw = overlapFrac(mapServe(zoneRaw), mapServe(grilleRaw));
  base.before_raw = beforeRaw;
  base.after_raw = afterRaw;

  // ANTI-REGRESSION GUARD — rewrite only when it STRICTLY improves the served
  // exact overlap. A muni already matching (coaticook/MT) → afterRaw == beforeRaw
  // → skipped, untouched.
  if (afterRaw <= beforeRaw + (args.minGain - 1e-9)) {
    return { ...base, skip_reason: beforeRaw >= 0.999 ? "deja-aligne" : "aucun-gain" };
  }

  const zoneRewrite = rewriteGeojson(zoneBody);
  const grilleRewrite = rewriteGeojson(grilleBody);
  if (!zoneRewrite || !grilleRewrite) return { ...base, skip_reason: "geojson-non-parsable" };
  base.changed_zone_cells = zoneRewrite.changedCells + zoneRewrite.changedIds;
  base.changed_grille_cells = grilleRewrite.changedCells + grilleRewrite.changedIds;

  if (args.dryRun) return { ...base, wrote: false, skip_reason: "dry-run" };

  // Write the side(s) that actually changed (idempotent; back up the original first).
  if (zoneRewrite.changedCells + zoneRewrite.changedIds > 0) {
    await backupOnce(s3, zoneKey);
    await putBytes(s3, zoneKey, Buffer.from(zoneRewrite.text, "utf8"), "application/geo+json");
  }
  if (grilleRewrite.changedCells + grilleRewrite.changedIds > 0) {
    await backupOnce(s3, grilleKey);
    await putBytes(s3, grilleKey, Buffer.from(grilleRewrite.text, "utf8"), "application/geo+json");
  }
  return { ...base, wrote: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  console.log(
    `zonage-canon-serve: ${args.slugs.length} slug(s)` + (args.dryRun ? " | DRY-RUN" : " | APPLY") + ` | min-gain=${args.minGain}`,
  );
  const results: SlugResult[] = [];
  for (const slug of args.slugs) {
    try {
      const r = await runSlug(s3, slug, args);
      results.push(r);
      console.log(
        [
          (r.wrote ? "FIX " : "SKIP") + " " + slug,
          `raw ${pct(r.before_raw)}→${pct(r.after_raw)}`,
          `zone_cells=${r.changed_zone_cells}`,
          `grille_cells=${r.changed_grille_cells}`,
          r.skip_reason ? `(${r.skip_reason})` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      console.log(`ERR ${slug} ${e instanceof Error ? e.message : String(e)}`);
      results.push({
        slug,
        zone_key: null,
        grille_key: null,
        grille_present: false,
        before_raw: 0,
        after_raw: 0,
        wrote: false,
        skip_reason: "error",
        changed_zone_cells: 0,
        changed_grille_cells: 0,
      });
    }
  }
  const fixed = results.filter((r) => r.wrote);
  console.log(
    `DONE fixed=${fixed.length}/${results.length}` +
      (fixed.length ? ` slugs=[${fixed.map((r) => r.slug).join(",")}]` : ""),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
