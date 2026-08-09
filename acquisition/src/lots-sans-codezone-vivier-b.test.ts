import { describe, expect, it } from "vitest";

import { causeForMissingLot } from "./lots-sans-codezone-vivier-b.js";

describe("causeForMissingLot", () => {
  it("should keep a missing zonage collection distinct from an unmaterialized fold", () => {
    expect(causeForMissingLot({
      zonageExists: false,
      zonageHasUsableCode: false,
      parquetRowExists: true,
      parquetZoneCode: "R-1",
    })).toBe("no_zonage_collection");
  });

  it("should keep a served zonage without codes distinct from geometric coverage", () => {
    expect(causeForMissingLot({
      zonageExists: true,
      zonageHasUsableCode: false,
      parquetRowExists: true,
      parquetZoneCode: null,
    })).toBe("zonage_without_usable_code");
  });

  it("should recognize an unserved parquet code as materialization stale", () => {
    expect(causeForMissingLot({
      zonageExists: true,
      zonageHasUsableCode: true,
      parquetRowExists: true,
      parquetZoneCode: "C-2",
    })).toBe("materialization_stale");
  });

  it("should report a null parquet code as geometry coverage without inventing one", () => {
    expect(causeForMissingLot({
      zonageExists: true,
      zonageHasUsableCode: true,
      parquetRowExists: true,
      parquetZoneCode: null,
    })).toBe("fold_computed_null_geometry_coverage");
  });

  it("should retain absent parquet rows as an explicit unknown residual", () => {
    expect(causeForMissingLot({
      zonageExists: true,
      zonageHasUsableCode: true,
      parquetRowExists: false,
      parquetZoneCode: null,
    })).toBe("lot_zone_fold_not_materialized");
  });
});
