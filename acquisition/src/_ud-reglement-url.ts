/**
 * _ud-reglement-url.ts — $0 read-only: pour chaque slug, dump les valeurs distinctes
 * de reglement_url / source_url portées par le polygone zonage servi (S3), pour
 * localiser le document à lire. N'écrit rien.
 * Usage: npx tsx acquisition/src/_ud-reglement-url.ts --slugs a,b,c
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const URL_FIELDS = ["reglement_url", "source_url", "reglement", "url", "reglement_zonage_url"];

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
    const urls = new Map<string, Set<string>>();
    const otherKeys = new Set<string>();
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      for (const k of Object.keys(p)) otherKeys.add(k);
      for (const field of URL_FIELDS) {
        const v = p[field];
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;
        if (!urls.has(field)) urls.set(field, new Set());
        urls.get(field)!.add(s);
      }
    }
    console.log(`\n=== ${slug} (n=${(fc.features ?? []).length}) ===`);
    console.log(`  champs: ${[...otherKeys].join(", ")}`);
    if (urls.size === 0) console.log(`  (aucun champ URL)`);
    for (const [field, set] of urls) {
      for (const u of set) console.log(`  ${field}: ${u}`);
    }
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
