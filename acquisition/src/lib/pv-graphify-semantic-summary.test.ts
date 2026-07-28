import { describe, expect, it } from "vitest";

import { summarizePvGraphifySemantic } from "./pv-graphify-semantic-summary.js";

describe("summarizePvGraphifySemantic", () => {
  it("deduplicates the classification universe by CAS key before measuring its indexed remainder", () => {
    const summary = summarizePvGraphifySemantic([
      {
        path: "classification-a.json",
        value: {
          lines: [
            { classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", storage_key: "cas/a" },
            { classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", storage_key: "cas/b" },
            { classification: "PDF_SANS_COUCHE_TEXTE", storage_key: "cas/ignored" },
          ],
        },
      },
      {
        path: "classification-b.json",
        value: {
          lines: [
            { classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", storage_key: "cas/b" },
            { classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", storage_key: "cas/c" },
          ],
        },
      },
    ], [
      {
        path: "graphify-a.json",
        value: {
          documents: [
            { storage_key: "cas/a", entity_counts: { Document: 1, Zone: 1 }, graphify: { exit_code: 0, nodes: 2, edges: 1 } },
            { storage_key: "cas/b", entity_counts: { Document: 1 }, graphify: { exit_code: 0, nodes: 0, edges: 0 } },
          ],
        },
      },
      {
        path: "graphify-b.json",
        value: {
          documents: [
            { storage_key: "cas/c", entity_counts: { Document: 1 }, graphify: { exit_code: 1, nodes: 0, edges: 0 } },
          ],
        },
      },
    ]);

    expect(summary).toMatchObject({
      eligible_records: 4,
      unique_captured_pvs: 3,
      duplicate_eligible_records: 1,
      processed_pvs: 3,
      indexed_pvs: 2,
      unindexed_pvs: 1,
      graphify_failures: 1,
      zero_node_pvs: 1,
      graph: { nodes: 2, edges: 1 },
      entity_counts: { Document: 2, Zone: 1 },
    });
  });

  it("rejects a Graphify document outside the classified universe", () => {
    expect(() => summarizePvGraphifySemantic([
      { path: "classification.json", value: { lines: [] } },
    ], [
      {
        path: "graphify.json",
        value: {
          documents: [
            { storage_key: "cas/unclassified", entity_counts: {}, graphify: { exit_code: 0, nodes: 0, edges: 0 } },
          ],
        },
      },
    ])).toThrow("absent de l'univers de classification");
  });
});
