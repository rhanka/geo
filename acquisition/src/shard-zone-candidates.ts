/**
 * shard-zone-candidates.ts — compute the PDF-recalage candidate slugs for a
 * given shard (default shard 2 of 4, i.e. index % 4 === 2).
 *
 * Reads work/coverage/coverage-matrix.json in native key order (the stable
 * "index"), keeps zones.status !== 'done', assigns shard = index % 4, and
 * ranks the PDF buckets (candidateTracks containing pdf-georef-t1 /
 * pdf-vectorize-t2 / pdf-raster-t3 / pdf-scan-t4 / pdf-discovery-required)
 * first. Pure reporting — no side effects, no invention.
 *
 * Usage: npx tsx acquisition/src/shard-zone-candidates.ts [--shard 2] [--mod 4] [--limit 40]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PDF_TRACKS = [
  'pdf-georef-t1',
  'pdf-vectorize-t2',
  'pdf-raster-t3',
  'pdf-scan-t4',
  'pdf-discovery-required',
];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const shard = Number(arg('shard', '2'));
const mod = Number(arg('mod', '4'));
const limit = Number(arg('limit', '60'));

const matrixPath = resolve('work/coverage/coverage-matrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as {
  cities: Record<string, any>;
};

const slugs = Object.keys(matrix.cities);

type Row = {
  slug: string;
  index: number;
  status: string;
  pdfTracks: string[];
  allTracks: string[];
  notes?: string;
};

const shardNonDone: Row[] = [];
let shardTotal = 0;

slugs.forEach((slug, index) => {
  if (index % mod !== shard) return;
  shardTotal += 1;
  const z = matrix.cities[slug]?.zones ?? {};
  if (z.status === 'done') return;
  const allTracks: string[] = Array.isArray(z.candidateTracks)
    ? z.candidateTracks
    : [];
  const pdfTracks = allTracks.filter((t) => PDF_TRACKS.includes(t));
  shardNonDone.push({
    slug,
    index,
    status: z.status ?? '(none)',
    pdfTracks,
    allTracks,
    notes: z.notes,
  });
});

// Priority: PDF bucket first (more pdf tracks earlier is better), then others.
const priorityOrder = new Map(PDF_TRACKS.map((t, i) => [t, i]));
function pdfScore(r: Row): number {
  if (r.pdfTracks.length === 0) return 999;
  return Math.min(...r.pdfTracks.map((t) => priorityOrder.get(t) ?? 999));
}
shardNonDone.sort((a, b) => pdfScore(a) - pdfScore(b) || a.index - b.index);

const withPdf = shardNonDone.filter((r) => r.pdfTracks.length > 0);

console.log(
  `=== SHARD ${shard}/${mod} — zones NON-done ===`,
);
console.log(
  `shard total munis=${shardTotal} | zones non-done=${shardNonDone.length} | dont bucket-PDF=${withPdf.length}`,
);
console.log('');
console.log('=== TOP CANDIDATS (PDF prioritaires) ===');
for (const r of shardNonDone.slice(0, limit)) {
  const pdf = r.pdfTracks.length ? r.pdfTracks.join(',') : '—';
  console.log(
    `${r.slug}\t[i=${r.index}]\tstatus=${r.status}\tpdf=[${pdf}]\ttracks=[${r.allTracks.join(',')}]${r.notes ? `\tnotes=${r.notes}` : ''}`,
  );
}
