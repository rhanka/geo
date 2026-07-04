/**
 * opendata-probe.ts — discover the zone-code field of a Donnees Quebec CKAN
 * zonage dataset (open-data sweep helper for zonage-opendata-deposit.ts).
 *
 * Given a CKAN package name (or a direct GeoJSON URL), download the vector
 * layer, enumerate every property key, and rank them by how "zone-code-like"
 * their values are (lettered + digit signature, bounded length, high distinct
 * count). Prints the best candidate field + a sample so the operator can pick
 * --zone-field for the deposit. Read-only; deposits nothing.
 *
 *   npx tsx work/zonage-dicts/opendata-probe.ts --pkg zonage
 *   npx tsx work/zonage-dicts/opendata-probe.ts --url <geojson>
 */
const CKAN = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=";
const UA = "sentropic-geo/0.1";

interface Res { format?: string; url?: string; name?: string }

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/geo+json,application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
    return JSON.parse(await r.text());
  } finally { clearTimeout(t); }
}

async function pkgGeojsonUrl(pkg: string): Promise<{ url: string; note: string }> {
  const j = (await fetchJson(CKAN + encodeURIComponent(pkg))) as { result?: { resources?: Res[] } };
  const resources = j.result?.resources ?? [];
  // Prefer an explicit GeoJSON resource, then any .geojson/.json download.
  const byFmt = resources.find((r) => (r.format ?? "").toLowerCase() === "geojson");
  const byUrl = resources.find((r) => /\.(geo)?json($|\?)/i.test(r.url ?? ""));
  const pick = byFmt ?? byUrl;
  if (!pick?.url) {
    const fmts = resources.map((r) => r.format).join(", ");
    throw new Error(`no GeoJSON resource in package '${pkg}' (formats: ${fmts})`);
  }
  return { url: pick.url, note: `${pick.format} ${pick.name ?? ""}`.trim() };
}

const CODE_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9\- .]{0,15}$/;

function analyze(features: Array<{ properties?: Record<string, unknown> }>): void {
  const keys = new Map<string, { nonNull: number; distinct: Set<string>; codeLike: number; sample: string[] }>();
  for (const f of features) {
    const p = f.properties ?? {};
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      const s = String(v).trim();
      let e = keys.get(k);
      if (!e) { e = { nonNull: 0, distinct: new Set(), codeLike: 0, sample: [] }; keys.set(k, e); }
      e.nonNull++;
      e.distinct.add(s);
      if (CODE_RE.test(s)) e.codeLike++;
      if (e.sample.length < 8 && !e.sample.includes(s)) e.sample.push(s);
    }
  }
  const total = features.length;
  const rows = [...keys.entries()].map(([k, e]) => ({
    key: k,
    nonNull: e.nonNull,
    distinct: e.distinct.size,
    codeLikePct: e.nonNull ? Math.round((e.codeLike / e.nonNull) * 100) : 0,
    distinctPct: total ? Math.round((e.distinct.size / total) * 100) : 0,
    sample: e.sample,
  }));
  // Rank: high code-like, high distinct, not a pure integer id.
  rows.sort((a, b) => (b.codeLikePct - a.codeLikePct) || (b.distinct - a.distinct));
  console.log(`features=${total}`);
  for (const r of rows) {
    console.log(
      `  ${r.key.padEnd(24)} nonNull=${r.nonNull} distinct=${r.distinct} (${r.distinctPct}% of feats) ` +
        `codeLike=${r.codeLikePct}% sample=${JSON.stringify(r.sample)}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const pkg = get("pkg");
  let url = get("url");
  let note = "";
  if (pkg) { const r = await pkgGeojsonUrl(pkg); url = r.url; note = r.note; }
  if (!url) { console.error("usage: --pkg <ckan-name> | --url <geojson>"); process.exit(2); }
  console.log(`URL: ${url}${note ? `  [${note}]` : ""}`);
  const fc = (await fetchJson(url)) as { type?: string; features?: Array<{ properties?: Record<string, unknown> }> };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) throw new Error("not a FeatureCollection");
  analyze(fc.features);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
