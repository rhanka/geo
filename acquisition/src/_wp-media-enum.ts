/**
 * Enumerate EVERY file published by a WordPress muni site via its REST media
 * endpoint (`/wp-json/wp/v2/media`), then filter by URL *and* title.
 *
 * WHY this is the discovery lever that replaces a browser: the "Règlements"
 * accordions of muni CMS are built in JS, so a raw-HTML link scrape reports a
 * FALSE "annexe non publiée" (measured: 1 link scraped vs 37 in the rendered
 * DOM). Playwright is unavailable here (ECONNREFUSED 127.0.0.1:9222), but WP's
 * REST API is anonymous, paginated and EXHAUSTIVE — it enumerates the same
 * corpus with plain fetch.
 *
 * ⚠️ `x-wp-total` alone does NOT prove absence. MEASURED on `hope` and
 * `cloridorme`: both are WordPress with a correct x-wp-total, but their bylaws
 * do not live in the media library at all — they are held by the **WP File
 * Download** plugin (served via `admin-ajax.php?action=wpfd&task=file.download`).
 * The media library showed 24 and 9 PDFs; the plugin's own sitemap listed 244
 * and 135. So `--wpfd` probes `/wpfd_file-sitemap.xml` too, and only when BOTH
 * indexes come back empty is "not found" a real absence.
 *
 * Read-only: prints matches, downloads nothing.
 *   npx tsx acquisition/src/_wp-media-enum.ts --site https://ville.x.qc.ca \
 *     [--filter "grille|specification|zonage|annexe"] [--max-pages 30]
 */
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const site = arg('site');
if (!site) {
  console.log('usage: _wp-media-enum.ts --site <base-url> [--filter <regex>] [--max-pages N]');
  process.exit(1);
}
const re = new RegExp(arg('filter') ?? 'grille|sp[ée]cification|zonage|annexe|urbanisme', 'i');
const maxPages = Number(arg('max-pages', '30'));
const base = site.replace(/\/+$/, '');

interface Media {
  source_url?: string;
  title?: { rendered?: string };
  date?: string;
}

const hits: Array<{ url: string; title: string; date: string }> = [];
let total = -1;
let scanned = 0;

for (let page = 1; page <= maxPages; page++) {
  const url = `${base}/wp-json/wp/v2/media?per_page=100&page=${page}&_fields=source_url,title,date`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
  } catch (e) {
    console.log(`FAIL page ${page}: ${(e as Error).message}`);
    break;
  }
  if (page === 1) {
    total = Number(res.headers.get('x-wp-total') ?? -1);
    if (!res.ok) {
      console.log(`NOT-WORDPRESS-OR-REST-DISABLED: HTTP ${res.status} on ${url}`);
      process.exit(2);
    }
    console.log(`# x-wp-total=${total} (${res.headers.get('x-wp-totalpages') ?? '?'} pages)`);
  }
  if (!res.ok) break;
  const items = (await res.json()) as Media[];
  if (!Array.isArray(items) || items.length === 0) break;
  scanned += items.length;
  for (const m of items) {
    const u = m.source_url ?? '';
    const t = m.title?.rendered ?? '';
    if (re.test(u) || re.test(t)) {
      hits.push({ url: u, title: t, date: (m.date ?? '').slice(0, 10) });
    }
  }
}

for (const h of hits) console.log(`  ${h.date}  ${h.url}\n            title="${h.title}"`);
console.log(`\n# ${hits.length} match(es) over ${scanned} media enumerated (x-wp-total=${total})`);

// WP File Download index — the media library is NOT the whole corpus (see header).
let wpfdSeen = 0;
let wpfdHits = 0;
for (const sm of ['/wpfd_file-sitemap.xml', '/wpfd-category-sitemap.xml']) {
  try {
    const r = await fetch(`${base}${sm}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
    });
    if (!r.ok) continue;
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
    wpfdSeen += locs.length;
    for (const l of locs) {
      if (re.test(l)) {
        wpfdHits++;
        console.log(`  WPFD ${l}`);
      }
    }
  } catch {
    /* plugin absent — normal */
  }
}
if (wpfdSeen) {
  console.log(`# WP File Download: ${wpfdHits} match(es) over ${wpfdSeen} entries indexed`);
} else {
  console.log('# WP File Download: no plugin sitemap (media library is the whole corpus)');
}
console.log('# NOTE: an amendment ("modifiant la grille") is NOT the grille — check the title.');
