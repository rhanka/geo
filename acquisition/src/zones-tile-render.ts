/**
 * CLI: rasterise ONE tile of a zoning sheet, addressed in PAGE FRACTIONS.
 *
 * Why this exists: the `--labels claude` lane is a loop of
 *   render a tile -> the agent READS the glyph codes -> record them in
 *   work/reads/<slug>.tiles.json -> zones-reads-merge-tiles.ts re-projects.
 * The tiles file addresses tiles in page fractions (`crop: [x0,y0,x1,y1]`), but
 * poppler wants pixels at a DPI. Doing that conversion by hand for every tile is
 * exactly the silent arithmetic slip `zones-reads-merge-tiles` was written to
 * avoid: a tile rendered at the wrong offset is still a perfectly readable image,
 * so the agent reads REAL codes and records them under a crop that never showed
 * them. No downstream gate can catch that — the labels simply land in the wrong
 * place and get served as fact.
 *
 * So: the SAME [x0,y0,x1,y1] page fractions you paste into the tiles file are the
 * ones you render here. Prints the crop line ready to paste.
 *
 * Sizing: a tile is read from a downscaled copy (~1568 px on the long edge), so
 * rendering much above that buys nothing — it is silently thrown away. Pick a DPI
 * that puts the tile NEAR that budget: this tool prints the pixel size and warns
 * when the render will be downscaled (i.e. you should cut a smaller tile instead
 * of raising DPI).
 *
 * Usage:
 *   npx tsx acquisition/src/zones-tile-render.ts --pdf work/pdf/<slug>-zonage.pdf \
 *     --crop 0.46,0.24,0.58,0.36 [--page 1] [--dpi 300] [--out-dir <dir>] [--id r1c2]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { renderRegion } from "./lib/t2-labels-gpt55.js";

const READ_LONG_EDGE_PX = 1568; // what the vision read actually receives

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function pageSize(pdf: string, page: number): [number, number] {
  const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), pdf], { encoding: "utf8" });
  const m =
    info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!m) throw new Error(`pdfinfo: could not read size of page ${page} of ${pdf}`);
  return [Number(m[1]), Number(m[2])];
}

function main(): void {
  const pdf = arg("pdf");
  const cropRaw = arg("crop");
  const page = Number(arg("page") ?? "1");
  const dpi = Number(arg("dpi") ?? "300");
  const id = arg("id");
  const outDir = arg("out-dir") ?? "work/tiles";
  if (!pdf || !cropRaw) {
    throw new Error("required: --pdf <file> --crop x0,y0,x1,y1 (page fractions) [--page 1] [--dpi 300] [--id <tag>]");
  }

  const crop = cropRaw.split(",").map((s) => Number(s.trim()));
  if (crop.length !== 4 || crop.some((v) => !Number.isFinite(v))) {
    throw new Error(`--crop must be 4 numbers x0,y0,x1,y1 (page fractions 0..1), got: ${cropRaw}`);
  }
  const [fx0, fy0, fx1, fy1] = crop as [number, number, number, number];
  if (!(fx1 > fx0 && fy1 > fy0)) throw new Error("--crop must satisfy x1>x0 and y1>y0");
  if (crop.some((v) => v < 0 || v > 1)) throw new Error("--crop values are PAGE FRACTIONS and must be within 0..1");

  const [pageW, pageH] = pageSize(pdf, page);
  mkdirSync(outDir, { recursive: true });

  const region: [number, number, number, number] = [fx0 * pageW, fy0 * pageH, fx1 * pageW, fy1 * pageH];
  const png = renderRegion(pdf, page, dpi, region, outDir);

  const wPx = Math.round((region[2] - region[0]) * (dpi / 72));
  const hPx = Math.round((region[3] - region[1]) * (dpi / 72));
  const longEdge = Math.max(wPx, hPx);
  console.error(`[tile-render] page=${pageW}x${pageH}pt crop=[${crop.join(",")}] dpi=${dpi} -> ${wPx}x${hPx}px`);
  if (longEdge > READ_LONG_EDGE_PX) {
    const factor = (longEdge / READ_LONG_EDGE_PX).toFixed(2);
    console.error(
      `[tile-render] WARNING: long edge ${longEdge}px > ${READ_LONG_EDGE_PX}px read budget: the image is downscaled ` +
        `~${factor}x before it is read, so this DPI is wasted. Cut a SMALLER crop instead of raising --dpi.`,
    );
  }
  console.error(`[tile-render] paste into work/reads/<slug>.tiles.json:`);
  console.error(`  { "_id": ${JSON.stringify(id ?? "tile")}, "crop": [${crop.join(", ")}], "labels": [] }`);
  console.log(png);
}

main();
