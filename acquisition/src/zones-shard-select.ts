/**
 * Deterministic shard selector for the ZONES recalage PDF lane.
 *
 * Targets = municipalities in work/coverage/coverage-matrix.json where
 * zones.status != "done". The shard is chosen by enumeration index over the
 * ALPHABETICALLY SORTED eligible slug list: shard i/n = (index % n === i).
 * Within a shard, candidates are ordered PDF-buckets first (candidateTracks
 * containing pdf-georef-t1 / pdf-vectorize-t2 / pdf-raster-t3 / pdf-scan-t4 /
 * pdf-discovery-required) — the recalage voie — then the rest.
 *
 * Node/TS only. Read-only: prints the selection, writes nothing.
 *   npx tsx acquisition/src/zones-shard-select.ts --shard 3 --shards 4 --limit 12
 *   npx tsx acquisition/src/zones-shard-select.ts --check saint-hugues,lacolle
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const shard = Number(arg('shard', '3'));
const shards = Number(arg('shards', '4'));
const limit = Number(arg('limit', '12'));

const PDF_TRACKS = new Set([
  'pdf-georef-t1',
  'pdf-vectorize-t2',
  'pdf-raster-t3',
  'pdf-scan-t4',
  'pdf-discovery-required',
]);

const root = resolve(process.cwd());
const matrixPath = resolve(root, 'work/coverage/coverage-matrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as {
  cities: Record<string, { zones?: { status?: string; candidateTracks?: string[] } }>;
};

// Sorted eligible list = deterministic partition key shared across shard agents.
const eligible = Object.keys(matrix.cities)
  .filter((s) => matrix.cities[s].zones?.status !== 'done')
  .sort();

const checkArg = arg('check');
if (checkArg) {
  for (const s of checkArg.split(',').map((x) => x.trim()).filter(Boolean)) {
    const idx = eligible.indexOf(s);
    if (idx < 0) {
      const st = matrix.cities[s]?.zones?.status ?? 'NOT-IN-MATRIX';
      console.log(`${s}\tstatus=${st}\t(not in eligible/sorted list)`);
      continue;
    }
    const c = matrix.cities[s].zones!;
    const pdf = (c.candidateTracks ?? []).filter((t) => PDF_TRACKS.has(t));
    console.log(
      `${s}\tidx=${idx}\tshard=${idx % shards}\tstatus=${c.status ?? '?'}\tpdfTracks=[${pdf.join('|')}]`,
    );
  }
  process.exit(0);
}

const mine = eligible.filter((_, index) => index % shards === shard);

function pdfScore(slug: string): number {
  const tracks = matrix.cities[slug].zones?.candidateTracks ?? [];
  return tracks.some((t) => PDF_TRACKS.has(t)) ? 0 : 1; // 0 = PDF-bucket first
}

const ordered = mine
  .map((slug) => ({ slug, pdf: pdfScore(slug) }))
  .sort((a, b) => a.pdf - b.pdf || a.slug.localeCompare(b.slug));

const pdfCount = ordered.filter((o) => o.pdf === 0).length;

console.log(`# ZONES recalage shard ${shard}/${shards} (index%${shards}==${shard} over sorted eligible)`);
console.log(`# eligible total (zones!=done): ${eligible.length}`);
console.log(`# my shard size: ${mine.length}  (PDF-bucket: ${pdfCount})`);
console.log(`# taking first ${Math.min(limit, ordered.length)} (PDF-buckets first):`);
console.log(ordered.slice(0, limit).map((o) => o.slug).join(','));
