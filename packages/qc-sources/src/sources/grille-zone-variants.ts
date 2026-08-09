/**
 * Pure, local-only parser for Saint-Amable's one-zone-per-PDF native grids.
 *
 * The municipal grids repeat the same zone header once per regulatory column.
 * Those columns are variants of ONE authoritative FeatureServer zone, not new
 * zones. This module therefore keeps every column, its native-text bbox, usage
 * markers, structure markers, norm cells and note references. It deliberately
 * has no download, S3, publication or keep-best capability.
 */

export const SAINT_AMABLE_USAGE_CODE_LIST = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "p1",
  "p2",
  "p3",
  "i1",
  "i2",
  "i3",
  "a1",
] as const;

export type SaintAmableUsageCode = (typeof SAINT_AMABLE_USAGE_CODE_LIST)[number];

/** Closed vocabulary accepted from the USAGES AUTORISÉS section. */
export const SAINT_AMABLE_USAGE_CODES: ReadonlySet<string> = new Set(
  SAINT_AMABLE_USAGE_CODE_LIST,
);

export interface NativeBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface NativeTextItem {
  text: string;
  bbox: NativeBBox;
}

export interface NativeTextPage {
  method: string;
  page: number;
  width: number;
  height: number;
  items: NativeTextItem[];
}

/**
 * Compact result from the independent layout-text read. The staging runner is
 * responsible for producing this with a different reader/mode than `primary`.
 * The parser requires the header multiplicity and every usage marker to agree.
 */
export interface NativePageVerification {
  method: string;
  rawZoneCodes: readonly string[];
  authorizedUsagesByColumn: ReadonlyArray<ReadonlyArray<string>>;
  /** Norm rows independently observed as one physical cell spanning all columns. */
  mergedNormKeys: readonly VariantNormKey[];
}

export type StructureLabel = "Isolée" | "Jumelée" | "Contiguë";

export type VariantNormKey =
  | "marge_avant_min"
  | "marge_laterale_min"
  | "marge_laterale_totale_min"
  | "marge_arriere_min"
  | "largeur_min"
  | "profondeur_min"
  | "superficie_implantation_min"
  | "hauteur_etages"
  | "locaux_commerciaux_max"
  | "cos_max";

export type VariantNormUnit = "m" | "m2" | "etages" | "ratio" | "nombre";

export interface VariantNormCell {
  /** Verbatim native-text cell after whitespace-only joining. */
  raw: string;
  /** Scalar value; null for ranges and refused cells. */
  value: number | null;
  /** Range bounds; null for scalar/refused cells. */
  min: number | null;
  max: number | null;
  unit: VariantNormUnit;
  bbox: NativeBBox;
  /** `merged` means one printed cell applies to every regulatory column. */
  scope: "column" | "merged";
}

export type ZoneVariantNorms = Partial<Record<VariantNormKey, VariantNormCell>>;

export interface ZoneVariant {
  column_index: number;
  bbox: NativeBBox;
  usages: SaintAmableUsageCode[];
  structures: StructureLabel[];
  norms: ZoneVariantNorms;
  /** Ordered, de-duplicated `*N` references printed in this column. */
  footnotes: string[];
}

export interface ZoneVariantExtraction {
  zone_code: string;
  source_url: string;
  source_sha256: string;
  snapshot: string;
  page: number;
  header_observations: [
    { method: string; raw_zone_codes: string[] },
    { method: string; raw_zone_codes: string[] },
  ];
  variants: ZoneVariant[];
}

export interface ParseSaintAmableZoneVariantsInput {
  /** Canonical FeatureServer code. It is authority, never an extraction fallback. */
  expectedZone: string;
  primary: NativeTextPage;
  verification: NativePageVerification;
  sourceUrl: string;
  sourceSha256: string;
  snapshot: string;
}

export type ZoneVariantExtractionErrorCode =
  | "invalid-native-page"
  | "invalid-expected-zone"
  | "invalid-observed-zone"
  | "pseudo-zone-suffix"
  | "normalization-collision"
  | "header-missing"
  | "header-mismatch"
  | "header-count-mismatch"
  | "non-independent-read"
  | "usage-section-missing"
  | "invalid-usage-code"
  | "usage-marker-mismatch"
  | "norm-merge-mismatch"
  | "norm-conflict";

export class ZoneVariantExtractionError extends Error {
  readonly code: ZoneVariantExtractionErrorCode;

  constructor(code: ZoneVariantExtractionErrorCode, message: string) {
    super(message);
    this.name = "ZoneVariantExtractionError";
    this.code = code;
  }
}

function fail(code: ZoneVariantExtractionErrorCode, message: string): never {
  throw new ZoneVariantExtractionError(code, message);
}

function numberAttr(attrs: string, name: string): number {
  const value = attrs.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    fail("invalid-native-page", `missing or invalid ${name} attribute`);
  }
  return parsed;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_all, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function assertNativeTextPageGeometry(page: NativeTextPage): void {
  if (
    !page.method.trim() ||
    !Number.isSafeInteger(page.page) ||
    page.page < 1 ||
    !Number.isFinite(page.width) ||
    page.width <= 0 ||
    !Number.isFinite(page.height) ||
    page.height <= 0 ||
    page.items.length === 0
  ) {
    fail("invalid-native-page", "native page metadata or dimensions are invalid");
  }
  for (const [index, item] of page.items.entries()) {
    const { x0, y0, x1, y1 } = item.bbox;
    if (
      !item.text.trim() ||
      ![x0, y0, x1, y1].every(Number.isFinite) ||
      x0 < 0 ||
      y0 < 0 ||
      x1 <= x0 ||
      y1 <= y0 ||
      x1 > page.width ||
      y1 > page.height
    ) {
      fail("invalid-native-page", `native text item ${index} has an invalid bbox`);
    }
  }
}

/** Parse Poppler `pdftohtml -i -xml -stdout` into its native positioned spans. */
export function nativeTextPageFromPdftohtmlXml(
  xml: string,
  method: string,
): NativeTextPage {
  const pages = Array.from(xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi));
  if (pages.length !== 1) {
    fail(
      "invalid-native-page",
      `pdftohtml input must contain exactly one page; found ${pages.length}`,
    );
  }
  const pageMatch = pages[0]!;
  const attrs = pageMatch[1]!;
  const pageBody = pageMatch[2]!;
  const page = numberAttr(attrs, "number");
  const width = numberAttr(attrs, "width");
  const height = numberAttr(attrs, "height");
  const items: NativeTextItem[] = [];
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(pageBody)) !== null) {
    const itemAttrs = match[1];
    const body = match[2];
    if (itemAttrs === undefined || body === undefined) continue;
    const x0 = numberAttr(itemAttrs, "left");
    const y0 = numberAttr(itemAttrs, "top");
    const itemWidth = numberAttr(itemAttrs, "width");
    const itemHeight = numberAttr(itemAttrs, "height");
    const text = decodeXmlText(body).replace(/\s+/g, " ").trim();
    if (!text) continue;
    items.push({
      text,
      bbox: { x0, y0, x1: x0 + itemWidth, y1: y0 + itemHeight },
    });
  }
  const nativePage = { method, page, width, height, items };
  assertNativeTextPageGeometry(nativePage);
  return nativePage;
}

const EXPECTED_ZONE_RE = /^[A-Z][A-Z0-9]{0,3}-\d{1,3}$/;
const OBSERVED_ZONE_RE = /^([A-Za-z][A-Za-z0-9]{0,3})\s*[-–—]\s*(\d{1,3})$/;
const PSEUDO_ZONE_RE = /^[A-Za-z][A-Za-z0-9]{0,3}\s*[-–—]\s*\d{1,3}\s+\*\d+$/;

function canonicalObservedZone(raw: string): string {
  const trimmed = raw.trim();
  if (PSEUDO_ZONE_RE.test(trimmed)) {
    fail("pseudo-zone-suffix", `footnote suffix is not a zone header: ${JSON.stringify(raw)}`);
  }
  const match = trimmed.match(OBSERVED_ZONE_RE);
  if (!match?.[1] || !match[2]) {
    fail("invalid-observed-zone", `invalid observed zone header: ${JSON.stringify(raw)}`);
  }
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface PositionedToken {
  text: string;
  bbox: NativeBBox;
  cx: number;
  cy: number;
}

function tokensFromItems(items: readonly NativeTextItem[]): PositionedToken[] {
  const tokens: PositionedToken[] = [];
  for (const item of items) {
    const matches = Array.from(item.text.matchAll(/\S+/g));
    for (const match of matches) {
      const text = match[0];
      const start = match.index ?? 0;
      const end = start + text.length;
      const length = Math.max(item.text.length, 1);
      const width = item.bbox.x1 - item.bbox.x0;
      const x0 = item.bbox.x0 + (start / length) * width;
      const x1 = item.bbox.x0 + (end / length) * width;
      const bbox = { x0, y0: item.bbox.y0, x1, y1: item.bbox.y1 };
      tokens.push({
        text,
        bbox,
        cx: (x0 + x1) / 2,
        cy: (bbox.y0 + bbox.y1) / 2,
      });
    }
  }
  return tokens.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
}

interface TokenRow {
  cy: number;
  tokens: PositionedToken[];
}

function groupRows(tokens: readonly PositionedToken[]): TokenRow[] {
  const rows: TokenRow[] = [];
  for (const token of tokens) {
    const candidate = rows[rows.length - 1];
    const row = candidate && Math.abs(candidate.cy - token.cy) <= 4 ? candidate : undefined;
    if (row) {
      row.tokens.push(token);
      row.cy =
        row.tokens.reduce((sum: number, current: PositionedToken) => sum + current.cy, 0) /
        row.tokens.length;
    } else {
      rows.push({ cy: token.cy, tokens: [token] });
    }
  }
  for (const row of rows) row.tokens.sort((a, b) => a.cx - b.cx);
  return rows;
}

function selectHeaderItems(page: NativeTextPage): NativeTextItem[] {
  const pseudo = page.items.find((item) => PSEUDO_ZONE_RE.test(item.text.trim()));
  if (pseudo) {
    fail(
      "pseudo-zone-suffix",
      `footnote suffix is not a zone header: ${JSON.stringify(pseudo.text)}`,
    );
  }
  const candidates = page.items.filter((item) => OBSERVED_ZONE_RE.test(item.text.trim()));
  if (candidates.length === 0) fail("header-missing", "native bbox read found no zone header");

  const bands: NativeTextItem[][] = [];
  for (const candidate of candidates.sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
    const band = bands.find(
      (current) => Math.abs(current[0]!.bbox.y0 - candidate.bbox.y0) <= 4,
    );
    if (band) band.push(candidate);
    else bands.push([candidate]);
  }
  bands.sort(
    (a, b) => b.length - a.length || a[0]!.bbox.y0 - b[0]!.bbox.y0,
  );
  return bands[0]!.sort((a, b) => a.bbox.x0 - b.bbox.x0);
}

function assertHeaderRead(
  rawCodes: readonly string[],
  expectedZone: string,
  label: string,
): string[] {
  if (rawCodes.length === 0) fail("header-missing", `${label} found no zone header`);
  const canonical = rawCodes.map(canonicalObservedZone);
  if (canonical.some((code) => code !== expectedZone)) {
    fail(
      "header-mismatch",
      `${label} observed ${canonical.join(", ")} but manifest expects ${expectedZone}`,
    );
  }
  return canonical;
}

function bboxUnion(tokens: readonly PositionedToken[]): NativeBBox {
  return {
    x0: Math.min(...tokens.map((token) => token.bbox.x0)),
    y0: Math.min(...tokens.map((token) => token.bbox.y0)),
    x1: Math.max(...tokens.map((token) => token.bbox.x1)),
    y1: Math.max(...tokens.map((token) => token.bbox.y1)),
  };
}

function columnBboxes(
  headers: readonly NativeTextItem[],
  page: NativeTextPage,
  gridEnd: number,
): NativeBBox[] {
  const centers = headers.map((header) => (header.bbox.x0 + header.bbox.x1) / 2);
  if (centers.some((center, index) => index > 0 && center <= centers[index - 1]!)) {
    fail("invalid-native-page", "zone header centers must be strictly increasing");
  }
  const maxHeaderY1 = Math.max(...headers.map((header) => header.bbox.y1));
  if (!Number.isFinite(gridEnd) || gridEnd <= maxHeaderY1 || gridEnd > page.height) {
    fail("invalid-native-page", "zone variant grid has an invalid vertical extent");
  }
  let columns: NativeBBox[];
  if (centers.length === 1) {
    const halfWidth = Math.max(page.width * 0.03, headers[0]!.bbox.x1 - headers[0]!.bbox.x0);
    columns = [
      {
        x0: centers[0]! - halfWidth,
        y0: headers[0]!.bbox.y0,
        x1: centers[0]! + halfWidth,
        y1: gridEnd,
      },
    ];
  } else {
    const boundaries: number[] = [];
    boundaries.push(centers[0]! - (centers[1]! - centers[0]!) / 2);
    for (let index = 0; index < centers.length - 1; index += 1) {
      boundaries.push((centers[index]! + centers[index + 1]!) / 2);
    }
    const last = centers.length - 1;
    boundaries.push(centers[last]! + (centers[last]! - centers[last - 1]!) / 2);
    columns = centers.map((_center, index) => ({
      x0: boundaries[index]!,
      y0: headers[index]!.bbox.y0,
      x1: boundaries[index + 1]!,
      y1: gridEnd,
    }));
  }
  if (
    columns.some(
      ({ x0, y0, x1, y1 }) =>
        x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > page.width || y1 > page.height,
    )
  ) {
    fail("invalid-native-page", "derived zone variant bbox is outside the native page");
  }
  return columns;
}

function tokenColumn(token: PositionedToken, columns: readonly NativeBBox[]): number {
  return columns.findIndex(
    (column, index) =>
      token.cx >= column.x0 &&
      (token.cx < column.x1 || (index === columns.length - 1 && token.cx <= column.x1)),
  );
}

function rowLabel(row: TokenRow, firstColumnX: number): string {
  return row.tokens
    .filter((token) => token.cx < firstColumnX)
    .map((token) => token.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function markerColumns(row: TokenRow, columns: readonly NativeBBox[]): number[] {
  return row.tokens
    .filter((token) => token.text === "●")
    .map((token) => tokenColumn(token, columns))
    .filter((index) => index >= 0);
}

const STRUCTURE_LABELS: ReadonlyArray<{
  canonical: StructureLabel;
  folded: string;
}> = [
  { canonical: "Isolée", folded: "isolee" },
  { canonical: "Jumelée", folded: "jumelee" },
  { canonical: "Contiguë", folded: "contigue" },
];

function structureForLabel(label: string): (typeof STRUCTURE_LABELS)[number] | undefined {
  return STRUCTURE_LABELS.find(
    (structure) => label === structure.folded || label.endsWith(` ${structure.folded}`),
  );
}

interface NormLabelSpec {
  key: VariantNormKey;
  unit: VariantNormUnit;
  kind: "scalar" | "range";
  matches: (label: string) => boolean;
}

const NORM_LABELS: readonly NormLabelSpec[] = [
  {
    key: "marge_laterale_totale_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /\blaterale totale\b/.test(label),
  },
  {
    key: "marge_avant_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /^avant\b/.test(label),
  },
  {
    key: "marge_laterale_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /^laterale\b/.test(label),
  },
  {
    key: "marge_arriere_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /^arriere\b/.test(label),
  },
  {
    key: "largeur_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /\blargeur minimum\b/.test(label),
  },
  {
    key: "profondeur_min",
    unit: "m",
    kind: "scalar",
    matches: (label) => /\bprofondeur minimum\b/.test(label),
  },
  {
    key: "superficie_implantation_min",
    unit: "m2",
    kind: "scalar",
    matches: (label) => /\bsuperficie d.?implantation minimum\b/.test(label),
  },
  {
    key: "hauteur_etages",
    unit: "etages",
    kind: "range",
    matches: (label) => /\bnombre d.?etages\b/.test(label),
  },
  {
    key: "locaux_commerciaux_max",
    unit: "nombre",
    kind: "scalar",
    matches: (label) => /\bnombre de locaux commerciaux\b/.test(label),
  },
  {
    key: "cos_max",
    unit: "ratio",
    kind: "scalar",
    matches: (label) => /\bcoefficient d.?occupation au sol\b/.test(label),
  },
];

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(/\*\d+/g, " ").replace(/\s+/g, " ").trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(normalized)) return null;
  const value = Number(normalized.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function normCell(
  raw: string,
  tokens: readonly PositionedToken[],
  spec: NormLabelSpec,
  scope: "column" | "merged",
): VariantNormCell {
  if (spec.kind === "range") {
    const normalized = raw.replace(/\*\d+/g, " ").replace(/\s+/g, "").trim();
    const match = normalized.match(/^(\d+(?:[.,]\d+)?)\s*[\\/]\s*(\d+(?:[.,]\d+)?)$/);
    const min = match?.[1] ? Number(match[1].replace(",", ".")) : null;
    const max = match?.[2] ? Number(match[2].replace(",", ".")) : null;
    return {
      raw,
      value: null,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      unit: spec.unit,
      bbox: bboxUnion(tokens),
      scope,
    };
  }
  return {
    raw,
    value: parseNumber(raw),
    min: null,
    max: null,
    unit: spec.unit,
    bbox: bboxUnion(tokens),
    scope,
  };
}

function stableUnique<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/**
 * Parse and reconcile one Saint-Amable native page. Any source/header/marker
 * ambiguity throws; no partial or representative zone row is emitted.
 */
export function parseSaintAmableZoneVariants(
  input: ParseSaintAmableZoneVariantsInput,
): ZoneVariantExtraction {
  assertNativeTextPageGeometry(input.primary);
  if (!EXPECTED_ZONE_RE.test(input.expectedZone)) {
    fail(
      "invalid-expected-zone",
      `authoritative zone must already be canonical: ${JSON.stringify(input.expectedZone)}`,
    );
  }
  if (input.primary.method === input.verification.method) {
    fail("non-independent-read", "primary and verification methods must be distinct");
  }

  const headerItems = selectHeaderItems(input.primary);
  const primaryRaw = headerItems.map((item) => item.text.trim());
  assertHeaderRead(primaryRaw, input.expectedZone, input.primary.method);
  assertHeaderRead(
    input.verification.rawZoneCodes,
    input.expectedZone,
    input.verification.method,
  );
  if (primaryRaw.length !== input.verification.rawZoneCodes.length) {
    fail(
      "header-count-mismatch",
      `${input.primary.method} found ${primaryRaw.length} columns; ` +
        `${input.verification.method} found ${input.verification.rawZoneCodes.length}`,
    );
  }
  const rawPresentations = new Set(
    [...primaryRaw, ...input.verification.rawZoneCodes].map((code) => code.trim()),
  );
  if (rawPresentations.size !== 1) {
    fail(
      "normalization-collision",
      `multiple raw headers normalize to ${input.expectedZone}: ${[...rawPresentations].join(", ")}`,
    );
  }

  const firstHeaderY = Math.min(...headerItems.map((item) => item.bbox.y0));
  const usageStartY = Math.max(...headerItems.map((item) => item.bbox.y1));
  const firstColumnCenter = Math.min(
    ...headerItems.map((item) => (item.bbox.x0 + item.bbox.x1) / 2),
  );
  const noteDefinitionY = Math.min(
    ...input.primary.items
      .filter(
        (item) =>
          item.bbox.x0 < firstColumnCenter && /^\*\d+\s*:/.test(item.text.trim()),
      )
      .map((item) => item.bbox.y0),
    input.primary.height,
  );
  const columns = columnBboxes(headerItems, input.primary, noteDefinitionY);
  const firstColumnX = columns[0]!.x0;
  const tokens = tokensFromItems(input.primary.items).filter(
    (token) => token.cy > firstHeaderY && token.cy < noteDefinitionY,
  );
  const rows = groupRows(tokens);
  const allText = fold(input.primary.items.map((item) => item.text).join(" "));
  if (!allText.includes("usages autorises")) {
    fail("usage-section-missing", "page has no USAGES AUTORISÉS section");
  }
  const usageEndY = Math.min(
    ...input.primary.items
      .filter((item) => /^usages specifiquement (?:permis|exclus)\b/.test(fold(item.text)))
      .map((item) => item.bbox.y0),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(usageEndY) || usageEndY <= usageStartY) {
    fail(
      "usage-section-missing",
      "page has no valid end boundary for the authorized usage-class section",
    );
  }

  const variants: ZoneVariant[] = columns.map((bbox, column_index) => ({
    column_index,
    bbox,
    usages: [],
    structures: [],
    norms: {},
    footnotes: [],
  }));
  const mergedNormKeys = new Set(input.verification.mergedNormKeys);
  const seenNormRows = new Set<VariantNormKey>();
  if (mergedNormKeys.size !== input.verification.mergedNormKeys.length) {
    fail("norm-merge-mismatch", "verification contains duplicate merged norm keys");
  }

  for (const row of rows) {
    const label = rowLabel(row, firstColumnX);
    const foldedLabel = fold(label);
    const usageMatches = Array.from(label.matchAll(/\(([a-z]\d+)\)/gi)).map((match) =>
      match[1]!.toLowerCase(),
    );
    if (usageMatches.length > 0 && row.cy > usageStartY && row.cy < usageEndY) {
      for (const usage of usageMatches) {
        if (!SAINT_AMABLE_USAGE_CODES.has(usage)) {
          fail("invalid-usage-code", `usage outside the closed vocabulary: ${usage}`);
        }
      }
      const markers = markerColumns(row, columns);
      for (const column of markers) {
        for (const usage of usageMatches) {
          variants[column]!.usages.push(usage as SaintAmableUsageCode);
        }
      }
    }

    const structure = structureForLabel(foldedLabel);
    if (structure) {
      for (const column of markerColumns(row, columns)) {
        variants[column]!.structures.push(structure.canonical);
      }
    }

    const norm = NORM_LABELS.find((candidate) => candidate.matches(foldedLabel));
    if (norm) {
      if (seenNormRows.has(norm.key)) {
        fail(
          "norm-conflict",
          `multiple physical rows map to ${norm.key}; refusing last-write-wins collapse`,
        );
      }
      seenNormRows.add(norm.key);
      const cells = columns.map((_column, index) => {
        const cellTokens = row.tokens.filter(
          (token) => tokenColumn(token, columns) === index && token.text !== "●",
        );
        const raw = cellTokens.map((token) => token.text).join(" ").trim();
        return { tokens: cellTokens, raw };
      });
      const present = cells
        .map((cell, index) => ({ ...cell, index }))
        .filter((cell) => cell.raw.length > 0);
      if (present.length === 1 && variants.length > 1 && mergedNormKeys.has(norm.key)) {
        const source = present[0]!;
        for (const variant of variants) {
          variant.norms[norm.key] = normCell(source.raw, source.tokens, norm, "merged");
        }
      } else {
        for (const cell of present) {
          variants[cell.index]!.norms[norm.key] = normCell(
            cell.raw,
            cell.tokens,
            norm,
            "column",
          );
        }
      }
    }
  }

  for (const key of mergedNormKeys) {
    const cells = variants.map((variant) => variant.norms[key]);
    if (
      cells.some((cell) => cell === undefined || cell.scope !== "merged") ||
      new Set(cells.map((cell) => cell?.raw)).size !== 1
    ) {
      fail(
        "norm-merge-mismatch",
        `verification declared ${key} merged but the native row is missing or ambiguous`,
      );
    }
  }

  for (const token of tokens) {
    if (!/^\*\d+$/.test(token.text)) continue;
    const column = tokenColumn(token, columns);
    if (column >= 0) variants[column]!.footnotes.push(token.text);
  }
  for (const variant of variants) {
    variant.usages = stableUnique(variant.usages);
    variant.structures = stableUnique(variant.structures);
    variant.footnotes = stableUnique(variant.footnotes);
  }

  if (input.verification.authorizedUsagesByColumn.length !== variants.length) {
    fail(
      "usage-marker-mismatch",
      `verification has ${input.verification.authorizedUsagesByColumn.length} usage columns; ` +
        `native bbox read has ${variants.length}`,
    );
  }
  for (let index = 0; index < variants.length; index += 1) {
    const verified = input.verification.authorizedUsagesByColumn[index] ?? [];
    for (const usage of verified) {
      if (!SAINT_AMABLE_USAGE_CODES.has(usage)) {
        fail("invalid-usage-code", `verification usage outside vocabulary: ${usage}`);
      }
    }
    if (JSON.stringify(variants[index]!.usages) !== JSON.stringify(verified)) {
      fail(
        "usage-marker-mismatch",
        `usage markers differ in column ${index}: ` +
          `${input.primary.method}=${JSON.stringify(variants[index]!.usages)} ` +
          `${input.verification.method}=${JSON.stringify(verified)}`,
      );
    }
  }

  return {
    zone_code: input.expectedZone,
    source_url: input.sourceUrl,
    source_sha256: input.sourceSha256,
    snapshot: input.snapshot,
    page: input.primary.page,
    header_observations: [
      { method: input.primary.method, raw_zone_codes: primaryRaw },
      {
        method: input.verification.method,
        raw_zone_codes: [...input.verification.rawZoneCodes],
      },
    ],
    variants,
  };
}
