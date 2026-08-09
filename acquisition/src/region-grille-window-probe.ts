/**
 * region-grille-window-probe — READ-ONLY ($0, no S3, no LLM). Locates the "grille
 * des usages et normes / spécifications" annex inside a staged zoning by-law PDF so
 * a GPT-5.5 vision pass can be windowed tightly (mirrors the runner's
 * detectGridPages, plus a title-marker scan and a zones-in-columns detector).
 *
 * Per slug it prints: total pages, the grille-title pages, the zones-in-columns
 * pages, and the recommended [first..last] window (min-1 .. max+1, clamped).
 *
 * Usage: npx tsx acquisition/src/region-grille-window-probe.ts --slugs a,b,c
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isMultiZoneHorizontalPage } from "../../packages/qc-sources/src/sources/grille-pdf-classifier.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

const TITLE_RE = /grille\s+des\s+(?:usages?\s+et\s+(?:des\s+)?normes?|sp.cifications?|normes?)/i;
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-?\d{1,3}\b/g;
const GRID_HEADER_EXCLUDE = /\b(?:ARTICLES?|R[ÈE]GLEMENTS?|REGLEMENTS?)\b|\b(?:19|20)\d{2}\b/i;
const MIN_CODES = 6;

function stagedGrille(slug: string): string | null {
  const dir = join(WORK, slug);
  if (!existsSync(dir)) return null;
  try {
    const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return null;
    return join(dir, pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!);
  } catch {
    return null;
  }
}

function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function colBandHit(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (GRID_HEADER_EXCLUDE.test(line)) continue;
    const codes = new Set<string>();
    for (const m of line.matchAll(ZONE_CODE_TOKEN)) codes.add(m[0].toUpperCase());
    if (codes.size >= MIN_CODES) return true;
  }
  return false;
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
    const titlePages: number[] = [];
    const colPages: number[] = [];
    const horizPages: number[] = [];
    texts.forEach((t, i) => {
      const p = i + 1;
      if (TITLE_RE.test(t)) titlePages.push(p);
      if (colBandHit(t)) colPages.push(p);
      if (isMultiZoneHorizontalPage(t)) horizPages.push(p);
    });
    const hits = [...new Set([...colPages, ...horizPages])].sort((a, b) => a - b);
    let win = "n/a";
    if (hits.length > 0) {
      const first = Math.max(1, hits[0]! - 1);
      const last = Math.min(texts.length, hits[hits.length - 1]! + 1);
      win = `${first}..${last} (${last - first + 1}p)`;
    }
    console.log(
      `${slug.padEnd(42)} pages=${String(texts.length).padStart(3)} ` +
        `title=[${titlePages.slice(0, 8).join(",")}] cols=[${colPages.slice(0, 12).join(",")}] ` +
        `horiz=${horizPages.length} → WIN ${win}`,
    );
  }
}

main();
