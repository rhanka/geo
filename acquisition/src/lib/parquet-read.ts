/**
 * Parquet reader that tolerates both SNAPPY/UNCOMPRESSED (via @dsnp/parquetjs)
 * and ZSTD (via hyparquet) parquet files — the legacy Python index writer used
 * ZSTD, the role writer used pandas-default SNAPPY. Returns plain JS row
 * objects, one per record.
 */
import { readFileSync } from "node:fs";

import { ParquetReader } from "@dsnp/parquetjs";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

/** Read all rows from a local parquet file as objects. `columns` optionally
 * restricts the projection (hyparquet path honours it; the dsnp path returns
 * all columns then we project). */
export async function readParquetRows(
  path: string,
  columns?: string[],
): Promise<Record<string, unknown>[]> {
  // Try @dsnp first (handles SNAPPY/UNCOMPRESSED/GZIP).
  try {
    const reader = await ParquetReader.openFile(path);
    const cursor = reader.getCursor(columns as never);
    const rows: Record<string, unknown>[] = [];
    let row: Record<string, unknown> | null;
    while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
      if (Object.keys(row).length === 0) break;
      rows.push(row);
    }
    await reader.close();
    return rows;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (!/ZSTD|invalid compression/i.test(msg)) throw e;
  }
  // Fall back to hyparquet for ZSTD.
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const rows = (await parquetReadObjects({
    file: ab,
    compressors,
    ...(columns ? { columns } : {}),
  })) as Record<string, unknown>[];
  return rows;
}

/** Read all rows from an in-memory parquet buffer. */
export async function readParquetRowsFromBuffer(
  buf: Buffer,
  columns?: string[],
): Promise<Record<string, unknown>[]> {
  // hyparquet works directly on ArrayBuffer and handles ZSTD + SNAPPY.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  try {
    return (await parquetReadObjects({
      file: ab,
      compressors,
      ...(columns ? { columns } : {}),
    })) as Record<string, unknown>[];
  } catch {
    // Fall back to writing a temp file and using @dsnp.
    const { writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = join(tmpdir(), `_pq_${Date.now()}_${Math.random().toString(36).slice(2)}.parquet`);
    writeFileSync(tmp, buf);
    try {
      return await readParquetRows(tmp, columns);
    } finally {
      (await import("node:fs")).unlinkSync(tmp);
    }
  }
}
