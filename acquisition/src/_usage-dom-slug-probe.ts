/**
 * _usage-dom-slug-probe — $0 read-only. Pour chaque slug: lit le polygone zonage
 * servi (S3, clés plate + sous-dossier), et imprime:
 *  - les reglement_url distincts stampés sur les features (le doc SOUS LA MAIN)
 *  - la distribution des préfixes alpha du zone_code (avec échantillons)
 * Sert à prioriser (a-t-on l'URL ?) et à ne mapper QUE les préfixes réels.
 *
 *   npx tsx acquisition/src/_usage-dom-slug-probe.ts --slugs a,b,c
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
type S3 = ReturnType<typeof s3Client>;

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function zoneCodeOf(props: Record<string, unknown>): string | null {
  for (const name of SIG_ZONE_CODE_FIELDS) {
    const v = props[name];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function alphaPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return m ? m[0] : "";
}

async function keysFor(s3: S3, slug: string): Promise<string[]> {
  const cand = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const out: string[] = [];
  for (const k of cand) if (await exists(s3, k)) out.push(k);
  return out;
}

async function probe(s3: S3, slug: string): Promise<void> {
  const keys = await keysFor(s3, slug);
  if (!keys.length) {
    console.log(`\n### ${slug} — NON servi`);
    return;
  }
  const urls = new Map<string, number>();
  const byPrefix = new Map<string, { n: number; ex: Set<string> }>();
  const byUsage = new Map<string, number>();
  let total = 0;
  for (const key of keys) {
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: { properties?: Record<string, unknown> }[] };
    const feats = fc.features ?? [];
    for (const f of feats) {
      total++;
      const props = f.properties ?? {};
      for (const uk of ["reglement_url", "reglement_source_url", "source_url"]) {
        const v = props[uk];
        if (v && typeof v === "string") urls.set(v, (urls.get(v) ?? 0) + 1);
      }
      if ("usage_dominant" in props) {
        const u = props["usage_dominant"];
        const key = u === null ? "null" : String(u);
        byUsage.set(key, (byUsage.get(key) ?? 0) + 1);
      }
      const code = zoneCodeOf(props);
      if (!code) continue;
      const pref = alphaPrefix(canonZoneCodeServe(code) || code) || "(num)";
      let e = byPrefix.get(pref);
      if (!e) { e = { n: 0, ex: new Set() }; byPrefix.set(pref, e); }
      e.n++;
      if (e.ex.size < 5) e.ex.add(code);
    }
    break; // une clé suffit pour l'inventaire des codes
  }
  console.log(`\n### ${slug} — features=${total} préfixes=${byPrefix.size}`);
  if (byUsage.size) console.log(`  S3 usage_dominant: ${[...byUsage.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  const rows = [...byPrefix.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [p, e] of rows) console.log(`  ${p.padEnd(10)} n=${String(e.n).padStart(4)}  ex: ${[...e.ex].join(", ")}`);
  if (urls.size) {
    console.log(`  URLs:`);
    for (const [u, n] of [...urls.entries()].sort((a, b) => b[1] - a[1])) console.log(`    (${n}) ${u}`);
  } else {
    console.log(`  URLs: (aucune stampée)`);
  }
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) { console.error("pass --slugs a,b,c"); process.exit(2); }
  const s3 = s3Client();
  for (const slug of slugs) {
    try { await probe(s3, slug); } catch (e) { console.log(`\n### ${slug} — ERR ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
