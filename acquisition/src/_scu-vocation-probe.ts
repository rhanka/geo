/**
 * _scu-vocation-probe.ts — reconnaissance probe for the SCU / MRC-Memphrémagog
 * plan family (austin, eastman, brome…), whose zone labels are hierarchical
 * `<cadran>.<seq>[.<sub>]-<VOCATION>` codes (`1.1-RV`, `1.8.A-RUpe`).
 *
 * It does TWO separate things, and the distinction is the anti-invention point:
 *
 *   (a) `--tokens`  : tallies the hierarchical-looking tokens actually printed on
 *       the page, with their vocation suffix. This is EVIDENCE that the plan is
 *       of this family — it is NOT a dictionary. Building the dict from the very
 *       tokens one wants to admit would be circular and would admit OCR/parse
 *       noise as "real" vocations.
 *   (b) `--legend <needle>` : dumps the raw text lines around a needle (default
 *       "ocation", matching "Vocation principale"), so a human/agent can READ the
 *       plan's own closed legend set VERBATIM and hand-write the dict JSON.
 *
 * The dict written from (b) is what gates `--labels text --dict` downstream.
 */
import { pdftotextWords } from "./lib/t1-labels.js";

/** Same shape as lib/t1-labels HIER_VOCATION_RE (kept local: probe-only). */
const HIER_RE = /^(\d{1,2}(?:\.\d{1,2}){0,3}(?:\.[A-Z])?)-([A-Za-z][A-Za-z0-9]{0,4})$/i;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (!t.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[t.slice(2)] = true;
    else {
      a[t.slice(2)] = next;
      i++;
    }
  }
  return a;
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const pdf = String(a["pdf"] ?? "");
  if (!pdf) throw new Error("required: --pdf <path>");
  const page = a["page"] ? Number(a["page"]) : 1;
  const { words, pageW, pageH } = pdftotextWords(pdf, { page });
  console.log(`# ${pdf} p${page} — ${words.length} words, page ${pageW}x${pageH}`);

  if (a["legend"] !== undefined) {
    const needle = typeof a["legend"] === "string" ? a["legend"].toLowerCase() : "ocation";
    const hits = words
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.text.toLowerCase().includes(needle));
    console.log(`# legend needle "${needle}": ${hits.length} hit(s)`);
    for (const { i } of hits.slice(0, 20)) {
      const from = Math.max(0, i - 3);
      const ctx = words.slice(from, i + 60).map((w) => w.text).join(" ");
      console.log(`--- @${i}: ${ctx}`);
    }
    return;
  }

  if (a["words"] !== undefined) {
    const lim = typeof a["words"] === "string" ? Number(a["words"]) : 400;
    console.log(words.slice(0, lim).map((w) => w.text).join(" | "));
    return;
  }

  // Default: token evidence (NOT a dictionary — see the header note).
  const byVoc = new Map<string, number>();
  const samples = new Map<string, string>();
  let nHier = 0;
  for (const w of words) {
    const m = HIER_RE.exec(w.text.trim());
    if (!m) continue;
    nHier++;
    const voc = m[2]!;
    byVoc.set(voc, (byVoc.get(voc) ?? 0) + 1);
    if (!samples.has(voc)) samples.set(voc, w.text.trim());
  }
  console.log(`# hierarchical-looking tokens: ${nHier}, distinct vocation suffixes: ${byVoc.size}`);
  for (const [voc, n] of [...byVoc.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${voc.padEnd(8)} n=${String(n).padStart(4)}  e.g. ${samples.get(voc)}`);
  }
}

main();
