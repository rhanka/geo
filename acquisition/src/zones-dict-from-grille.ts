/**
 * zones-dict-from-grille.ts — build an authoritative zone-code dictionary from a
 * municipal "grille des spécifications" (Annexe D) PDF whose header row lists every
 * zone as `NN-Xx` (numéro-dominance), e.g. Sainte-Thècle 337-2016 Annexe D.
 *
 * WHY: the composite glyph-label lane (t1/t2-build --labels claude --dict) needs the
 * REAL set of full zone codes to snap vision reads against — anti-invention. The grille
 * header IS that authoritative list. A -layout dump wraps long suffixes across lines
 * (`43-M-\nAd`), so we scan BOTH the raw stream (tokens kept together) and the layout
 * dump, union the matches, and normalize. Fabricates nothing: only tokens literally
 * present as `<digits>-<Letter...>` in the grille are emitted.
 *
 * Usage:
 *   npx tsx acquisition/src/zones-dict-from-grille.ts --pdf <annexeD.pdf> --out <dict.json> [--pages N]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pdftotext(pdf: string, pages: number, layout: boolean): string {
  const args = ["-q"];
  if (layout) args.push("-layout");
  args.push("-f", "1", "-l", String(pages), "-enc", "UTF-8", pdf, "-");
  const r = spawnSync("pdftotext", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.stdout ?? "";
}

function main(): void {
  const pdf = arg("pdf");
  const out = arg("out");
  const pages = Number(arg("pages") ?? "12");
  if (!pdf || !out) throw new Error("required: --pdf <annexeD.pdf> --out <dict.json> [--pages N]");

  // Dominance codes are 1-2 letters (F, P, M, Va, Vb, Vc, Aa, Ag, Af, Ad, Ra, Rb, Rc,
  // Ca, Cb, Ia, Ib). A zone may carry a compound dominance (`43-M-Ad`, `86-P-Ad`).
  // We match `NN-D[-D]` where D = one uppercase letter + optional lowercase letter.
  const RE = /\b(\d{1,3})-([A-Z][a-z]?)(?:-([A-Z][a-z]?))?\b/g;
  const raw = pdftotext(pdf, pages, false);
  const lay = pdftotext(pdf, pages, true);
  const text = raw + "\n" + lay.replace(/-\s*\n\s*/g, "-"); // rejoin suffixes wrapped by -layout

  const codes = new Map<number, Set<string>>();
  for (const src of [raw, text]) {
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(src)) !== null) {
      const num = Number(m[1]);
      const dom = m[3] ? `${m[2]}-${m[3]}` : m[2]!;
      if (!codes.has(num)) codes.set(num, new Set());
      codes.get(num)!.add(dom);
    }
  }

  // Emit one code per zone number. If a zone shows multiple dominance readings across
  // the two passes, keep them all (the label-snap step picks the verbatim match); this
  // never fabricates — every variant was literally read from the grille.
  const dict: string[] = [];
  const nums = [...codes.keys()].sort((a, b) => a - b);
  for (const n of nums) {
    for (const dom of [...codes.get(n)!].sort()) dict.push(`${n}-${dom}`);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dict, null, 0) + "\n");
  console.log(`zones=${nums.length} (min=${nums[0]} max=${nums[nums.length - 1]}) codes=${dict.length}`);
  console.log(`dominances=${[...new Set(dict.map((c) => c.replace(/^\d+-/, "")))].sort().join(" ")}`);
  console.log(`missing-in-range=${(() => { const miss: number[] = []; for (let i = nums[0]!; i <= nums[nums.length - 1]!; i++) if (!codes.has(i)) miss.push(i); return miss.join(",") || "none"; })()}`);
  console.log(`-> ${out}`);
}

main();
