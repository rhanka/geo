import { describe, expect, it } from "vitest";

import { buildGeoReceipt, serializeGeoReceipt, type GeoReceiptInput } from "./geo-receipt.js";

const base: GeoReceiptInput = {
  cycleId: "iso-prod-2026-09-25",
  watermark: "iso-prod-2026-09-25",
  at: "2026-09-25T12:00:00.000Z",
  irremplacable: { inventoryKey: "geo-objects/prod/sets/iso-prod-2026-09-25/inventory.json", sha256set: "abc", count: 44 },
  servi: {
    prefix: "geo-objects/prod/sets/iso-prod-2026-09-25",
    servedCount: 3885,
    setHash: "def",
    servedIdsKey: "geo-objects/prod/sets/iso-prod-2026-09-25/served-ids.ndjson.gz",
    sha256: "1c12",
  },
};

describe("buildGeoReceipt", () => {
  it("assembles the three legs with per-leg timestamps and a null pg by default", () => {
    const r = buildGeoReceipt(base);
    expect(r.tenant).toBe("geo");
    expect(r.cycleId).toBe("iso-prod-2026-09-25");
    expect(r.legs.pg).toBeNull(); // re-derivable, no preprod restore target
    expect(r.legs.s3_irremplacable).toEqual({
      inventory_key: base.irremplacable.inventoryKey,
      sha256set: "abc",
      count: 44,
      at: base.at,
    });
    expect(r.legs.s3_servi.served_ids_key).toBe(base.servi.servedIdsKey);
    expect(r.legs.s3_servi.at).toBe(base.at);
  });

  it("carries a DR pg dump leg + snapshotAt when provided", () => {
    const r = buildGeoReceipt({
      ...base,
      snapshotAt: "2026-09-25T11:59:00.000Z",
      pg: { key: "geo-postgres/prod/sets/x/geo.dump", sha256: "pgsha", size: 139_000_000 },
    });
    expect(r.snapshotAt).toBe("2026-09-25T11:59:00.000Z");
    expect(r.legs.pg).toEqual({ key: "geo-postgres/prod/sets/x/geo.dump", sha256: "pgsha", size: 139_000_000, at: base.at });
  });

  it("fails closed on missing required fields", () => {
    expect(() => buildGeoReceipt({ ...base, cycleId: "" })).toThrow(/cycleId/);
    expect(() => buildGeoReceipt({ ...base, servi: { ...base.servi, setHash: "" } })).toThrow(/setHash/);
    expect(() => buildGeoReceipt({ ...base, irremplacable: { ...base.irremplacable, count: -1 } })).toThrow(/count/);
  });
});

describe("serializeGeoReceipt", () => {
  it("is deterministic, newline-terminated, and round-trips", () => {
    const s = serializeGeoReceipt(buildGeoReceipt(base));
    expect(s.endsWith("\n")).toBe(true);
    expect(serializeGeoReceipt(buildGeoReceipt(base))).toBe(s); // deterministic
    expect(JSON.parse(s).tenant).toBe("geo");
  });
});
