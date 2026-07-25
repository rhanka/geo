/**
 * _plan-composite-probe.ts — measure, at $0, whether a zoning plan's labels are
 * COMPOSITE (number ⊕ dominance printed as two separate tokens, e.g. matane's
 * legend "Numéro de zone et dominance  17 R") and how many of them validate
 * verbatim against an authoritative dictionary.
 *
 * This is the pre-gate for the composite text-label lane: it answers "is there a
 * readable zone code on this plan at all?" BEFORE any georeferencing work, and it
 * distinguishes the two failure modes that look alike in a layout dump:
 *   - tokens are already joined by pdftotext ("503 A" as one word) → plain --labels text;
 *   - tokens are separate words → needs the dict-gated composite join.
 *
 * Anti-invention: a pair is only counted when the composite code is a VERBATIM
 * member of the dictionary. Nothing is emitted or served here — this only reports.
 *
 * Usage:
 *   npx tsx acquisition/src/_plan-composite-probe.ts --pdf <path> --dict <codes.json> [--pages N]
 */
import { readFileSync } from "node:fs";

import { pdftotextWords, type RawLabel } from "./lib/t1-labels.js";

const NUMBER_RE = /^\d{1,3}$/;
const DOMINANCE_RE = /^[A-Z]{1,3}$/;

function hasBox(w: RawLabel): w is RawLabel & Required<Pick<RawLabel, "xMin" | "yMin" | "xMax" | "yMax">> {
  return w.xMin !== undefined && w.yMin !== undefined && w.xMax !== undefined && w.yMax !== undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pdf = arg("pdf");
  const dictPath = arg("dict");
  const pages = parseInt(arg("pages") ?? "10", 10);
  if (!pdf || !dictPath) {
    console.error("usage: --pdf <path> --dict <codes.json> [--pages N]");
    process.exit(2);
  }

  const dict = new Set<string>((JSON.parse(readFileSync(dictPath, "utf8")) as string[]).map((c) => c.toUpperCase()));
  console.log(`dict: ${dict.size} codes\n`);

  for (let page = 1; page <= pages; page++) {
    const { words, pageW, pageH } = pdftotextWords(pdf, { page });
    if (words.length === 0) {
      console.log(`p${page}: 0 mot (page image/glyphe)`);
      continue;
    }
    const numbers = words.filter((w) => hasBox(w) && NUMBER_RE.test(w.text));
    const doms = words.filter((w) => hasBox(w) && DOMINANCE_RE.test(w.text));

    // Already-joined single tokens ("503-A" / "503 A" merged by pdftotext).
    const joined = words.filter((w) => /^\d{1,3}[-\s]?[A-Z]{1,3}$/i.test(w.text.trim()) && dict.has(w.text.trim().toUpperCase().replace(/\s+/g, "-")));

    // Separate-token pairs: for each number, the nearest dominance within a small
    // radius (right OR below — the legend prints them stacked).
    let inDict = 0;
    let outDict = 0;
    const hits = new Map<string, number>();
    const misses = new Map<string, number>();
    for (const n of numbers) {
      if (!hasBox(n)) continue;
      const h = Math.max(1, n.yMax - n.yMin);
      const w0 = Math.max(1, n.xMax - n.xMin);
      let best: RawLabel | undefined;
      let bestD = Infinity;
      for (const d of doms) {
        if (!hasBox(d)) continue;
        const dx = d.pageX - n.pageX;
        const dy = d.pageY - n.pageY;
        // right-adjacent (within ~2 char widths) or stacked below (within ~1.5 line height)
        const near = (Math.abs(dy) <= h * 0.8 && dx > 0 && dx <= w0 + h * 2.5) || (Math.abs(dx) <= w0 * 1.5 && dy > 0 && dy <= h * 2.0);
        if (!near) continue;
        const dist = Math.hypot(dx, dy);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) continue;
      const code = `${n.text}-${best.text.toUpperCase()}`;
      if (dict.has(code)) {
        inDict++;
        hits.set(code, (hits.get(code) ?? 0) + 1);
      } else {
        outDict++;
        misses.set(code, (misses.get(code) ?? 0) + 1);
      }
    }

    console.log(
      `p${page}: ${words.length} mots (${pageW}x${pageH}) | numéros=${numbers.length} dominances=${doms.length} | ` +
        `déjà-joints∈dict=${joined.length} | paires∈dict=${inDict} (${hits.size} codes) hors-dict=${outDict}`,
    );
    if (hits.size) console.log(`     ∈dict: ${[...hits.keys()].slice(0, 22).join(" ")}${hits.size > 22 ? " …" : ""}`);
    if (misses.size) console.log(`     ∉dict: ${[...misses.keys()].slice(0, 12).join(" ")}${misses.size > 12 ? " …" : ""}`);
  }
}

main();
