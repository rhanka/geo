/**
 * pdf-normalize-rotation.ts — bake a page's /Rotate into its content so that
 * EVERY poppler tool in the recalage chain reports ONE coordinate frame.
 *
 * WHY (measured, saint-polycarpe 2026-07-17):
 *   A plan exported with /Rotate 90 is read in THREE disagreeing frames:
 *     pdfinfo        "Page size: 792 x 1224"  → /Rotate NOT applied
 *     pdftocairo -svg  width=1224 height=792  → /Rotate APPLIED
 *     pdftotext -bbox  width=792 height=1224  → /Rotate NOT applied
 *   `pdfPageSize()` (t2-autogcp.ts:169, t2-build.ts:136, t3-chamfer-seed.ts:113,
 *   t2-build-multisheet.ts:152, t2-emit-northup-gcp.ts:139 — six copies, none of
 *   which parses "Page rot") feeds the pdfinfo frame to
 *   `extractSvgVectorPoints`, which measures points in the pdftocairo frame.
 *
 *   The damage is silent and it is NOT caught by any gate: the auto-seed fit is
 *   derived from SVG points against SVG points, so it is self-consistent and
 *   clears residual+holdout. But the LABELS come from pdftotext, i.e. the OTHER
 *   frame — so a "passing" fit plants every zone code in the wrong place. The
 *   only symptom is a lot-coverage that lands just under the arbitration floor
 *   (saint-polycarpe: serving 79.27% < 85%), which reads as "anisotropy not
 *   confirmed real" rather than "the pipeline mixed two frames".
 *
 * WHAT THIS DOES: re-writes the PDF through `pdftocairo -pdf`, which applies
 * /Rotate to the content and emits /Rotate 0 pages. Vectors stay vectors (no
 * rasterisation) — verify with the reported svg-point count if in doubt. On a
 * page that is already /Rotate 0 this is a no-op and the source path is echoed
 * back unchanged, so it is safe to put in front of every plan unconditionally.
 *
 * This normalises a FRAME. It invents nothing, moves no feature, and serves
 * nothing: every downstream anti-invention gate (residual, holdout, iso-gate,
 * lot-coverage arbitration) still applies in full.
 *
 * Usage:
 *   npx tsx acquisition/src/pdf-normalize-rotation.ts --pdf <in.pdf> --out <out.pdf> [--page 1]
 * Prints the path to use downstream (the normalised file, or the original when
 * no rotation was present).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

export interface PageFrame {
  pageW: number;
  pageH: number;
  rot: number;
}

/** Read the page box AND the /Rotate that the six pdfPageSize copies ignore. */
export function readPageFrame(pdfPath: string, page = 1): PageFrame {
  const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), pdfPath], {
    encoding: "utf8",
  });
  const pm =
    info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: could not read page size");
  const rm =
    info.match(new RegExp(`Page\\s+${page}\\s+rot:\\s*(-?\\d+)`)) ?? info.match(/Page rot:\s*(-?\d+)/);
  return {
    pageW: Number(pm[1]),
    pageH: Number(pm[2]),
    rot: rm ? ((Number(rm[1]) % 360) + 360) % 360 : 0,
  };
}

/**
 * Bake /Rotate into the content. Returns the path to use downstream: the
 * normalised copy when the page was rotated, the ORIGINAL path when it was not
 * (so callers can pipe unconditionally without paying a re-write).
 */
export function normalizeRotation(pdfPath: string, outPath: string, page = 1): string {
  const before = readPageFrame(pdfPath, page);
  if (before.rot === 0) return pdfPath;
  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync("pdftocairo", ["-pdf", pdfPath, outPath], { timeout: 300_000 });
  if (!existsSync(outPath)) throw new Error(`pdftocairo -pdf produced nothing at ${outPath}`);
  const after = readPageFrame(outPath, page);
  if (after.rot !== 0) {
    throw new Error(`normalise failed: /Rotate still ${after.rot} after pdftocairo -pdf`);
  }
  // A 90/270 bake must transpose the box; anything else means poppler did
  // something we did not ask for, and we refuse to hand it downstream.
  const expectSwap = before.rot === 90 || before.rot === 270;
  const wantW = expectSwap ? before.pageH : before.pageW;
  const wantH = expectSwap ? before.pageW : before.pageH;
  if (Math.abs(after.pageW - wantW) > 2 || Math.abs(after.pageH - wantH) > 2) {
    throw new Error(
      `normalise failed: expected ${wantW}x${wantH} after baking rot ${before.rot}, got ${after.pageW}x${after.pageH}`,
    );
  }
  return outPath;
}

if (process.argv[1] && process.argv[1].endsWith("pdf-normalize-rotation.ts")) {
  const pdf = arg("pdf");
  const out = arg("out");
  const page = Number(arg("page", "1"));
  if (!pdf || !out) throw new Error("required: --pdf <in.pdf> --out <out.pdf>");
  const before = readPageFrame(pdf, page);
  const used = normalizeRotation(pdf, out, page);
  const after = readPageFrame(used, page);
  console.error(
    `[pdf-normalize-rotation] before: ${before.pageW}x${before.pageH} rot=${before.rot} → after: ${after.pageW}x${after.pageH} rot=${after.rot}${used === pdf ? " (no-op, already north-up frame)" : ""}`,
  );
  console.log(used);
}
