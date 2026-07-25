/**
 * DOM tests for `GeoDetailPanel` (jsdom — DOM only). Cover schema-driven
 * rendering (text + pdf/url link + citation), the collapsible levels toggle,
 * the title resolution, and the plain key/value fallback when no schema.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import type { GeoFeatureHit } from "./GeoMap.svelte";
import GeoDetailPanel, {
  type GeoDetailSchema,
} from "./GeoDetailPanel.svelte";

afterEach(cleanup);

const feature: GeoFeatureHit = {
  id: "qc-24",
  geometry: null,
  properties: {
    name: "Québec",
    level: "region",
    code: "24",
    fiche: "https://example.org/fiche.pdf",
    site: "https://example.org",
    citation: "Décret 1234-2020, Gazette officielle du Québec.",
  },
};

const schema: GeoDetailSchema = {
  titleKey: "name",
  fields: [
    { key: "level", labelFr: "Niveau", kind: "text" },
    { key: "code", labelFr: "Code", kind: "text" },
    { key: "fiche", labelFr: "Fiche", kind: "pdf", level: "source" },
    { key: "site", labelFr: "Lien", kind: "url", level: "source" },
    { key: "citation", labelFr: "Référence", kind: "citation", level: "source" },
  ],
  levels: [{ id: "source", labelFr: "Source officielle" }],
};

describe("GeoDetailPanel — schema-driven", () => {
  it("renders nothing when no feature is given", () => {
    const { container } = render(GeoDetailPanel, {
      props: { feature: null, schema },
    });
    expect(container.querySelector(".geo-detail")).toBeNull();
  });

  it("renders the title and base (level-less) fields", () => {
    const { getByText } = render(GeoDetailPanel, {
      props: { feature, schema },
    });
    expect(getByText("Québec")).toBeTruthy();
    expect(getByText("Niveau")).toBeTruthy();
    expect(getByText("region")).toBeTruthy();
    expect(getByText("Code")).toBeTruthy();
    expect(getByText("24")).toBeTruthy();
  });

  it("keeps level fields collapsed until the toggle is opened", () => {
    const { getByRole, queryByText, getByText } = render(GeoDetailPanel, {
      props: { feature, schema },
    });
    // Collapsed by default → no source fields yet.
    expect(queryByText("Fiche")).toBeNull();

    const toggle = getByRole("button", { name: /Source officielle/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Now the pdf link, url link and citation render.
    expect(getByText("Fiche")).toBeTruthy();
  });

  it("renders a pdf field as a link, a url field as a link, and a citation as a blockquote", () => {
    const { getByRole, container } = render(GeoDetailPanel, {
      props: { feature, schema },
    });
    fireEvent.click(getByRole("button", { name: /Source officielle/ }));

    const links = container.querySelectorAll("a.geo-detail-link");
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://example.org/fiche.pdf");
    expect(hrefs).toContain("https://example.org");
    // The pdf link is labelled distinctly from a plain url link.
    expect(
      Array.from(links).some((a) => a.textContent?.includes("PDF")),
    ).toBe(true);

    const quote = container.querySelector("blockquote.geo-detail-citation");
    expect(quote?.textContent).toContain("Gazette officielle");
  });
});

describe("GeoDetailPanel — expand/collapse", () => {
  it("hides the body when collapsed", () => {
    const { getByRole, queryByText } = render(GeoDetailPanel, {
      props: { feature, schema, expanded: false },
    });
    expect(queryByText("Niveau")).toBeNull();
    const toggle = getByRole("button", { name: /Détail/ });
    fireEvent.click(toggle);
    expect(queryByText("Niveau")).toBeTruthy();
  });
});

describe("GeoDetailPanel — fallback", () => {
  it("lists all properties as key/value pairs when no schema is supplied", () => {
    const { getAllByText, container } = render(GeoDetailPanel, {
      props: { feature },
    });
    // Title resolves from `name` — which also appears as the `name` value row in
    // the fallback list, so "Québec" legitimately occurs more than once.
    expect(getAllByText("Québec").length).toBeGreaterThan(0);
    // Every property key appears as a <dt>.
    const labels = Array.from(
      container.querySelectorAll("dt.geo-detail-label"),
    ).map((n) => n.textContent);
    expect(labels).toContain("level");
    expect(labels).toContain("code");
    expect(labels).toContain("citation");
  });
});
