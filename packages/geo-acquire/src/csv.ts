/**
 * Dependency-free RFC 4180 CSV parser plus a small column-mapping helper for
 * building {@link ReferentialFeatureCollection}s from tabular crosswalks
 * (postal code ↔ commune, INSEE/StatCan codes). Postal and statistical files
 * are frequently `;`-separated, so the delimiter is configurable.
 *
 * The parser handles:
 *   - quoted fields with embedded delimiters and newlines,
 *   - `""` as an escaped quote inside a quoted field,
 *   - CRLF and LF line endings (and a bare CR inside quotes),
 *   - a configurable single-character field delimiter,
 *   - a trailing newline (no spurious empty final row).
 */

import type {
  CsvNormalizer,
  ReferentialFeature,
} from "@sentropic/geo-core";

export interface ParseCsvOptions {
  /** Field delimiter. Defaults to "," (RFC 4180). Use ";" for many EU files. */
  delimiter?: string;
}

export interface ParsedCsv {
  /** Column names from the first record. */
  header: string[];
  /** Each subsequent record as a `{ column: value }` map. */
  rows: Record<string, string>[];
}

/**
 * Parse `text` as RFC 4180 CSV. The first record is treated as the header; each
 * following record becomes a `Record<string,string>` keyed by header column.
 * Rows with fewer fields than the header get `""` for missing columns; extra
 * fields beyond the header are dropped.
 */
export function parseCsv(text: string, opts: ParseCsvOptions = {}): ParsedCsv {
  const delimiter = opts.delimiter ?? ",";
  if (delimiter.length !== 1) {
    throw new Error(`parseCsv: delimiter must be a single character, got ${JSON.stringify(delimiter)}`);
  }
  const records = parseRecords(text, delimiter);
  if (records.length === 0) {
    return { header: [], rows: [] };
  }
  const header = records[0]!;
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]!] = fields[c] ?? "";
    }
    rows.push(row);
  }
  return { header, rows };
}

/**
 * Tokenize CSV text into an array of records, each an array of field strings.
 * A single trailing line terminator does not produce an empty final record.
 */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // whether the current record has any content yet

  const pushField = (): void => {
    record.push(field);
    field = "";
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      started = true;
      continue;
    }
    if (ch === "\r") {
      // Consume an optional following \n (CRLF) and end the record.
      if (text[i + 1] === "\n") i++;
      pushRecord();
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      continue;
    }
    field += ch;
    started = true;
  }

  // Flush a final record if the file does not end with a newline, or if a
  // field/record was started (handles a final unterminated line).
  if (started || field.length > 0 || record.length > 0) {
    pushRecord();
  }

  return records;
}

// `CsvNormalizer` now lives in geo-core (single source of truth for the
// normalizer types); re-exported here for back-compat.
export type { CsvNormalizer };

/** Map a source column to a {@link ReferentialProperties} key, optionally transforming the value. */
export interface CsvColumnMapping {
  /**
   * Property name → source column name. The mapped property receives the
   * (optionally transformed) value of that source column.
   */
  columns: Record<string, string>;
  /**
   * Property name whose value becomes the feature's `geoId` (and GeoJSON `id`).
   * Must be a key of {@link columns}. Optional.
   */
  idFrom?: string;
  /**
   * Whether to keep every original CSV column on the output properties in
   * addition to the mapped keys. Defaults to `false` (mapped keys only).
   */
  keepUnmapped?: boolean;
}

/**
 * Build a {@link CsvNormalizer} that maps named columns onto
 * {@link ReferentialProperties} with `geometry: null`. `mapping.columns` is a
 * `{ outputKey: sourceColumn }` map; `mapping.idFrom` (an output key) seeds the
 * feature `geoId`/`id`. The dataset's `country` (from the manifest) is attached
 * when available.
 */
export function csvColumnMapper(mapping: CsvColumnMapping): CsvNormalizer {
  return (rows, ctx) => {
    const country = ctx.manifest.jurisdiction.country;
    const features: ReferentialFeature[] = rows.map((row) => {
      const properties: ReferentialFeature["properties"] = mapping.keepUnmapped
        ? { ...row }
        : {};
      for (const [outKey, srcCol] of Object.entries(mapping.columns)) {
        properties[outKey] = row[srcCol] ?? "";
      }
      if (country) properties.country = country;

      let geoId: string | undefined;
      if (mapping.idFrom !== undefined) {
        const candidate = properties[mapping.idFrom];
        if (typeof candidate === "string" && candidate.length > 0) {
          geoId = candidate;
          properties.geoId = candidate;
        }
      }

      const feature: ReferentialFeature = {
        type: "Feature",
        geometry: null,
        properties,
      };
      if (geoId !== undefined) feature.id = geoId;
      return feature;
    });

    return { type: "FeatureCollection", features };
  };
}
