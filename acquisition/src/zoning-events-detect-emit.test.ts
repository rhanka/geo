import { describe, expect, it } from "vitest";

import {
  buildZoningEventsDryRunDocument,
  type DetectedEventCandidate,
  type ServedZoneCodesResult,
} from "./zoning-events-detect-emit.js";

const candidate: DetectedEventCandidate = {
  source_ref: "raw/pv-index/cas/abc.pdf",
  detection_anchor: "resolution:26-02-38263",
  type: "ppcmoi",
  date_iso: "2026-02-09",
  bylaw_numero: "26-02-38263",
  zone_mentions: [{ mention_brute: "rd 104", page: 25 }],
  extrait_brut: "PPCMOI: permettre la construction dans la zone RD-104.",
  url_pdf: "https://www.coaticook.ca/upload/DOCUMENTS/PV/PV20260209.pdf",
};

describe("buildZoningEventsDryRunDocument", () => {
  it("builds a validated complete document with a stable id and an EXACT_GEOM zone", () => {
    const zones: ServedZoneCodesResult = {
      state: "loaded",
      sourceKey: "normalized/ca-qc-zonage/qc-zonage-coaticook/qc-zonage-coaticook.geojson",
      zoneCodes: ["RD-104"],
    };
    const document = buildZoningEventsDryRunDocument("coaticook", [candidate], zones, "2026-08-02T12:00:00.000Z");
    expect(document).toMatchObject({ type: "FeatureCollection", complete: true, muni: "coaticook" });
    expect(document.events).toHaveLength(1);
    expect(document.events[0]).toMatchObject({
      detection_state: "detected",
      zone_codes_resolus: [{ zone_code: "RD-104", score_confiance: 1, provenance: "exact_geom" }],
      zone_codes_non_resolus: [],
    });
    expect(document.features[0]?.properties.event_id).toBe(document.events[0]?.event_id);
  });

  it("keeps a non-match out of the resolved set instead of applying a fuzzy score", () => {
    const zones: ServedZoneCodesResult = { state: "loaded", sourceKey: "s3://zones", zoneCodes: ["HC-15"] };
    const document = buildZoningEventsDryRunDocument("coaticook", [candidate], zones, "2026-08-02T12:00:00.000Z");
    expect(document.events[0]?.zone_codes_resolus).toEqual([]);
    expect(document.events[0]?.zone_codes_non_resolus).toEqual([
      { mention_brute: "rd 104", page: 25, raison: "no-exact-match" },
    ]);
  });

  it("names an unavailable served zone set as detection-incomplete", () => {
    const zones: ServedZoneCodesResult = { state: "unavailable", reason: "S3 qc-zonage-coaticook absent" };
    const document = buildZoningEventsDryRunDocument("coaticook", [candidate], zones, "2026-08-02T12:00:00.000Z");
    expect(document.events[0]).toMatchObject({
      detection_state: "detection_incomplete",
      zone_codes_resolus: [],
      zone_codes_non_resolus: [{ mention_brute: "rd 104", page: 25, raison: "detection-incomplete" }],
    });
  });
});
