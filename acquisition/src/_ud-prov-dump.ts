/**
 * _ud-prov-dump.ts — $0 read-only: dump les valeurs distinctes des champs provenance
 * (source, reglement_numero, reglement_millesime, reglement_page_source, reglement_url)
 * portées par le polygone zonage servi. N'écrit rien.
 * Usage: npx tsx acquisition/src/_ud-prov-dump.ts --slugs a,b
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const FIELDS = ["source", "reglement_numero", "reglement_millesime", "reglement_page_source", "reglement_url", "mun_nom", "Municipalite"];

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) throw new Error("required: --slugs a,b");
  const s3 = s3Client();
  for (const slug of slugs) {
    const candidates = [
      `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
      `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
    ];
    let key: string | null = null;
    for (const k of candidates) if (await exists(s3, k)) { key = k; break; }
    if (!key) { console.log(`${slug}: NON servi`); continue; }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: { properties?: Record<string, unknown> }[] };
    const vals = new Map<string, Set<string>>();
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      for (const fld of FIELDS) {
        const v = p[fld];
        if (v == null || String(v).trim() === "") continue;
        if (!vals.has(fld)) vals.set(fld, new Set());
        vals.get(fld)!.add(String(v).trim());
      }
    }
    console.log(`\n=== ${slug} ===`);
    for (const [fld, set] of vals) console.log(`  ${fld}: ${[...set].slice(0, 5).join(" | ")}`);
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
