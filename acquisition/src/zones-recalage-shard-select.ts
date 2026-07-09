/**
 * Sélection déterministe des slugs candidats au recalage PDF→zones pour un shard.
 *
 * Critères (cf. mission RECALAGE PDF ZONES, shard k/4) :
 *  - zones.status != "done"
 *  - index (position dans Object.keys(cities)) % 4 == shard
 *  - priorité aux buckets PDF : candidateTracks ∋ {pdf-georef-t1, pdf-vectorize-t2,
 *    pdf-raster-t3, pdf-scan-t4, pdf-discovery-required}
 *
 * Usage : npx tsx acquisition/src/zones-recalage-shard-select.ts --shard 1 [--limit 12]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PDF_TRACKS = new Set([
  "pdf-georef-t1",
  "pdf-vectorize-t2",
  "pdf-raster-t3",
  "pdf-scan-t4",
  "pdf-discovery-required",
]);

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const shard = Number(arg("shard", "1"));
const limit = Number(arg("limit", "12"));
const matrixPath = resolve("work/coverage/coverage-matrix.json");
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
const slugs = Object.keys(cities);

type Row = {
  slug: string;
  index: number;
  status: string;
  doneTrack: string | null;
  tracks: string[];
  pdfTracks: string[];
  isPdf: boolean;
};

const rows: Row[] = [];
slugs.forEach((slug, index) => {
  if (index % 4 !== shard) return;
  const z = cities[slug]?.zones ?? {};
  if (z.status === "done") return;
  const tracks: string[] = Array.isArray(z.candidateTracks) ? z.candidateTracks : [];
  const pdfTracks = tracks.filter((t) => PDF_TRACKS.has(t));
  rows.push({
    slug,
    index,
    status: z.status ?? "unknown",
    doneTrack: z.doneTrack ?? null,
    tracks,
    pdfTracks,
    isPdf: pdfTracks.length > 0,
  });
});

// Priorité : buckets PDF d'abord, puis ordre matriciel stable.
rows.sort((a, b) => Number(b.isPdf) - Number(a.isPdf) || a.index - b.index);

const selected = rows.slice(0, limit);

console.log(
  JSON.stringify(
    {
      shard,
      limit,
      totalNonDoneInShard: rows.length,
      pdfBucketCount: rows.filter((r) => r.isPdf).length,
      selected: selected.map((r) => ({
        slug: r.slug,
        index: r.index,
        status: r.status,
        doneTrack: r.doneTrack,
        pdfTracks: r.pdfTracks,
      })),
    },
    null,
    2,
  ),
);
