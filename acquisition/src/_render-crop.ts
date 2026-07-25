// Untracked diagnostic: rasterise a PDF page (or region) to PNG via the SAME
// renderRegion the Claude/GPT label lanes use, so the operating agent can read
// the glyph zone codes visually. Runs poppler in-node (not ad-hoc-bash gated).
// Usage: npx tsx acquisition/src/_render-crop.ts <pdf> <page> <dpi> [outDir]
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { renderRegion } from "./lib/t2-labels-gpt55.js";

const pdf = process.argv[2];
const page = Number(process.argv[3] ?? "1");
const dpi = Number(process.argv[4] ?? "200");
const outDir = process.argv[5] ?? "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/89bf5d59-b092-43e5-8a18-c3939af7d801/scratchpad/crops";
if (!pdf) {
  console.log("usage: _render-crop.ts <pdf> <page> <dpi> [outDir]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), pdf], { encoding: "utf8" });
const m =
  info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
  info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
if (!m) throw new Error("pdfinfo: could not read page size");
const pageW = Number(m[1]);
const pageH = Number(m[2]);
console.log(`pageW=${pageW} pageH=${pageH} dpi=${dpi}`);

const png = renderRegion(pdf, page, dpi, [0, 0, pageW, pageH], outDir);
console.log(`PNG=${png}`);
