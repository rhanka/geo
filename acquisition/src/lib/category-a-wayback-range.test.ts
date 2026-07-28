import { describe, expect, it } from "vitest";

import {
  WAYBACK_RANGE_BYTES,
  categoryAWaybackRangeRequests,
  cdxLengthIndex,
  waybackArchiveKey,
  waybackSnapshotIdentity,
} from "./category-a-wayback-range.js";

describe("category A Wayback byte ranges", () => {
  it("materializes contiguous requests with one explicit final part", () => {
    expect(categoryAWaybackRangeRequests(WAYBACK_RANGE_BYTES * 2 + 7)).toEqual([
      { start: WAYBACK_RANGE_BYTES, end: WAYBACK_RANGE_BYTES * 2 - 1, last: false },
      { start: WAYBACK_RANGE_BYTES * 2, end: WAYBACK_RANGE_BYTES * 2 + 6, last: true },
    ]);
  });

  it("joins a snapshot to the captured CDX length without using its timestamp as a date", () => {
    const url =
      "https://web.archive.org/web/20210512010742id_/http://ville.example/reglement.pdf";
    const identity = waybackSnapshotIdentity(url);
    expect(identity).toEqual({
      timestamp: "20210512010742",
      originalUrl: "http://ville.example/reglement.pdf",
    });
    const lengths = cdxLengthIndex([
      ["original", "timestamp", "length"],
      ["http://ville.example/reglement.pdf", "20210512010742", "3000000"],
    ]);
    expect(lengths.get(waybackArchiveKey(
      identity!.timestamp,
      identity!.originalUrl,
    )!)).toBe(3_000_000);
  });
});
