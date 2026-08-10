import { describe, expect, it } from "vitest";

import {
  completedZonesArcgisCaptureJob,
  type KubernetesJobObservation,
} from "./zones-arcgis-replacement-kubernetes-job.js";

const expected = {
  runId: "zones-20260810T020304Z-audet",
  namespace: "geo",
  slug: "audet",
};

function completedJob(overrides: KubernetesJobObservation = {}): KubernetesJobObservation {
  return {
    metadata: {
      name: "geo-zarc-20260810t020304z-0123456789ab",
      namespace: "geo",
      labels: {
        app: "geo-zones-arcgis-replacement-capture",
        lane: "zones",
        "geo.city": "audet",
        "geo.run-id": "zones-20260810T020304Z-audet",
      },
      ...overrides.metadata,
    },
    status: {
      succeeded: 1,
      failed: 0,
      completionTime: "2026-08-10T02:03:06.000Z",
      ...overrides.status,
    },
  };
}

describe("zones ArcGIS replacement Kubernetes Job receipt", () => {
  it("accepts only the exact labelled completed capture Job", () => {
    expect(completedZonesArcgisCaptureJob(completedJob(), expected)).toEqual({
      runId: expected.runId,
      succeeded: 1,
      failed: 0,
      completionTime: "2026-08-10T02:03:06.000Z",
    });
  });

  it("refuses a completed Job for another run, city, namespace, or lane", () => {
    for (const job of [
      completedJob({ metadata: { labels: { app: "geo-zones-arcgis-replacement-capture", lane: "zones", "geo.city": "audet", "geo.run-id": "zones-other" } } }),
      completedJob({ metadata: { labels: { app: "geo-zones-arcgis-replacement-capture", lane: "zones", "geo.city": "other", "geo.run-id": expected.runId } } }),
      completedJob({ metadata: { namespace: "other" } }),
      completedJob({ metadata: { labels: { app: "geo-zones-arcgis-replacement-capture", lane: "normes", "geo.city": "audet", "geo.run-id": expected.runId } } }),
    ]) {
      expect(() => completedZonesArcgisCaptureJob(job, expected)).toThrow(/do not attest|another namespace/);
    }
  });

  it("refuses unsuccessful, retried, or timestamp-less Kubernetes status", () => {
    for (const job of [
      completedJob({ status: { succeeded: 0 } }),
      completedJob({ status: { failed: 1 } }),
      completedJob({ status: { completionTime: "not-a-date" } }),
    ]) {
      expect(() => completedZonesArcgisCaptureJob(job, expected)).toThrow(/not exactly one completed success/);
    }
  });
});
