/**
 * Strict native-text extraction for legally reviewed density documents.
 *
 * The parser publishes only a value printed on the same page as an exact zone
 * code and density label. Repeated use-class columns must agree; disagreement
 * is a refusal, never a choice made by the parser.
 */

export interface VerbatimDensityNorm {
  zoneCode: string;
  value: number;
  unit: "logements/terrain" | "logements/batiment" | "log/ha";
  raw: string;
  proof: string;
  page: number;
}

export interface DensityNormRefusal {
  page: number;
  zoneCode: string | null;
  reason: string;
  proof: string | null;
}

export interface DensityDocumentParseResult {
  family: string;
  documentAnchored: boolean;
  projectExcluded: boolean;
  norms: VerbatimDensityNorm[];
  refusals: DensityNormRefusal[];
}

function pages(text: string): string[] {
  const out = text.split("\f");
  if (out.at(-1) === "") out.pop();
  return out;
}

function foldedLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function decimal(raw: string): number | null {
  if (!/^\d+(?:[,.]\d+)?$/.test(raw)) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hardProjectMarker(text: string): boolean {
  return /(?:^|\n)\s*(?:1\s*er|premier|second|deuxi[èe]me)?\s*projet\s+de\s+r[èe]glement\b/im
    .test(text.slice(0, 30_000));
}

function consolidate(
  family: string,
  documentAnchored: boolean,
  projectExcluded: boolean,
  readings: VerbatimDensityNorm[],
  refusals: DensityNormRefusal[],
): DensityDocumentParseResult {
  if (!documentAnchored || projectExcluded) {
    return { family, documentAnchored, projectExcluded, norms: [], refusals };
  }
  const byZone = new Map<string, VerbatimDensityNorm>();
  const conflicted = new Set<string>();
  for (const reading of readings) {
    const key = reading.zoneCode.toUpperCase();
    const previous = byZone.get(key);
    if (
      previous
      && (previous.value !== reading.value || previous.unit !== reading.unit)
    ) {
      conflicted.add(key);
      refusals.push({
        page: reading.page,
        zoneCode: reading.zoneCode,
        reason: "valeurs-divergentes-pour-la-zone",
        proof: `${previous.proof} <> ${reading.proof}`,
      });
      continue;
    }
    if (!previous) byZone.set(key, reading);
  }
  for (const key of conflicted) byZone.delete(key);
  return {
    family,
    documentAnchored,
    projectExcluded,
    norms: [...byZone.values()],
    refusals,
  };
}

/** Municipalité de Champlain — one sheet per numeric zone. */
export function parseChamplainDensityDocument(text: string): DensityDocumentParseResult {
  const family = "champlain-2009-03-annexe-c";
  const documentAnchored =
    /MUNICIPALIT[ÉE]\s+DE\s+CHAMPLAIN/i.test(text)
    && /(?:R[ÈE]GLEMENT\s+DE\s+ZONAGE|GRILLE\s+DE\s+SP[ÉE]CIFICATIONS)/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [index, pageText] of pages(text).entries()) {
    const page = index + 1;
    const folded = foldedLine(pageText);
    const zone =
      /\bGRILLE\s+DE\s+SP[ÉE]CIFICATIONS\s+ZONE\s*:\s*(\d{2,4})\b/i.exec(folded)?.[1] ?? null;
    const match =
      /\bNombre\s+maximum\s+de\s+logements?\s+(\d+(?:[,.]\d+)?)\b/i.exec(folded);
    if (!match) continue;
    const proof = match[0]!;
    if (!zone) {
      refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
      continue;
    }
    const value = decimal(match[1]!);
    if (value === null) {
      refusals.push({ page, zoneCode: zone, reason: "maximum-non-numerique", proof });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value,
      unit: "logements/batiment",
      raw: match[1]!,
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

interface PositionedCode {
  code: string;
  center: number;
}

function normalizedHeaderZoneCode(raw: string): string {
  return raw.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function positionedZoneCodes(lines: readonly string[]): PositionedCode[] {
  const zonesLine = lines.findIndex((line) => /\bZONES?\b/i.test(line));
  if (zonesLine < 0) return [];

  const headerLines = lines.slice(zonesLine, zonesLine + 8);
  const complete = headerLines.flatMap((line) =>
    [...line.matchAll(/([A-ZÀ-ÖØ-Þ]{1,4}-\d{1,4}(?:[.-][A-Z0-9]+)*)/gu)]
      .map((match) => ({
        code: normalizedHeaderZoneCode(match[1]!),
        center: (match.index ?? 0) + Math.floor(match[0].length / 2),
      }))
  );
  if (complete.length > 0) {
    return [...new Map(
      complete
        .sort((left, right) => left.center - right.center)
        .map((positioned) => [positioned.code, positioned]),
    ).values()];
  }

  for (const [lineIndex, line] of headerLines.entries()) {
    const prefixes =
      [...line.matchAll(/([A-ZÀ-ÖØ-Þ]{1,4}-)(?=\s|$)/gu)];
    if (prefixes.length === 0) continue;
    for (const numberLine of headerLines.slice(lineIndex + 1)) {
      const numbers = [...numberLine.matchAll(/\b(\d{1,4})\b/g)];
      if (numbers.length !== prefixes.length) continue;
      return prefixes.map((prefix, index) => {
        const number = numbers[index]!;
        return {
          code: `${normalizedHeaderZoneCode(prefix[1]!)}${number[1]!}`,
          center: (number.index ?? 0) + Math.floor(number[0].length / 2),
        };
      });
    }
  }
  return [];
}

function cellAtCenters(
  line: string,
  labelEnd: number,
  codes: readonly PositionedCode[],
  index: number,
): string {
  const center = codes[index]!.center;
  const previous = codes[index - 1]?.center;
  const next = codes[index + 1]?.center;
  const start = previous === undefined
    ? Math.min(labelEnd, Math.max(0, center - Math.floor(((next ?? center + 16) - center) / 2)))
    : Math.floor((previous + center) / 2);
  const end = next === undefined ? line.length : Math.floor((center + next) / 2);
  return line.slice(start, end).trim();
}

/**
 * Lac-des-Écorces — native multizone tables. Zone headers and density values
 * remain associated only through their measured text-column positions.
 */
export function parseLacDesEcorcesDensityDocument(text: string): DensityDocumentParseResult {
  const family = "lac-des-ecorces-grilles-regroupe-r3";
  const documentAnchored =
    /MUNICIPALIT[ÉE]\s+DE\s+LAC-DES-[ÉE]CORCES/i.test(text)
    && /Grille\s+des\s+sp[ée]cifications/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const lines = pageText.split(/\r?\n/);
    const codes = positionedZoneCodes(lines);
    const densityLine = lines.find((line) => /Nombre\s+de\s+logements?\s+maximum/i.test(line));
    if (!densityLine) continue;
    const label = /Nombre\s+de\s+logements?\s+maximum/i.exec(densityLine);
    const proof = foldedLine(densityLine);
    if (!label || codes.length === 0) {
      refusals.push({ page, zoneCode: null, reason: "entete-zones-absent", proof });
      continue;
    }
    const labelEnd = (label.index ?? 0) + label[0].length;
    for (const [index, positioned] of codes.entries()) {
      const rawCell = cellAtCenters(densityLine, labelEnd, codes, index);
      const withoutNotes = rawCell.replace(/\([^)]*\)/g, " ");
      const rawValues = withoutNotes.match(/\d+(?:[,.]\d+)?/g) ?? [];
      if (rawValues.length === 0) continue;
      if (rawValues.length !== 1) {
        refusals.push({
          page,
          zoneCode: positioned.code,
          reason: "cellule-densite-ambiguë",
          proof: `${positioned.code}: ${rawCell}`,
        });
        continue;
      }
      const raw = rawValues[0]!;
      const value = decimal(raw);
      if (value === null) continue;
      readings.push({
        zoneCode: positioned.code,
        value,
        unit: "logements/batiment",
        raw,
        proof: `${proof} [${positioned.code}=${rawCell}]`,
        page,
      });
    }
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Ville de Mont-Laurier — règlement de zonage 134, fichier municipal
 * « Zones H.pdf ». A zone page prints one or more use-class columns on the row
 * « Logement / Hectare maximum ». The norm is publishable only when every
 * printed numeric column agrees.
 */
export function parseMontLaurierZonesHDensityDocument(
  text: string,
): DensityDocumentParseResult {
  const family = "mont-laurier-reglement-134-zones-h";
  const documentAnchored =
    /VILLE\s+DE\s+MONT-LAURIER/i.test(text)
    && /GRILLE\s+DES\s+USAGES\s+ET\s+NORMES\s+PAR\s+ZONE/i.test(text)
    && /R[ÈE]GLEMENT\s+DE\s+ZONAGE\s+NUM[ÉE]RO\s*:\s*134/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const norms: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [index, pageText] of pages(text).entries()) {
    const page = index + 1;
    const zone =
      /\bZONE\s*:\s*([A-Z]{1,4}-\d{1,4}(?:[.-][A-Z0-9]+)*)\b/i.exec(pageText)?.[1] ?? null;
    for (const line of pageText.split(/\r?\n/)) {
      const folded = foldedLine(line);
      const match = /\bLogements?\s*\/\s*Hectare\s+maximum\b\s*(.*)$/i.exec(folded);
      if (!match) continue;
      const proof = folded;
      if (!zone) {
        refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
        continue;
      }
      const rawValues =
        match[1]!.match(/\d+(?:[,.]\d+)?/g)?.map((raw) => raw.trim()) ?? [];
      const values = rawValues
        .map((raw) => ({ raw, value: decimal(raw) }))
        .filter((entry): entry is { raw: string; value: number } => entry.value !== null);
      if (values.length === 0) {
        refusals.push({ page, zoneCode: zone, reason: "maximum-numerique-absent", proof });
        continue;
      }
      const unique = new Set(values.map((entry) => entry.value));
      if (unique.size !== 1) {
        refusals.push({
          page,
          zoneCode: zone,
          reason: "valeurs-divergentes-entre-colonnes-usages",
          proof,
        });
        continue;
      }
      norms.push({
        zoneCode: zone,
        value: values[0]!.value,
        unit: "log/ha",
        raw: values.map((entry) => entry.raw).join(" | "),
        proof,
        page,
      });
    }
  }

  return {
    family,
    documentAnchored,
    projectExcluded,
    norms: documentAnchored && !projectExcluded ? norms : [],
    refusals,
  };
}
