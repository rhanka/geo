/**
 * _reglement-merge.ts — lane P0_1 (provenance règlement).
 *
 * Fusionne des ENTRÉES CURÉES (verbatim, produites par le conducteur après lecture
 * du corps) dans le registre acquisition/config/reglement-provenance.json.
 *
 * Entrée: un fichier JSON = tableau de { slug, reglement_numero, reglement_millesime,
 *   reglement_page_source, reglement_url, _note }. Un champ absent => null.
 *
 * Garde: on N'ÉCRASE JAMAIS une entrée déjà CURÉE (reglement_numero truthy) sauf
 * --force. Une entrée HOLD-NULL (numéro null) est remplaçable (re-qualification).
 *
 * Usage: npx tsx acquisition/src/_reglement-merge.ts <findings.json> [--force]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');
const FIELDS = ['reglement_numero', 'reglement_millesime', 'reglement_page_source', 'reglement_url'] as const;

interface Finding {
  slug: string;
  reglement_numero?: string | null;
  reglement_millesime?: number | null;
  reglement_page_source?: number | null;
  reglement_url?: string | null;
  _note?: string;
}

function main(): void {
  const file = process.argv[2];
  const force = process.argv.includes('--force');
  if (!file) throw new Error('usage: _reglement-merge.ts <findings.json> [--force]');

  const findings = JSON.parse(readFileSync(file, 'utf8')) as Finding[];
  const cfg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
    slugs: Record<string, Record<string, unknown>>;
    [k: string]: unknown;
  };

  let wrote = 0;
  const skipped: string[] = [];
  for (const f of findings) {
    if (!f.slug) continue;
    const cur = cfg.slugs[f.slug];
    if (cur && cur['reglement_numero'] && !force) {
      skipped.push(`${f.slug} (déjà CURÉ ${JSON.stringify(cur['reglement_numero'])})`);
      continue;
    }
    const entry: Record<string, unknown> = {
      reglement_numero: f.reglement_numero ?? null,
      reglement_millesime: f.reglement_millesime ?? null,
      reglement_page_source: f.reglement_page_source ?? null,
      reglement_url: f.reglement_url ?? null,
    };
    if (f._note) entry._note = f._note;
    cfg.slugs[f.slug] = entry;
    const tag = f.reglement_numero ? `CURED ${f.reglement_numero}` : 'HOLD-NULL';
    console.log(`${tag}\t${f.slug}`);
    wrote++;
  }

  writeFileSync(REGISTRY, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`# merge: écrits=${wrote} skipped=${skipped.length} → ${REGISTRY}`);
  void FIELDS;
}

main();
