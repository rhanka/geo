/**
 * _svg-page-frame-probe.ts — falsify (or confirm) the page-frame agreement
 * between `pdfinfo` (which feeds pageW/pageH in t2-autogcp) and the `pdftocairo
 * -svg` render (which feeds extractSvgVectorPoints).
 *
 * WHY: `pdfPageSize()` (acquisition/src/t2-autogcp.ts:169) parses pdfinfo's
 * "Page size: W x H pts". Poppler reports the *MediaBox* there and prints the
 * /Rotate value on a SEPARATE "Page rot:" line. `pdftocairo -svg` APPLIES
 * /Rotate. So on a /Rotate 90|270 page the SVG frame is TRANSPOSED relative to
 * the pageW/pageH handed to extractSvgVectorPoints/inNeatline/marginCrops.
 *
 * This probe only MEASURES and prints. It changes nothing and serves nothing.
 *
 * Usage: npx tsx acquisition/src/_svg-page-frame-probe.ts --pdf <path> [--page 1]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
const page = Number(arg("page", "1"));
if (!pdf) throw new Error("required: --pdf <path>");

const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), pdf], {
  encoding: "utf8",
});
const pm =
  info.match(/Page\s+\d+\s+size:\s*([\d.]+)\s*x\s*([\d.]+)/) ??
  info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
if (!pm) throw new Error("pdfinfo: could not read page size");
const pageW = Number(pm[1]);
const pageH = Number(pm[2]);
const rotM = info.match(/Page\s+\d+\s+rot:\s*(-?\d+)/) ?? info.match(/Page rot:\s*(-?\d+)/);
const rot = rotM ? Number(rotM[1]) : 0;

const dir = mkdtempSync(join(tmpdir(), "svgframe-"));
const out = join(dir, "p.svg");
execFileSync("pdftocairo", ["-svg", "-f", String(page), "-l", String(page), pdf, out], {
  timeout: 180_000,
});
const svg = readFileSync(out, "utf8").slice(0, 4000);
const wm = svg.match(/width="([\d.]+)pt"/);
const hm = svg.match(/height="([\d.]+)pt"/);
const svgW = wm ? Number(wm[1]) : NaN;
const svgH = hm ? Number(hm[1]) : NaN;

// The THIRD frame that must agree: pdftotext -bbox, which feeds the label
// extraction (lib/t1-labels.ts). If labels and SVG share a frame but pageW/pageH
// does not, the single honest fix is pdfPageSize; if labels disagree with the
// SVG too, the fix is bigger and must not be guessed.
const btxt = execFileSync(
  "pdftotext",
  ["-bbox", "-f", String(page), "-l", String(page), pdf, "-"],
  { encoding: "utf8" },
);
const bm = btxt.match(/<page width="([\d.]+)" height="([\d.]+)"/);
const bboxW = bm ? Number(bm[1]) : NaN;
const bboxH = bm ? Number(bm[2]) : NaN;

const transposed =
  Math.abs(svgW - pageH) < 1.5 && Math.abs(svgH - pageW) < 1.5 && Math.abs(pageW - pageH) > 1.5;
// Dimensions alone CANNOT clear a page: /Rotate 180 leaves every box identical
// while still flipping the SVG content 180° against un-flipped pdftotext labels.
// A square page hides a 90° rotation the same way. So /Rotate is the authority
// and the dims are only corroboration.
const agrees = rot === 0 && Math.abs(svgW - pageW) < 1.5 && Math.abs(svgH - pageH) < 1.5;
const labelsMatchSvg = rot === 0 && Math.abs(bboxW - svgW) < 1.5 && Math.abs(bboxH - svgH) < 1.5;

console.log(`pdf            = ${pdf}  (page ${page})`);
console.log(`pdfinfo        : pageW=${pageW} pageH=${pageH}  Page rot=${rot}`);
console.log(`pdftocairo svg : svgW=${svgW} svgH=${svgH}`);
console.log(`pdftotext bbox : bboxW=${bboxW} bboxH=${bboxH}  (labels frame)`);
console.log(
  `labels vs svg  : ${labelsMatchSvg ? "AGREE — one consistent render frame" : "DISAGREE — labels and vectors live in different frames"}`,
);
console.log(
  `VERDICT        : ${
    agrees
      ? "FRAMES AGREE — /Rotate 0, pageW/pageH match the SVG render; no normalisation needed"
      : rot !== 0 && transposed
        ? `FRAMES TRANSPOSED (/Rotate ${rot}) — SVG is rotated vs pdfinfo pageW/pageH; extractSvgVectorPoints gets the WRONG frame → NORMALISE`
        : rot !== 0
          ? `FRAMES ROTATED (/Rotate ${rot}) — boxes happen to match but SVG content is rotated against un-rotated pdftotext labels → NORMALISE`
          : "FRAMES DISAGREE at /Rotate 0 — unexpected, inspect manually"
  }`,
);
if (rot !== 0) {
  console.log(
    `FIX            : npx tsx acquisition/src/pdf-normalize-rotation.ts --pdf ${pdf} --out <out-norot.pdf> --page ${page}`,
  );
}
