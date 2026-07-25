/**
 * DOM tests for `GeoSearch` (jsdom — DOM only). Cover the NFD/accent-insensitive
 * substring match, the emitted match set (`onQuery`) and pick (`onPick`), the
 * listbox semantics, and the `foldText` helper.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import type { Feature, FeatureCollection } from "@sentropic/geo-core";
import GeoSearch, { foldText } from "./GeoSearch.svelte";

afterEach(cleanup);

const features: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      properties: { name: "Québec", code: "24" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.5, 45.5] },
      properties: { name: "Montréal", code: "06" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.9, 48.4] },
      properties: { name: "Saguenay", code: "02" },
    },
  ],
};

function typeQuery(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } });
}

describe("foldText", () => {
  it("NFD-folds accents and lowercases", () => {
    expect(foldText("Québec")).toBe("quebec");
    expect(foldText("Montréal")).toBe("montreal");
    expect(foldText(null)).toBe("");
    expect(foldText(24)).toBe("24");
  });
});

describe("GeoSearch — matching", () => {
  it("matches accent-insensitively over the name key", () => {
    const onQuery = vi.fn();
    const { getByRole, getAllByRole } = render(GeoSearch, {
      props: { features, onQuery },
    });
    const input = getByRole("combobox") as HTMLInputElement;
    // "quebec" (no accent) must still match "Québec".
    typeQuery(input, "quebec");

    const options = getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent?.trim()).toBe("Québec");

    // onQuery emits the single matching feature.
    const lastCall = onQuery.mock.calls.at(-1)?.[0] as Feature[];
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0]?.properties?.["name"]).toBe("Québec");
  });

  it("also searches secondary keys (code)", () => {
    const { getByRole, getAllByRole } = render(GeoSearch, {
      props: { features, keys: ["name", "code"] },
    });
    const input = getByRole("combobox") as HTMLInputElement;
    typeQuery(input, "06");
    const options = getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent?.trim()).toBe("Montréal");
  });

  it("shows no listbox for an empty query", () => {
    const { getByRole, queryAllByRole } = render(GeoSearch, {
      props: { features },
    });
    const input = getByRole("combobox") as HTMLInputElement;
    typeQuery(input, "  ");
    expect(queryAllByRole("option")).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("GeoSearch — pick", () => {
  it("emits onPick and closes the listbox on click", () => {
    const onPick = vi.fn();
    const { getByRole, getAllByRole, queryAllByRole } = render(GeoSearch, {
      props: { features, onPick },
    });
    const input = getByRole("combobox") as HTMLInputElement;
    typeQuery(input, "saguenay");
    const option = getAllByRole("option")[0]!;
    fireEvent.click(option.querySelector("button")!);

    expect(onPick).toHaveBeenCalledTimes(1);
    const picked = onPick.mock.calls[0]?.[0] as Feature;
    expect(picked.properties?.["name"]).toBe("Saguenay");
    // Input reflects the picked label, listbox is closed.
    expect(input.value).toBe("Saguenay");
    expect(queryAllByRole("option")).toHaveLength(0);
  });

  it("picks the active option on Enter", () => {
    const onPick = vi.fn();
    const { getByRole } = render(GeoSearch, { props: { features, onPick } });
    const input = getByRole("combobox") as HTMLInputElement;
    typeQuery(input, "m"); // matches Montréal + Saguenay (a in name)…
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe("GeoSearch — listbox semantics", () => {
  it("exposes a combobox wired to a labelled listbox", () => {
    const { getByRole } = render(GeoSearch, {
      props: { features, labelFr: "Rechercher" },
    });
    const input = getByRole("combobox") as HTMLInputElement;
    typeQuery(input, "q");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = getByRole("listbox");
    expect(listbox.getAttribute("aria-label")).toBe("Rechercher");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
  });
});
