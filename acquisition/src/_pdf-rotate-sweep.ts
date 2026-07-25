/**
 * _pdf-rotate-sweep.ts — $0 sweep for the /Rotate TWO-FRAME trap over the cached
 * zoning plans.
 *
 * THE TRAP. `t2-autogcp` sizes the page with `pdfinfo` ("Page size: W x H"),
 * which reports the /MediaBox UNROTATED, while `pdftocairo -svg` (the source of
 * the vector points that become GCPs) and `pdftocairo -png` (what a human or the
 * vision lane actually looks at) BOTH apply /Rotate. On a plan carrying
 * `/Rotate 90|270` the two frames are TRANSPOSED: the fit is asked to map a
 * landscape drawing through a portrait page box. The fingerprint is an
 * "orientation ambiguity" / parasitic anisotropy reject — a gate failure, not a
 * geometry failure (eastman: /Rotate 270, MediaBox 2384x3370, drawing 3370x2384).
 *
 * The remedy is the one the project memory already prescribes: NORMALISE the
 * rotation BEFORE the pipeline (`_pdf-crop-page.ts <pdf> <page> 0,0,1,1 <out>`
 * re-emits the page through pdftocairo -pdf, baking /Rotate into the content and
 * leaving /Rotate 0), then re-run the auto-seed on the normalised copy.
 *
 * This sweep only MEASURES, at $0: it reports every cached plan whose page 1
 * carries a non-zero /Rotate, so the re-runs can be targeted instead of guessed.
 *
 *   npx tsx acquisition/src/_pdf-rotate-sweep.ts [--dir work/zonage-plans]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface PageInfo {
  file: string;
  rotate: number;
  mediaW: number;
  mediaH: number;
  pages: number;
}

function pdfInfo(path: string): PageInfo | null {
  let out: string;
  try {
    out = execFileSync("pdfinfo", ["-f", "1", "-l", "1", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const size = out.match(/Page\s+1\s+size:\s*([\d.]+)\s*x\s*([\d.]+)/) ?? out.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  const rot = out.match(/Page\s+1\s+rot:\s*(-?\d+)/) ?? out.match(/Page rot:\s*(-?\d+)/);
  const pages = out.match(/Pages:\s*(\d+)/);
  if (!size) return null;
  return {
    file: path,
    rotate: ((rot ? Number(rot[1]) : 0) % 360 + 360) % 360,
    mediaW: Number(size[1]),
    mediaH: Number(size[2]),
    pages: pages ? Number(pages[1]) : 1,
  };
}

function main(): void {
  const dirArg = process.argv.indexOf("--dir");
  const dir = dirArg >= 0 ? process.argv[dirArg + 1]! : "work/zonage-plans";
  if (!existsSync(dir)) throw new Error(`no such dir: ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => join(dir, f))
    .filter((p) => {
      try {
        return statSync(p).size > 1024;
      } catch {
        return false;
      }
    })
    .sort();
  console.log(`# scanning ${files.length} plan(s) in ${dir}`);

  let rotated = 0;
  let upright = 0;
  let unreadable = 0;
  for (const f of files) {
    const info = pdfInfo(f);
    if (!info) {
      unreadable++;
      continue;
    }
    if (info.rotate === 0) {
      upright++;
      continue;
    }
    rotated++;
    // The two frames the pipeline would disagree on.
    const drawnW = info.rotate % 180 === 0 ? info.mediaW : info.mediaH;
    const drawnH = info.rotate % 180 === 0 ? info.mediaH : info.mediaW;
    console.log(
      `⚠ ROTATE ${String(info.rotate).padStart(3)}  ${f}  mediabox ${info.mediaW}x${info.mediaH} ` +
        `→ drawn ${drawnW}x${drawnH}  pages=${info.pages}`,
    );
  }
  console.log(`\n# rotate!=0=${rotated} · upright=${upright} · unreadable=${unreadable}`);
}

main();
