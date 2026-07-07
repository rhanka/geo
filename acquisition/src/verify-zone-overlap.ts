/**
 * verify-zone-overlap.ts — post-deposit anti-invention audit for a served zones
 * layer. Loads normalized/ca-qc-zonage/qc-zonage-<slug>.geojson from S3, and
 * checks the zone_code values are REAL lettered codes that OVERLAP the deposited
 * norms grille (registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet) using the
 * exact runtime join canon. Optionally DROPS a failing deposit from S3 (--drop).
 *
 * PASS iff: distinct>=3 AND codeLike>=50% AND (no norms grille OR overlap>0).
 *
 * USAGE:
 *   npx tsx acquisition/src/verify-zone-overlap.ts --slugs a,b,c [--drop]
 */
import { s3Client, getJson, getBytes, exists, deleteObject, copyObject } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const NORMS_PREFIX = "registry/qc-zonage-norms/";
const CODE_RE = /^(?:[A-Za-z]{1,5}[ ._-]?\d|\d{1,5}[ ._-][A-Za-z])/;

function arg(k: string): string | undefined { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; }
function has(k: string): boolean { return process.argv.includes(`--${k}`); }

interface GeoFC { features?: Array<{ properties?: Record<string, unknown> | null }> }

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const drop = has("drop");
  if (slugs.length === 0) { console.error("usage: --slugs a,b,c [--drop]"); process.exit(2); }
  const s3 = s3Client();
  const pass: string[] = [], fail: string[] = [], absent: string[] = [];
  for (const slug of slugs) {
    const flat = `${ZONES_PREFIX}qc-zonage-${slug}.geojson`;
    const sub = `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
    const key = (await exists(s3, flat)) ? flat : (await exists(s3, sub)) ? sub : null;
    if (!key) { absent.push(slug); console.log(`ABSENT ${slug} (no deposit)`); continue; }
    const fc = (await getJson(s3, key)) as GeoFC;
    const codes = new Set<string>();
    for (const f of fc.features ?? []) { const c = f.properties?.["zone_code"]; if (c !== null && c !== undefined && String(c).trim() !== "") codes.add(String(c).trim()); }
    const distinct = [...codes];
    const codeLike = distinct.filter((c) => CODE_RE.test(c));
    const codeLikeRatio = distinct.length ? codeLike.length / distinct.length : 0;
    // norms overlap (canon join)
    const normsKey = `${NORMS_PREFIX}qc-zonage-norms-${slug}.parquet`;
    let overlap: number | null = null, normsCount = 0;
    if (await exists(s3, normsKey)) {
      const rows = await readParquetRowsFromBuffer(await getBytes(s3, normsKey), ["zone_code"]);
      const normsSet = new Set<string>();
      for (const r of rows) { const c = r["zone_code"]; if (c !== null && c !== undefined && String(c).trim() !== "") normsSet.add(canonicalizeZoneCodeForJoin(String(c))); }
      normsCount = normsSet.size;
      overlap = 0;
      for (const c of distinct) if (normsSet.has(canonicalizeZoneCodeForJoin(c))) overlap++;
    }
    const ok = distinct.length >= 3 && codeLikeRatio >= 0.5 && (overlap === null || overlap > 0);
    const line = `${ok ? "PASS" : "FAIL"} ${slug} features=${fc.features?.length ?? 0} distinct=${distinct.length} codeLike=${(codeLikeRatio * 100).toFixed(0)}% norms=${normsCount} overlap=${overlap ?? "n/a"} key=${key} sample=${JSON.stringify(distinct.slice(0, 8))}`;
    console.log(line);
    if (ok) pass.push(slug);
    else {
      fail.push(slug);
      if (drop) {
        const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
        for (const k of [flat, sub, `${ZONES_PREFIX}qc-zonage-${slug}.stats.json`, `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.stats.json`]) {
          if (await exists(s3, k)) {
            const backup = `${ZONES_PREFIX}_rejected/${k.slice(ZONES_PREFIX.length).replace(/\//g, "__")}.${ts}`;
            await copyObject(s3, k, backup);
            await deleteObject(s3, k);
            console.log(`  DROPPED ${k} -> ${backup}`);
          }
        }
      }
    }
  }
  console.log(`\nSUMMARY pass=${pass.length} [${pass.join(",")}] fail=${fail.length} [${fail.join(",")}] absent=${absent.length}`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
