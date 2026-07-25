/**
 * _reglement-prov-shard1-scans.ts — diagnostic READ-ONLY $0 (lane P0_1).
 *
 * Isole les HOLD-NULL d'un shard dont le PDF local est un SCAN (couche texte
 * absente ou quasi nulle). Motivation (mémoire plein-texte-aveugle-sur-scan-find0
 * + passe vision shard 0/2): `pdftotext` rend 0 caractère sur un scan, donc toute
 * sonde plein-texte conclut « DOC MUET / FIND-0 » à tort. Ces slugs sont la cible
 * de la ROUTE VISION $0 (rendre p1 en PNG via _render-pdf.ts puis LIRE l'image
 * avec la vision de l'agent — gratuit, ≠ OCR Mistral payant).
 *
 * Mesure par PDF: nombre de caractères non blancs rendus par pdftotext sur les
 * `--pages` premières pages, et le nombre de pages du doc.
 *
 * ANTI-INVENTION: n'extrait aucun numéro, ne décide rien, n'écrit rien.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_reglement-prov-shard1-scans.ts --shard 1/2 [--pages 4]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function pageCount(pdf: string): number {
  try {
    const out = execFileSync('pdfinfo', [pdf], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : -1;
  } catch {
    return -1;
  }
}

function nonBlankChars(pdf: string, pages: number): number {
  try {
    const txt = execFileSync(
      'pdftotext',
      ['-f', '1', '-l', String(pages), '-layout', '-enc', 'UTF-8', pdf, '-'],
      { encoding: 'utf8', maxBuffer: 1 << 26 },
    );
    return txt.replace(/\s+/g, '').length;
  } catch {
    return -1;
  }
}

function main(): void {
  const [idxRaw, cntRaw] = (arg('shard', '1/2') as string).split('/');
  const shardIdx = Number(idxRaw);
  const shardCount = Number(cntRaw);
  const pages = Number(arg('pages', '4'));

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
  const mine = universe.filter((_s, i) => i % shardCount === shardIdx);

  const scans: string[] = [];
  for (const slug of mine) {
    const cur = registry.slugs[slug];
    if (cur && cur.reglement_numero) continue; // déjà curé
    const dir = resolve(CORPUS, slug);
    if (!existsSync(dir)) continue;
    const pdfs = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => resolve(dir, f))
      .sort((a, b) => statSync(b).size - statSync(a).size);
    for (const pdf of pdfs) {
      const n = nonBlankChars(pdf, pages);
      const p = pageCount(pdf);
      const verdict = n < 0 ? 'ERR' : n < 40 ? 'NO-TEXT-LAYER' : n < 400 ? 'THIN-TEXT' : 'TEXT-OK';
      if (verdict === 'NO-TEXT-LAYER' || verdict === 'THIN-TEXT') {
        console.log(`${verdict}\t${slug}\tchars(p1-${pages})=${n}\tpages=${p}\t${pdf.slice(ROOT.length + 1)}`);
        if (!scans.includes(slug)) scans.push(slug);
      }
    }
  }
  console.log(`# shard=${shardIdx}/${shardCount} slugs avec au moins un PDF sans couche texte exploitable = ${scans.length}`);
  console.log('# list: ' + scans.join(','));
}
main();
