/**
 * Native-text parsers for NEW, independently captured documents that state an
 * explicit density norm by zone.
 *
 * Anti-invention contract:
 *   - a parser is armed only by the exact document-family anchors below;
 *   - the zone, density label, maximum marker, value and unit must all be
 *     printed on the same PDF page;
 *   - a repeated zone with different printed values is refused;
 *   - fractions such as "1/50 hectares" remain evidence but are not converted
 *     into a numeric log/ha value here.
 */
import { hasHardProjectMarker } from "./density-document-discovery.js";

export type DensityDocumentFamily = "saint-dominique-2017-324" | "stoneham-09-591";

export interface VerbatimDensityNorm {
  zoneCode: string;
  value: number;
  unit: "logements/terrain" | "log/ha";
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

export interface DensityNormParseResult {
  family: DensityDocumentFamily;
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

function foldedWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decimal(raw: string): number | null {
  if (!/^\d+(?:[,.]\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function consolidate(
  family: DensityDocumentFamily,
  documentAnchored: boolean,
  projectExcluded: boolean,
  readings: VerbatimDensityNorm[],
  refusals: DensityNormRefusal[],
): DensityNormParseResult {
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
 * Municipalité de Saint-Dominique — Annexe B du règlement de zonage 2017-324.
 * Each fiche prints "ZONE A-1" and "nombre de logements / terrain (max.) 1".
 */
export function parseSaintDominiqueDensityDocument(text: string): DensityNormParseResult {
  const family = "saint-dominique-2017-324" as const;
  const documentAnchored =
    /MUNICIPALIT[ÉE]\s+DE\s+SAINT-DOMINIQUE/i.test(text)
    && (
      /ZONAGE\s+2017-324\s*-\s*ANNEXE\s+B/i.test(text)
      || /R[ÈE]GLEMENT\s+DE\s+ZONAGE\s+(?:NUM[ÉE]RO|N[O°])?\s*2017-324/i.test(text)
    );
  const projectExcluded = hasHardProjectMarker(text.slice(0, 250_000));
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [index, pageText] of pages(text).entries()) {
    const page = index + 1;
    const folded = foldedWhitespace(pageText);
    const zone = /\bZONE\s+([A-Z]{1,4}-\d{1,4}(?:[.-][A-Z0-9]+)*)\b/i.exec(folded)?.[1] ?? null;
    const match =
      /nombre\s+de\s+logements?\s*\/\s*terrain\s*\(max\.?\)\s*(\d+(?:[,.]\d+)?)/i.exec(folded);
    if (!match) continue;
    const proof = match[0]!;
    if (!zone) {
      refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
      continue;
    }
    const raw = match[1]!;
    const value = decimal(raw);
    if (value === null) {
      refusals.push({ page, zoneCode: zone, reason: "valeur-max-non-numerique", proof });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value,
      unit: "logements/terrain",
      raw,
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}

/**
 * Stoneham-et-Tewkesbury — Annexe 2, version intégrée du règlement 09-591.
 * The page label is "Zone : CP-145" and the row explicitly declares
 * "Densité nette (logement / hectare) Minimum 9 Maximum 25".
 */
export function parseStonehamDensityDocument(text: string): DensityNormParseResult {
  const family = "stoneham-09-591" as const;
  const documentAnchored =
    /ANNEXE\s+2\s*:\s*GRILLE\s+DES\s+SP[ÉE]CIFICATIONS/i.test(text)
    && /VERSION\s+INT[ÉE]GR[ÉE][\s\S]{0,160}R[ÈE]GLEMENT\s+DE\s+ZONAGE\s+(?:NUM[ÉE]RO\s+)?09-591/i.test(text);
  const projectExcluded = hasHardProjectMarker(text.slice(0, 250_000));
  const readings: VerbatimDensityNorm[] = [];
  const refusals: DensityNormRefusal[] = [];

  for (const [index, pageText] of pages(text).entries()) {
    const page = index + 1;
    const folded = foldedWhitespace(pageText);
    const zone =
      /\bZone\s*:\s*([A-Z]{1,4}-\d{1,4}(?:[.-][A-Z0-9]+)*)\b/i.exec(folded)?.[1] ?? null;
    const match =
      /Densit[ée]\s+nette\s*\(logement\s*\/\s*hectare\)\s+Minimum\s*(.*?)\s+Maximum\s+(\d+(?:[,.]\d+)?(?:\s*\/\s*\d+(?:[,.]\d+)?)?(?:\s+hectares?)?)/i.exec(folded);
    if (!match) continue;
    const proof = match[0]!;
    if (!zone) {
      refusals.push({ page, zoneCode: null, reason: "zone-absente-sur-la-page", proof });
      continue;
    }
    const raw = match[2]!.trim();
    // A ratio such as "1/50 hectares" is printed evidence, but converting it
    // would create a value not present verbatim in the document. Keep it only
    // as a documented refusal.
    if (raw.includes("/") || /\bhectares?\b/i.test(raw)) {
      refusals.push({
        page,
        zoneCode: zone,
        reason: "ratio-hectares-non-converti",
        proof,
      });
      continue;
    }
    const value = decimal(raw);
    if (value === null) {
      refusals.push({ page, zoneCode: zone, reason: "maximum-non-numerique", proof });
      continue;
    }
    readings.push({
      zoneCode: zone,
      value,
      unit: "log/ha",
      raw,
      proof,
      page,
    });
  }
  return consolidate(family, documentAnchored, projectExcluded, readings, refusals);
}
