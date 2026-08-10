import { describe, expect, it } from "vitest";

import {
  buildHandoff,
  type HandoffArtifact,
  type ReadinessArtifact,
} from "./reglement-double-millesime-handoff.js";

const readiness: ReadinessArtifact = {
  partition: { counts: { ANCIEN_VERBATIM: 2 } },
  ancien_verbatim: [
    {
      slug: "alpha",
      en_vigueur_numero: "R-2024",
      en_vigueur_millesime: null,
      ancien_numero_verbatim: "Ancien  42",
      _note_span: { start: 4, end: 42, text: "Remplace le règlement Ancien  42." },
    },
    {
      slug: "beta",
      en_vigueur_numero: "B-7",
      en_vigueur_millesime: "2019",
      ancien_numero_verbatim: "B-1",
      _note_span: { start: 60, end: 90, text: "Abroge le règlement B-1." },
    },
  ],
};

function handoff(): HandoffArtifact {
  return buildHandoff(readiness, {
    path: "fixture/readiness.json",
    sha256: "fixture-sha256",
    commit_hint: "0ff0a680",
  }, "2026-08-02T00:00:00.000Z");
}

describe("reglement double-millesime handoff", () => {
  it("derives the handoff form and count from the two-entry readiness fixture", () => {
    const result = handoff();
    expect(result).toMatchObject({
      contract: "reglement-double-millesime-handoff/v1",
      as_of: "2026-08-02T00:00:00.000Z",
      count: readiness.ancien_verbatim.length,
    });
    expect(result.entries).toHaveLength(readiness.ancien_verbatim.length);
  });

  it("preserves numero_ancien and clause_verbatim byte-for-byte", () => {
    const result = handoff();
    expect(result.entries[0]).toMatchObject({
      numero_ancien: "Ancien  42",
      clause_verbatim: "Remplace le règlement Ancien  42.",
      note_span: { start: 4, end: 42 },
    });
  });

  it("always leaves millesime_ancien null", () => {
    expect(handoff().entries.every((entry) => entry.millesime_ancien === null)).toBe(true);
  });

  it("never fabricates zone_ref", () => {
    expect(handoff().entries.every((entry) => entry.zone_ref === null)).toBe(true);
  });

  it("preserves en-vigueur millesimes including null", () => {
    expect(handoff().entries.map((entry) => entry.millesime_en_vigueur)).toEqual([null, "2019"]);
  });
});
