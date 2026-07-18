/**
 * _reglement-null-retryable.ts — lane P0_1 (provenance règlement).
 *
 * Classe READ-ONLY les entrées HOLD-NULL du registre reglement-provenance.json en
 * deux familles, pour cibler le re-grind au seul gisement PROVISOIRE:
 *   - RETRYABLE : la note dit que le null tient à un ACCÈS échoué (hôte injoignable,
 *     404/lien mort, timeout, http=000) ou demande explicitement un re-essai /
 *     re-découverte d'URL. Un tel null peut basculer CURED si l'accès réussit.
 *   - STRUCTURAL: le doc a été LU et le null est motivé (mauvais doc/homonyme,
 *     projet non adopté, conflit de numéros non tranché, consolidé sans numéro,
 *     grille-annexe sans numéro de base). Re-lire la même source ne change rien.
 *
 * Filtre optionnel par shard i/n sur la liste TRIÉE des HOLD-NULL (même convention
 * que _reglement-provenance-targets.ts: index % n == i).
 *
 * ANTI-INVENTION: n'ouvre aucun doc, ne décide rien. Sert seulement à prioriser.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-null-retryable.ts --shard 1/2
 *   npx tsx acquisition/src/_reglement-null-retryable.ts --shard 1/2 --retryable
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Marqueurs d'un null PROVISOIRE (accès échoué / re-essai demandé). */
const RETRY_RE =
  /(injoignable|inatteignable|lien\s+mort|404|http[= ]?000|timeout|ne\s+r[eé]pond\s+pas|re-?essai|re-?d[eé]couverte|panne\s+d.h[oô]te|h[oô]te\s+(down|injoignable)|url\s+morte?)/i;

function main(): void {
  const shardSpec = arg('shard');
  const onlyRetryable = process.argv.includes('--retryable');
  const onlyStructural = process.argv.includes('--structural');
  const cfg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    slugs: Record<string, Record<string, unknown>>;
  };
  const holdnull = Object.keys(cfg.slugs)
    .filter((s) => !cfg.slugs[s]['reglement_numero'])
    .sort();

  let mine = holdnull;
  if (shardSpec) {
    const [i, n] = shardSpec.split('/').map(Number);
    mine = holdnull.filter((_, idx) => idx % n === i);
  }

  let retry = 0;
  let struct = 0;
  const rows: Array<{ slug: string; kind: string; note: string }> = [];
  for (const slug of mine) {
    const note = String(cfg.slugs[slug]['_note'] ?? '');
    const kind = RETRY_RE.test(note) ? 'RETRYABLE' : 'STRUCTURAL';
    if (kind === 'RETRYABLE') retry++;
    else struct++;
    if (onlyRetryable && kind !== 'RETRYABLE') continue;
    if (onlyStructural && kind !== 'STRUCTURAL') continue;
    rows.push({ slug, kind, note: note.slice(0, 160) });
  }
  for (const r of rows) console.log(`${r.kind}\t${r.slug}\t${r.note}`);
  console.log(`# HOLD-NULL shard=${shardSpec ?? 'all'} total=${mine.length} RETRYABLE=${retry} STRUCTURAL=${struct}`);
}

main();
