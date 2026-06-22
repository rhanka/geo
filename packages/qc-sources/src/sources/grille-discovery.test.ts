import { describe, it, expect } from "vitest";

import {
  classifyGrilleLink,
  discoverGrillesInHtml,
  discoverGrillesForCity,
  candidatePagesForCity,
  GRILLE_SCORE_THRESHOLD,
  type PvFetchLike,
} from "./grille-discovery.js";

// ─────────────────────────────────────────────────────────────────────────────
// classifyGrilleLink — keyword scoring
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyGrilleLink", () => {
  it("scores an explicit 'grille des spécifications' link above threshold", () => {
    const c = classifyGrilleLink(
      "Grille des spécifications",
      "https://x.qc.ca/grille_des_specifications_zonage.pdf",
    );
    expect(c.score).toBeGreaterThanOrEqual(GRILLE_SCORE_THRESHOLD);
    expect(c.matched).toContain("grille des spécifications");
  });

  it("scores a 'règlement de zonage' link above threshold", () => {
    const c = classifyGrilleLink(
      "Règlement de zonage refondu",
      "https://x.qc.ca/Reglement-de-zonage.pdf",
    );
    expect(c.score).toBeGreaterThanOrEqual(GRILLE_SCORE_THRESHOLD);
  });

  it("folds diacritics so 'spécifications' matches the folded keyword", () => {
    const withAccent = classifyGrilleLink("Grille des spécifications", "a.pdf");
    const without = classifyGrilleLink("Grille des specifications", "a.pdf");
    expect(withAccent.score).toBe(without.score);
  });

  it("keeps an unrelated municipal document below threshold", () => {
    const c = classifyGrilleLink(
      "Budget 2026 — résolution",
      "https://x.qc.ca/budget-2026.pdf",
    );
    expect(c.score).toBeLessThan(GRILLE_SCORE_THRESHOLD);
  });

  it("penalises a PV so it does not masquerade as a grille", () => {
    const c = classifyGrilleLink(
      "Procès-verbal séance ordinaire",
      "https://x.qc.ca/pv-2026-05.pdf",
    );
    expect(c.score).toBeLessThan(GRILLE_SCORE_THRESHOLD);
    expect(c.penalised.length).toBeGreaterThan(0);
  });

  it("penalises a PIIA règlement (related but not a zoning grille)", () => {
    const c = classifyGrilleLink(
      "Règlement sur les PIIA",
      "https://x.qc.ca/reglement-piia.pdf",
    );
    // "règlement" + no zonage; "piia" penalty keeps it out.
    expect(c.score).toBeLessThan(GRILLE_SCORE_THRESHOLD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverGrillesInHtml — link extraction + classification on real-shaped HTML
// ─────────────────────────────────────────────────────────────────────────────

const URBANISME_PAGE_HTML = `<!DOCTYPE html><html><head><base href="https://exemple.qc.ca/urbanisme/"></head>
<body>
  <nav><a href="https://facebook.com/ville">Facebook</a></nav>
  <ul>
    <li><a href="documents/Grille-des-specifications-zonage-583-15.pdf">Grille des spécifications (zonage)</a></li>
    <li><a href="/uploads/Reglement-de-zonage-refondu.pdf">Règlement de zonage refondu</a></li>
    <li><a href="documents/Budget-2026.pdf">Budget 2026</a></li>
    <li><a href="documents/PV-2026-05.pdf">Procès-verbal du 12 mai 2026</a></li>
    <li><a href="/urbanisme/permis">Demander un permis</a></li>
  </ul>
</body></html>`;

describe("discoverGrillesInHtml", () => {
  it("surfaces only the grille/zonage PDFs and resolves relative hrefs", () => {
    const { candidates, renderRequiresBrowser } = discoverGrillesInHtml(
      URBANISME_PAGE_HTML,
      "https://exemple.qc.ca/urbanisme/",
      "exemple",
    );
    expect(renderRequiresBrowser).toBe(false);
    const urls = candidates.map((c) => c.pdfUrl);
    expect(urls).toContain(
      "https://exemple.qc.ca/urbanisme/documents/Grille-des-specifications-zonage-583-15.pdf",
    );
    expect(urls).toContain("https://exemple.qc.ca/uploads/Reglement-de-zonage-refondu.pdf");
    // Budget + PV must NOT be surfaced.
    expect(urls.some((u) => /Budget/i.test(u))).toBe(false);
    expect(urls.some((u) => /PV-2026/i.test(u))).toBe(false);
  });

  it("ranks the strongest grille match first and dedups", () => {
    const { candidates } = discoverGrillesInHtml(
      URBANISME_PAGE_HTML,
      "https://exemple.qc.ca/urbanisme/",
      "exemple",
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.scoreClassif).toBeGreaterThanOrEqual(
      candidates[candidates.length - 1]?.scoreClassif ?? 0,
    );
    // every candidate carries provenance.
    for (const c of candidates) {
      expect(c.slug).toBe("exemple");
      expect(c.sourceUrl).toBe("https://exemple.qc.ca/urbanisme/");
    }
  });

  it("reports JS-rendered pages instead of emitting bogus candidates", () => {
    const js = `<html><body><div id="liste-documents"><!-- injected by scripts.js --></div></body></html>`;
    const { candidates, renderRequiresBrowser } = discoverGrillesInHtml(
      js,
      "https://exemple.qc.ca/urbanisme/",
      "exemple",
    );
    expect(renderRequiresBrowser).toBe(true);
    expect(candidates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// candidatePagesForCity — page derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("candidatePagesForCity", () => {
  it("starts from the PV index URL and derives site-root urbanisme pages", () => {
    const pages = candidatePagesForCity("https://exemple.qc.ca/conseil/proces-verbaux/");
    expect(pages[0]).toBe("https://exemple.qc.ca/conseil/proces-verbaux/");
    expect(pages).toContain("https://exemple.qc.ca/");
    expect(pages).toContain("https://exemple.qc.ca/urbanisme");
    expect(pages).toContain("https://exemple.qc.ca/reglements");
    // no duplicates
    expect(new Set(pages).size).toBe(pages.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverGrillesForCity — multi-page crawl with an injected fetch (no network)
// ─────────────────────────────────────────────────────────────────────────────

function htmlResponse(html: string): Awaited<ReturnType<PvFetchLike>> {
  const bytes = new TextEncoder().encode(html);
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function notFound(): Awaited<ReturnType<PvFetchLike>> {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("discoverGrillesForCity", () => {
  it("crawls candidate pages, skips 404s, and aggregates confirmed candidates", async () => {
    const fetchImpl: PvFetchLike = async (url) => {
      if (url === "https://exemple.qc.ca/urbanisme") return htmlResponse(URBANISME_PAGE_HTML);
      // every other page 404s
      return notFound();
    };
    const res = await discoverGrillesForCity(
      "exemple",
      "https://exemple.qc.ca/conseil/proces-verbaux/",
      { fetchImpl },
    );
    expect(res.slug).toBe("exemple");
    expect(res.candidates.length).toBeGreaterThanOrEqual(2);
    const okProbe = res.probes.find((p) => p.pageUrl === "https://exemple.qc.ca/urbanisme");
    expect(okProbe?.status).toBe("ok");
    const notFoundProbe = res.probes.find((p) => p.status === "skipped-non-200");
    expect(notFoundProbe).toBeDefined();
  });
});
