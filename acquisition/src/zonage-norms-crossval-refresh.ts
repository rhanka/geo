/**
 * zonage-norms-crossval-refresh.ts — refresh the recorded crossval of
 * ALREADY-DEPOSITED `qc-zonage-norms` manifest entries against the CURRENT SIG
 * grille PLUS the numeric-identifier (millésime) bridge, WITHOUT re-running any
 * paid OCR/vision.
 *
 * WHY. `crossValidateZoneCodes` now reconciles a pure code-FORMAT mismatch — a
 * variable letter prefix over the SAME unique zone NUMBER (repentigny vintage
 * prefixes; the Mont-Tremblant CV-RF-106 ⇄ RA-106 shape) — via `canonZone` +
 * `overlapWithNumericBridge`. Several munis were deposited (their grille FIELDS
 * extract with a high `published_field_pct`) yet carry a recorded
 * `crossval.overlap = 0` from before the bridge existed: a FALSE negative. The
 * zone codes are already in the deposited parquet, so recomputing the overlap
 * needs only the parquet + the SIG geojson — NO model call.
 *
 * This COMPLEMENTS `zonage-norms-manifest-merge.ts` (which only ADDS parquet slugs
 * absent from the manifest, never touching existing entries): this tool REFRESHES
 * existing entries whose overlap the bridge now lifts above 0.
 *
 * ANTI-FUSION / ANTI-INVENTION: the recomputation is exactly the deposit gate's
 * `crossValidateZoneCodes` — the numeric bridge fires only when a zone number is
 * unique on BOTH sides, and never fuses two distinct numbers. It only ever RAISES
 * a false-negative overlap toward the truth; it can never invent a code.
 *
 * Read-only by default (prints the before/after table). `--apply` rewrites ONLY
 * the crossval of the entries whose overlap changed — every other field and every
 * untouched entry is preserved verbatim, and the manifest is re-read immediately
 * before the write (anti-loss, mirrors manifest-merge).
 *
 * Usage:
 *   npx tsx src/zonage-norms-crossval-refresh.ts                 # dry, all overlap=0 high-field entries
 *   npx tsx src/zonage-norms-crossval-refresh.ts --slug repentigny,mercier
 *   npx tsx src/zonage-norms-crossval-refresh.ts --min-field-pct 20
 *   npx tsx src/zonage-norms-crossval-refresh.ts --apply
 */
import { writeFileSync } from "node:fs";

import type { S3Client } from "@aws-sdk/client-s3";

import { s3Client, getBytes, exists, putBytes } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  crossValidateZoneCodes,
  normsKey,
  ZONAGE_NORMS_MANIFEST_KEY,
  type Manifest,
  type ManifestEntry,
  type CrossValResult,
} from "./lib/zonage-norms.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function readManifest(s3: S3Client): Promise<Manifest> {
  if (await exists(s3, ZONAGE_NORMS_MANIFEST_KEY)) {
    const j = JSON.parse((await getBytes(s3, ZONAGE_NORMS_MANIFEST_KEY)).toString("utf8"));
    if (j && Array.isArray(j.entries)) return j as Manifest;
  }
  return { product: "qc-zonage-norms", updated_at: new Date().toISOString(), entries: [] };
}

/** Distinct zone codes deposited in a slug's parquet (the crossval only needs the codes). */
async function depositedZoneCodes(s3: S3Client, slug: string): Promise<string[] | null> {
  if (!(await exists(s3, normsKey(slug)))) return null;
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, normsKey(slug)));
  if (rows.length === 0) return null;
  const codes = new Set<string>();
  for (const r of rows) {
    const zc = r["zone_code"];
    if (zc != null && String(zc).trim()) codes.add(String(zc));
  }
  return [...codes];
}

interface Refreshed {
  slug: string;
  published_field_pct: number;
  oldOverlap: number;
  newOverlap: number;
  numericBridged: number;
  sigZoneCodes: number;
  extractedZoneCodes: number;
  crossval: CrossValResult;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const minFieldPct = Number(arg(argv, "min-field-pct") ?? "0");
  const only = arg(argv, "slug");
  const onlySet = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const reportPath = arg(argv, "report");
  const s3 = s3Client();

  const man = await readManifest(s3);
  // Candidate = a deposited entry whose recorded overlap is 0 (or absent) with a
  // gridFound=true (or unknown) — the exact "champs hauts, overlap SIG=0" shape.
  // When --slug is passed we refresh EXACTLY those (any overlap), to prove a case.
  const candidates = man.entries.filter((e) => {
    if (onlySet) return onlySet.has(e.slug);
    const overlap = e.crossval?.overlap ?? 0;
    return overlap === 0 && (e.published_field_pct ?? 0) >= minFieldPct;
  });
  console.error(
    `[refresh] manifest entries=${man.entries.length} candidates=${candidates.length}` +
      (onlySet ? ` (slug filter)` : ` (overlap=0, field%>=${minFieldPct})`),
  );

  const refreshed: Refreshed[] = [];
  const unchanged: string[] = [];
  const noParquet: string[] = [];
  for (const e of candidates) {
    const codes = await depositedZoneCodes(s3, e.slug);
    if (!codes) {
      noParquet.push(e.slug);
      continue;
    }
    const fakeZones = codes.map((c) => ({ zone_code: c }) as unknown as ZoneNormsT);
    const cross = await crossValidateZoneCodes(s3, e.slug, fakeZones);
    const oldOverlap = e.crossval?.overlap ?? 0;
    if (cross.overlap === oldOverlap) {
      unchanged.push(e.slug);
      continue;
    }
    refreshed.push({
      slug: e.slug,
      published_field_pct: e.published_field_pct ?? 0,
      oldOverlap,
      newOverlap: cross.overlap,
      numericBridged: cross.numericBridged,
      sigZoneCodes: cross.sigZoneCodes,
      extractedZoneCodes: cross.extractedZoneCodes,
      crossval: cross,
    });
    console.error(
      `[refresh] ${e.slug}: overlap ${oldOverlap} → ${cross.overlap} ` +
        `(bridged=${cross.numericBridged}, sig=${cross.sigZoneCodes}, ext=${cross.extractedZoneCodes}, ` +
        `field%=${e.published_field_pct})`,
    );
  }

  refreshed.sort((a, b) => b.newOverlap - a.newOverlap);
  const gained = refreshed.filter((r) => r.newOverlap > r.oldOverlap);
  const report = {
    apply,
    manifestEntries: man.entries.length,
    candidates: candidates.length,
    refreshedCount: refreshed.length,
    gainedOverlapCount: gained.length,
    unchanged: unchanged.length,
    noParquet: noParquet.length,
    gained: gained.map((r) => ({
      slug: r.slug,
      overlap: `${r.oldOverlap}→${r.newOverlap}`,
      numericBridged: r.numericBridged,
      sig: r.sigZoneCodes,
      extracted: r.extractedZoneCodes,
      field_pct: r.published_field_pct,
    })),
  };

  if (apply && gained.length > 0) {
    // Re-read immediately before write (anti-loss), patch ONLY the gained slugs'
    // crossval, preserve every other field and entry verbatim.
    const now = await readManifest(s3);
    const patch = new Map(gained.map((r) => [r.slug, r.crossval]));
    let patched = 0;
    const entries: ManifestEntry[] = now.entries.map((e) => {
      const c = patch.get(e.slug);
      if (!c) return e;
      patched++;
      return {
        ...e,
        crossval: {
          gridFound: c.gridFound,
          sigZoneCodes: c.sigZoneCodes,
          overlap: c.overlap,
          recoupExtracted: Math.round(c.recoupExtracted * 1000) / 1000,
          recoupSig: Math.round(c.recoupSig * 1000) / 1000,
        },
      };
    });
    const updated: Manifest = {
      product: "qc-zonage-norms",
      updated_at: new Date().toISOString(),
      entries: entries.sort((a, b) => a.slug.localeCompare(b.slug)),
    };
    await putBytes(s3, ZONAGE_NORMS_MANIFEST_KEY, JSON.stringify(updated, null, 2), "application/json");
    console.error(`[refresh] manifest WRITTEN — patched ${patched} entr(y|ies)`);
  } else {
    console.error(`[refresh] DRY (pass --apply to write; ${gained.length} entr(y|ies) would gain overlap)`);
  }

  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
