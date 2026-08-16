/**
 * Sonde READ-ONLY : le qc-zonage servi d'amherst a-t-il flat == nested ?
 * Décisif avant re-fold : lot-zone-join-run lit resolveZonesKey [flat, nested]
 * (FLAT d'abord), or geo-zones exige le NESTED (autoritaire). Si flat≠nested,
 * le re-fold utiliserait le flat périmé → il faut d'abord fixer l'ordre/synchro.
 */
import { objectHead, getBytes, s3Client } from "./lib/s3.js";

const FLAT = "normalized/ca-qc-zonage/qc-zonage-amherst.geojson";
const NESTED = "normalized/ca-qc-zonage/qc-zonage-amherst/qc-zonage-amherst.geojson";

function codeSet(buf: Buffer): Set<string> {
  const fc = JSON.parse(buf.toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> }> };
  const s = new Set<string>();
  for (const f of fc.features ?? []) {
    for (const k of ["code_zone", "zone_code", "ZONE", "zone"]) {
      const v = f.properties?.[k];
      if (typeof v === "string" && v.trim()) { s.add(v.trim()); break; }
    }
  }
  return s;
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const hf = await objectHead(s3, FLAT);
  const hn = await objectHead(s3, NESTED);
  process.stdout.write(`FLAT exists=${hf.exists} bytes=${hf.contentLength ?? "—"} etag=${hf.etag ?? "—"}\n`);
  process.stdout.write(`NESTED exists=${hn.exists} bytes=${hn.contentLength ?? "—"} etag=${hn.etag ?? "—"}\n`);
  if (!hf.exists && hn.exists) { process.stdout.write("→ FLAT ABSENT : runner [flat,nested] lira NESTED (autoritaire). SAFE.\n"); return; }
  if (hf.exists && !hn.exists) { process.stdout.write("→ NESTED ABSENT : anomalie (audit lit nested). À investiguer.\n"); return; }
  if (hf.etag && hn.etag && hf.etag === hn.etag) { process.stdout.write("→ etag IDENTIQUE : flat==nested byte-exact. Re-fold SAFE (même zones).\n"); return; }
  const [bf, bn] = await Promise.all([getBytes(s3, FLAT), getBytes(s3, NESTED)]);
  const cf = codeSet(bf), cn = codeSet(bn);
  const onlyFlat = [...cf].filter((c) => !cn.has(c));
  const onlyNested = [...cn].filter((c) => !cf.has(c));
  process.stdout.write(`→ etag DIFFÈRENT. codes flat=${cf.size} nested=${cn.size} only_flat=${onlyFlat.length} only_nested=${onlyNested.length}\n`);
  process.stdout.write(onlyFlat.length === 0 && onlyNested.length === 0
    ? "  codes identiques (géométrie peut différer) — re-fold prudent, vérifier après.\n"
    : `  ⚠ VOCABULAIRE DIFFÈRE → flat PÉRIMÉ : NE PAS re-folder via runner flat-first ; fixer resolveZonesKey→nested-first d'abord.\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 2; });
