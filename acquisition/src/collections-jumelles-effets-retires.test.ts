import { describe, expect, it } from "vitest";

import { scanEffectFieldChunks } from "./collections-jumelles-effets-retires.js";

describe("scanEffectFieldChunks", () => {
  it("counts only exact effet_densifiant keys across range boundaries", () => {
    const json = Buffer.from(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { properties: { effet_densifiant: "densifie" } },
        { properties: { effet_densifiant: "inconnu" } },
        { properties: { note: 'texte qui cite "effet_densifiant":"reduit" sans être une propriété' } },
        { properties: { effet_densifiant: "reduit" } },
      ],
    }));
    const split = json.indexOf(Buffer.from('"effet_densifiant"')) + 9;
    const observed = scanEffectFieldChunks([json.subarray(0, split), json.subarray(split)]);

    expect(observed).toEqual({
      feature_count: null,
      effect_value_counts: { densifie: 1, inconnu: 1, reduit: 1 },
      non_unknown_effect_feature_count: 2,
    });
  });
});
