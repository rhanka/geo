/**
 * CLI: assemble a `--labels claude` reads file from PER-TILE vision reads.
 *
 * Why this exists: `t2-build --labels claude` ingests ONE reads file whose x,y
 * are normalised inside ONE crop. A large-format sheet (A0 at 1:25 000) renders
 * to a crop of ~4500x5200 px: its zone codes are unreadable when the whole crop
 * is viewed at once, so the operating agent must read it TILE BY TILE.
 *
 * Doing the tile→region projection by hand invites silent arithmetic slips that
 * no gate downstream can catch (a label lands in the wrong zone and is served as
 * fact). This tool does that projection deterministically instead.
 *
 * Anti-invention contract:
 *   - it NEVER reads a glyph and never invents a label: it only re-projects the
 *     reads the agent actually made, tile-local → region-normalised.
 *   - with --dict it reports (and drops) any code absent from the authoritative
 *     dictionary, loudly, so a misread never passes as a real zone.
 *   - it reports duplicates and out-of-frame reads rather than clamping them.
 *
 * Tiles file (what the agent writes):
 *   {
 *     "page": [2834.64, 2607.87],            // page size in PDF points
 *     "region": [99.2, 36.5, 2250.7, 2519.2],// --label-region, pdf pt, top-left
 *     "tiles": [
 *       { "crop": [0.035, 0.014, 0.29, 0.25],// page FRACTIONS of this tile
 *         "labels": [ { "code": "110", "x": 0.42, "y": 0.31 } ] }  // tile-local 0..1
 *     ]
 *   }
 *
 * Usage:
 *   npx tsx acquisition/src/zones-reads-merge-tiles.ts --tiles work/reads/<slug>.tiles.json \
 *     --dict work/zonage-dicts/<slug>.codes.json --out work/reads/<slug>.reads.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface TileLabel {
  code: string;
  x: number;
  y: number;
}
interface Tile {
  crop: [number, number, number, number];
  labels: TileLabel[];
}
interface TilesFile {
  page: [number, number];
  region: [number, number, number, number];
  tiles: Tile[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function loadDict(path: string): Set<string> {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const codes: unknown = Array.isArray(j) ? j : j?.codes;
  if (!Array.isArray(codes)) throw new Error(`--dict must be an array or {codes:[...]}: ${path}`);
  return new Set(codes.map((c) => String(c).toUpperCase()));
}

function main(): void {
  const tilesPath = arg("tiles");
  const outPath = arg("out");
  const dictPath = arg("dict");
  if (!tilesPath || !existsSync(tilesPath)) throw new Error("required: --tiles <tiles.json> [--dict <codes.json>] [--out <reads.json>]");

  const spec = JSON.parse(readFileSync(tilesPath, "utf8")) as TilesFile;
  const [pageW, pageH] = spec.page;
  const [rx0, ry0, rx1, ry1] = spec.region;
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (!(rw > 0 && rh > 0)) throw new Error("region must be [x0,y0,x1,y1] with x1>x0, y1>y0 (pdf points, top-left)");
  const dict = dictPath ? loadDict(dictPath) : undefined;

  const out: TileLabel[] = [];
  const dropped: string[] = [];
  const outside: string[] = [];
  const seen = new Map<string, number>();

  spec.tiles.forEach((tile, ti) => {
    const [fx0, fy0, fx1, fy1] = tile.crop;
    for (const l of tile.labels ?? []) {
      const code = String(l.code).toUpperCase();
      if (dict && !dict.has(code)) {
        dropped.push(`t${ti}:${code}`);
        continue;
      }
      // tile-local 0..1 -> page points -> region-normalised 0..1
      const pageX = (fx0 + l.x * (fx1 - fx0)) * pageW;
      const pageY = (fy0 + l.y * (fy1 - fy0)) * pageH;
      const x = (pageX - rx0) / rw;
      const y = (pageY - ry0) / rh;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        outside.push(`t${ti}:${code}(${x.toFixed(3)},${y.toFixed(3)})`);
        continue;
      }
      seen.set(code, (seen.get(code) ?? 0) + 1);
      out.push({ code, x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) });
    }
  });

  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([c, n]) => `${c}x${n}`);
  console.error(`[reads-merge] tiles=${spec.tiles.length} labels=${out.length} distinct=${seen.size}`);
  if (dupes.length) console.error(`[reads-merge] multi-spot codes (legitimate if far apart): ${dupes.join(" ")}`);
  if (dropped.length) console.error(`[reads-merge] DROPPED not-in-dict (${dropped.length}): ${dropped.join(" ")}`);
  if (outside.length) console.error(`[reads-merge] DROPPED outside region (${outside.length}): ${outside.join(" ")}`);
  if (dict) {
    const missing = [...dict].filter((c) => !seen.has(c)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    console.error(`[reads-merge] dict codes NOT read (${missing.length}/${dict.size}): ${missing.join(" ")}`);
    console.error(
      `[reads-merge] WARNING: an unread zone is NOT a hole — t1-zones assigns its lots to the NEAREST label ` +
        `(nearest-label Voronoi), so a missing label silently mislabels that zone's lots.`,
    );
  }

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ labels: out }, null, 2));
    console.error(`[reads-merge] wrote ${outPath}`);
  }
}

main();
