/**
 * _reglement-prov-shard1-urlgap.ts — diagnostic READ-ONLY (lane P0_1, shard 1/2).
 *
 * Le gisement annoncé de la mission = « grilles avec une URL source SANS numéro
 * extrait ». Ce script le rend MESURABLE pour un shard: pour chaque HOLD-NULL du
 * shard, il croise (a) le source_url du manifest registry/qc-zonage-norms,
 * (b) la présence d'un PDF local dans work/zonage-norms/<slug>/.
 *
 * Trois classes en sortie:
 *   URL-NO-LOCAL  : URL http connue, AUCUN PDF sur disque => jamais ouverte, cible $0
 *                   (fetch + lecture native).
 *   URL-WITH-LOCAL: URL connue ET doc déjà sur disque => déjà instruit, ne pas re-broyer.
 *   NO-URL        : pas d'entrée manifest / source_url non-disponible => défaut de
 *                   DÉCOUVERTE, hors périmètre « URL déjà connue ».
 *
 * ANTI-INVENTION: n'ouvre aucun PDF, ne décide rien, n'écrit rien.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_reglement-prov-shard1-urlgap.ts --shard 1/2
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { s3Client, getBytes } from './lib/s3.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function localPdfCount(slug: string): number {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).length;
}

async function main(): Promise<void> {
  const [idxRaw, cntRaw] = (arg('shard', '1/2') as string).split('/');
  const shardIdx = Number(idxRaw);
  const shardCount = Number(cntRaw);

  const enrich = JSON.parse(readFileSync(ENRICH, 'utf8')) as {
    perMuni: Array<{ slug: string; served?: boolean; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    slugs: Record<string, { reglement_numero: unknown }>;
  };

  const universe = enrich.perMuni
    .filter((m) => m.reglement === false)
    .map((m) => m.slug)
    .sort();
  const mine = universe.filter((_s, i) => i % shardCount === shardIdx);

  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'),
  ) as { entries?: Array<{ slug: string; source_url?: string; methode?: string }> };
  const bySlug = new Map<string, { source_url?: string; methode?: string }>();
  for (const e of manifest.entries ?? []) bySlug.set(e.slug, e);

  const buckets: Record<string, string[]> = { 'URL-NO-LOCAL': [], 'URL-WITH-LOCAL': [], 'NO-URL': [] };
  for (const slug of mine) {
    const cur = registry.slugs[slug];
    if (cur && cur.reglement_numero) continue; // déjà curé
    const url = bySlug.get(slug)?.source_url;
    const hasUrl = !!url && /^https?:\/\//i.test(url) && !/non-disponible/i.test(url);
    const n = localPdfCount(slug);
    const key = !hasUrl ? 'NO-URL' : n > 0 ? 'URL-WITH-LOCAL' : 'URL-NO-LOCAL';
    buckets[key]!.push(slug);
    if (key === 'URL-NO-LOCAL') console.log(`URL-NO-LOCAL\t${slug}\t${url}`);
  }
  for (const [k, v] of Object.entries(buckets)) console.log(`# ${k} = ${v.length}`);
  console.log('# URL-NO-LOCAL list: ' + buckets['URL-NO-LOCAL']!.join(','));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
