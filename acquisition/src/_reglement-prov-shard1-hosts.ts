/**
 * _reglement-prov-shard1-hosts.ts — diagnostic READ-ONLY $0 (lane P0_1).
 *
 * Classe les HOLD-NULL d'un shard par FAMILLE D'HÉBERGEUR, déduite du source_url
 * du manifest registry/qc-zonage-norms. Chaque famille a un levier d'accès au
 * CORPS déjà prouvé sur un autre shard:
 *   VPLUS       -> dossier frère `_publication` (corps codifié) vs `_actualites`
 *                  (grille/projet) — levier légué par le shard 0/2.
 *   WORDPRESS   -> `/wp-json/wp/v2/media` énumère tout (_wp-media-enum.ts).
 *   OCTOBERCMS  -> préfixe `/storage/app/media/` là où `/services/` rend 404.
 *   WEBLEX      -> `apps.gestionweblex.ca/...document.ashx?documentid=<uuid>`.
 *   AUTRE       -> pas de levier générique connu.
 *
 * But: cibler la re-découverte du corps là où un levier EXISTE, au lieu de
 * re-broyer des verdicts déjà terminaux.
 *
 * ANTI-INVENTION: n'ouvre rien, ne décide rien, n'écrit rien.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_reglement-prov-shard1-hosts.ts --shard 1/2
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { s3Client, getBytes } from './lib/s3.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function family(url: string): string {
  const u = url.toLowerCase();
  if (/vplus|villesetvillages|vplus-documents/.test(u)) return 'VPLUS';
  if (/gestionweblex|weblex/.test(u)) return 'WEBLEX';
  if (/\/storage\/app\/media\//.test(u)) return 'OCTOBERCMS';
  if (/\/wp-content\/|\/wp-json\//.test(u)) return 'WORDPRESS';
  if (/fichiersupload/.test(u)) return 'FICHIERSUPLOAD';
  return 'AUTRE';
}

async function main(): Promise<void> {
  const [idxRaw, cntRaw] = (arg('shard', '1/2') as string).split('/');
  const shardIdx = Number(idxRaw);
  const shardCount = Number(cntRaw);

  const enrich = JSON.parse(readFileSync(ENRICH, 'utf8')) as {
    perMuni: Array<{ slug: string; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    slugs: Record<string, { reglement_numero: unknown }>;
  };

  const universe = enrich.perMuni
    .filter((m) => m.reglement === false)
    .map((m) => m.slug)
    .sort();
  const mine = new Set(universe.filter((_s, i) => i % shardCount === shardIdx));

  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'),
  ) as { entries?: Array<{ slug: string; source_url?: string }> };

  const byFam = new Map<string, Array<{ slug: string; url: string }>>();
  for (const e of manifest.entries ?? []) {
    if (!mine.has(e.slug)) continue;
    const cur = registry.slugs[e.slug];
    if (cur && cur.reglement_numero) continue; // déjà curé
    const url = e.source_url ?? '';
    if (!/^https?:\/\//i.test(url)) continue;
    const f = family(url);
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f)!.push({ slug: e.slug, url });
  }
  for (const [f, items] of [...byFam.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n### ${f} = ${items.length}`);
    for (const it of items) console.log(`  ${it.slug}\t${it.url}`);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
