/**
 * region-grille-signature — READ-ONLY ($0). Scores every page of a staged by-law
 * PDF by how much it looks like the GRILLE DES USAGES ET NORMES table: a blend of
 * norm-field header keywords (marge, hauteur, superficie, frontage, densité,
 * rapport, implantation) and zone-code token density. Prints the top-scoring pages
 * so a GPT-5.5 vision pass can be aimed at the real grille table (landscape tables
 * that the layout/column heuristics miss). Pure `pdftotext -layout`.
 *
 * Usage: npx tsx acquisition/src/region-grille-signature.ts --slugs a,b,c [--top N]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

const NORM_LABELS = [
  /marges?\b/i, /hauteur/i, /superficie/i, /frontage/i, /densit/i,
  /rapport\s+(?:plancher|espace|b[âa]ti)/i, /implantation/i, /logements?\b/i,
  /entreposage/i, /usages?\b/i, /normes\b/i,
];
const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-\d{1,3}\b/g;
const EXCLUDE = /\b(?:ARTICLE|R[ÈE]GLEMENT|LRQ|L\.R\.Q)\b|\b(?:19|20)\d{2}\b/i;

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

function scorePage(text: string): { score: number; labels: number; codes: number; strict: boolean } {
  let labels = 0;
  for (const re of NORM_LABELS) if (re.test(text)) labels++;
  const codeSet = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (EXCLUDE.test(line)) continue;
    for (const m of line.matchAll(ZONE_CODE_TOKEN)) codeSet.add(m[0].toUpperCase());
  }
  const codes = codeSet.size;
  // STRICT implantation-grid fingerprint: margins in ≥2 directions + hauteur +
  // a lot-dimension (superficie/frontage) — the auxiliary entreposage/affichage
  // tables that trip the loose score lack this exact co-occurrence.
  const avant = /\bavant\b/i.test(text);
  const arriere = /arri[èe]re/i.test(text);
  const laterale = /lat[ée]rale/i.test(text);
  const marge = /marges?\b/i.test(text);
  const hauteur = /hauteur/i.test(text);
  const dim = /superficie/i.test(text) || /frontage/i.test(text);
  const dirs = [avant, arriere, laterale].filter(Boolean).length;
  const strict = marge && dirs >= 2 && hauteur && dim && codes >= 5;
  const score = labels * 3 + Math.min(codes, 40) + (strict ? 100 : 0);
  return { score, labels, codes, strict };
}

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const top = Number(arg("top") ?? "4");
  if (slugs.length === 0) { console.error("usage: --slugs a,b,c [--top N]"); process.exit(2); }
  for (const slug of slugs) {
    const pdf = stagedGrille(slug);
    if (!pdf) { console.log(`MISSING ${slug}`); continue; }
    const texts = pageTexts(pdf);
    const all = texts.map((t, i) => ({ page: i + 1, ...scorePage(t) }));
    const strict = all.filter((s) => s.strict).sort((a, b) => b.score - a.score);
    const scored = (strict.length > 0 ? strict : all.filter((s) => s.labels >= 3 && s.codes >= 3).sort((a, b) => b.score - a.score))
      .slice(0, top);
    const tag = strict.length > 0 ? "STRICT " : "loose  ";
    const cell = scored.map((s) => `p${s.page}(${s.score}:L${s.labels}/C${s.codes}${s.strict ? "*" : ""})`).join(" ");
    console.log(`${tag}${slug.padEnd(42)} pages=${String(texts.length).padStart(3)} → ${cell || "no text grille signature (likely image scan)"}`);
  }
}

main();
