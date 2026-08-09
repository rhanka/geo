/**
 * Resolve the DISCOVERED source-url for a CSV of municipality slugs, so the
 * NORMES Mistral runner can reuse an on-disk grille.pdf (levier #1) WITHOUT
 * inventing a `--source-url` (anti-invention gate: the deposited product must
 * carry the real règlement URL).
 *
 * Sources scanned, in priority order:
 *   1. work/zonage-norms/discovered.json   (grille-discovery registry: slug→sourceUrl)
 *   2. work/coverage/normes-provenance.json (prior deposits: slug→source_url)
 *   3. work/zonage-norms/<slug>/source.json (per-slug discovery sidecar, written next
 *      to the downloaded grille.pdf). Scanning only 1+2 reports a FALSE "NO-URL" for
 *      every slug whose PDF was staged with just this sidecar.
 *
 * Read-only: prints one TSV line per slug, writes nothing.
 *   npx tsx acquisition/src/norms-source-lookup.ts --slugs a,b,c
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const slugs = (arg('slugs') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const REPO = resolve(process.cwd());

interface Hit {
  sourceUrl: string;
  route?: string;
  first?: number;
  last?: number;
  from: string;
}

const bySlug = new Map<string, Hit>();

// 1) discovered.json
try {
  const disc = JSON.parse(
    readFileSync(resolve(REPO, 'work/zonage-norms/discovered.json'), 'utf8'),
  ) as { munis: Array<{ slug: string; sourceUrl?: string; route?: string; first?: number; last?: number }> };
  for (const m of disc.munis ?? []) {
    if (!m.slug || !m.sourceUrl) continue;
    if (!bySlug.has(m.slug)) {
      bySlug.set(m.slug, {
        sourceUrl: m.sourceUrl,
        ...(m.route ? { route: m.route } : {}),
        ...(m.first ? { first: m.first } : {}),
        ...(m.last ? { last: m.last } : {}),
        from: 'discovered.json',
      });
    }
  }
} catch {
  /* optional */
}

// 2) normes-provenance.json (fallback: prior deposit source_url)
try {
  const prov = JSON.parse(
    readFileSync(resolve(REPO, 'work/coverage/normes-provenance.json'), 'utf8'),
  ) as { rows: Array<{ slug: string; source_url?: string; sourceUrl?: string }> };
  for (const r of prov.rows ?? []) {
    const url = r.source_url ?? r.sourceUrl;
    if (!r.slug || !url) continue;
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, { sourceUrl: url, from: 'provenance' });
  }
} catch {
  /* optional */
}

// 3) per-slug sidecar work/zonage-norms/<slug>/source.json
for (const slug of slugs) {
  if (bySlug.has(slug)) continue;
  const p = resolve(REPO, 'work/zonage-norms', slug, 'source.json');
  if (!existsSync(p)) continue;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as { sourceUrl?: string; source_url?: string };
    const url = s.sourceUrl ?? s.source_url;
    if (url) bySlug.set(slug, { sourceUrl: url, from: 'source.json' });
  } catch {
    /* optional */
  }
}

let hits = 0;
for (const slug of slugs) {
  const h = bySlug.get(slug);
  if (!h) {
    console.log(`${slug}\tNO-URL`);
    continue;
  }
  hits++;
  const win = h.first && h.last ? `\t${h.first}..${h.last}` : '';
  console.log(`${slug}\t${h.sourceUrl}\t[${h.from}${h.route ? ` route=${h.route}` : ''}]${win}`);
}
console.error(`# source-lookup: ${hits}/${slugs.length} slugs have a discovered source-url`);
