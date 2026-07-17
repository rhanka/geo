/**
 * _pdf-render-page.ts — render one PDF page (or a crop of it) to PNG, so the
 * operating agent can LOOK at the drawing.
 *
 * Why a committed tool: confirming a plan is north-up is an INDEPENDENT check the
 * recalage lane requires before `t2-emit-northup-gcp` may pick an orientation
 * (north arrow up, title block, neighbouring munis in the right cardinal spot).
 * That check needs an image, and every ad-hoc `pdftocairo` invocation is a
 * one-off — this makes the step reproducible and reviewable.
 *
 * $0: poppler only, no model, no network.
 *
 * Usage:
 *   npx tsx acquisition/src/_pdf-render-page.ts --pdf <path> --page 3 [--dpi 45] [--out <prefix>]
 *   npx tsx acquisition/src/_pdf-render-page.ts --pdf <path> --page 3 --crop 0.6,0.0,1.0,0.25
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pdf = arg("pdf");
  const page = parseInt(arg("page") ?? "1", 10);
  const dpi = parseInt(arg("dpi") ?? "45", 10);
  const out = arg("out") ?? `/tmp/pdf-page-${page}`;
  const crop = arg("crop"); // fx0,fy0,fx1,fy1 as page fractions

  if (!pdf) {
    console.error("usage: --pdf <path> --page <n> [--dpi 45] [--out <prefix>] [--crop fx0,fy0,fx1,fy1]");
    process.exit(2);
  }
  mkdirSync(dirname(out), { recursive: true });

  const args = ["-png", "-r", String(dpi), "-f", String(page), "-l", String(page)];
  if (crop) {
    const f = crop.split(",").map(Number);
    if (f.length !== 4 || !f.every((n) => Number.isFinite(n))) throw new Error("--crop must be fx0,fy0,fx1,fy1");
    // Page size in points → crop box in pixels at the requested dpi.
    const info = execFileSync("pdfinfo", ["-f", String(page), "-l", String(page), pdf], { encoding: "utf8" });
    const m = info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ?? info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
    if (!m) throw new Error("pdfinfo: could not read page size");
    const pxW = (Number(m[1]) * dpi) / 72;
    const pxH = (Number(m[2]) * dpi) / 72;
    const x = Math.round(Math.min(f[0]!, f[2]!) * pxW);
    const y = Math.round(Math.min(f[1]!, f[3]!) * pxH);
    const w = Math.round(Math.abs(f[2]! - f[0]!) * pxW);
    const h = Math.round(Math.abs(f[3]! - f[1]!) * pxH);
    args.push("-x", String(x), "-y", String(y), "-W", String(w), "-H", String(h));
    console.error(`crop px: x=${x} y=${y} w=${w} h=${h} (page ${pxW.toFixed(0)}x${pxH.toFixed(0)} @ ${dpi}dpi)`);
  }
  args.push(pdf, out);

  execFileSync("pdftocairo", args, { stdio: "inherit", timeout: 180_000 });
  console.log(`${out}-${String(page).padStart(2, "0")}.png (or ${out}-${page}.png)`);
}

main();
