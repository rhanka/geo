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
  const projectExcluded =
    /(?:^|\n)\s*(?:1\s*er|premier|second|deuxi[èe]me)?\s*projet\s+de\s+r[èe]glement\b/im
      .test(text.slice(0, 30_000));
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
