import { describe, expect, it } from "vitest";

import { selectBalancedPvControl, selectPvControlBatch } from "./pv-graphify-control.js";

describe("selectBalancedPvControl", () => {
  it("distributes twenty PV across all seven available municipalities with a maximum gap of one", () => {
    const candidates = [
      ...["albertville", "amherst", "armagh", "arundel", "aston-jonction", "auclair"].flatMap((slug) =>
        [1, 2, 3].map((index) => ({ slug, storage_key: `${slug}-${index}` }))),
      ...[1, 2, 3].map((index) => ({ slug: "audet", storage_key: `audet-${index}` })),
    ];

    const selected = selectBalancedPvControl(candidates, 20);
    const perMunicipality = Object.fromEntries(
      [...selected.reduce((counts, candidate) => {
        counts.set(candidate.slug, (counts.get(candidate.slug) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())].sort(),
    );

    expect(selected).toHaveLength(20);
    expect(perMunicipality).toEqual({
      albertville: 3,
      amherst: 3,
      armagh: 3,
      arundel: 3,
      "aston-jonction": 3,
      auclair: 3,
      audet: 2,
    });
  });

  it("keeps the result stable regardless of input order", () => {
    const candidates = [
      { slug: "b", storage_key: "b-2" },
      { slug: "a", storage_key: "a-2" },
      { slug: "b", storage_key: "b-1" },
      { slug: "a", storage_key: "a-1" },
    ];

    expect(selectBalancedPvControl(candidates, 3).map((candidate) => candidate.storage_key))
      .toEqual(["a-1", "b-1", "a-2"]);
  });

  it("selects a stable short batch that can be re-run after interruption", () => {
    const candidates = [
      { slug: "b", storage_key: "b-2" },
      { slug: "a", storage_key: "a-2" },
      { slug: "b", storage_key: "b-1" },
      { slug: "a", storage_key: "a-1" },
      { slug: "c", storage_key: "c-1" },
    ];

    expect(selectPvControlBatch(candidates, 2, 2)).toEqual({
      batch_index: 2,
      batch_size: 2,
      batch_count: 3,
      candidates: [
        { slug: "b", storage_key: "b-1" },
        { slug: "b", storage_key: "b-2" },
      ],
    });
  });
});
