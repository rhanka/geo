/**
 * $0 column parser for the Alma "cahier des spécifications" (règlement de zonage
 * 199-2012, native text layer) — effet_densifiant (4a) lane, AVANT side.
 *
 * The grille is a wide table: one header row `Types de zone  Aa Aa Cb ...`, one
 * header row `Numéros de zone 1 2 47 ...`, then one row per usage sub-class with
 * an `x` under every column that permits it. A zone can own SEVERAL consecutive
 * columns (Cb47 has three), each column being a distinct sub-class set; the
 * dwelling maximum of the zone is the max over its columns.
 *
 * Eyeballing `pdftotext -layout` alignment is how a lane invents data, so the
 * column anchors are computed from the character offsets of the `Numéros de zone`
 * tokens and every `x` is assigned to its NEAREST anchor. An `x` further than
 * --tolerance chars from any anchor is reported as unassigned rather than
 * silently attached to a neighbour.
 *
 * Usage:
 *   npx tsx acquisition/src/_effet-alma-grille-columns.ts \
 *     --file work/zonage-norms/alma/grille.pdf --zones Cb47,Cb50,Cb1
 *   (omit --zones to dump every zone column found)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TYPES_ROW = "Types de zone";
const NUMEROS_ROW = "Numéros de zone";

/** Rows whose `x` we care about, in grille order. */
const CLASS_ROW_RE = /^\s*((?:R|C|I|E|P|T|A|F|X|Z)\d{1,2})\s*:/;

export interface ColumnRead {
  /** `Cb47` — type token + numéro token, concatenated (the served zone_code form). */
  zone_code: string;
  /** 1-based rank of this column among the columns of the same zone_code on the page. */
  occurrence: number;
  page: number;
  /** character offset of the column anchor in the page text */
  offset: number;
  classes: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pageCount(file: string): number {
  const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  const m = /^Pages:\s+(\d+)/m.exec(info);
  if (!m) throw new Error("pdfinfo: Pages introuvable");
  return Number(m[1]);
}

function pageText(file: string, page: number): string {
  return execFileSync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", "-f", String(page), "-l", String(page), file, "-"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Token start offsets of a whitespace-separated header row, after its label. */
function tokenOffsets(line: string, label: string): { token: string; offset: number }[] {
  const start = line.indexOf(label);
  if (start < 0) return [];
  const out: { token: string; offset: number }[] = [];
  const re = /\S+/g;
  re.lastIndex = start + label.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push({ token: m[0], offset: m.index });
  return out;
}

export function parsePage(
  text: string,
  page: number,
  tolerance: number,
  dumpRow?: string,
  dumpRowSpan = 4,
): ColumnRead[] {
  const lines = text.split("\n");
  const typesLine = lines.find((l) => l.includes(TYPES_ROW));
  const numerosLine = lines.find((l) => l.includes(NUMEROS_ROW));
  if (!typesLine || !numerosLine) return [];

  const types = tokenOffsets(typesLine, TYPES_ROW);
  const numeros = tokenOffsets(numerosLine, NUMEROS_ROW);
  if (types.length === 0 || numeros.length !== types.length) {
    console.error(
      `p.${page}: en-têtes désalignés (types=${types.length} numeros=${numeros.length}) — page ignorée`,
    );
    return [];
  }

  const seen = new Map<string, number>();
  const columns: ColumnRead[] = numeros.map((n, i) => {
    const zone_code = `${types[i]!.token}${n.token}`;
    const occurrence = (seen.get(zone_code) ?? 0) + 1;
    seen.set(zone_code, occurrence);
    // anchor on the numéro token: it is the narrowest, most reliably centred cell
    return { zone_code, occurrence, page, offset: n.offset, classes: [] };
  });

  // Free-text rows (USAGES SPÉCIFIQUEMENT AUTORISÉS carries cells like « 9 à 18 log. »,
  // which is the only thing that can bound an otherwise open-ended R10 "9 et plus"
  // column). Their cells are multi-token, so anchor on the token's CENTRE.
  if (dumpRow) {
    const from = lines.findIndex((l) => l.includes(dumpRow));
    if (from >= 0) {
      for (let i = from; i < Math.min(from + dumpRowSpan, lines.length); i++) {
        const line = lines[i]!;
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const centre = m.index + m[0].length / 2;
          let best: ColumnRead | undefined;
          let bestDist = Infinity;
          for (const col of columns) {
            const d = Math.abs(col.offset - centre);
            if (d < bestDist) {
              bestDist = d;
              best = col;
            }
          }
          console.log(
            `ROW p.${page} L${i - from} off=${m.index}\t${JSON.stringify(m[0])}\t-> ${best?.zone_code ?? "?"} col${best?.occurrence ?? "?"} (dist=${bestDist.toFixed(1)})`,
          );
        }
      }
    }
  }

  for (const line of lines) {
    const m = CLASS_ROW_RE.exec(line);
    if (!m) continue;
    const cls = m[1]!;
    const labelEnd = line.indexOf(":", m.index) + 1;
    for (let i = labelEnd; i < line.length; i++) {
      if (line[i] !== "x" && line[i] !== "X") continue;
      // a lone marker, not a letter inside a word
      if (i > 0 && /\S/.test(line[i - 1]!)) continue;
      if (i + 1 < line.length && /\S/.test(line[i + 1]!)) continue;
      let best: ColumnRead | undefined;
      let bestDist = Infinity;
      for (const col of columns) {
        const d = Math.abs(col.offset - i);
        if (d < bestDist) {
          bestDist = d;
          best = col;
        }
      }
      if (!best || bestDist > tolerance) {
        console.error(`p.${page} ${cls}: « x » à l'offset ${i} non assignable (dist=${bestDist})`);
        continue;
      }
      if (!best.classes.includes(cls)) best.classes.push(cls);
    }
  }
  return columns;
}

function main(): void {
  const file = arg("file");
  if (!file || !existsSync(file)) throw new Error("required: --file <grille.pdf>");
  const tolerance = Number(arg("tolerance") ?? 4);
  const wanted = arg("zones")?.split(",").map((s) => s.trim()).filter(Boolean);

  const dumpRow = arg("dump-row");
  const dumpRowSpan = Number(arg("dump-row-span") ?? 4);
  const onlyPage = arg("page") ? Number(arg("page")) : undefined;

  const total = pageCount(file);
  const rows: ColumnRead[] = [];
  for (let p = 1; p <= total; p++) {
    if (onlyPage !== undefined && p !== onlyPage) continue;
    rows.push(...parsePage(pageText(file, p), p, tolerance, dumpRow, dumpRowSpan));
  }

  for (const row of rows) {
    if (wanted && !wanted.includes(row.zone_code)) continue;
    console.log(
      `${row.zone_code}\tcol${row.occurrence}\tp.${row.page}\toff=${row.offset}\t${row.classes.join(" ") || "(aucune)"}`,
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
