/**
 * Link-extraction coverage tests for `parsePvIndex` + `detectIndexRenderMode`.
 *
 * These fixtures are REAL index pages of municipalities the 10-city pilot found
 * EMPTY (0 extracted PV links). They drive the link-extraction yield fix:
 *   - relative-href resolution (../../, ./, bare path) and a <base href>,
 *   - accept any .pdf document regardless of its label wording,
 *   - month-year-only date labels ("Mars 2025"),
 *   - exclusion of outbound hosts (sto.ca) and same-page nav siblings,
 *   - typing ordre-du-jour vs procès-verbal,
 *   - FLAGGING JS-rendered families (gestionweblex, ASP.NET) for obscura
 *     instead of silently capturing the wrong page.
 *
 * Nothing is fabricated (ANTI-INVENTION): see the fixture header for sources.
 */

import { describe, expect, it } from "vitest";
import {
  detectIndexRenderMode,
  parsePvIndex,
  PV_NON_DISPONIBLE,
} from "./proces-verbaux-parser.js";
import {
  PV_BARNSTON_OUEST_INDEX_HTML,
  PV_GESTIONWEBLEX_INDEX_HTML,
  PV_ASPNET_GATINEAU_INDEX_HTML,
  PV_SHIGAWAKE_DOWNLOAD_INDEX_HTML,
} from "./proces-verbaux-link-extraction.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// Family 1 — flat-html-list with ../../ relative PDF links (barnston-ouest)
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – barnston-ouest flat .php list with ../../ relative PDFs", () => {
  const BASE = "https://www.barnston-ouest.ca/fr/municipalite/proces-verbaux.php";
  const items = parsePvIndex(PV_BARNSTON_OUEST_INDEX_HTML, BASE);

  it("extracts every PDF in the list (was 0 before the fix)", () => {
    expect(items.length).toBeGreaterThanOrEqual(11);
  });

  it("resolves ../../ relative hrefs against the index directory", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/www\.barnston-ouest\.ca\//);
      // The resolved URL must NOT still contain the unresolved ../ segments.
      expect(item.url).not.toContain("../");
      expect(item.url).toMatch(/\/upload\/documents\/Proces-verbaux\/.+\.pdf$/i);
    }
  });

  it("accepts month+year labels even without a 'procès-verbal' keyword", () => {
    const mars2025 = items.find((i) => i.url.includes("pv-2025-03.pdf"));
    expect(mars2025).toBeDefined();
    expect(mars2025?.title).toContain("Mars 2025");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 2 — gestionweblex SaaS doc-list (client-side rendered → obscura)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectIndexRenderMode – gestionweblex doc-list requires a browser", () => {
  const BASE = "https://www.muncste.ca/pages/proces-verbaux-secteur-courcelles";

  it("flags the page as requiring a headless browser (obscura)", () => {
    const mode = detectIndexRenderMode(PV_GESTIONWEBLEX_INDEX_HTML);
    expect(mode.requiresBrowser).toBe(true);
    expect(mode.reason).toMatch(/gestionweblex|doc-list|client/i);
  });

  it("does NOT mistake sibling navigation pages for PV documents", () => {
    const items = parsePvIndex(PV_GESTIONWEBLEX_INDEX_HTML, BASE);
    // The hub links (proces-verbaux-regroupement, …-secteur-courcelles) are
    // navigation, not documents — none should be emitted as a PV item.
    expect(items.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 3 — ASP.NET portal, JS-injected body, outbound sto.ca (gatineau)
// ─────────────────────────────────────────────────────────────────────────────

describe("ASP.NET gatineau portal – flag for obscura, never capture sto.ca", () => {
  const BASE =
    "https://www.gatineau.ca/portail/default.aspx?p=publications_cartes_statistiques_donnees_ouvertes/proces_verbaux";

  it("flags the page as requiring a headless browser (obscura)", () => {
    const mode = detectIndexRenderMode(PV_ASPNET_GATINEAU_INDEX_HTML);
    expect(mode.requiresBrowser).toBe(true);
  });

  it("never emits the outbound sto.ca link as a PV item", () => {
    const items = parsePvIndex(PV_ASPNET_GATINEAU_INDEX_HTML, BASE);
    for (const item of items) {
      expect(item.url).not.toContain("sto.ca");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting unit cases — relative resolution, outbound exclusion, typing
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – relative href resolution", () => {
  const BASE = "https://example.qc.ca/conseil/proces-verbaux/";

  it("resolves a ./ relative PDF against the index directory", () => {
    const html = `<a href="./docs/pv-2025-03.pdf">Procès-verbal 3 mars 2025</a>`;
    const [item] = parsePvIndex(html, BASE);
    expect(item?.url).toBe(
      "https://example.qc.ca/conseil/proces-verbaux/docs/pv-2025-03.pdf",
    );
  });

  it("resolves a bare-path (no leading slash) relative PDF", () => {
    const html = `<a href="documents/pv-2025-03.pdf">Séance du 3 mars 2025</a>`;
    const [item] = parsePvIndex(html, BASE);
    expect(item?.url).toBe(
      "https://example.qc.ca/conseil/proces-verbaux/documents/pv-2025-03.pdf",
    );
  });

  it("still resolves a root-absolute /path PDF (no regression)", () => {
    const html = `<a href="/wp-content/pv-2025-03.pdf">Procès-verbal</a>`;
    const [item] = parsePvIndex(html, BASE);
    expect(item?.url).toBe("https://example.qc.ca/wp-content/pv-2025-03.pdf");
  });

  it("resolves against a <base href> when the document declares one", () => {
    const html = `<base href="https://cdn.example.qc.ca/files/"><a href="pv-2025-03.pdf">Procès-verbal 3 mars 2025</a>`;
    const [item] = parsePvIndex(html, BASE);
    expect(item?.url).toBe("https://cdn.example.qc.ca/files/pv-2025-03.pdf");
  });
});

describe("parsePvIndex – outbound + nav exclusion", () => {
  const BASE = "https://ville.qc.ca/conseil/proces-verbaux/";

  it("excludes a NON-document outbound link (sto.ca header nav)", () => {
    const html = `<a href="https://www.sto.ca/horaires">Société de transport</a>`;
    const items = parsePvIndex(html, BASE);
    expect(items.length).toBe(0);
  });

  it("KEEPS a cross-domain PDF (municipalities host PVs on a separate domain)", () => {
    // boisbriand.ca index links PV PDFs on ville.boisbriand.qc.ca — a document
    // link is kept even cross-site; only non-document outbound links are dropped.
    const html = `<a href="https://ville.autre.qc.ca/media/pv-2025-03.pdf">Procès-verbal 3 mars 2025</a>`;
    const items = parsePvIndex(html, BASE);
    expect(items.length).toBe(1);
  });

  it("keeps a relative PDF on the same domain", () => {
    const html = `<a href="../pv/pv-2025-03.pdf">Procès-verbal 3 mars 2025</a>`;
    const items = parsePvIndex(html, BASE);
    expect(items.length).toBe(1);
  });
});

describe("parsePvIndex – ordre-du-jour typing", () => {
  const BASE = "https://ville.qc.ca/conseil/proces-verbaux/";

  it("types an ordre-du-jour PDF distinctly from a procès-verbal", () => {
    const html = `
      <a href="/docs/pv-2025-03.pdf">Procès-verbal 3 mars 2025</a>
      <a href="/docs/odj-2025-03.pdf">Ordre du jour 3 mars 2025</a>`;
    const items = parsePvIndex(html, BASE);
    const pv = items.find((i) => i.url.includes("pv-2025-03"));
    const odj = items.find((i) => i.url.includes("odj-2025-03"));
    expect(pv?.docType).toBe("proces-verbal");
    expect(odj?.docType).toBe("ordre-du-jour");
  });
});

describe("parsePvIndex – month-year-only date labels", () => {
  const BASE = "https://ville.qc.ca/conseil/proces-verbaux/";

  it("parses an ISO date from a 'Mars 2025' label (first of month)", () => {
    const html = `<a href="/docs/pv-2025-03.pdf">Mars 2025</a>`;
    const [item] = parsePvIndex(html, BASE);
    expect(item?.dateIso).toBe("2025-03");
    expect(item?.dateIso).not.toBe(PV_NON_DISPONIBLE);
  });
});

describe("detectIndexRenderMode – server-rendered pages do NOT need a browser", () => {
  it("returns requiresBrowser=false for a plain PDF list", () => {
    const mode = detectIndexRenderMode(PV_BARNSTON_OUEST_INDEX_HTML);
    expect(mode.requiresBrowser).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 4 — download-endpoint CMS (shigawake): PVs are extension-less /download/
// URLs, not .pdf hrefs. Previously these whole municipalities looked empty.
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – shigawake extension-less /download/ PV endpoints", () => {
  const BASE = "https://municipalityshigawake.com/fr/documentation/proces-verbaux/";
  const items = parsePvIndex(PV_SHIGAWAKE_DOWNLOAD_INDEX_HTML, BASE);

  it("extracts every /download/ PV endpoint as a document (was 0: no .pdf href)", () => {
    const docs = items.filter((i) => i.url.includes("/download/"));
    expect(docs.length).toBe(3);
    for (const d of docs) expect(d.url).toMatch(/^https:\/\/municipalityshigawake\.com\/download\//);
  });

  it("does NOT mistake the sibling 'Règlements' nav link for a PV document", () => {
    const reglements = items.find((i) => i.url.includes("/documentation/reglements/"));
    // It may appear as a non-document nav item, but never with a /download/ doc URL.
    expect(reglements?.url.includes("/download/")).not.toBe(true);
  });

  it("is server-rendered (no browser needed)", () => {
    expect(detectIndexRenderMode(PV_SHIGAWAKE_DOWNLOAD_INDEX_HTML).requiresBrowser).toBe(false);
  });
});
