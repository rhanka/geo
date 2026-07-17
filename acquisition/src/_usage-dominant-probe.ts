/**
 * _usage-dominant-probe.ts — sonde la collection SERVIE d'un slug pour préparer
 * le mapping usage_dominant: provenance règlement (numero/millesime/url) + les
 * VRAIS zone_code (préfixes alpha de tête ET forme complète) présents dans le SIG.
 *
 * Anti-invention: on ne mappe QUE des préfixes vus ici.
 *
 * Usage:
 *   npx tsx acquisition/src/_usage-dominant-probe.ts --slugs cantley,chelsea
 *   npx tsx acquisition/src/_usage-dominant-probe.ts --slugs cantley --codes
 */
const API = "https://api.geo.sent-tech.ca/collections";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const ZONE_FIELDS = ["zone_code", "Zonage", "zonage", "ZONE", "zone", "Zone", "NO_ZONE", "num_zone", "CODE_ZONE"];

function zoneCodeOf(p: Record<string, unknown>): string | null {
  for (const f of ZONE_FIELDS) {
    const v = p[f];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

async function probe(slug: string, showCodes: boolean): Promise<void> {
  const res = await fetch(`${API}/qc-zonage-${slug}/items?limit=5000`);
  if (!res.ok) {
    console.log(`--- ${slug}: HTTP ${res.status}`);
    return;
  }
  const fc = (await res.json()) as { features?: { properties?: Record<string, unknown> }[] };
  const feats = fc.features ?? [];
  const prov = new Set<string>();
  const usage = new Map<string, number>();
  const byPrefix = new Map<string, { n: number; ex: Set<string> }>();
  const codes = new Set<string>();
  for (const f of feats) {
    const p = f.properties ?? {};
    if (p["reglement_numero"]) {
      prov.add(`${p["reglement_numero"]} | ${p["reglement_millesime"] ?? "-"} | ${p["reglement_url"] ?? "-"}`);
    }
    const u = Object.prototype.hasOwnProperty.call(p, "usage_dominant") ? String(p["usage_dominant"]) : "(absent)";
    usage.set(u, (usage.get(u) ?? 0) + 1);
    const c = zoneCodeOf(p);
    if (!c) continue;
    codes.add(c);
    const m = c.match(/^[A-Za-z]+/);
    const pref = m ? m[0] : "(numérique)";
    let e = byPrefix.get(pref);
    if (!e) { e = { n: 0, ex: new Set() }; byPrefix.set(pref, e); }
    e.n++;
    if (e.ex.size < 5) e.ex.add(c);
  }
  console.log(`--- ${slug}: features=${feats.length} codesDistincts=${codes.size}`);
  console.log(`    usage_dominant: ${[...usage].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`    reglement: ${prov.size ? [...prov].slice(0, 3).join(" ;; ") : "(aucun)"}`);
  for (const [pref, e] of [...byPrefix].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${pref.padEnd(10)} n=${String(e.n).padStart(4)}  ex: ${[...e.ex].join(", ")}`);
  }
  if (showCodes) console.log(`    CODES: ${[...codes].sort().join(", ")}`);
}

const argv = process.argv.slice(2);
const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const showCodes = argv.includes("--codes");
if (!slugs.length) {
  console.error("pass --slugs <a,b> [--codes]");
  process.exit(2);
}
for (const slug of slugs) await probe(slug, showCodes);
