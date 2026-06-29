/**
 * Parquet writers for the acquisition outputs, replacing the Python
 * pyarrow/pandas writers.
 *
 * Consumer note (load-bearing): the `registry/index-immo/*.parquet` and
 * `registry/role-foncier/*.parquet` files are read by the EXTERNAL `immo`
 * (radar-immobilier) pipeline via a pyarrow/pandas reader, which accepts any
 * Parquet codec. The byte-exact compression codec is therefore NOT load-bearing
 * — only the logical schema (column names + Parquet primitive/logical types)
 * and the cell values are. We write SNAPPY (same codec pandas emits by default
 * for the role parquet; the Python index writer used ZSTD, but the values and
 * schema are identical — see ROLE-foncier.md / build_index_immo.OUT_SCHEMA).
 *
 * `@dsnp/parquetjs` cannot DECODE ZSTD, so for the TS-vs-Python equivalence
 * checks we read the legacy Python ZSTD files with `hyparquet` and the
 * freshly-written TS files with either reader.
 */
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

/** Logical column type for the role-foncier (variable) schema. */
export type ColType = "UTF8" | "DOUBLE" | "BOOLEAN" | "INT64";

/**
 * Fixed schema for `registry/index-immo/<slug>.parquet`, byte-identical in
 * meaning to Python `build_index_immo.PA_FIELDS` (strings = UTF8 BYTE_ARRAY,
 * numerics = DOUBLE; every column optional/nullable, anti-invention).
 */
export const INDEX_IMMO_SCHEMA = new ParquetSchema({
  feature_id: { type: "UTF8", optional: true, compression: "SNAPPY" },
  no_lot: { type: "UTF8", optional: true, compression: "SNAPPY" },
  code_zone: { type: "UTF8", optional: true, compression: "SNAPPY" },
  role_usage_cubf: { type: "UTF8", optional: true, compression: "SNAPPY" },
  role_nb_etages_max: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  role_annee_construction: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  role_superficie_batiment_m2: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  role_nb_logements: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  role_valeur_immeuble: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  _source: { type: "UTF8", optional: true, compression: "SNAPPY" },
  _snapshot: { type: "UTF8", optional: true, compression: "SNAPPY" },
});

/** Column order of the fixed index-immo schema (used by the writer + tests). */
export const INDEX_IMMO_COLUMNS = [
  "feature_id",
  "no_lot",
  "code_zone",
  "role_usage_cubf",
  "role_nb_etages_max",
  "role_annee_construction",
  "role_superficie_batiment_m2",
  "role_nb_logements",
  "role_valeur_immeuble",
  "_source",
  "_snapshot",
] as const;

export type IndexImmoRow = Record<(typeof INDEX_IMMO_COLUMNS)[number], unknown>;

/** Write index-immo rows to a local parquet file. Returns the row count. */
export async function writeIndexImmoParquet(
  rows: IndexImmoRow[],
  path: string,
): Promise<number> {
  const writer = await ParquetWriter.openFile(INDEX_IMMO_SCHEMA, path);
  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const c of INDEX_IMMO_COLUMNS) {
      const v = r[c];
      // parquetjs treats `null`/`undefined` as absent for optional fields.
      out[c] = v === null || v === undefined ? undefined : v;
    }
    await writer.appendRow(out);
  }
  await writer.close();
  return rows.length;
}

/**
 * Infer a parquet schema for the role-foncier variable rows the same way
 * `pandas.DataFrame(rows)` + `pyarrow.Table.from_pandas` would: the column set
 * is the UNION of all property keys (so a value missing on some rows is still a
 * declared, nullable column), and the type is decided by the first non-null
 * value seen for that column.
 *
 *   number that is an integer across all rows  -> INT64 (pandas int64)…
 *   number with any fractional/None value      -> DOUBLE (pandas float64)
 *   boolean                                     -> BOOLEAN
 *   everything else                             -> UTF8
 *
 * pandas promotes an int column to float64 as soon as a null appears, so we
 * follow the same rule: a column with any null OR any fractional value is
 * DOUBLE; a column whose every present value is an integer is INT64.
 */
export function inferRoleSchema(rows: Record<string, unknown>[]): {
  schema: ParquetSchema;
  columns: string[];
  types: Record<string, ColType>;
} {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }

  const types: Record<string, ColType> = {};
  for (const c of columns) {
    let anyNull = false;
    let anyNumber = false;
    let anyFractional = false;
    let anyBool = false;
    let anyString = false;
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined) {
        anyNull = true;
        continue;
      }
      if (typeof v === "boolean") anyBool = true;
      else if (typeof v === "number") {
        anyNumber = true;
        if (!Number.isInteger(v)) anyFractional = true;
      } else anyString = true;
    }
    if (anyString || (!anyNumber && !anyBool)) types[c] = "UTF8";
    else if (anyBool && !anyNumber) types[c] = "BOOLEAN";
    else if (anyNumber && (anyFractional || anyNull)) types[c] = "DOUBLE";
    else types[c] = "INT64";
  }

  const fields: Record<string, { type: ColType; optional: boolean; compression: "SNAPPY" }> = {};
  for (const c of columns) {
    fields[c] = { type: types[c]!, optional: true, compression: "SNAPPY" };
  }
  return { schema: new ParquetSchema(fields as never), columns, types };
}

/** Write role-foncier (variable schema) rows to a local parquet. */
export async function writeRoleParquet(
  rows: Record<string, unknown>[],
  path: string,
): Promise<{ rows: number; columns: string[] }> {
  const { schema, columns, types } = inferRoleSchema(rows);
  const writer = await ParquetWriter.openFile(schema, path);
  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      let v = r[c];
      if (v === null || v === undefined) {
        out[c] = undefined;
        continue;
      }
      // Coerce to the declared column type (a column promoted to DOUBLE must
      // not receive an INT64 cell, etc.).
      const t = types[c];
      if (t === "UTF8" && typeof v !== "string") v = String(v);
      else if (t === "DOUBLE" && typeof v === "number") v = v;
      else if (t === "INT64" && typeof v === "number") v = BigInt(Math.trunc(v));
      out[c] = v;
    }
    await writer.appendRow(out);
  }
  await writer.close();
  return { rows: rows.length, columns };
}
