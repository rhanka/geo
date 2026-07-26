/**
 * norms-manifest-refresh — REFRESH the `qc-zonage-norms` manifest entry for a set of
 * slugs whose parquet was RE-DEPOSITED (overwritten) — reconstructing each entry from
 * the CURRENT parquet + a LIVE SIG cross-validation and UPSERTING it.
 *
 * `zonage-norms-manifest-merge.ts` only ADDS parquet slugs ABSENT from the manifest;
 * it never refreshes an existing (stale/garbage) entry. After a re-extraction that
 * overwrites an existing slug's parquet, this tool brings that slug's manifest entry
 * back in sync (methode, source_url, unique_zone_codes, published_field_pct, crossval).
 *
 * Read-modify-write of the shared manifest — run SINGLE-PROCESS only (no concurrent
 * manifest writer). DRY by default; pass --apply to write.
 *
 * Usage: npx tsx acquisition/src/norms-manifest-refresh.ts --slugs a,b,c [--apply]
 */
import { s3Client, getBytes } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  crossValidateZoneCodes,
  normsKey,
  upsertManifest,
  readManifest,
  type ManifestEntry,
} from "./lib/zonage-norms.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import type { S3Client } from "@aws-sdk/client-s3";

const NORM_VALUE_COLS = [
  "densite_value", "hauteur_min_value", "hauteur_max_value", "frontage_min_value",
  "superficie_min_value", "marge_avant_min_value", "marge_laterale_min_value", "marge_arriere_min_value",
];

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function entryFromParquet(s3: S3Client, slug: string): Promise<ManifestEntry | null> {
  const buf = await getBytes(s3, normsKey(slug));
  const rows = await readParquetRowsFromBuffer(buf);
  if (rows.length === 0) return null;
  const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  const codes = new Set<string>();
  let publishedCells = 0;
  for (const r of rows) {
    const zc = str(r["zone_code"]);
    if (zc) codes.add(zc);
    for (const c of NORM_VALUE_COLS) if (r[c] != null) publishedCells++;
  }
  const r0 = rows[0]!;
  const pubPct = rows.length ? Math.round((publishedCells / (rows.length * 8)) * 1000) / 10 : 0;
  const fakeZones = [...codes].map((c) => ({ zone_code: c } as unknown as ZoneNormsT));
  const cross = await crossValidateZoneCodes(s3, slug, fakeZones);
  const reglement = str(r0["_reglement"]);
  return {
    slug,
    key: normsKey(slug),
    ...(reglement ? { reglement } : {}),
    source_url: str(r0["_source_url"]) ?? "non-disponible",
    methode: str(r0["_methode"]) ?? "unknown",
    snapshot: str(r0["_snapshot"]) ?? new Date().toISOString().slice(0, 10),
    zone_rows: rows.length,
    unique_zone_codes: codes.size,
    published_field_pct: pubPct,
    crossval: {
      gridFound: cross.gridFound,
      sigZoneCodes: cross.sigZoneCodes,
      overlap: cross.overlap,
      recoupExtracted: Math.round(cross.recoupExtracted * 1000) / 1000,
      recoupSig: Math.round(cross.recoupSig * 1000) / 1000,
    },
    deposited_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const slugsArg = get("slugs");
  if (!slugsArg) throw new Error("required: --slugs a,b,c");
  const slugs = slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const apply = process.argv.includes("--apply");
  const s3 = s3Client();

  const before = await readManifest(s3);
  const beforeBySlug = new Map(before.entries.map((e) => [e.slug, e]));

  const results: Array<{ slug: string; ok: boolean; before?: unknown; after?: unknown; reason?: string }> = [];
  for (const slug of slugs) {
    try {
      const entry = await entryFromParquet(s3, slug);
      if (!entry) {
        results.push({ slug, ok: false, reason: "no parquet rows" });
        continue;
      }
      const prev = beforeBySlug.get(slug);
      if (apply) await upsertManifest(s3, entry);
      results.push({
        slug,
        ok: true,
        before: prev ? { uzc: prev.unique_zone_codes, pubPct: prev.published_field_pct, overlap: prev.crossval?.overlap, methode: prev.methode } : null,
        after: { uzc: entry.unique_zone_codes, pubPct: entry.published_field_pct, overlap: entry.crossval?.overlap, recoupSig: entry.crossval?.recoupSig, methode: entry.methode },
      });
      console.error(`[refresh] ${apply ? "UPSERT" : "DRY"} ${slug}: uzc=${entry.unique_zone_codes} pub%=${entry.published_field_pct} overlap=${entry.crossval?.overlap}/${entry.crossval?.sigZoneCodes} method=${entry.methode}`);
    } catch (e) {
      results.push({ slug, ok: false, reason: (e as Error).message.slice(0, 120) });
      console.error(`[refresh] ! ${slug}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(JSON.stringify({ apply, results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
