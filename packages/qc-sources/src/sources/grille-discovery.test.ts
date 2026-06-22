import { describe, it, expect } from "vitest";

import {
  classifyGrilleLink,
  discoverGrillesInHtml,
  discoverGrillesForCity,
  candidatePagesForCity,
  extractInternalSubpages,
  GRILLE_SCORE_THRESHOLD,
  RobotsCache,
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

// ─────────────────────────────────────────────────────────────────────────────
// extractInternalSubpages — same-site sub-page link harvest (2-hop)
// ─────────────────────────────────────────────────────────────────────────────

// A hub page that links to urbanisme/zonage SUB-PAGES (not the PDF directly),
// plus noise (outbound + a PV) that must NOT be followed. Models portneuf's PV
// page → urbanisme sub-page → grille PDF chain. The grille sub-page path here
// is deliberately NOT one of URBANISME_PATH_HINTS, so it is only reachable by
// following an internal link (a genuine hop-2 path, not a derived candidate).
const GRILLE_SUBPAGE_PATH = "/ma-ville/amenagement-du-territoire/grilles-de-zonage";
const HUB_PAGE_HTML = `<!DOCTYPE html><html><body>
  <a href="https://facebook.com/ville">Facebook</a>
  <a href="/conseil/proces-verbaux/">Procès-verbaux</a>
  <a href="${GRILLE_SUBPAGE_PATH}">Grilles de zonage</a>
  <a href="/ma-ville/reglementation-diverse">Réglementation</a>
  <a href="/loisirs/activites">Loisirs</a>
  <a href="https://autre-site.qc.ca/zonage">Zonage (autre site)</a>
</body></html>`;

describe("extractInternalSubpages", () => {
  it("keeps same-site urbanisme/zonage/règlement sub-pages, drops outbound + PDF + noise", () => {
    const links = extractInternalSubpages(HUB_PAGE_HTML, "https://exemple.qc.ca/accueil");
    const urls = links.map((l) => l.url);
    expect(urls).toContain(`https://exemple.qc.ca${GRILLE_SUBPAGE_PATH}`);
    expect(urls).toContain("https://exemple.qc.ca/ma-ville/reglementation-diverse");
    // outbound (even if it says "zonage"), facebook, loisirs are dropped
    expect(urls.some((u) => /facebook|autre-site|loisirs/.test(u))).toBe(false);
    // the PV link is not an urbanisme/zonage hint → not followed
    expect(urls.some((u) => /proces-verbaux/.test(u))).toBe(false);
    // the grille/zonage sub-page (score 4+3) ranks before a bare règlement (score 1)
    expect(urls[0]).toBe(`https://exemple.qc.ca${GRILLE_SUBPAGE_PATH}`);
  });

  it("caps the number of sub-pages returned", () => {
    const many = `<html><body>${Array.from({ length: 12 }, (_, i) => `<a href="/urbanisme-${i}">Urbanisme ${i}</a>`).join("")}</body></html>`;
    const links = extractInternalSubpages(many, "https://exemple.qc.ca/x", 5);
    expect(links).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2-hop crawl: hop-1 misses, hop-2 finds the grille on a sub-page
// ─────────────────────────────────────────────────────────────────────────────

describe("discoverGrillesForCity — 2-hop", () => {
  // Hop-1 pages yield NO grille PDF (just the hub of sub-page links). The grille
  // PDF lives on the /services-aux-citoyens/urbanisme SUB-PAGE (hop 2).
  const SUBPAGE_WITH_GRILLE = `<html><body>
    <a href="/upload/grille_des_specifications_zonage.pdf">Grilles des spécifications</a>
  </body></html>`;

  const GRILLE_SUBPAGE_URL = `https://exemple.qc.ca${GRILLE_SUBPAGE_PATH}`;
  const GRILLE_PDF_URL = "https://exemple.qc.ca/upload/grille_des_specifications_zonage.pdf";

  const make2HopFetch = (): PvFetchLike => async (url) => {
    if (url === "https://exemple.qc.ca/conseil/proces-verbaux/") return htmlResponse(HUB_PAGE_HTML);
    if (url === "https://exemple.qc.ca/") return htmlResponse(HUB_PAGE_HTML);
    if (url === GRILLE_SUBPAGE_URL) return htmlResponse(SUBPAGE_WITH_GRILLE);
    return notFound();
  };

  it("does NOT find the grille in single-hop (maxHops=1)", async () => {
    const res = await discoverGrillesForCity(
      "exemple",
      "https://exemple.qc.ca/conseil/proces-verbaux/",
      { fetchImpl: make2HopFetch(), maxHops: 1 },
    );
    expect(res.candidates).toHaveLength(0);
    expect(res.probes.some((p) => p.hop === 2)).toBe(false);
  });

  it("FINDS the grille via a depth-1 sub-page in 2-hop (maxHops=2)", async () => {
    const res = await discoverGrillesForCity(
      "exemple",
      "https://exemple.qc.ca/conseil/proces-verbaux/",
      { fetchImpl: make2HopFetch(), maxHops: 2 },
    );
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.candidates[0]?.pdfUrl).toBe(GRILLE_PDF_URL);
    // the winning candidate came from the sub-page (hop 2)
    const subProbe = res.probes.find((p) => p.pageUrl === GRILLE_SUBPAGE_URL);
    expect(subProbe?.hop).toBe(2);
    expect(subProbe?.status).toBe("ok");
  });

  it("respects robots.txt: a Disallowed sub-page is not fetched in 2-hop", async () => {
    const fetchImpl: PvFetchLike = async (url) => {
      if (url.endsWith("/robots.txt")) {
        const body = "User-agent: *\nDisallow: /ma-ville/amenagement-du-territoire/\n";
        const bytes = new TextEncoder().encode(body);
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/plain" : null) },
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      }
      return make2HopFetch()(url);
    };
    const robots = new RobotsCache({ fetchImpl, log: () => {} });
    const res = await discoverGrillesForCity(
      "exemple",
      "https://exemple.qc.ca/conseil/proces-verbaux/",
      { fetchImpl, maxHops: 2, robots },
    );
    // grille sub-page is Disallowed → never fetched → no candidate
    expect(res.candidates).toHaveLength(0);
    const blocked = res.probes.find((p) => p.pageUrl === GRILLE_SUBPAGE_URL);
    expect(blocked?.status).toBe("robots-disallow");
  });
});
