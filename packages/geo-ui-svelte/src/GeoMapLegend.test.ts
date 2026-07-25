/**
 * DOM tests for `GeoMapLegend` (jsdom — no WebGL). Cover the categorical mode
 * (labelFr + swatch rows, the always-on union-of-types legend), the value mode
 * (FR-formatted bin bounds), the empty case, and the optional toggle behaviour.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import GeoMapLegend from "./GeoMapLegend.svelte";
import type { GeoCategory } from "./GeoMap.svelte";
import type { ChoroplethBin } from "./choropleth.js";

afterEach(cleanup);

const categories: GeoCategory[] = [
  { id: "region", labelFr: "Région", color: "#2563eb" },
  { id: "mrc", labelFr: "MRC", color: "#0891b2" },
];

const bins: ChoroplethBin[] = [
  { min: 0, max: 1000, color: "#eff6ff" },
  { min: 1000, max: 5000, color: "#2563eb" },
];

describe("GeoMapLegend — categorical", () => {
  it("renders one labelFr + swatch row per category", () => {
    const { getByText, container } = render(GeoMapLegend, {
      props: { categories },
    });
    expect(getByText("Région")).toBeTruthy();
    expect(getByText("MRC")).toBeTruthy();
    const swatches = container.querySelectorAll(".geo-legend-swatch");
    expect(swatches).toHaveLength(2);
    // Swatch colour comes from the category (browser normalizes hex → rgb).
    const first = swatches[0] as HTMLElement | undefined;
    expect(first?.style.backgroundColor).toBe("rgb(37, 99, 235)");
  });

  it("uses list semantics with a group label", () => {
    const { container, getByRole } = render(GeoMapLegend, {
      props: { categories, titleFr: "Niveaux" },
    });
    expect(getByRole("group", { name: "Niveaux" })).toBeTruthy();
    expect(container.querySelector("ul")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("is presentational (no buttons) when visibleIds is not bound", () => {
    const { container } = render(GeoMapLegend, { props: { categories } });
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders toggle buttons when visibleIds is provided", () => {
    const { container, getAllByRole } = render(GeoMapLegend, {
      props: { categories, visibleIds: ["region", "mrc"] },
    });
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const firstButton = buttons[0]!;
    expect(firstButton.getAttribute("aria-pressed")).toBe("true");
    // Clicking a row flips its pressed state.
    fireEvent.click(firstButton);
    expect(
      container.querySelectorAll('button[aria-pressed="false"]'),
    ).toHaveLength(1);
  });
});

describe("GeoMapLegend — value/choropleth", () => {
  it("renders FR-formatted bin bounds with swatches", () => {
    const { container, getByText } = render(GeoMapLegend, { props: { bins } });
    const swatches = container.querySelectorAll(".geo-legend-swatch");
    expect(swatches).toHaveLength(2);
    // "0 – 1 000" with fr-CA grouping; assert structurally.
    const rows = Array.from(
      container.querySelectorAll(".geo-legend-label"),
    ).map((n) => n.textContent?.replace(/\s/g, ""));
    expect(rows).toContain("0–1000");
    expect(rows).toContain("1000–5000");
    expect(getByText(/1\s*000\s*–\s*5\s*000/)).toBeTruthy();
  });

  it("prefers categorical when both categories and bins are given", () => {
    const { getByText, queryByText } = render(GeoMapLegend, {
      props: { categories, bins },
    });
    expect(getByText("Région")).toBeTruthy();
    expect(queryByText(/1000/)).toBeNull();
  });
});

describe("GeoMapLegend — empty", () => {
  it("renders nothing when neither categories nor bins are present", () => {
    const { container } = render(GeoMapLegend, { props: {} });
    expect(container.querySelector(".geo-legend")).toBeNull();
  });

  it("renders nothing for empty arrays", () => {
    const { container } = render(GeoMapLegend, {
      props: { categories: [], bins: [] },
    });
    expect(container.querySelector(".geo-legend")).toBeNull();
  });
});
