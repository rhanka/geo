/**
 * _reglement-provenance-targets.ts — lane P0_1 (provenance règlement, demande Steve/immo).
 *
 * Sélecteur de cibles READ-ONLY. Répond à: "quelles villes servies n'ont PAS de
 * reglement_numero, et quelle URL source connaît-on déjà pour aller le lire ?"
 *
 * Univers   : work/coverage/zonage-enrichment.json (perMuni: served && !reglement)
 * Jointure  : registry/qc-zonage-norms/manifest.json (source_url par slug) — le
 *             manifest fait autorité (mémoire norms-manifest-is-authority ; la
 *             coverage-matrix est réécrite concurremment).
 * Registre  : acquisition/config/reglement-provenance.json — un slug déjà curé
 *             (numéro OU _note d'écartement) est marqué DONE et sorti du gisement.
 *
 * Shard: --shard i/n garde les slugs dont (index dans la liste triée des cibles) % n == i.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-provenance-targets.ts --shard 0/2
 *   npx tsx acquisition/src/_reglement-provenance-targets.ts --shard 0/2 --limit 12 --with-url
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

interface Muni {
  slug: string;
  served?: boolean;
  reglement?: boolean;
}
interface Entry {
  slug: string;
  source_url?: string;
  zone_rows?: number;
  unique_zone_codes?: number;
  methode?: string;
}

async function main(): Promise<void> {
  const shardSpec = arg('shard');
  const limit = Number(arg('limit', '0'));
  const withUrl = process.argv.includes('--with-url');
  const noUrl = process.argv.includes('--no-url');

  const enrich = JSON.parse(readFileSync(ENRICH, 'utf8')) as { perMuni: Muni[] };
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    slugs: Record<string, Record<string, unknown>>;
  };

  // Univers déterministe et partageable entre shards: TOUTES les villes servies
  // sans provenance règlement, triées par slug. (Le filtre URL vient APRÈS le
  // sharding, sinon deux agents ne calculeraient pas le même index.)
  const targets = enrich.perMuni
    .filter((m) => m.served === true && m.reglement === false)
    .map((m) => m.slug)
    .sort();

  let mine = targets;
  if (shardSpec) {
    const [iRaw, nRaw] = shardSpec.split('/');
    const i = Number(iRaw);
    const n = Number(nRaw);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n) {
      throw new Error(`--shard invalide: ${shardSpec} (attendu i/n)`);
    }
    mine = targets.filter((_, idx) => idx % n === i);
  }

  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'),
  ) as { entries?: Entry[] };
  const bySlug = new Map<string, Entry>();
  for (const e of manifest.entries ?? []) bySlug.set(e.slug, e);

  const rows: Array<{ slug: string; url: string | null; state: string; meta: string }> = [];
  for (const slug of mine) {
    const cur = registry.slugs[slug];
    const done = cur ? (cur['reglement_numero'] ? 'CURED' : 'HOLD-NULL') : null;
    const e = bySlug.get(slug);
    const url = e?.source_url ?? null;
    rows.push({
      slug,
      url,
      state: done ?? (url ? 'TODO-URL' : e ? 'TODO-NO-URL' : 'NO-GRILLE'),
      meta: e ? `rows=${e.zone_rows ?? '?'} codes=${e.unique_zone_codes ?? '?'} methode=${e.methode ?? '?'}` : '-',
    });
  }

  let out = rows;
  if (withUrl) out = out.filter((r) => r.state === 'TODO-URL');
  if (noUrl) out = out.filter((r) => r.state === 'TODO-NO-URL' || r.state === 'NO-GRILLE');
  if (limit > 0) out = out.slice(0, limit);

  for (const r of out) console.log(`${r.slug}\t${r.state}\t${r.meta}\t${r.url ?? '-'}`);

  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.state, (tally.get(r.state) ?? 0) + 1);
  console.log(
    `# univers cibles(served && !reglement)=${targets.length} shard=${shardSpec ?? 'all'} mine=${mine.length} affichés=${out.length}`,
  );
  console.log(`# ${[...tally].map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
