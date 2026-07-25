/**
 * _frag-ndl-page-find.ts — ONE-OFF: find which page of the notre-dame-de-lourdes
 * --joliette by-law PDF carries the oversize map sheet (MediaBox ~2384x1684 pt,
 * vs the standard 612x792 letter pages used by the rest of the document) — the
 * embedded /VP /Measure /GEO georef page confirmed by _diag-vp-georef.ts
 * (residual 28.1 m). Cheap per-page `pdfinfo -f N -l N` scan (no rendering).
 *
 * Usage: npx tsx acquisition/src/_frag-ndl-page-find.ts --pdf <path> [--max 250]
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("required: --pdf <path>");
const max = Number(arg("max", "250"));

const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
const pagesM = info.match(/Pages:\s*(\d+)/);
const totalPages = pagesM ? Number(pagesM[1]) : 0;
console.log(`total pages: ${totalPages}`);

const limit = Math.min(totalPages, max);
for (let p = 1; p <= limit; p++) {
  try {
    const pinfo = execFileSync("pdfinfo", ["-f", String(p), "-l", String(p), pdf], { encoding: "utf8", timeout: 15_000 });
    const sizeM = pinfo.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
    if (sizeM) {
      const w = Number(sizeM[1]);
      const h = Number(sizeM[2]);
      if (w > 700 || h > 900) console.log(`page ${p}: ${w} x ${h} pt  <-- NON-STANDARD (candidat plan)`);
    }
  } catch (e) {
    console.log(`page ${p}: erreur pdfinfo: ${(e as Error).message?.slice(0, 100)}`);
  }
}
console.log("scan termine.");
