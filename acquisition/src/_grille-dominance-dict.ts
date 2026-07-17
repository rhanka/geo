/**
 * _grille-dominance-dict.ts — build an authoritative zone-code dictionary from a
 * "grille des spécifications" whose header codes each zone on TWO stacked rows:
 *
 *     NUMÉROS DE ZONES   1   2   3   4   5  ...
 *     ET DOMINANCES      C   C   C   C   R  ...
 *
 * The real regulatory zone code is the COMPOSITE of both rows (matane legend:
 * "Numéro de zone et dominance  17 R" → `17-R`). Same shape as the already-served
 * lac-sergent dict (`1-H`, `20-I`).
 *
 * Anti-invention: the pairing is SPATIAL (column x-overlap), never positional
 * order — a missing dominance under a number must drop that number, not shift the
 * whole row and fabricate codes. A number with no dominance in its column is
 * ABSTAINED (reported, not emitted).
 *
 * $0: pure `pdftotext -bbox-layout` (poppler), no OCR, no model.
 *
 * Usage:
 *   npx tsx acquisition/src/_grille-dominance-dict.ts --pdf <path> [--out <path>] [--debug]
 */
import { writeFileSync } from "node:fs";

import { pdftotextWords, type RawLabel } from "./lib/t1-labels.js";

const NUMBER_RE = /^\d{1,3}$/;
// Dominance token: starts uppercase (drops row-label noise like « de »/« et »),
// then 0-2 letters of ANY case so the mixed-case codes « Rec »/« Cn »/« AF » of
// the Excel-grille variant survive. Emitted verbatim (never upper-cased) so the
// dict spelling matches the plan's printed label for the composite join.
const DOMINANCE_RE = /^[A-Z][A-Za-z]{0,2}$/;

interface PairedCode {
  code: string;
  number: string;
  dominance: string;
  page: number;
}

interface Abstention {
  number: string;
  page: number;
  reason: string;
}

function hasBox(w: RawLabel): w is RawLabel & Required<Pick<RawLabel, "xMin" | "yMin" | "xMax" | "yMax">> {
  return w.xMin !== undefined && w.yMin !== undefined && w.xMax !== undefined && w.yMax !== undefined;
}

/** Words whose vertical span overlaps the anchor row's span. */
function onRow(words: RawLabel[], anchor: RawLabel): RawLabel[] {
  if (!hasBox(anchor)) return [];
  const h = Math.max(1, anchor.yMax - anchor.yMin);
  return words.filter((w) => {
    if (!hasBox(w)) return false;
    return Math.abs(w.pageY - anchor.pageY) <= h * 0.75;
  });
}

/** Find the word sequence "NUMÉROS ... ZONES" / "ET DOMINANCES" and return its last word. */
function findRowAnchor(words: RawLabel[], head: RegExp, tail: RegExp): RawLabel | undefined {
  for (let i = 0; i < words.length; i++) {
    if (!head.test(words[i]!.text)) continue;
    for (let j = i + 1; j < Math.min(words.length, i + 4); j++) {
      if (tail.test(words[j]!.text)) return words[j]!;
    }
  }
  return undefined;
}

export interface GrilleDominanceResult {
  codes: string[];
  paired: PairedCode[];
  abstained: Abstention[];
  pagesWithHeader: number[];
}

export function extractDominanceDict(pdfPath: string, pages: number, debug = false): GrilleDominanceResult {
  const paired: PairedCode[] = [];
  const abstained: Abstention[] = [];
  const pagesWithHeader: number[] = [];

  for (let page = 1; page <= pages; page++) {
    const { words } = pdftotextWords(pdfPath, { page });
    if (words.length === 0) continue;

    let numAnchor = findRowAnchor(words, /^NUM[ÉE]ROS$/i, /^ZONES$/i);
    let domAnchor = findRowAnchor(words, /^ET$/i, /^DOMINANCES$/i);
    // Variant « grille Excel » (ex. Bonaventure R2006-543) : l'en-tête est libellé
    // sur deux lignes « Numéro de zone »» » / « Dominance »» » au lieu de
    // « NUMÉROS DE ZONES » / « ET DOMINANCES ». L'appariement spatial (colonne x)
    // qui suit est IDENTIQUE — seul le repérage de la ligne change.
    if (!numAnchor) numAnchor = findRowAnchor(words, /^Num[ée]ro$/i, /^zone$/i);
    if (!domAnchor) domAnchor = words.find((w) => hasBox(w) && /^Dominance$/i.test(w.text));
    if (!numAnchor || !domAnchor || !hasBox(numAnchor) || !hasBox(domAnchor)) continue;
    pagesWithHeader.push(page);

    // Only take cells to the RIGHT of each row label (the header text itself is not a cell).
    const numbers = onRow(words, numAnchor)
      .filter((w) => hasBox(w) && w.xMin > numAnchor.xMax && NUMBER_RE.test(w.text))
      .sort((a, b) => a.pageX - b.pageX);
    const dominances = onRow(words, domAnchor)
      .filter((w) => hasBox(w) && w.xMin > domAnchor.xMax && DOMINANCE_RE.test(w.text))
      .sort((a, b) => a.pageX - b.pageX);

    if (debug) {
      console.log(`--- p${page}: ${numbers.length} numéros / ${dominances.length} dominances`);
      console.log(`    NUM: ${numbers.map((n) => n.text).join(" ")}`);
      console.log(`    DOM: ${dominances.map((d) => d.text).join(" ")}`);
    }

    for (const num of numbers) {
      if (!hasBox(num)) continue;
      // Column match: the dominance whose x-span overlaps (or is nearest to) the
      // number's x-span. Tolerance = the number's own width — a dominance further
      // than that is another column, so we abstain rather than guess.
      const tol = Math.max(6, (num.xMax - num.xMin) * 1.2);
      let best: RawLabel | undefined;
      let bestDist = Infinity;
      for (const dom of dominances) {
        const dist = Math.abs(dom.pageX - num.pageX);
        if (dist < bestDist) {
          bestDist = dist;
          best = dom;
        }
      }
      if (!best || bestDist > tol) {
        abstained.push({ number: num.text, page, reason: `no dominance within ${tol.toFixed(1)}pt (nearest ${bestDist.toFixed(1)}pt)` });
        continue;
      }
      // Emit UPPER-CASE: the composite dict is looked up via `code.toUpperCase()`
      // in `isDictComposite` (t1-labels), and matane's served dict is upper-case —
      // so « Rec »/« Cn » must be normalised to « REC »/« CN » to match the join.
      paired.push({ code: `${num.text}-${best.text.toUpperCase()}`, number: num.text, dominance: best.text.toUpperCase(), page });
    }
  }

  const codes = [...new Set(paired.map((p) => p.code))].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    return na - nb || a.localeCompare(b);
  });
  return { codes, paired, abstained, pagesWithHeader };
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pdf = arg("pdf");
  const out = arg("out");
  const pages = parseInt(arg("pages") ?? "40", 10);
  const debug = argv.includes("--debug");
  if (!pdf) {
    console.error("usage: --pdf <path> [--out <path>] [--pages N] [--debug]");
    process.exit(2);
  }

  const res = extractDominanceDict(pdf, pages, debug);

  console.log(`\n=== ${pdf}`);
  console.log(`pages avec en-tête NUMÉROS/DOMINANCES : ${res.pagesWithHeader.join(", ") || "AUCUNE"}`);
  console.log(`codes appariés : ${res.paired.length} → ${res.codes.length} distincts`);
  console.log(`abstentions (numéro sans dominance en colonne) : ${res.abstained.length}`);
  for (const a of res.abstained.slice(0, 10)) console.log(`   p${a.page} « ${a.number} » : ${a.reason}`);
  if (res.abstained.length > 10) console.log(`   … +${res.abstained.length - 10}`);

  // Duplicate detection: the same number with two different dominances would mean
  // the column pairing slipped — surface it instead of silently emitting both.
  const byNumber = new Map<string, Set<string>>();
  for (const p of res.paired) {
    if (!byNumber.has(p.number)) byNumber.set(p.number, new Set());
    byNumber.get(p.number)!.add(p.dominance);
  }
  const conflicts = [...byNumber.entries()].filter(([, doms]) => doms.size > 1);
  if (conflicts.length) {
    console.log(`\n⚠️  ${conflicts.length} numéro(s) à dominance CONTRADICTOIRE (appariement suspect) :`);
    for (const [n, doms] of conflicts.slice(0, 10)) console.log(`   ${n} → ${[...doms].join(" / ")}`);
  }

  console.log(`\ncodes : ${res.codes.join(" ")}`);

  if (out) {
    writeFileSync(out, `${JSON.stringify(res.codes, null, 2)}\n`);
    console.log(`\n→ ${out} (${res.codes.length} codes)`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) main();
