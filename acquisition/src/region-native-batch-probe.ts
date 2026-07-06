/**
 * region-native-batch-probe — READ-ONLY ($0, no S3, no LLM). Runs EVERY frozen
 * native-text grille parser family against each staged grille PDF for a set of
 * slugs (or every staged grille in the Estrie/Montérégie/Centre-du-Québec region),
 * so we know which munis deposit for FREE before spending GPT-5.5 per page.
 *
 * Per slug it prints the best native family (max unique codes among families that
 * publish ≥1 norm field) and its zone-code sample. Pure read of `pdftotext -layout`.
 *
 * Usage:
 *   npx tsx acquisition/src/region-native-batch-probe.ts            # all staged region grilles
 *   npx tsx acquisition/src/region-native-batch-probe.ts --slugs a,b,c
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseZoneHeader,
  isNumberedGrilleSpec,
  parseNumberedGrilleNativePage,
  parseNumeroDominanceHeader,
  parseNumeroDominanceGrillePage,
  parseTransposedColumnsGrille,
  parseTransposedGrilleNativePage,
  looksLikeNormeGeneraleGrille,
  parseNormeGeneraleGrillePage,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import { parseLabelValueGrillePage } from "../../packages/qc-sources/src/sources/grille-zoneheader-parser.js";
import { parseSpanHeaderGrillePage } from "../../packages/qc-sources/src/sources/grille-spanheader-parser.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import { loadMatrix, MATRIX_PATH, allMunicipalities } from "./coverage-matrix.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

const REGION_MRCS = new Set(
  [
    "Le Granit", "Le Haut-Saint-François", "Le Val-Saint-François", "Les Sources",
    "Coaticook", "Memphrémagog", "Sherbrooke",
    "Acton", "Beauharnois-Salaberry", "Brome-Missisquoi", "La Haute-Yamaska",
    "Le Haut-Richelieu", "Le Haut-Saint-Laurent", "Les Jardins-de-Napierville",
    "Les Maskoutains", "La Vallée-du-Richelieu", "Marguerite-D'Youville",
    "Pierre-De Saurel", "Roussillon", "Rouville", "Vaudreuil-Soulanges", "Longueuil",
    "Arthabaska", "Bécancour", "Drummond", "L'Érable", "Nicolet-Yamaska",
  ].map((s) => s.toLowerCase()),
);

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
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite, z.hauteur_min, z.hauteur_max, z.frontage_min, z.superficie_min,
    z.marges?.avant_min, z.marges?.laterale_min, z.marges?.arriere_min,
  ];
  return fs.filter((f) => f && (f as { value: number | null }).value !== null).length;
}

const FAMILIES: Array<{ name: string; run: (t: string, p: number, o: { source_url: string; snapshot: string }) => ZoneNormsT[] }> = [
  { name: "numbered", run: (t, p, o) => (parseZoneHeader(t) && isNumberedGrilleSpec(t) ? parseNumberedGrilleNativePage(t, p, { ...o, methode: "n" }) : []) },
  { name: "numeroDom", run: (t, p, o) => (parseNumeroDominanceHeader(t) ? parseNumeroDominanceGrillePage(t, p, { ...o, methode: "n" }) : []) },
  { name: "normeGen", run: (t, p, o) => (looksLikeNormeGeneraleGrille(t) ? parseNormeGeneraleGrillePage(t, p, { ...o, methode: "n" }) : []) },
  { name: "transpCols", run: (t, p, o) => parseTransposedColumnsGrille(t, p, { ...o, methode: "n" }) },
  { name: "transpGrille", run: (t, p, o) => parseTransposedGrilleNativePage(t, p, { ...o, methode: "n" }) },
  { name: "labelValue", run: (t, p, o) => parseLabelValueGrillePage(t, p, { ...o, methode: "n" }) },
  { name: "spanHeader", run: (t, p, o) => parseSpanHeaderGrillePage(t, p, { ...o, methode: "n" }) },
];

function probe(slug: string, pdf: string, opts: { source_url: string; snapshot: string }): void {
  const texts = pageTexts(pdf);
  let best: { family: string; codes: Set<string>; zonesWithNorms: number } | null = null;
  const perFamily: string[] = [];
  for (const fam of FAMILIES) {
    const codes = new Set<string>();
    let zonesWithNorms = 0;
    let pagesFired = 0;
    texts.forEach((t, i) => {
      let zs: ZoneNormsT[] = [];
      try { zs = fam.run(t, i + 1, opts); } catch { zs = []; }
      const good = zs.filter((z) => publishedCount(z) > 0);
      if (good.length > 0) { pagesFired++; zonesWithNorms += good.length; for (const z of good) codes.add(z.zone_code); }
    });
    if (codes.size > 0) perFamily.push(`${fam.name}=${codes.size}c/${zonesWithNorms}z/${pagesFired}p`);
    if (codes.size > 0 && (!best || codes.size > best.codes.size)) best = { family: fam.name, codes, zonesWithNorms };
  }
  const verdict = best && best.codes.size >= 3 ? "NATIVE-OK" : best ? "thin" : "none";
  console.log(
    `${verdict.padEnd(10)} ${slug.padEnd(42)} pages=${String(texts.length).padStart(3)} ` +
      (best ? `best=${best.family}(${best.codes.size}c) sample=[${[...best.codes].slice(0, 8).join(",")}]` : "no native family fired") +
      (perFamily.length ? `  {${perFamily.join(" ")}}` : ""),
  );
}

function main(): void {
  const slugArg = (() => {
    const i = process.argv.indexOf("--slugs");
    return i >= 0 ? process.argv[i + 1] : undefined;
  })();
  const snapshot = new Date().toISOString().slice(0, 10);
  const opts = { source_url: "probe", snapshot };

  let slugs: string[];
  if (slugArg) {
    slugs = slugArg.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const matrix = loadMatrix(MATRIX_PATH)!;
    const mrcBySlug = new Map<string, string | null>();
    for (const m of allMunicipalities()) mrcBySlug.set(m.slug, m.mrc);
    slugs = Object.entries(matrix.cities)
      .filter(([slug, cov]) => {
        const c = cov as Record<string, { status?: string }>;
        if (c["zones"]?.status !== "done" || c["normes"]?.status === "done") return false;
        const mrc = mrcBySlug.get(slug);
        return mrc != null && REGION_MRCS.has(mrc.toLowerCase()) && stagedGrille(slug) !== null;
      })
      .map(([slug]) => slug)
      .sort();
  }

  console.log(`probing ${slugs.length} staged grille(s)\n`);
  for (const slug of slugs) {
    const pdf = stagedGrille(slug);
    if (!pdf) { console.log(`MISSING    ${slug} (no staged grille)`); continue; }
    try { probe(slug, pdf, opts); } catch (e) { console.log(`ERROR      ${slug}: ${(e as Error).message.slice(0, 80)}`); }
  }
}

main();
