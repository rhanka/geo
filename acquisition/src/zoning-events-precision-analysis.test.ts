/** Network-free unit coverage for the qc-zoning-events precision analysis. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runPrecisionAnalysis } from "./zoning-events-precision-analysis.js";

const geo = (type: string, excerpt?: string) => ({
  side: "geo",
  natural_key: {
    muni: "alpha",
    source_url_norm: "https://alpha.test/pv.pdf",
    date_iso: "2026-02-10",
    type,
  },
  secondary_natural_key: null,
  source_fields: {
    event_id: `geo-${type}`,
    muni: "alpha",
    source_url: "https://alpha.test/pv.pdf",
    date_iso: "2026-02-10",
    type,
    bylaw_numero: null,
    zone_ref: null,
    no_lot: null,
    ...(excerpt === undefined ? {} : { extrait_brut: excerpt }),
  },
});

describe("runPrecisionAnalysis", () => {
  it("should measure naive precision and classify every extra into the closed evidence partition", () => {
    const directory = mkdtempSync(join(tmpdir(), "zoning-events-precision-"));
    try {
      const gatePath = join(directory, "gate.json");
      const immoPath = join(directory, "immo.ndjson");
      const outPath = join(directory, "precision.json");
      writeFileSync(gatePath, JSON.stringify({
        contract: "qc-zoning-events-recall-gate/v1",
        cities: [{
          slug: "alpha",
          matched: 2,
          extra: 3,
          partition: {
            extra: [
              { geo: geo("ppcmoi", "Verbatim ppcmoi") },
              { geo: { ...geo("derogation"), natural_key: { ...geo("derogation").natural_key, date_iso: "2026-02-11" } } },
              { geo: { ...geo("autre"), natural_key: { ...geo("autre").natural_key, source_url_norm: "https://alpha.test/other.pdf" } } },
            ],
          },
        }],
      }));
      writeFileSync(immoPath, `${JSON.stringify({
        node_type: "DesignationEvent",
        city_slug: "alpha",
        kind: "rezonage",
        date: "2026-02-10",
        source_url: "https://alpha.test/pv.pdf",
      })}\n`);

      const result = runPrecisionAnalysis({
        gatePath,
        immoEventsPath: immoPath,
        outPath,
        generatedAt: "2026-08-02T00:00:00.000Z",
      });

      expect(result.report.aggregate).toMatchObject({
        matched: 2,
        extra: 3,
        precision_naive: 0.4,
        extras: {
          residual_taxonomy: 1,
          shared_doc_immo_undercount: 1,
          geo_only_doc: 1,
        },
      });
      expect(result.report.samples.residual_taxonomy[0]).toMatchObject({
        natural_key: { type: "ppcmoi" },
        extrait_brut: "Verbatim ppcmoi",
      });
      expect(JSON.parse(readFileSync(result.output, "utf8"))).toMatchObject({
        contract: "qc-zoning-events-precision-analysis/v1",
      });
      expect(readFileSync(result.markdownOutput, "utf8")).toContain("Précision naïve agrégée : 0.4000");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
