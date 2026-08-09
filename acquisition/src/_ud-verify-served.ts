/**
 * _ud-verify-served.ts — $0 read-only: lit le polygone zonage SERVI sur S3 et
 * reporte la distribution de usage_dominant / usage_dominant_source réellement
 * stampée (preuve S3, pas l'API cachée). N'écrit rien.
 * Usage: npx tsx acquisition/src/_ud-verify-served.ts --slugs a,b
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

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
    for (const key of candidates) {
      if (!(await exists(s3, key))) continue;
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: { properties?: Record<string, unknown> }[] };
      const dist = new Map<string, number>();
      let src = 0;
      for (const f of fc.features ?? []) {
        const p = f.properties ?? {};
        const has = "usage_dominant" in p;
        const v = has ? (p["usage_dominant"] == null ? "null" : String(p["usage_dominant"])) : "(absent)";
        dist.set(v, (dist.get(v) ?? 0) + 1);
        if (p["usage_dominant_source"]) src++;
      }
      const parts = [...dist.entries()].sort().map(([k, n]) => `${k}:${n}`).join(" ");
      console.log(`${slug} [${key.includes("/qc-zonage-" + slug + "/") ? "subdir" : "flat"}] n=${(fc.features ?? []).length} src=${src} -> ${parts}`);
    }
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
