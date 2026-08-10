import { describe, expect, it } from "vitest";

import { bprimeJoinKey, classifyBucket, parseBprimeTsv, type ZoneSignal } from "./qa-overlap-bprime167.js";

describe("B' 167 versus geo overlap", () => {
  it("should ignore comments, parse the header, and retain an UNMATCHED row verbatim", () => {
    const rows = parseBprimeTsv([
      "# frozen conductor input",
      "# graph_city_slug is authoritative; UNMATCHED rows fall back to slug",
      "slug\tname\tpriorityRank\tgraph_version\tgraph_city_slug\tmatch",
      "alpha\tAlpha\t1\t2.3\talpha\texact",
      "raw-slug\tRaw city\t2\tnone\t\tUNMATCHED",
    ].join("\n"));

    expect(rows).toEqual([
      { slug: "alpha", name: "Alpha", priorityRank: 1, graph_version: "2.3", graph_city_slug: "alpha", match: "exact" },
      { slug: "raw-slug", name: "Raw city", priorityRank: 2, graph_version: "none", graph_city_slug: "", match: "UNMATCHED" },
    ]);
  });

  it("should prefer graph_city_slug and fall back to slug only for empty or UNMATCHED graph rows", () => {
    const rows = parseBprimeTsv([
      "slug\tname\tpriorityRank\tgraph_version\tgraph_city_slug\tmatch",
      "saint-damase-les-maskoutains\tSaint-Damase\t1\t2.3\tsaint-damase--les-maskoutains\tnormalized",
      "without-graph\tWithout graph\t2\tnone\t\tUNMATCHED",
      "unmatched-overrides-graph\tUnmatched graph\t3\tnone\tgraph-only\tUNMATCHED",
    ].join("\n"));
    const geoSet = new Set<string>();
    const zonesMap = new Map<string, ZoneSignal>([
      ["saint-damase--les-maskoutains", { url: "https://example.test/dead", classification: "DEAD" }],
    ]);

    expect(rows.map(bprimeJoinKey)).toEqual([
      "saint-damase--les-maskoutains",
      "without-graph",
      "unmatched-overrides-graph",
    ]);
    expect(classifyBucket(bprimeJoinKey(rows[0]), geoSet, zonesMap)).toBe("proof_v1_dead");
  });

  it("should apply the four evidence buckets by precedence with exact slug equality", () => {
    const geoSet = new Set(["already-verifiable"]);
    const zonesMap = new Map<string, ZoneSignal>([
      ["already-verifiable", { url: "https://example.test/also-live", classification: "LIVE" }],
      ["v1-live", { url: "https://example.test/live", classification: "LIVE" }],
      ["v1-dead", { url: "https://example.test/dead", classification: "DEAD" }],
      ["v1-ambiguous", { url: "https://example.test/ambiguous", classification: "AMBIGU" }],
      ["graph-only", { url: "https://example.test/graph", classification: "LIVE" }],
    ]);

    expect(classifyBucket("already-verifiable", geoSet, zonesMap)).toBe("proof_live_verifiable");
    expect(classifyBucket("v1-live", geoSet, zonesMap)).toBe("proof_v1_live");
    expect(classifyBucket("v1-dead", geoSet, zonesMap)).toBe("proof_v1_dead");
    expect(classifyBucket("v1-ambiguous", geoSet, zonesMap)).toBe("proof_v1_dead");
    expect(classifyBucket("no-proof", geoSet, zonesMap)).toBe("no_proof_url_signal");
    expect(classifyBucket("raw-slug", geoSet, zonesMap)).toBe("no_proof_url_signal");
  });
});
