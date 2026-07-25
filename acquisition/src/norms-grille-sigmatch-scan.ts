/**
 * norms-grille-sigmatch-scan — $0 decisive gate before paying for an OCR pass.
 *
 * For each slug, scan EVERY local PDF under work/zonage-norms/<slug>/ and score
 * each page by how many DISTINCT **SIG zone codes of that municipality** appear
 * verbatim in its text layer. Unlike norms-grille-page-locate (shape regex), this
 * matches the real code vocabulary, so it also works for numeric-only munis
 * (e.g. "512", "25") and dotted forms ("AG.19", "FC.10").
 *
 * A page carrying >= --min distinct SIG codes is a proven grille window: that is
 * the only thing that justifies spending on Mistral. No hit => don't pay.
 *
 * Pure read: 1 S3 GET per slug + local pdftotext. 0 writes, 0 LLM.
 *
 * ⛔ KNOWN FALSE NEGATIVE — DO NOT USE THIS ALONE AS A VETO. The scan assumes a
 * TRANSPOSED grille (many zone codes on one page). It is BLIND to the fiche-par-zone
 * gabarit, where each page documents ONE zone and therefore carries a single code:
 * saint-lazare (60 zones deposited, overlap 100%) scores NO-SIG-CODES here. Before
 * concluding "no grille", also run the $0 zoneheader probe:
 *   zonage-norms-run.ts --route zoneheader --dry-run --budget-usd 0
 *
 * KNOWN FALSE POSITIVE (seen on sainte-genevieve-de-berthier): when a muni's SIG
 * codes are short (H1, C8), they collide with the *usage class* rows (H-1, H-2…)
 * printed inside a fiche-par-zone grille that belongs to ANOTHER municipality.
 * A GRILLE-WINDOW is therefore necessary but NOT sufficient — always confirm the
 * document names the municipality (pdf-page-text --page 1) before paying.
 *
 * Usage:
 *   npx tsx acquisition/src/norms-grille-sigmatch-scan.ts --slugs a,b,c [--min 5] [--top 6]
 *     [--pdf <path>]            scan one explicit PDF instead of the slug dir
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { s3Client, getBytes } from "./lib/s3.js";
import { resolveGridKey, sigZoneCodesFromGeojson, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Header vocabulary of a real "grille des usages et normes". A page carrying SIG
 * codes but NO such header is usually another table of the bylaw (distances
 * séparatrices, panneaux-réclame, classes d'usages) — a proven false positive.
 */
const GRILLE_HEADERS = [
  "grille des",
  "usages et normes",
  "spécification",
  "specification",
  "marge",
  "hauteur",
  "implantation",
  "frontage",
  "superficie minimale",
  "rapport",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sigTokens(slug: string): Promise<string[]> {
  const s3 = s3Client();
  const key = await resolveGridKey(s3, slug);
  if (!key) return [];
  const geojson = (await getBytes(s3, key)).toString("utf8");
  const set = new Set<string>(sigZoneCodesFromGeojson(geojson));
  const parsed = JSON.parse(geojson) as { features?: Array<{ properties?: Record<string, unknown> }> };
  for (const f of parsed.features ?? []) {
    for (const name of SIG_ZONE_CODE_FIELDS) {
      const v = f.properties?.[name];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) set.add(s);
    }
  }
  return [...set].filter((c) => c.length >= 1 && c.length <= 14);
}

function pdfsFor(slug: string): string[] {
  const dir = join("work/zonage-norms", slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).size > 4096)
    .sort();
}

function scanPdf(pdf: string, tokens: string[], min: number, top: number): void {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.log(`  ${pdf}\tPDFTOTEXT-FAIL`);
    return;
  }
  const pages = (r.stdout ?? "").split("\f");
  const chars = (r.stdout ?? "").length;
  // Case-insensitive: the SIG spells "RB-9" where the bylaw prints "Rb-9".
  // Optional separator: "AG-1" in the SIG is often "AG 1" or "AG1" in the PDF.
  const res = new Map(
    tokens.map((t) => [
      t,
      new RegExp(`(?<![\\w-])${escapeRe(t).replace(/\\?-/g, "[-. ]?")}(?![\\w-])`, "i"),
    ]),
  );
  const rows = pages.map((txt, i) => {
    let hits: string[] = [];
    for (const [t, re] of res) if (re.test(txt)) hits.push(t);
    const low = txt.toLowerCase();
    const headers = GRILLE_HEADERS.filter((h) => low.includes(h)).length;
    return { page: i + 1, n: hits.length, headers, sample: hits.slice(0, 8) };
  });
  const strong = rows.filter((x) => x.n >= min && x.headers >= 3);
  const ranked = [...rows].sort((a, b) => b.n - a.n).slice(0, top);
  const runs: Array<[number, number]> = [];
  for (const x of strong) {
    const last = runs[runs.length - 1];
    if (last && x.page === last[1] + 1) last[1] = x.page;
    else runs.push([x.page, x.page]);
  }
  const verdict = chars < 200 * pages.length ? "THIN-TEXT" : strong.length ? "GRILLE-WINDOW" : "NO-SIG-CODES";
  console.log(
    `  ${pdf}\t${verdict}\tpages=${pages.length}\tstrongPages=${strong.length}\truns=${runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",") || "-"}`,
  );
  for (const x of ranked.slice(0, 3)) {
    if (x.n > 0) console.log(`      p${x.page} codes=${x.n} headers=${x.headers} :: ${x.sample.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const slugs = (get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) throw new Error("required: --slugs a,b,c");
  const min = Number(get("min") ?? "5");
  const top = Number(get("top") ?? "6");
  const onePdf = get("pdf");

  for (const slug of slugs) {
    const tokens = await sigTokens(slug);
    if (!tokens.length) {
      console.log(`### ${slug}\tNO-SIG-CODES-AT-ALL`);
      continue;
    }
    const pdfs = onePdf ? [onePdf] : pdfsFor(slug);
    console.log(`### ${slug} sigTokens=${tokens.length} pdfs=${pdfs.length}`);
    for (const p of pdfs) scanPdf(p, tokens, min, top);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
