/**
 * laval-grille-parse.ts -- PURE parser for a Ville de Laval "Info-règlements"
 * zoning grid document (info-reglements.laval.ca, Code de l'urbanisme / CDU).
 *
 * WHY this exists (and why it is NOT an OCR route):
 *   Laval serves ONE grid per zone as a STRUCTURED HTML document behind a Gatsby
 *   static JSON (`/page-data/consultation/grilles/<id>/page-data.json`), already
 *   combining the Titre-7 "type de milieux" with the Annexe-B exception grid
 *   ("Chaque zone du territoire de Laval a sa propre grille unique"). The bytes
 *   are native and verbatim, so OCR (Mistral) would only ADD transcription risk
 *   and cost. Native $0 beats OCR whenever the right document is found.
 *
 * ANTI-INVENTION contract (mirrors docs/spec/normes-extraction-retenu.md):
 *   - Every value is copied VERBATIM from a grid cell; `raw` always keeps the
 *     cell text (including the by-law article ref, e.g. "11 (art. 1017.)").
 *   - "-" / "" (the portal's own "no norm" marker) => value:null, NEVER 0.
 *   - A measure that VARIES by building structure (Isolé/Jumelé/Contigu) is NOT
 *     collapsed to one number: `value` stays null and `raw` keeps every branch
 *     verbatim ("Isolé 11 | Jumelé 9 | Contigu 6"). Publishing the smallest of
 *     the three would be a plausible-but-false norm — exactly the failure the
 *     column-shift guard-rail forbids.
 *   - Units are read from the LABEL ("(m)", "(m2)", "(%)"), so a metre value can
 *     never land in a m² field (semantic type-check).
 */

/** Norm fields of the deployed 40-column parquet schema that this source can fill. */
export interface LavalMeasure {
  value: number | null;
  raw: string;
  unit: string | null;
}

export interface ParsedLavalGrille {
  /** Zone code exactly as the portal spells it, e.g. "T4.3-8094". */
  zoneCode: string | null;
  /** "Type de milieu" prefix, e.g. "T4.3" — used to cross-check the SIG code. */
  typeMilieu: string | null;
  /** Numeric zone id, e.g. "8094". */
  zoneId: string | null;
  /** Verbatim "type de milieu" section title, e.g. "SECTION 3 Urbain T4.3". */
  sectionTitle: string | null;
  /** Canonical norm fields -> measure (absent key = label not present at all). */
  fields: Partial<Record<LavalNormField, LavalMeasure>>;
  /** Verbatim summary of authorised uses, e.g. "Habitation (H1): A; ...". */
  usages: string | null;
  /** True when the portal flags zone-specific exception provisions. */
  hasExceptions: boolean;
}

export type LavalNormField =
  | "densite"
  | "hauteur_min"
  | "hauteur_max"
  | "frontage_min"
  | "superficie_min"
  | "marge_avant_min"
  | "marge_laterale_min"
  | "marge_arriere_min";

const STRUCTURES = ["Isolé", "Jumelé", "Contigu"];

/** Decode the entities the portal actually emits, then normalise whitespace. */
export function cellText(html: string): string {
  return html
    .replace(/<sup>2<\/sup>/gi, "2")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split the document into its `<div class="informaltable X ...">` sections.
 *  Sections are delimited by START offsets (never by `</div>`) because each one
 *  contains nested <div>s (mediaobject, titlepage) that would close it early. */
export function splitSections(html: string): { name: string; body: string }[] {
  const re = /<div class="informaltable ([^"]*?)(?: table-responsive)?"/g;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) starts.push({ name: m[1].trim(), at: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : html.length),
  }));
}

/** Rows of a section, each as its ordered list of cell texts. */
export function sectionRows(body: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(body))) {
    const cells: string[] = [];
    const tdRe = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/g;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1]))) cells.push(cellText(td[2]));
    rows.push(cells);
  }
  return rows;
}

/** The portal writes "-" (and sometimes "") for "no norm applies". */
function isBlank(cell: string): boolean {
  return cell === "" || cell === "-" || cell === "–" || cell === "—";
}

/** Parse a French decimal ("1,5" / "11") from the head of a cell.
 *  Returns null for a blank cell or a cell with no leading number. */
export function parseNumber(cell: string): number | null {
  if (isBlank(cell)) return null;
  const m = /^\s*(\d+(?:[,.]\d+)?)/.exec(cell);
  if (!m) return null;
  return Number(m[1].replace(",", "."));
}

/** Unit implied by a label: "Marge avant (m)" -> "m", "Superficie d'un lot (m2)" -> "m2". */
export function unitOfLabel(label: string): string | null {
  const m = /\(([^)]{1,3})\)\s*$/.exec(label.trim());
  if (!m) return null;
  const u = m[1].trim();
  return u === "m" || u === "m2" || u === "%" ? u : null;
}

interface Measure {
  /** Branches keyed by structure; key "" = the single, structure-independent row. */
  branches: { structure: string; min: string; max: string }[];
  label: string;
}

/** Find a labelled measure and every structure branch that follows it.
 *  Layout (verified against real bytes): the LAST two cells of a row are
 *  Minimum, Maximum; the cell before them may be a structure name, in which case
 *  the following rows carry the remaining structures with no label. */
export function findMeasure(rows: string[][], labelRe: RegExp): Measure | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length < 3) continue;
    const labelIdx = cells.findIndex((c) => labelRe.test(c));
    if (labelIdx < 0) continue;
    // The label row must still carry its own min/max pair at the end.
    if (labelIdx >= cells.length - 2) continue;

    const label = cells[labelIdx];
    const branches: { structure: string; min: string; max: string }[] = [];
    const min = cells[cells.length - 2];
    const max = cells[cells.length - 1];
    const maybeStructure = cells.length >= 4 ? cells[cells.length - 3] : "";
    const isStructured = STRUCTURES.includes(maybeStructure);
    branches.push({ structure: isStructured ? maybeStructure : "", min, max });

    if (isStructured) {
      // A continuation row carries ONLY [structure, min, max]. Requiring exactly
      // three cells is what stops the walk at the NEXT labelled measure, whose
      // own first branch also starts with a structure name (e.g. "Superficie
      // d'un lot" right after "Largeur d'un lot") — merging them would mix
      // metres into an m² field.
      for (let j = i + 1; j < rows.length; j++) {
        const nxt = rows[j];
        if (nxt.length !== 3 || !STRUCTURES.includes(nxt[0])) break;
        branches.push({ structure: nxt[0], min: nxt[1], max: nxt[2] });
      }
    }
    return { branches, label };
  }
  return null;
}

/** Collapse a measure's branches into ONE verbatim-or-null field.
 *  `which` selects the Minimum or Maximum column. */
export function toMeasure(m: Measure, which: "min" | "max"): LavalMeasure | null {
  const unit = unitOfLabel(m.label);
  const vals = m.branches.map((b) => ({ structure: b.structure, cell: which === "min" ? b.min : b.max }));

  if (vals.length === 1) {
    const cell = vals[0].cell;
    return { value: parseNumber(cell), raw: cell, unit };
  }

  // Every branch blank => the measure simply does not apply to this zone; keep
  // the portal's own marker rather than a noisy "Isolé - | Jumelé - | Contigu -".
  if (vals.every((v) => isBlank(v.cell))) return { value: null, raw: "-", unit };

  // Structure-dependent: publish a number ONLY if every branch agrees.
  const raw = vals.map((v) => `${v.structure} ${v.cell}`.trim()).join(" | ");
  const nums = vals.map((v) => parseNumber(v.cell));
  const allSame = nums.every((n) => n !== null && n === nums[0]);
  return { value: allSame ? nums[0] : null, raw, unit };
}

/** Verbatim list of the uses the grid marks Autorisé / Conditionnel.
 *  The verdict cell may carry a by-law ref ("C (art. 1014.)"), and the portal
 *  also writes "Aucun" — which must NOT be read as an "A". */
export function usagesOf(rows: string[][]): string | null {
  const out: string[] = [];
  for (const cells of rows) {
    if (cells.length < 2) continue;
    const verdict = cells[cells.length - 1];
    const vm = /^([AC])(?:\s*$|\s*\()/.exec(verdict);
    if (!vm) continue;
    const label = cells.slice(0, -1).filter((c) => c.length > 2).pop();
    if (!label) continue;
    out.push(`${label}: ${vm[1]}`);
  }
  return out.length ? out.join("; ") : null;
}

/** Parse one Laval grid document (the `downloadDocument.content` string). */
export function parseLavalGrille(html: string): ParsedLavalGrille {
  const sections = splitSections(html);
  const byName = (n: string): string[][] => {
    const s = sections.find((x) => x.name === n);
    return s ? sectionRows(s.body) : [];
  };

  // Header table: [typeMilieu, "-", zoneId, ""] — the very first informaltable.
  let typeMilieu: string | null = null;
  let zoneId: string | null = null;
  if (sections.length) {
    const head = sectionRows(sections[0].body).find((r) => r.length >= 3 && /^\d+$/.test(r[2]));
    if (head) {
      typeMilieu = head[0] || null;
      zoneId = head[2] || null;
    }
  }

  // The "type de milieu" cell holds the title AND the whole Intention prose, so
  // take the title from its own <strong> rather than the flattened cell text.
  const milieuSection = sections.find((x) => x.name === "Type de milieu et application");
  const titleM = milieuSection
    ? /<strong>\s*(SECTION[^<]*?)\s*<\/strong>/i.exec(milieuSection.body)
    : null;
  const sectionTitle = titleM ? cellText(titleM[1]) : null;

  const lot = byName("Lotissement");
  const impl = byName("Implantation");
  const arch = byName("Architecture");

  const fields: Partial<Record<LavalNormField, LavalMeasure>> = {};
  const put = (
    field: LavalNormField,
    rows: string[][],
    labelRe: RegExp,
    which: "min" | "max",
  ): void => {
    const m = findMeasure(rows, labelRe);
    if (!m) return;
    const meas = toMeasure(m, which);
    if (meas) fields[field] = meas;
  };

  put("frontage_min", lot, /^Largeur d'un lot \(m\)$/, "min");
  put("superficie_min", lot, /^Superficie d'un lot \(m2\)$/, "min");
  put("marge_avant_min", impl, /^Marge avant \(m\)$/, "min");
  put("marge_laterale_min", impl, /^Marge latérale \(m\)$/, "min");
  put("marge_arriere_min", impl, /^Marge arrière \(m\)$/, "min");
  put("hauteur_min", arch, /^Hauteur d'un bâtiment \(m\)$/, "min");
  put("hauteur_max", arch, /^Hauteur d'un bâtiment \(m\)$/, "max");
  // `densite`: the CDU expresses occupation via use-groups, not a numeric
  // density — left absent rather than invented.

  const exceptionRows = byName("Exceptions");
  const hasExceptions = exceptionRows.flat().some((c) => /^\d{3,4}\./.test(c.trim()));

  return {
    zoneCode: typeMilieu && zoneId ? `${typeMilieu}-${zoneId}` : null,
    typeMilieu,
    zoneId,
    sectionTitle,
    fields,
    usages: usagesOf(byName("Usages")),
    hasExceptions,
  };
}
