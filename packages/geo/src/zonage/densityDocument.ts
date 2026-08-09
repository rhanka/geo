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
  unit: "logements/terrain" | "logements/batiment" | "log/ha" | "cos-max";
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

/**
 * Amos — the VA-964 Annex 2 page for P-1 prints one COS maximum in two
 * agreeing use columns. The amendment date is required on that same page:
 * the surrounding, otherwise undated, annex is never assigned a date by
 * inference.
 */
export function parseAmosDensityDocument(text: string): DensityDocumentParseResult {
  const family = "amos-va-964-annexe-2-p1";
  const documentAnchored =
    /GRILLE\s+DE\s+SPECIFICATIONS/i.test(text)
    && /\bZONE\s+P-1\b/i.test(text)
    && /\(1\)\s+Inclut\s+le\s+b[âa]timent\s+principal\s+et\s+les\s+b[âa]timents\s+accessoires\s+rattach[ée]s/i
      .test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const folded = foldedLine(pageText);
    const zone = /\bZONE\s+(P-1)\b/i.exec(folded)?.[1]?.toUpperCase() ?? null;
    if (zone === null) continue;
    const densityLine = pageText.split(/\r?\n/)
      .find((line) => /Coefficient\s+d[’']occupation\s+du\s+sol\s+maximum\s*\(%\)/i.test(line));
    if (!densityLine) continue;
    const proof = foldedLine(densityLine);
    const date =
      /\bVA-1290\s+17\s+sept\.?\s+2024\b/i.exec(folded);
    if (!date) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "date-amendement-absente-sur-la-page",
        proof,
      });
      continue;
    }
    const match =
      /Coefficient\s+d[’']occupation\s+du\s+sol\s+maximum\s*\(%\)\s*(.*)$/i
        .exec(proof);
    if (!match) continue;
    const raw = match[1]!.trim();
    const withoutNotes = raw.replace(/\(\s*\d+\s*\)/g, " ");
    const values = (withoutNotes.match(/\d+(?:[,.]\d+)?/g) ?? [])
      .map((value) => ({ raw: value, value: decimal(value) }))
      .filter((entry): entry is { raw: string; value: number } => entry.value !== null);
    if (values.length === 0) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "cos-maximum-non-numerique",
        proof,
      });
      continue;
    }
    const distinct = new Set(values.map((entry) => entry.value));
    if (distinct.size !== 1) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "maxima-divergents-entre-colonnes-usages",
        proof,
      });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value: values[0]!.value,
      unit: "cos-max",
      raw,
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Notre-Dame-de-Lourdes (MRC de Joliette) — the municipality publishes the
 * dated zoning by-law with Annex C integrated in the same PDF. Only H-16 has a
 * single COS maximum repeated identically across every printed use column;
 * use-specific "Maximum N logements" notes elsewhere are deliberately ignored.
 */
export function parseNotreDameDeLourdesJolietteDensityDocument(
  text: string,
): DensityDocumentParseResult {
  const family = "notre-dame-de-lourdes-joliette-02-2023-annexe-c-h16";
  const documentAnchored =
    /R[èe]glement\s+de\s+zonage\s+(?:num[ée]ro\s+)?02-2023/i.test(text)
    && /MUNICIPALIT[ÉE]\s+DE\s+NOTRE-DAME-DE-LOURDES/i.test(text)
    && /Derni[èe]re\s+mise\s+[àa]\s+jour\s+le\s*:\s*27\s+novembre\s+2024/i.test(text)
    && /documents\s+suivants\s+sont\s+annex[ée]s\s+au\s+pr[ée]sent\s+r[èe]glement\s+et\s+en\s+font\s+partie\s+int[ée]grante/i
      .test(text)
    && /Annexe\s+C\s*:\s*Grilles\s+des\s+sp[ée]cifications/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const folded = foldedLine(pageText);
    const zone = /\bZone\s+(H-16)\b/i.exec(folded)?.[1]?.toUpperCase() ?? null;
    if (zone === null) continue;
    const densityLine = pageText.split(/\r?\n/)
      .find((line) => /Coefficient\s+d['’]emprise\s+au\s+sol\s+maximal\s*\(%\)/i.test(line));
    if (!densityLine) continue;
    const proof = foldedLine(densityLine);
    const match =
      /Coefficient\s+d['’]emprise\s+au\s+sol\s+maximal\s*\(%\)\s*(.*)$/i
        .exec(proof);
    if (!match) continue;
    const raw = match[1]!.trim();
    const values = (raw.match(/\d+(?:[,.]\d+)?/g) ?? [])
      .map((value) => ({ raw: value, value: decimal(value) }))
      .filter((entry): entry is { raw: string; value: number } => entry.value !== null);
    if (values.length < 2) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "cos-maximum-colonnes-incomplètes",
        proof,
      });
      continue;
    }
    const distinct = new Set(values.map((entry) => entry.value));
    if (distinct.size !== 1) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "maxima-divergents-entre-colonnes-usages",
        proof,
      });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value: values[0]!.value,
      unit: "cos-max",
      raw,
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
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
    [...line.matchAll(/([A-ZÀ-ÖØ-Þ]{1,4}-\d{1,4}(?:[.-][A-Z0-9]+)*)/giu)]
      .map((match) => ({
        code: normalizedHeaderZoneCode(match[1]!),
        center: (match.index ?? 0) + Math.floor(match[0].length / 2),
      }))
  );
  const positioned = [...complete];

  for (const [lineIndex, line] of headerLines.entries()) {
    const prefixes =
      [...line.matchAll(/([A-ZÀ-ÖØ-Þ]{1,4}-)(?=\s|$)/giu)];
    if (prefixes.length === 0) continue;
    for (const numberLine of headerLines.slice(lineIndex + 1)) {
      const numbers = [...numberLine.matchAll(/\b(\d{1,4})\b/g)];
      if (numbers.length !== prefixes.length) continue;
      positioned.push(...prefixes.map((prefix, index) => {
        const number = numbers[index]!;
        return {
          code: `${normalizedHeaderZoneCode(prefix[1]!)}${number[1]!}`,
          center: (number.index ?? 0) + Math.floor(number[0].length / 2),
        };
      }));
      break;
    }
  }
  return [...new Map(
    positioned
      .sort((left, right) => left.center - right.center)
      .map((positioned) => [positioned.code, positioned]),
  ).values()];
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
 * Très-Saint-Rédempteur — the original Annex C of zoning by-law 155 prints
 * several exact zone codes in columns and one "Logement / bâtiment max." row.
 * Blank cells stay absent; a value is never borrowed from a neighbouring
 * column.
 */
export function parseTresSaintRedempteurDensityDocument(
  text: string,
): DensityDocumentParseResult {
  const family = "tres-saint-redempteur-155-annexe-c";
  const documentAnchored =
    /MUNICIPALIT[ÉE]\s+DE\s+TR[ÈE]S-SAINT-R[ÉE]DEMPTEUR/i.test(text)
    && /Annexe\s*["«]?C["»]?\s+du\s+r[èe]glement/i.test(text)
    && /de\s+zonage\s+num[ée]ro\s+155/i.test(text)
    && /GRILLE\s+DES\s+USAGES\s+ET\s+DES\s+NORMES/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const lines = pageText.split(/\r?\n/);
    const codes = positionedZoneCodes(lines);
    if (codes.length === 0) continue;
    const densityLine = lines.find((line) =>
      /Logement\s*\/\s*b[âa]timent\s+max\./i.test(line)
    );
    if (!densityLine) continue;
    const label = /Logement\s*\/\s*b[âa]timent\s+max\./i.exec(densityLine);
    if (!label || label.index === undefined) continue;
    const labelEnd = label.index + label[0].length;

    for (const [index, zone] of codes.entries()) {
      const raw = cellAtCenters(densityLine, labelEnd, codes, index);
      if (raw === "") continue;
      const value = decimal(raw);
      const proof = `Logement / bâtiment max. ${raw}`;
      if (value === null) {
        refusals.push({
          page,
          zoneCode: zone.code,
          reason: "maximum-non-numerique",
          proof,
        });
        continue;
      }
      readings.push({
        zoneCode: zone.code,
        value,
        unit: "logements/batiment",
        raw,
        proof,
        page,
      });
    }
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
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
 * Chesterville — one sheet per zone. Cells are printed as ranges per use class
 * (for example 2/3 or 4/9), so a zone-level scalar exists only when every
 * printed range is degenerate and all resulting values agree.
 */
export function parseChestervilleDensityDocument(text: string): DensityDocumentParseResult {
  const family = "chesterville-grilles-usages-normes";
  const documentAnchored =
    /Municipalit[ée]\s+de\s+Chesterville/i.test(text)
    && /(?:Grille\s+des\s+usages\s+et\s+normes|R[ÈE]GLEMENT\s+N[°O]\s*187)/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const partialAmendment =
    /R[ÈE]GLEMENT\s+N[°O]\s*187\b/i.test(text)
    && /[Aa]mendant\s+le\s+r[èe]glement\s+de\s+zonage/i.test(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];
  const blockedZones = new Set<string>();

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const folded = foldedLine(pageText);
    const zone =
      /\bZone\s+([A-Z]{1,3}\s*-?\s*\d{1,3})\b/i.exec(folded)?.[1]
        ?.replace(/\s|-/g, "")
        .toUpperCase() ?? null;
    const densityLine = pageText.split(/\r?\n/)
      .find((line) => /\bNombre\s+de\s+logements?\s+par\s+b[âa]timent\b/i.test(line));
    if (!densityLine) continue;
    const match =
      /\bNombre\s+de\s+logements?\s+par\s+b[âa]timent\b\s*(.*)$/i
        .exec(foldedLine(densityLine));
    if (!match) continue;
    const proof = match[0]!;
    const rawTail = match[1]!;
    const ranges = [...rawTail.matchAll(/\b(\d+)\s*\/\s*(\d+)\b/g)];
    const incompleteRange = /\b\d+\s*\/(?:\s|$)/.test(rawTail);
    if (ranges.length === 0 && !incompleteRange) continue;
    if (partialAmendment) {
      if (zone) blockedZones.add(zone);
      refusals.push({
        page,
        zoneCode: zone,
        reason: "amendement-partiel-ne-prouve-pas-une-densite-de-zone",
        proof,
      });
      continue;
    }
    if (!zone) {
      refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
      continue;
    }
    if (incompleteRange) {
      blockedZones.add(zone);
      refusals.push({ page, zoneCode: zone, reason: "plage-logements-incomplete", proof });
      continue;
    }
    const fixedValues: number[] = [];
    let nonScalar = false;
    for (const range of ranges) {
      const minimum = decimal(range[1]!);
      const maximum = decimal(range[2]!);
      if (minimum === null || maximum === null || minimum !== maximum) {
        nonScalar = true;
        break;
      }
      fixedValues.push(minimum);
    }
    if (nonScalar || new Set(fixedValues).size !== 1) {
      blockedZones.add(zone);
      refusals.push({
        page,
        zoneCode: zone,
        reason: "plages-ou-classes-divergentes",
        proof,
      });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value: fixedValues[0]!,
      unit: "logements/batiment",
      raw: ranges.map((range) => `${range[1]}/${range[2]}`).join(" | "),
      proof,
      page,
    });
  }
  return consolidate(
    family,
    documentAnchored,
    projectExcluded,
    readings.filter((reading) => !blockedZones.has(reading.zoneCode)),
    refusals,
  );
}

/**
 * Drummondville chapter 13 — prose rules scoped by the closest preceding zone
 * heading on the same page. This avoids attributing a rule to an earlier
 * section merely because both zone codes occur on that page.
 */
export function parseDrummondvilleDensityDocument(text: string): DensityDocumentParseResult {
  const family = "drummondville-4300-chapitre-13";
  const documentAnchored =
    /Ville\s+de\s+Drummondville/i.test(text)
    && /R[èe]glement\s+de\s+zonage\s+N[o°]\s*4300/i.test(text)
    && /Chapitre\s+13/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    let currentZone: string | null = null;
    for (const line of pageText.split(/\r?\n/)) {
      const zoneHeading =
        /\bZONES?(?:\s+D[’']HABITATION)?\s+([A-Z]{1,4}-\d{1,4}(?:-\d+)*)\b/.exec(line);
      if (zoneHeading) currentZone = zoneHeading[1]!;
      const folded = foldedLine(line);
      const perTerrain =
        /\bLe\s+nombre\s+de\s+logements?\s+par\s+terrain\s+maximal\s+est\s+[ée]tabli\s+[àa]\s+(\d+(?:[,.]\d+)?)\b/i
          .exec(folded);
      const perBuilding =
        /\bnombre\s+de\s+logements?\s*\/\s*b[âa]timent\s+maximal\s*:\s*(\d+(?:[,.]\d+)?)\b/i
          .exec(folded);
      const match = perTerrain ?? perBuilding;
      if (!match) continue;
      if (!currentZone) {
        refusals.push({
          page,
          zoneCode: null,
          reason: "zone-absente-avant-la-regle-sur-la-page",
          proof: folded,
        });
        continue;
      }
      const value = decimal(match[1]!);
      if (value === null) {
        refusals.push({
          page,
          zoneCode: currentZone,
          reason: "maximum-non-numerique",
          proof: folded,
        });
        continue;
      }
      readings.push({
        zoneCode: currentZone,
        value,
        unit: perTerrain ? "logements/terrain" : "logements/batiment",
        raw: match[1]!,
        proof: folded,
        page,
      });
    }
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Huberdeau — the captured density clause governs project-integrated housing
 * under several servicing/riparian conditions and names no zone. It is
 * evidence, but cannot become a scalar zone norm.
 */
export function parseHuberdeauDensityDocument(text: string): DensityDocumentParseResult {
  const family = "huberdeau-199-02-projet-integre";
  const documentAnchored =
    /MUNICIPALIT[ÉE]\s+D[’']HUBERDEAU/i.test(text)
    && /R[ÈE]GLEMENT\s+(?:DE\s+ZONAGE\s+)?(?:NUM[ÉE]RO\s+)?199-02/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const refusals: DensityNormRefusal[] = [];
  for (const [pageIndex, pageText] of pages(text).entries()) {
    const line = pageText.split(/\r?\n/)
      .find((candidate) => /nombre\s+de\s+logements?\s+[àa]\s+l’hectare\s+brut/i.test(candidate));
    if (!line) continue;
    refusals.push({
      page: pageIndex + 1,
      zoneCode: null,
      reason: "densite-conditionnelle-sans-code-zone",
      proof: foldedLine(line),
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, [], refusals);
}

/** Clermont — one native grid page per zone, with use-class columns. */
export function parseClermontDensityDocument(text: string): DensityDocumentParseResult {
  const family = "clermont-vc-434-13-grilles";
  const documentAnchored =
    /VILLE\s+DE\s+CLERMONT/i.test(text)
    && /R[ÈE]GLEMENT\s+DE\s+ZONAGE\s+NUM[ÉE]RO\s+VC-434-13/i.test(text)
    && /GRILLES?\s+DES\s+SP[ÉE]CIFICATIONS/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const zone =
      /\bZONE\s+(\d{3}(?:\.\d+)?-[A-ZÀ-ÖØ-Þ]{1,8}(?:-\d+)*)\b/i
        .exec(pageText)?.[1] ?? null;
    const line = pageText.split(/\r?\n/)
      .find((candidate) => /\bNombre\s+maximal\s+de\s+logements?\b/i.test(candidate));
    if (!line) continue;
    const proof = foldedLine(line);
    const match = /\bNombre\s+maximal\s+de\s+logements?\b\s*(.*)$/i.exec(proof);
    const withoutNotes = match?.[1]?.replace(/\([^)]*\)/g, " ") ?? "";
    const rawValues = withoutNotes.match(/\d+(?:[,.]\d+)?/g) ?? [];
    if (rawValues.length === 0) continue;
    if (!zone) {
      refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
      continue;
    }
    const values = rawValues.map(decimal);
    if (values.some((value) => value === null) || new Set(values).size !== 1) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "maxima-divergents-entre-colonnes-usages",
        proof,
      });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value: values[0]!,
      unit: "logements/batiment",
      raw: rawValues.join(" | "),
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Varennes — a zone sheet spans two PDF pages. Only explicit maximum rows are
 * candidates; the zone from the first page remains in scope for its immediate
 * continuation page. Divergent columns or competing maximum metrics fail
 * closed through the shared consolidation rule.
 */
export function parseVarennesDensityDocument(text: string): DensityDocumentParseResult {
  const family = "varennes-707-annexe-b-grilles";
  const documentAnchored =
    /GRILLE\s+DES\s+USAGES\s+ET\s+NORMES/i.test(text)
    && /\bZone\s+[A-Z]{1,4}-\d{3,4}\b/i.test(text)
    && /PGSYSTEM\/Grille\/Exe\/html1\.html/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];
  let currentZone: string | null = null;

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const pageZone =
      /\bGRILLE\s+DES\s+USAGES\s+ET\s+NORMES\b[^\n]*\bZone\s+([A-Z]{1,4}-\d{3,4})\b/i
        .exec(pageText)?.[1] ?? null;
    if (pageZone) currentZone = pageZone;
    for (const line of pageText.split(/\r?\n/)) {
      const proof = foldedLine(line);
      const housing =
        /\b(?:6|10)\.\s*b\)\s*Nombre\s+de\s+logements?\s+max\.\s*(.*)$/i.exec(proof);
      const cos =
        /\b54\.\s*Coefficient\s+d['’]occupation\s+du\s+sol\s+max\.\s*(.*)$/i.exec(proof);
      const match = housing ?? cos;
      if (!match) continue;
      const rawValues = match[1]!.match(/\d+(?:[,.]\d+)?/g) ?? [];
      if (rawValues.length === 0) continue;
      if (!currentZone) {
        refusals.push({
          page,
          zoneCode: null,
          reason: "zone-absente-avant-la-regle",
          proof,
        });
        continue;
      }
      const values = rawValues.map(decimal);
      if (values.some((value) => value === null) || new Set(values).size !== 1) {
        refusals.push({
          page,
          zoneCode: currentZone,
          reason: "maxima-divergents-entre-colonnes-usages",
          proof,
        });
        continue;
      }
      readings.push({
        zoneCode: currentZone,
        value: values[0]!,
        unit: housing ? "logements/batiment" : "cos-max",
        raw: rawValues.join(" | "),
        proof,
        page,
      });
    }
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Mont-Tremblant — one native sheet per zone. A zone may carry either a
 * logements/ha row or an explicit prose maximum per building. Repeated use
 * columns must agree, conditional prose is refused, and competing metrics for
 * one zone fail closed through the shared consolidation rule.
 */
export function parseMontTremblantDensityDocument(
  text: string,
): DensityDocumentParseResult {
  const family = "mont-tremblant-2008-102-annexe-a";
  const documentAnchored =
    /Annexe\s+A\s+du\s+r[èe]glement\s+de\s+zonage\s+\(2008\)-102/i.test(text)
    && /GRILLE\s+DES\s+USAGES\s+ET\s+DES\s+NORMES/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const zone =
      /\bZONE\s*:\s*([A-Z]{1,4}-\d{3}(?:[.-]\d+)*)\b/i.exec(pageText)?.[1] ?? null;
    for (const line of pageText.split(/\r?\n/)) {
      const proof = foldedLine(line);
      const row =
        /\bLogements?\s*\/\s*terrain\s+maximal\s*\(logements?\s*\/\s*ha\)\s*(.*)$/i
          .exec(proof);
      if (!row) continue;
      const withoutNotes = row[1]!.replace(/\(\s*\d+\s*\)/g, " ");
      const rawValues = withoutNotes.match(/\d+(?:[,.]\d+)?/g) ?? [];
      if (rawValues.length === 0) continue;
      if (!zone) {
        refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
        continue;
      }
      const values = rawValues.map(decimal);
      if (values.some((value) => value === null) || new Set(values).size !== 1) {
        refusals.push({
          page,
          zoneCode: zone,
          reason: "maxima-divergents-entre-colonnes-usages",
          proof,
        });
        continue;
      }
      readings.push({
        zoneCode: zone,
        value: values[0]!,
        unit: "log/ha",
        raw: rawValues.join(" | "),
        proof,
        page,
      });
    }

    const folded = foldedLine(pageText);
    const prose =
      /\bLe\s+nombre\s+maximal\s+de\s+logements?\s+par\s+b[âa]timent\s+est\s+fix[ée]\s+[àa]\s+(\d+(?:[,.]\d+)?)([^.]*)\./gi;
    for (const match of folded.matchAll(prose)) {
      const proof = match[0]!;
      if (!zone) {
        refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
        continue;
      }
      if (match[2]!.trim() !== "") {
        refusals.push({
          page,
          zoneCode: zone,
          reason: "maximum-conditionnel",
          proof,
        });
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
  }

  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Saint-Jérôme — one three-page sheet per zone. The scalar density field can
 * represent only the explicit COS maximum. A printed minimum followed by "-"
 * is evidence, but is not converted into a maximum.
 */
export function parseSaintJeromeDensityDocument(
  text: string,
): DensityDocumentParseResult {
  const family = "saint-jerome-0351-000-annexe-2";
  const documentAnchored =
    /R[èe]glement\s+num[ée]ro\s+0351-000\s+sur\s+le\s+zonage\s+de\s+la\s+Ville\s+de\s+Saint-\s*J[ée]r[oô]me/i
      .test(foldedLine(text))
    && /\bZone\s*:\s*[A-Z]{1,6}-\d{3}/i.test(text);
  const projectExcluded = hardProjectMarker(text);
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [pageIndex, pageText] of pages(text).entries()) {
    const page = pageIndex + 1;
    const zone =
      /\bZone\s*:\s*([A-Z]{1,6}-\d{3}(?:\.\d+)?)\b/i.exec(pageText)?.[1] ?? null;
    for (const line of pageText.split(/\r?\n/)) {
      const proof = foldedLine(line);
      const label =
        /\bCoefficient\s+d['’]occupation\s+du\s+sol\s+\(COS\)\s+min\.\/max\.\s*(.*)$/i
          .exec(proof);
      if (!label) continue;
      const pair = /^(\d+(?:[,.]\d+)?|-)\s*\/\s*(\d+(?:[,.]\d+)?|-)(?:\s|$)/.exec(label[1]!);
      if (!pair) continue;
      if (!zone) {
        refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
        continue;
      }
      if (pair[2] === "-") {
        refusals.push({ page, zoneCode: zone, reason: "cos-maximum-absent", proof });
        continue;
      }
      const value = decimal(pair[2]!);
      if (value === null) {
        refusals.push({ page, zoneCode: zone, reason: "cos-maximum-non-numerique", proof });
        continue;
      }
      readings.push({
        zoneCode: zone,
        value,
        unit: "cos-max",
        raw: pair[2]!,
        proof,
        page,
      });
    }
  }

  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

function refuseAreaDensityWithoutZone(
  family: string,
  text: string,
  documentAnchored: boolean,
  densityPattern: RegExp,
): DensityDocumentParseResult {
  const projectExcluded = hardProjectMarker(text);
  const refusals: DensityNormRefusal[] = [];
  for (const [pageIndex, pageText] of pages(text).entries()) {
    const folded = foldedLine(pageText);
    const match = densityPattern.exec(folded);
    densityPattern.lastIndex = 0;
    if (!match) continue;
    refusals.push({
      page: pageIndex + 1,
      zoneCode: null,
      reason: "densite-affectation-sans-code-zone",
      proof: match[0]!,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, [], refusals);
}

/** Mont-Tremblant plan policy: density is scoped to an area, not a zone. */
export function parseMontTremblantPlanDensityDocument(
  text: string,
): DensityDocumentParseResult {
  return refuseAreaDensityWithoutZone(
    "mont-tremblant-2008-100-plan-urbanisme",
    text,
    /Ville\s+de\s+Mont-Tremblant/i.test(text)
      && /R[èe]glement\s+\(2008\)-100/i.test(text)
      && /Plan\s+d['’]urbanisme/i.test(text),
    /\bMaximum\s+de\s+\d+(?:[,.]\d+)?\s+logements?[^.]{0,180}?[àa]\s+l['’]hectare\b/i,
  );
}

/** Varennes PPU policy: density is scoped to an affectation, not a zone. */
export function parseVarennesPpuDensityDocument(
  text: string,
): DensityDocumentParseResult {
  return refuseAreaDensityWithoutZone(
    "varennes-706-15-ppu",
    text,
    /PROGRAMME\s+PARTICULIER\s+D['’]URBANISME/i.test(text)
      && /Ville\s+de\s+Varennes/i.test(text),
    /\b(?:\d+(?:[,.]\d+)?\s+logements?\s+[àa]\s+l['’]hectare|logements?\s+[àa]\s+l['’]hectare\s*:\s*\d+(?:[,.]\d+)?|coefficient\s+d['’]occupation\s+du\s+sol\s+\(COS\))/i,
  );
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
