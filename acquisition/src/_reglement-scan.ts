/**
 * _reglement-scan.ts — lane P0_1 provenance règlement (Steve/immo).
 *
 * Ouvre le PDF du règlement (URL DÉJÀ connue via la grille servie, cf.
 * `_reglement-targets.ts`) et SORT LE VERBATIM permettant de relever à la main:
 *   - reglement_numero  (numéro OFFICIEL du règlement de zonage)
 *   - reglement_millesime (année d'adoption / entrée en vigueur)
 *   - reglement_page_source (page du PDF où le numéro est lu)
 *
 * Ce tool NE DÉCIDE RIEN: il n'imprime que du texte extrait tel quel (pdftotext)
 * + les positions (page) des motifs « Règlement … numéro X ». L'humain/agent lit
 * le contexte et tranche. Anti-invention: aucune valeur n'est dérivée de l'URL ni
 * du nom de fichier.
 *
 * Usage (npx tsx, from repo root):
 *   npx tsx acquisition/src/_reglement-scan.ts --slugs acton-vale,brossard
 *   npx tsx acquisition/src/_reglement-scan.ts --slugs brossard --pages 3 --hits 14
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGETS = process.env["REGL_TARGETS"] ?? "";
const CACHE = process.env["REGL_CACHE"] ?? resolve(ROOT, ".tmp-regl");

interface Target {
  slug: string;
  mined_reglement: string | null;
  source_url: string | null;
  reglement_url: string | null;
}

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Motifs de numéro de règlement — sortis AVEC leur contexte (jamais réécrits). */
const PATTERNS: RegExp[] = [
  // « … numéro X », « … no X », « … #X », « … : X » — et un numéro peut commencer
  // par une lettre (Z-3001, R-630, RV-2011-11-23), pas seulement par un chiffre.
  /r[èe]glement[^\n]{0,40}?(?:de\s+)?zonage[^\n]{0,30}?(?:num[ée]ro|n[o°s]?\s*\.?|#)\s*[:\s]*([A-Z]{0,3}-?[0-9][\w\-\.\/]{0,20})/gi,
  /r[èe]glement\s+(?:de\s+)?zonage\s+([A-Z]{0,3}-?[0-9][\w\-\.\/]{1,20})/gi,
  /r[èe]glement\s+(?:num[ée]ro|n[o°s]?\s*\.?|#)\s*[:\s]*([A-Z]{0,3}-?[0-9][\w\-\.\/]{0,20})[^\n]{0,60}zonage/gi,
  /zonage[^\n]{0,40}(?:num[ée]ro|n[o°s]?\s*\.?|#)\s*[:\s]*([A-Z]{0,3}-?[0-9][\w\-\.\/]{0,20})/gi,
  // Cartouche de plan: « ZONAGE ANNEXÉ AU RÈGLEMENT Z-3001 ET ADOPTÉ LE … ».
  /annex[ée][^\n]{0,20}au\s+r[èe]glement\s+([A-Z]{0,3}-?[0-9][\w\-\.\/]{0,20})[^\n]{0,60}/gi,
];
/**
 * L'article « TITRE » d'un règlement québécois PORTE le numéro officiel
 * (« Le présent règlement porte le numéro 123 et s'intitule … »). C'est la preuve
 * verbatim la plus fiable — bien plus que la page-titre (souvent muette) ou l'URL.
 */
const TITLE_PATTERNS: RegExp[] = [
  /(?:pr[ée]sent\s+r[èe]glement|ce\s+r[èe]glement)[^\n]{0,60}?(?:porte\s+le\s+(?:titre\s+et\s+le\s+)?num[ée]ro|est\s+identifi[ée][^\n]{0,20}num[ée]ro|porte\s+le\s+num[ée]ro)[^\n]{0,140}/gi,
  /(?:conna[îi]tre|cit[ée])\s+sous\s+le\s+(?:titre|num[ée]ro)[^\n]{0,140}/gi,
  /r[èe]glement\s+(?:de\s+)?zonage\s+(?:num[ée]ro|n[o°]\s*\.?|#)\s*[:\s]*[A-Z]{0,3}-?[0-9][\w\-\.\/]{0,20}[^\n]{0,80}/gi,
];
/** Faux positifs prouvés: « Plan No 2 », « ANNEXE I – Plan No 1 », renvois d'articles. */
const FALSE_POSITIVE = /plan\s+(?:no|n[o°]|num[ée]ro)|annexe\s+[ivx]|feuillet/i;
/** Motifs de date (millésime candidat) — contexte adoption / entrée en vigueur. */
const DATE_PATTERNS: RegExp[] = [
  /(?:adopt[ée]|entr[ée]e?\s+en\s+vigueur|en\s+vigueur\s+le|sanctionn[ée])[^\n]{0,80}?((?:19|20)\d{2})/gi,
];

async function download(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return true;
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; sentropic-geo/1.0; +https://sent-tech.ca)" },
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) { console.log(`  HTTP ${r.status} ${url}`); return false; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 4).toString("latin1") !== "%PDF") { console.log(`  PAS UN PDF (magic=${JSON.stringify(buf.subarray(0, 4).toString("latin1"))}) ${url}`); return false; }
    writeFileSync(dest, buf);
    return true;
  } catch (e) {
    console.log(`  FETCH FAIL ${e instanceof Error ? e.message : String(e)} ${url}`);
    return false;
  }
}

/** Texte par page (pdftotext -layout garde les en-têtes de page-titre). */
function pdfPages(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return [];
  return (r.stdout ?? "").split("\f");
}

/** Recherche libre (verbatim + page) — pour aller chercher une date d'entrée en
 *  vigueur ou un numéro que les motifs génériques ratent. Ne réécrit rien. */
function grepPages(pages: string[], pattern: string, maxHits: number): void {
  const re = new RegExp(pattern, "gi");
  let hits = 0;
  for (let p = 0; p < pages.length && hits < maxHits; p++) {
    const flat = (pages[p] ?? "").replace(/[ \t]+/g, " ");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null && hits < maxHits) {
      const ctx = flat.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90).replace(/\n/g, " ⏎ ").trim();
      hits++;
      console.log(`  GREP p${p + 1} «${ctx.slice(0, 240)}»`);
    }
  }
  if (hits === 0) console.log(`  GREP: 0 match pour /${pattern}/i`);
}

function scanSlug(slug: string, url: string, pdf: string, showPages: number, maxHits: number, grep?: string): void {
  const pages = pdfPages(pdf);
  if (pages.length === 0) { console.log(`  pdftotext FAIL (scan image ? -> route vision)`); return; }
  const chars = pages.join("").replace(/\s/g, "").length;
  console.log(`  pages=${pages.length} charsNonBlancs=${chars}${chars < 200 ? "  << PDF IMAGE (pas de texte natif)" : ""}`);
  if (grep) { grepPages(pages, grep, maxHits); return; }

  // 1) VERBATIM des premières pages (la page-titre porte le numéro officiel).
  for (let p = 0; p < Math.min(showPages, pages.length); p++) {
    const txt = (pages[p] ?? "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, 28).join("\n");
    if (!txt.trim()) continue;
    console.log(`  --- p${p + 1} VERBATIM ---`);
    console.log(txt.slice(0, 1600).split("\n").map((l) => `  | ${l}`).join("\n"));
  }

  // 2) Article « TITRE » (preuve la plus fiable: le règlement se nomme lui-même).
  let thits = 0;
  const tseen = new Set<string>();
  for (let p = 0; p < pages.length && thits < 6; p++) {
    const flat = (pages[p] ?? "").replace(/[ \t]+/g, " ");
    for (const re of TITLE_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null && thits < 6) {
        const ctx = m[0].replace(/\n/g, " ⏎ ").trim();
        if (FALSE_POSITIVE.test(ctx)) continue;
        if (tseen.has(ctx.slice(0, 50))) continue;
        tseen.add(ctx.slice(0, 50));
        thits++;
        console.log(`  TITRE p${p + 1} «${ctx.slice(0, 200)}»`);
      }
    }
  }

  // 3) Motifs « règlement … numéro X » avec la page où ils sont lus.
  let hits = 0;
  const seen = new Set<string>();
  for (let p = 0; p < pages.length && hits < maxHits; p++) {
    const flat = (pages[p] ?? "").replace(/[ \t]+/g, " ");
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null && hits < maxHits) {
        const ctx = flat.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\n/g, " ⏎ ").trim();
        if (FALSE_POSITIVE.test(ctx)) continue;
        const kkey = `${m[1]}|${ctx.slice(0, 40)}`;
        if (seen.has(kkey)) continue;
        seen.add(kkey);
        hits++;
        console.log(`  HIT p${p + 1} numero=${JSON.stringify(m[1])} ctx=«${ctx}»`);
      }
    }
  }
  if (hits === 0 && thits === 0) console.log(`  AUCUN motif «règlement … numéro X» dans le texte natif`);

  // 3) Dates d'adoption / entrée en vigueur (millésime candidat, verbatim).
  let dhits = 0;
  for (let p = 0; p < pages.length && dhits < 6; p++) {
    const flat = (pages[p] ?? "").replace(/[ \t]+/g, " ");
    for (const re of DATE_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null && dhits < 6) {
        dhits++;
        console.log(`  DATE p${p + 1} annee=${m[1]} ctx=«${m[0].replace(/\n/g, " ⏎ ").trim().slice(0, 150)}»`);
      }
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const showPages = Number.parseInt(arg(argv, "pages") ?? "2", 10);
  const maxHits = Number.parseInt(arg(argv, "hits") ?? "10", 10);
  const grep = arg(argv, "grep");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("pass --slugs <a,b>"); process.exit(2); }

  mkdirSync(CACHE, { recursive: true });
  const targets: Target[] = TARGETS && existsSync(TARGETS)
    ? (JSON.parse(readFileSync(TARGETS, "utf8")).targets as Target[])
    : [];
  const byslug = new Map(targets.map((t) => [t.slug, t]));

  for (const slug of slugs) {
    const t = byslug.get(slug);
    const url = t?.source_url ?? t?.reglement_url ?? null;
    console.log(`\n=== ${slug} ===`);
    console.log(`  url=${url ?? "(inconnue)"}  _reglement=${t?.mined_reglement ?? "-"}`);
    if (!url) continue;
    const pdf = resolve(CACHE, `${slug}.pdf`);
    if (!(await download(url, pdf))) continue;
    scanSlug(slug, url, pdf, showPages, maxHits, grep);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
