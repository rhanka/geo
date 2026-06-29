import { expect, test } from "vitest";

import {
  VALLEYFIELD_PRIORITY_SOURCE_BINDINGS,
  getPrioritySourceBinding,
} from "./prioritySources.js";

test("Valleyfield priority bindings model the scraping plan top five", () => {
  expect(VALLEYFIELD_PRIORITY_SOURCE_BINDINGS.map((source) => source.sourceId)).toEqual([
    "avis-publics-valleyfield",
    "reglements-urbanisme-valleyfield",
    "roles-evaluation-fonciere-mamh",
    "donnees-quebec-catalog",
    "adresses-quebec-igo-geocoder",
    "cptaq-zone-agricole",
  ]);

  expect(
    VALLEYFIELD_PRIORITY_SOURCE_BINDINGS.map((source) => [
      source.priority,
      source.kind,
      source.recommendation,
    ]),
  ).toEqual([
    [1, "avis-publics", "build-now"],
    [2, "reglement", "build-now"],
    [3, "role-evaluation", "build-now"],
    [4, "donnees-quebec", "build-now"],
    [4, "adresses-quebec", "build-now"],
    [5, "cptaq", "build-now"],
  ]);
});

test("priority bindings are addressable by source id", () => {
  expect(getPrioritySourceBinding("avis-publics-valleyfield")?.city).toBe(
    "salaberry-de-valleyfield",
  );
  expect(getPrioritySourceBinding("unknown-source")).toBeUndefined();
});

test("collectible terrAPI / Adresses Québec adapters resolve per city (WP4 #4)", () => {
  const vf = getPrioritySourceBinding("adresses-quebec-70052");
  expect(vf?.kind).toBe("adresses-quebec");
  expect(vf?.city).toBe("salaberry-de-valleyfield");
  const beau = getPrioritySourceBinding("adresses-quebec-70022");
  expect(beau?.kind).toBe("adresses-quebec");
  expect(beau?.city).toBe("beauharnois");
});
