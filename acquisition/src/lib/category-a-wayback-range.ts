import { z } from "zod";

export const WAYBACK_RANGE_BYTES = 1_048_576;
export const MAX_WAYBACK_RANGE_PARTS = 64;

const TargetSchema = z.object({
  slug: z.string().min(1),
  url: z.string().url().refine(
    (value) => /^https:\/\/web\.archive\.org\/web\/\d{14}(?:id_)?\/https?:\/\//i.test(value),
    "snapshot Wayback attendu",
  ),
  // `length` de CDX est la taille du record WARC et non, de façon fiable, la
  // taille décompressée du PDF. Elle reste une observation, jamais une borne.
  cdxLength: z.number().int().nonnegative().nullable(),
});

export const CategoryAWaybackRangeWorklistSchema = z.object({
  contract: z.literal("category-a-wayback-range/v1"),
  targets: z.array(TargetSchema).min(1),
});

export type CategoryAWaybackRangeTarget = z.infer<typeof TargetSchema>;
export type CategoryAWaybackRangeWorklist = z.infer<
  typeof CategoryAWaybackRangeWorklistSchema
>;

export function parseCategoryAWaybackRangeWorklist(
  value: unknown,
): CategoryAWaybackRangeWorklist {
  return CategoryAWaybackRangeWorklistSchema.parse(value);
}

export interface CategoryAWaybackRangeRequest {
  start: number;
  end: number;
  last: boolean;
}

export function categoryAWaybackRangeRequests(
  totalLength: number,
): CategoryAWaybackRangeRequest[] {
  if (
    !Number.isInteger(totalLength)
    || totalLength <= WAYBACK_RANGE_BYTES
    || totalLength > WAYBACK_RANGE_BYTES * (MAX_WAYBACK_RANGE_PARTS + 1)
  ) return [];
  const out: CategoryAWaybackRangeRequest[] = [];
  for (let start = WAYBACK_RANGE_BYTES; start < totalLength; start += WAYBACK_RANGE_BYTES) {
    const end = Math.min(totalLength - 1, start + WAYBACK_RANGE_BYTES - 1);
    out.push({ start, end, last: end === totalLength - 1 });
  }
  return out;
}

export interface WaybackSnapshotIdentity {
  timestamp: string;
  originalUrl: string;
}

export function waybackSnapshotIdentity(url: string): WaybackSnapshotIdentity | null {
  const match = /^https:\/\/web\.archive\.org\/web\/(\d{14})(?:id_)?\/(https?:\/\/.+)$/i.exec(url);
  if (!match) return null;
  try {
    return { timestamp: match[1]!, originalUrl: new URL(match[2]!).href };
  } catch {
    return null;
  }
}

export function waybackArchiveKey(timestamp: string, originalUrl: string): string | null {
  if (!/^\d{14}$/.test(timestamp)) return null;
  try {
    return `${timestamp}\t${new URL(originalUrl).href}`;
  } catch {
    return null;
  }
}

export function cdxLengthIndex(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(value) || !Array.isArray(value[0])) return out;
  const header = value[0].map(String);
  const originalIndex = header.indexOf("original");
  const timestampIndex = header.indexOf("timestamp");
  const lengthIndex = header.indexOf("length");
  if (originalIndex < 0 || timestampIndex < 0 || lengthIndex < 0) return out;
  for (const row of value.slice(1)) {
    if (!Array.isArray(row)) continue;
    const key = waybackArchiveKey(
      String(row[timestampIndex] ?? ""),
      String(row[originalIndex] ?? ""),
    );
    const length = Number(row[lengthIndex]);
    if (key !== null && Number.isInteger(length) && length >= 0) out.set(key, length);
  }
  return out;
}
