import { describe, expect, it } from "vitest";

import {
  extractGoNetLinks,
  extractPvNavigationLinks,
  pvEntriesFromHtml,
  pvEntriesFromItems,
  runPvGoNet,
} from "./pv-gonet-run.js";

describe("pv-gonet-run helpers", () => {
  it("extracts GoNet links and municipality codes from common URL forms", () => {
    const html = `
      <a href="https://www.goazimut.com/GOnet6/index.html?m=54095">Matrice</a>
      <a href="https://www.goazimut.com/GOnet6/index.html?15035">Rôle</a>
      <a href="https://www.google.com/url?q=https%3A%2F%2Fwww.goazimut.com%2FGOnet6%2Findex.html%3F07065&amp;sa=D">Azimut</a>
    `;
    expect(extractGoNetLinks(html, "https://example.qc.ca/")).toEqual([
      { url: "https://www.goazimut.com/GOnet6/index.html?m=54095", muniCode: "54095" },
      { url: "https://www.goazimut.com/GOnet6/index.html?15035", muniCode: "15035" },
      { url: "https://www.goazimut.com/GOnet6/index.html?07065", muniCode: "07065" },
    ]);
  });

  it("keeps municipal PV navigation links but excludes GoNet links", () => {
    const html = `
      <a href="/fr/conseil/proces-verbaux/">Procès-verbaux</a>
      <a href="https://archives.ville.example/fr/proces-verbaux/">Procès-verbaux archives</a>
      <a href="https://www.goazimut.com/GOnet6/?m=54095">Matrice graphique</a>
      <a href="https://external.example/proces-verbaux/">External PV</a>
    `;
    expect(extractPvNavigationLinks(html, "https://ville.example/")).toEqual([
      "https://ville.example/fr/conseil/proces-verbaux/",
      "https://archives.ville.example/fr/proces-verbaux/",
    ]);
  });

  it("keeps only real PV document entries", () => {
    const entries = pvEntriesFromItems([
      {
        title: "Procès-verbaux",
        url: "https://ville.example/proces-verbaux/",
        dateIso: "non-disponible",
        dateLabel: "Procès-verbaux",
        docType: "proces-verbal",
      },
      {
        title: "Ordre du jour",
        url: "https://ville.example/docs/odj-2026-01.pdf",
        dateIso: "2026-01",
        dateLabel: "Ordre du jour",
        docType: "ordre-du-jour",
      },
      {
        title: "Télécharger le document",
        url: "https://ville.example/upload/seances-du-conseil/proces-verbaux/2026/procesverbal_2026-01-19.pdf",
        dateIso: "2026-01-19",
        dateLabel: "2026-01-19",
        docType: "document",
      },
      {
        title: "Consulter",
        url: "https://ville.example/wp-content/uploads/2026/01/PV-12-JANVIER-2026.pdf",
        dateIso: "non-disponible",
        dateLabel: "Consulter",
        docType: "document",
      },
    ]);

    expect(entries).toEqual([
      {
        url: "https://ville.example/upload/seances-du-conseil/proces-verbaux/2026/procesverbal_2026-01-19.pdf",
        title: "Télécharger le document",
        publishedAt: "2026-01-19",
        contentType: "application/pdf",
      },
      {
        url: "https://ville.example/wp-content/uploads/2026/01/PV-12-JANVIER-2026.pdf",
        title: "Consulter",
        contentType: "application/pdf",
      },
    ]);
  });

  // STATIC-MISS recovery: download-endpoint CMS + date-labelled lists + the
  // homepage-junk garde-fou. Excerpts are verbatim from real index pages
  // (municipalityshigawake.com, riviere-heva.com, municipalite.eastfarnham.qc.ca)
  // captured 2026-06-27.
  describe("pvEntriesFromHtml – STATIC-MISS recovery + quality guard", () => {
    it("keeps extension-less /download/ PV endpoints (shigawake) — was 0", () => {
      const html = `
        <a href="https://municipalityshigawake.com/download/230/proces-verbaux-2026/3434/pv-reunion-extraordinaire-26-mai-2026">PV réunion extraordinaire 26 mai 2026</a>
        <a href="https://municipalityshigawake.com/download/220/proces-verbaux/3281/pv-reunion-reguliere-du-05-mai-2025">Procès-verbal réunion régulière 5 mai 2025</a>`;
      const entries = pvEntriesFromHtml(
        html,
        "https://municipalityshigawake.com/fr/documentation/proces-verbaux/",
      );
      expect(entries.map((e) => e.url)).toEqual([
        "https://municipalityshigawake.com/download/230/proces-verbaux-2026/3434/pv-reunion-extraordinaire-26-mai-2026",
        "https://municipalityshigawake.com/download/220/proces-verbaux/3281/pv-reunion-reguliere-du-05-mai-2025",
      ]);
    });

    it("keeps date-labelled PV PDFs on a CDN host from a procès-verbaux page (riviere-heva)", () => {
      const html = `
        <a href="https://riviere-heva.nyc3.digitaloceanspaces.com/site/documents/PV-du-2-mars-2026-adopte.pdf" download>Procès-verbal 2 mars 2026 - Séance ordinaire</a>
        <a href="https://riviere-heva.nyc3.digitaloceanspaces.com/site/documents/Proces-verbal-21-janvier-2026.pdf" download>Procès-verbal 21 janvier 2026</a>`;
      const entries = pvEntriesFromHtml(html, "https://riviere-heva.com/registre-des-proces-verbaux");
      expect(entries.length).toBe(2);
      expect(entries[0]?.contentType).toBe("application/pdf");
    });

    it("garde-fou: rejects generic homepage PDFs (east-farnham 168.pdf / horaire)", () => {
      // Real homepage links: opaque numeric PDFs and a schedule ('horaire'),
      // none carrying a PV keyword. Homepage is never a PV-context page.
      const html = `
        <a href="docs/fichiers_documents/168.pdf"></a>
        <a href="docs/images_infos/horaire_2026-06-04.pdf"></a>
        <a href="docs/fichiers_documents/79.pdf">Cliquez ici pour accéder à la résolution adoptée!</a>`;
      const entries = pvEntriesFromHtml(html, "https://www.municipalite.eastfarnham.qc.ca/");
      expect(entries).toEqual([]);
    });

    it("garde-fou: a bare-date PDF is kept on a /proces-verbaux/ page but rejected on the homepage", () => {
      const link = `<a href="/docs/2026-03-02.pdf">Séance du 2 mars 2026</a>`;
      // On an unambiguous PV-context page → kept via the date relaxation.
      expect(pvEntriesFromHtml(link, "https://ville.qc.ca/conseil/proces-verbaux/").length).toBe(1);
      // Same link on the homepage → rejected (no PV keyword, homepage not PV-context).
      expect(pvEntriesFromHtml(link, "https://ville.qc.ca/").length).toBe(0);
    });

    it("garde-fou: a download endpoint with NO PV keyword is rejected even on a PV page", () => {
      const html = `<a href="https://ville.qc.ca/download/55/finances/900/budget-2026">Budget 2026</a>`;
      expect(pvEntriesFromHtml(html, "https://ville.qc.ca/conseil/proces-verbaux/")).toEqual([]);
    });
  });

  it("should follow nested municipal PV navigation pages when the first PV page is only a hub", async () => {
    const originalFetch = globalThis.fetch;
    const pages = new Map<string, string>([
      [
        "https://www.longueuil.quebec",
        `
          <a href="https://www.goazimut.com/GOnet6/index.html?m=58227">Matrice graphique</a>
          <a href="/fr/services/instances-decisionnelles-et-consultatives/proces-verbaux">Procès-verbaux</a>
        `,
      ],
      [
        "https://www.longueuil.quebec/",
        `
          <a href="https://www.goazimut.com/GOnet6/index.html?m=58227">Matrice graphique</a>
          <a href="/fr/services/instances-decisionnelles-et-consultatives/proces-verbaux">Procès-verbaux</a>
        `,
      ],
      [
        "https://www.longueuil.quebec/fr/services/instances-decisionnelles-et-consultatives/proces-verbaux",
        `<a href="https://archives.longueuil.quebec/fr/conseil/proces-verbaux">Procès-verbaux</a>`,
      ],
      [
        "https://archives.longueuil.quebec/fr/conseil/proces-verbaux",
        `<a href="/docs/proces-verbal-2026-01-12.pdf">Procès-verbal du 12 janvier 2026</a>`,
      ],
    ]);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const normalized = url.endsWith("/") && !pages.has(url) ? url.slice(0, -1) : url;
      const html = pages.get(url) ?? pages.get(normalized);
      return new Response(html ?? "", {
        status: html ? 200 : 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;

    try {
      const report = await runPvGoNet([
        "--dry-run",
        "--no-robots",
        "--slugs",
        "longueuil",
        "--delay-ms",
        "0",
      ]);

      expect(report.dryRunReady).toBe(1);
      expect(report.depositedSlugs).toEqual([
        {
          slug: "longueuil",
          pvIndexUrl: "https://archives.longueuil.quebec/fr/conseil/proces-verbaux",
          count: 1,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
