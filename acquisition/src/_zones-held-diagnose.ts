/**
 * _zones-held-diagnose.ts — sonde DIAGNOSTIC (read-only) pour trancher les villes
 * HELD par le gate anti-régression (bernard-de-michaudville, jude) : capture GOnet
 * INCOMPLÈTE (tronquée) vs servi orphan SUPERSET (Voronoï/synthétique non prouvé).
 *
 * Discriminant qa : compare le count LIVE (returnCountOnly) au count de ma capture,
 * regarde exceededTransferLimit, et inspecte la nature du servi orphan.
 * Read-only. Aucun dépôt.
 *
 * USAGE : NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-held-diagnose.ts --manifest <f> --slugs a,b
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CaptureRunHeaderSchema, captureRunKeys, parseManifestJsonl } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S3_PREFIX = "normalized/ca-qc-zonage/";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }

async function casOctets(s3: ReturnType<typeof s3Client>, run: string, url: string): Promise<Buffer> {
  const keys = captureRunKeys(run);
  CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const m = manifest.find((l) => l.url === url) ?? manifest.find((l) => l.final_url === url);
  if (!m || m.storage_key === null) throw new Error("ligne CAS introuvable");
  return getBytes(s3, m.storage_key);
}

function countUrl(sourceUrl: string): string {
  // Remplace les params de la sous-requête /query par un returnCountOnly.
  return sourceUrl.replace(/(\/query\?)[^]*$/i, "$1where=1%3D1&returnCountOnly=true&f=json");
}

function distinctCodes(gj: { features?: Array<{ properties?: Record<string, unknown> }> }, field: string): { n: number; sample: string[] } {
  const s = new Set<string>();
  for (const f of gj.features ?? []) { const v = f.properties?.[field]; if (v !== null && v !== undefined && String(v).trim() !== "") s.add(String(v).trim()); }
  return { n: s.size, sample: [...s].slice(0, 12) };
}

async function readServed(s3: ReturnType<typeof s3Client>, slug: string): Promise<{ key: string; features: number; codes: number; confidence: string[]; source: string[] } | null> {
  for (const key of [`${S3_PREFIX}qc-zonage-${slug}.geojson`, `${S3_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]) {
    try {
      const gj = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: Array<{ properties?: Record<string, unknown> }> };
      const conf = new Set<string>(); const src = new Set<string>(); const codes = new Set<string>();
      for (const f of gj.features ?? []) {
        const p = f.properties ?? {};
        if (typeof p["confidence"] === "string") conf.add(p["confidence"]);
        if (typeof p["source"] === "string") src.add(String(p["source"]).slice(0, 60));
        const zc = p["zone_code"]; if (zc !== null && zc !== undefined && String(zc).trim() !== "") codes.add(String(zc).trim());
      }
      return { key, features: (gj.features ?? []).length, codes: codes.size, confidence: [...conf], source: [...src].slice(0, 3) };
    } catch { /* clé absente */ }
  }
  return null;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, arg("manifest")!), "utf8")) as { cities: Array<{ slug: string; source_url: string; zone_field: string; capture_run_id?: string }> };
  const want = new Set((arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const s3 = s3Client();
  for (const c of manifest.cities.filter((x) => want.has(x.slug))) {
    console.log(`\n=== ${c.slug} (champ ${c.zone_field}) ===`);
    const bytes = await casOctets(s3, c.capture_run_id!, c.source_url);
    const gj = JSON.parse(bytes.toString("utf8")) as { features?: unknown[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } };
    const captFeat = (gj.features ?? []).length;
    const etl = gj.exceededTransferLimit ?? gj.properties?.exceededTransferLimit ?? false;
    const cd = distinctCodes(gj as never, c.zone_field);
    console.log(`  CAPTURE: features=${captFeat} distinct=${cd.n} exceededTransferLimit=${etl} sample=${JSON.stringify(cd.sample)}`);
    try {
      const cu = countUrl(c.source_url);
      const r = await fetch(cu, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      const j = await r.json() as { count?: number };
      console.log(`  LIVE count (returnCountOnly): ${j.count ?? "?"}  [${r.status}]  ${captFeat === j.count ? "== capture (COMPLETE)" : "!= capture"}`);
    } catch (e) { console.log(`  LIVE count: erreur ${(e as Error).message}`); }
    const served = await readServed(s3, c.slug);
    if (served) console.log(`  SERVI orphan: key=${served.key.replace(S3_PREFIX, "")} features=${served.features} codes=${served.codes} confidence=${JSON.stringify(served.confidence)} source=${JSON.stringify(served.source)}`);
    else console.log("  SERVI: introuvable");
  }
}
main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
