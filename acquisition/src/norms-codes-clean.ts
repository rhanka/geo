/**
 * norms-codes-clean.ts — turn a deposited NORMS grille code list into a zoning
 * DICTIONARY usable by the anti-invention label validators (`--dict`).
 *
 * WHY. `norms-codes-dump.ts` emits the grille's `zone_code` column VERBATIM, and
 * a real grille row carries extraction-time annotations glued onto the code:
 *
 *   "RT-1 (1,2)"  footnote markers referring to the grille's own notes
 *   "CONS-3 abrogé" / "RUR-13 abroge"   repeal status
 *   "RT-3 ET RT-4" / "RUR ET AF"        a row shared by two zones
 *   "Cour avant", "Chemin public et piste cyclable", "Immeuble Protégé (m)"
 *                                        grille ROW LABELS, not zones at all
 *
 * The label validators match a read against the dict VERBATIM (modulo the shared
 * `normalizeForSnap`), so an annotated entry silently fails to admit its own real
 * code: `RT-1` read off the plan does not match `RT-1 (1,2)` in the dict. The
 * effect is NOT a safe under-serve — a zone whose code is missing from the dict
 * has its labels dropped, and `buildZones` then assigns those lots to the NEAREST
 * SURVIVING label, i.e. it MISLABELS them. Dropping the annotation is therefore
 * required for correctness, not a relaxation.
 *
 * WHAT IS AND IS NOT DONE. This ONLY strips annotations off a code and splits a
 * shared row; it never invents a code, never extends a series (no "R-1..R-9" from
 * "R-1"), and never renames. Every entry that does not reduce to a LETTERED zone
 * token (`^[A-Za-z]{1,4}-\d{1,3}$`, optionally a NUMBER-DOMINANCE `12-R`) is
 * DROPPED, not guessed. The mapping of every kept/dropped/split row is printed so
 * the dict is auditable against the grille it came from.
 *
 *   npx tsx acquisition/src/norms-codes-clean.ts --in <codes.json> --out <dict.json>
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Trailing grille footnote marker: "RT-1 (1,2)", "RT-2 (1)", "R-11 (3)". */
const FOOTNOTE_RE = /\s*\(\s*[\d]+(?:\s*[,;]\s*\d+)*\s*\)\s*$/;
/** Trailing repeal/status word (accent-insensitive on the final e). */
const STATUS_RE = /\s+(abrog[eé]{1,2}s?|abrog[eé]e|retir[eé]e?|remplac[eé]e?)\s*$/i;
/** A real municipal zone token: lettered+number, either order. */
const ZONE_RE = /^(?:[A-Za-z]{1,4}-\d{1,3}[a-z]?|\d{1,3}-[A-Za-z]{1,4})$/;

export interface CleanedEntry {
  raw: string;
  kept: string[];
  reason: string;
}

/** PURE: grille row → the zone codes it legitimately denotes (possibly none). */
export function cleanGrilleCode(raw: string): CleanedEntry {
  const trimmed = String(raw).trim();
  // A row shared by two zones ("RT-3 ET RT-4", "RUR ET AF") denotes BOTH.
  const parts = trimmed.split(/\s+(?:ET|et|Et|\/)\s+/);
  const kept: string[] = [];
  for (const part of parts) {
    let c = part.trim();
    c = c.replace(FOOTNOTE_RE, "").replace(STATUS_RE, "").trim();
    if (ZONE_RE.test(c)) kept.push(c);
  }
  const uniq = [...new Set(kept)];
  if (uniq.length === 0) return { raw: trimmed, kept: [], reason: "not-a-zone-token" };
  if (uniq.length > 1) return { raw: trimmed, kept: uniq, reason: "shared-row-split" };
  if (uniq[0] === trimmed) return { raw: trimmed, kept: uniq, reason: "verbatim" };
  return { raw: trimmed, kept: uniq, reason: "annotation-stripped" };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main(): void {
  const inPath = arg("in");
  const outPath = arg("out");
  if (!inPath || !outPath) throw new Error("required: --in <codes.json> --out <dict.json>");
  const raw = JSON.parse(readFileSync(inPath, "utf8")) as unknown;
  const rows = Array.isArray(raw) ? raw.map(String) : [];
  if (rows.length === 0) throw new Error(`--in must be a non-empty JSON array of codes: ${inPath}`);

  const entries = rows.map(cleanGrilleCode);
  const dict = [...new Set(entries.flatMap((e) => e.kept))].sort();

  const dropped = entries.filter((e) => e.kept.length === 0);
  const changed = entries.filter((e) => e.reason === "annotation-stripped" || e.reason === "shared-row-split");
  console.error(`[norms-codes-clean] ${rows.length} grille rows → ${dict.length} zone codes`);
  for (const e of changed) console.error(`  ~ "${e.raw}" → ${e.kept.join(", ")}  (${e.reason})`);
  console.error(`[norms-codes-clean] dropped ${dropped.length} non-zone rows:`);
  for (const e of dropped) console.error(`  ✗ "${e.raw}"`);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dict, null, 0));
  console.error(`[norms-codes-clean] wrote ${outPath}`);
  console.log(JSON.stringify({ in: inPath, out: outPath, rows: rows.length, codes: dict.length, dropped: dropped.length }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("norms-codes-clean.ts")) main();
