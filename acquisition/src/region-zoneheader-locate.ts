/**
 * region-zoneheader-locate — READ-ONLY ($0). Runs the frozen one-zone-per-page
 * grille locator (locateZoneHeaderGrille) + the Numéro/Dominance and span-header
 * page detectors over a staged PDF, so we know the grille annex page window even
 * when its value cells are image scans (native norm read fails). Guides the tight
 * GPT-5.5 vision window.
 *
 * Usage: npx tsx acquisition/src/region-zoneheader-locate.ts --slugs a,b,c
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { locateZoneHeaderGrille, readZoneHeaderCode } from "../../packages/qc-sources/src/sources/grille-zoneheader-locator.js";
import { parseNumeroDominanceHeader } from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

function stagedGrille(slug: string): string | null {
  const dir = join(WORK, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return null;
    return join(dir, pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!);
  } catch { return null; }
}

function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("usage: --slugs a,b,c"); process.exit(2); }
  for (const slug of slugs) {
    const pdf = stagedGrille(slug);
    if (!pdf) { console.log(`MISSING ${slug}`); continue; }
    const texts = pageTexts(pdf);
    const win = locateZoneHeaderGrille(texts);
    // pages carrying a bare ZONE header code (one-zone-per-page marker), even if scan
    const headerPages: number[] = [];
    const ndPages: number[] = [];
    texts.forEach((t, i) => {
      if (readZoneHeaderCode(t)) headerPages.push(i + 1);
      if (parseNumeroDominanceHeader(t)) ndPages.push(i + 1);
    });
    const hp = headerPages;
    const contiguity = hp.length > 1 ? `${hp[0]}..${hp[hp.length - 1]}` : hp.length === 1 ? `${hp[0]}` : "-";
    console.log(
      `${slug.padEnd(42)} pages=${String(texts.length).padStart(3)} ` +
        `loc=${win ? `${win.firstPage}..${win.lastPage}(codes=${win.uniqueZoneCodes},conf=${win.confidence})` : "none"} ` +
        `headerPages=${hp.length}[${contiguity}] ndPages=${ndPages.length}`,
    );
  }
}

main();
