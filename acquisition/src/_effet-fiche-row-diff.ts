/**
 * $0 two-sided diff for effet_densifiant (4a) on "fiche-par-zone" grilles
 * (one page per zone, e.g. Mont-Saint-Hilaire annexe 2 du règlement 1235).
 *
 * Such grilles carry an EXPLICIT « Nombre de logements par bâtiment (max.) »
 * row, which is the primary metric of the lane — no deduction from usage
 * classes needed. Two codifications of the same annexe (an older local copy and
 * the currently published one) therefore give the AVANT and the APRÈS sides
 * verbatim, and their difference IS the served delta.
 *
 * Guard rails:
 *  - the row label must contain « max » (memory
 *    normes-schema-ingest-fiche-par-zone-hauteur-mislabel: a MIN bound served as
 *    a MAX is the recurring bug of this family). Pass --allow-non-max to override.
 *  - values are reported VERBATIM as the tokens found on the row; the numeric
 *    max is derived, never invented. A row with no numeric token stays null.
 *  - each side also reports the per-zone « Entrée en vigueur » bylaw tokens, so
 *    the amendment responsible for a change can be named rather than guessed.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_effet-fiche-row-diff.ts \
 *     --avant work/zonage-norms/mont-saint-hilaire/grille.pdf \
 *     --apres /tmp/annexe2-2025-09.pdf \
 *     --row "Nombre de logements par bâtiment (max.)" [--changed-only]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ZONE_RE = /\bZone\s{2,}([A-Za-zÀ-ÿ]{1,4}-\d{1,3}[A-Za-z]?)\s*$/;
const BYLAW_RE = /\b(\d{3,4}(?:-\d{1,2}){1,2})\b/g;

export interface FicheRead {
  zone: string;
  page: number;
  /** verbatim tokens found to the right of the row label */
  tokens: string[];
  /** max numeric token, or null when the row carries no number */
  max: number | null;
  bylaws: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pageCount(file: string): number {
  const m = /^Pages:\s+(\d+)/m.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }));
  if (!m) throw new Error(`pdfinfo: Pages introuvable (${file})`);
  return Number(m[1]);
}

function allText(file: string): string[] {
  const out: string[] = [];
  const total = pageCount(file);
  for (let p = 1; p <= total; p++) {
    out.push(
      execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", "-f", String(p), "-l", String(p), file, "-"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
  }
  return out;
}

export function readFiches(pages: string[], rowLabel: string): Map<string, FicheRead> {
  const byZone = new Map<string, FicheRead>();
  pages.forEach((text, i) => {
    const page = i + 1;
    const lines = text.split("\n");

    let zone: string | undefined;
    for (const line of lines) {
      const m = ZONE_RE.exec(line.replace(/\s+$/, ""));
      if (m) {
        zone = m[1]!;
        break;
      }
    }
    if (!zone) return;

    const rowLine = lines.find((l) => l.includes(rowLabel));
    const tokens = rowLine
      ? rowLine.slice(rowLine.indexOf(rowLabel) + rowLabel.length).trim().split(/\s+/).filter(Boolean)
      : [];
    const numbers = tokens
      .map((t) => Number(t.replace(",", ".").replace(/[^\d.]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);

    const bylaws = new Set<string>();
    for (const line of lines) {
      let b: RegExpExecArray | null;
      BYLAW_RE.lastIndex = 0;
      while ((b = BYLAW_RE.exec(line)) !== null) bylaws.add(b[1]!);
    }

    // a zone spanning several pages: keep the highest max, union the bylaws
    const prev = byZone.get(zone);
    const read: FicheRead = {
      zone,
      page,
      tokens: [...(prev?.tokens ?? []), ...tokens],
      max: numbers.length ? Math.max(...numbers, prev?.max ?? 0) : (prev?.max ?? null),
      bylaws: [...new Set([...(prev?.bylaws ?? []), ...bylaws])],
    };
    byZone.set(zone, read);
  });
  return byZone;
}

function main(): void {
  const avantFile = arg("avant");
  const apresFile = arg("apres");
  const rowLabel = arg("row");
  if (!avantFile || !existsSync(avantFile)) throw new Error("required: --avant <pdf>");
  if (!apresFile || !existsSync(apresFile)) throw new Error("required: --apres <pdf>");
  if (!rowLabel) throw new Error("required: --row <libellé de ligne>");
  if (!/max/i.test(rowLabel) && !process.argv.includes("--allow-non-max")) {
    throw new Error(
      `ligne « ${rowLabel} » sans « max » : servir une borne MIN comme MAX est le bug récurrent ` +
        "de cette famille de grilles — ajouter --allow-non-max si c'est intentionnel",
    );
  }
  const changedOnly = process.argv.includes("--changed-only");

  const avant = readFiches(allText(avantFile), rowLabel);
  const apres = readFiches(allText(apresFile), rowLabel);

  const zones = [...new Set([...avant.keys(), ...apres.keys()])].sort();
  console.log(`zones: avant=${avant.size} apres=${apres.size} union=${zones.length}`);
  for (const zone of zones) {
    const a = avant.get(zone);
    const b = apres.get(zone);
    const changed = (a?.max ?? null) !== (b?.max ?? null);
    if (changedOnly && !changed) continue;
    console.log(
      `${changed ? "DIFF" : "same"}\t${zone}\tavant=${a ? `${a.max} [${a.tokens.join(" ")}] p.${a.page}` : "ABSENT"}` +
        `\tapres=${b ? `${b.max} [${b.tokens.join(" ")}] p.${b.page}` : "ABSENT"}` +
        (changed ? `\tregl_apres=${b?.bylaws.join(",") ?? ""}\tregl_avant=${a?.bylaws.join(",") ?? ""}` : ""),
    );
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
