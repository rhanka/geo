/**
 * Tests for real PV scraping of cities in Montérégie-Est near Montréal
 * (MRC La Vallée-du-Richelieu + MRC Marguerite-D'Youville cluster).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Mont-Saint-Hilaire (villemsh.ca):
 *     robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 *     URL: https://www.villemsh.ca/ville/conseil-municipal/seances-du-conseil/
 *   - Boucherville (boucherville.ca):
 *     robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 *     URL: https://www.boucherville.ca/mairie-conseil/seances-du-conseil/
 *   - Varennes (ville.varennes.qc.ca):
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://www.ville.varennes.qc.ca/la-ville/vie-democratique/seances-et-proces-verbaux
 *
 * Sites inaccessibles ou sans couche texte (documentés honnêtement — 2026-06-10):
 *   - Chambly (chambly.ca): HTTP 200 sur /administration/seances-du-conseil/ mais contenu
 *     chargé dynamiquement (JavaScript) — aucun lien PDF extrait par parsePvIndex.
 *   - Carignan: ECONNREFUSED (tous les domaines testés).
 *   - Marieville: HTTP 404 sur les chemins testés.
 *   - Richelieu: ERR_TLS_CERT_ALTNAME_INVALID.
 *   - Saint-Basile-le-Grand: HTTP 200 mais robots.txt: Disallow /wp-content/uploads/
 *     (PDF inaccessibles selon robots.txt — non exploitable).
 *   - Saint-Mathias-sur-Richelieu: ECONNREFUSED (tous les domaines testés).
 *   - Otterburn Park: ECONNREFUSED.
 *   - Saint-Bruno-de-Montarville: ECONNREFUSED.
 *   - Contrecoeur: ECONNREFUSED (tous les domaines testés).
 *   - Calixa-Lavallée: HTTP 200, WordPress, PV accessibles (texte), mais aucune modification
 *     de zonage dans les PV des 6 derniers mois (avisDeMotion=false, changementZonage=false).
 *   - Verchères: ECONNREFUSED / pas de site fonctionnel.
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Mont-Saint-Hilaire Mars 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 1235-34 amendant le Règlement de zonage numéro 1235 — rue des Vétérans)
 *   - Boucherville Mars 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlements 2026-290-50/53/54/55 modifiant Règlement de zonage 2018-290 —
 *        zones C-555/C-665/C-707/C-326/P-656)
 *   - Varennes Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 707-164 modifiant le règlement de zonage numéro 707)
 *
 * Suite de tests:
 *   1. parsePvIndex — Mont-Saint-Hilaire: parse les liens PDF WordPress accordion
 *   2. parsePvIndex — Boucherville: parse les liens HTML (PV pages) + PDF règlements
 *   3. parsePvIndex — Varennes: parse les liens PDF ODJ + PV (deux sections)
 *   4. detectZonageChange — Mont-Saint-Hilaire Mars 2026: zonage RÉEL (1235-34)
 *   5. detectZonageChange — Boucherville Mars 2026: zonage RÉEL (2026-290)
 *   6. detectZonageChange — Varennes Avril 2026: zonage RÉEL (707-164)
 *   7. ProcesVerbauxGenericAdapter.list() — Mont-Saint-Hilaire (mocked fetch)
 *   8. ProcesVerbauxGenericAdapter.list() — Boucherville (mocked fetch)
 *   9. ProcesVerbauxGenericAdapter.list() — Varennes (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  MONT_SAINT_HILAIRE_PV_CONFIG,
  BOUCHERVILLE_PV_CONFIG,
  VARENNES_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_MSH_INDEX_HTML,
  PV_MSH_2026_03_TEXT,
} from "./proces-verbaux-mont-saint-hilaire.fixture.js";
import {
  PV_BOUCHERVILLE_INDEX_HTML,
  PV_BOUCHERVILLE_2026_03_TEXT,
} from "./proces-verbaux-boucherville.fixture.js";
import {
  PV_VARENNES_INDEX_HTML,
  PV_VARENNES_2026_04_TEXT,
} from "./proces-verbaux-varennes.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Mont-Saint-Hilaire: WordPress accordion with PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Mont-Saint-Hilaire index HTML (WordPress accordion structure)", () => {
  const items = parsePvIndex(
    PV_MSH_INDEX_HTML,
    "https://www.villemsh.ca/ville/conseil-municipal/seances-du-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste 2026 + 2025", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF villemsh.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("villemsh.ca");
    }
  });

  it("inclut le PV du 9 mars 2026 (Proces_verbal_2026_03_09.pdf)", () => {
    const mar9 = items.find((i) => i.url.includes("2026_03_09"));
    expect(mar9).toBeDefined();
  });

  it("inclut le PV du 1er juin 2026 (Proces_verbal-_2026-06-01_site_Int._pas-approuve.pdf)", () => {
    const jun1 = items.find((i) => i.url.includes("2026-06-01"));
    expect(jun1).toBeDefined();
  });

  it("inclut un PV 2025 (Seances_Proces-verbal-2025-11-10.pdf)", () => {
    const nov10 = items.find((i) => i.url.includes("2025-11-10"));
    expect(nov10).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Boucherville: WordPress with HTML page links + PDF règlements
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Boucherville index HTML (WordPress avec pages HTML PV + PDFs règlements)", () => {
  const items = parsePvIndex(
    PV_BOUCHERVILLE_INDEX_HTML,
    "https://www.boucherville.ca/mairie-conseil/seances-du-conseil/",
  );

  it("parse au moins 5 items dans la liste 2026 (HTML pages PV + PDFs règlements)", () => {
    // The index has HTML page links for PV + direct PDF links for projet-règlements
    // parsePvIndex finds all href links including non-PDF ones
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("inclut le lien HTML PV du 16 mars 2026 (publications/...16-mars-2026/)", () => {
    const mar16 = items.find((i) => i.url.includes("16-mars-2026"));
    expect(mar16).toBeDefined();
  });

  it("inclut le lien HTML PV du 25 mai 2026 (publications/...25-mai-2026/)", () => {
    const may25 = items.find((i) => i.url.includes("25-mai-2026"));
    expect(may25).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Varennes: custom CMS with two PDF sections (ODJ + PV)
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Varennes index HTML (deux sections PDF: ODJ + PV approuvés)", () => {
  const items = parsePvIndex(
    PV_VARENNES_INDEX_HTML,
    "https://www.ville.varennes.qc.ca/la-ville/vie-democratique/seances-et-proces-verbaux",
  );

  it("parse au moins 8 items de PDF dans la liste 2026 + 2025 (ODJ + PV)", () => {
    // 2026: 7 ODJ + 5 PV = 12; 2025: 6 ODJ + 3 PV = 9
    expect(items.length).toBeGreaterThanOrEqual(8);
  });

  it("tous les items ont des URLs https PDF varennes.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("varennes.qc.ca");
    }
  });

  it("inclut le PV du 13 avril 2026 (20260413-PV-SO.pdf)", () => {
    const apr13 = items.find((i) => i.url.includes("20260413-PV-SO"));
    expect(apr13).toBeDefined();
  });

  it("inclut l'ODJ du 13 avril 2026 (20260413-SO.pdf)", () => {
    const apr13odj = items.find((i) => i.url.includes("20260413-SO.pdf"));
    expect(apr13odj).toBeDefined();
  });

  it("inclut le PV du 12 janvier 2026 (20260112-PV-SO.pdf)", () => {
    const jan12 = items.find((i) => i.url.includes("20260112-PV-SO"));
    expect(jan12).toBeDefined();
  });

  it("inclut un PV 2025 (20251124-SO_PV.pdf)", () => {
    const nov24 = items.find((i) => i.url.includes("20251124"));
    expect(nov24).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectZonageChange — Mont-Saint-Hilaire Mars 2026: zonage RÉEL (1235-34)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Mont-Saint-Hilaire Mars 2026 (1235-34 amendant Règlement de zonage 1235 — rue des Vétérans)", () => {
  const result = detectZonageChange(PV_MSH_2026_03_TEXT);

  it("détecte avisDeMotion ('donne un avis de motion' présent pour 1235-34)", () => {
    // Real: "Madame Mélodie Georget, conseillère municipale, donne un avis de motion
    // à l'effet qu'à une prochaine séance, elle présentera ou fera présenter un
    // règlement amendant le Règlement de zonage numéro 1235..."
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (1235-34 amendant le Règlement de zonage numéro 1235)", () => {
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '1235-34' en reglementNumbers", () => {
    // REGLEMENT_NUMBER_RE matches "1235-34" from "règlement 1235-34".
    // "1235" (base bylaw, no hyphen) is not a REGLEMENT_NUMBER_RE match.
    expect(result.reglementNumbers).toContain("1235-34");
  });

  it("le texte brut contient 'règlement de zonage' et '1235-34'", () => {
    expect(PV_MSH_2026_03_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_MSH_2026_03_TEXT).toContain("1235-34");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Boucherville Mars 2026: zonage RÉEL (2026-290)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Boucherville Mars 2026 (règlements 2026-290-50/53/54/55 modifiant Règlement de zonage 2018-290)", () => {
  const result = detectZonageChange(PV_BOUCHERVILLE_2026_03_TEXT);

  it("détecte avisDeMotion (plusieurs 'donne un avis de motion' pour zonage 2018-290)", () => {
    // Four avis de motion for règlements 2026-290-50, 2026-290-53, 2026-290-54, 2026-290-55.
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (tous modifient le Règlement de zonage numéro 2018-290)", () => {
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '2026-290' en reglementNumbers (parser extrait les 2 premiers segments)", () => {
    // REGLEMENT_NUMBER_RE matches "2026-290" from "2026-290-50" (first 2 segments).
    // All four rules share this prefix.
    expect(result.reglementNumbers).toContain("2026-290");
  });

  it("n'inclut PAS '2018-290' (ancien règlement de base, exclu par filterNewReglements)", () => {
    // "2018-290" is the base bylaw, excluded when "2026-290" (new) is present.
    expect(result.reglementNumbers).not.toContain("2018-290");
  });

  it("le texte brut contient 'Règlement de zonage numéro 2018-290' et 'zone C-326'", () => {
    expect(PV_BOUCHERVILLE_2026_03_TEXT).toContain("Règlement de zonage numéro 2018-290");
    expect(PV_BOUCHERVILLE_2026_03_TEXT).toContain("zone C-326");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Varennes Avril 2026: zonage RÉEL (707-164)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Varennes Avril 2026 (707-164 modifiant règlement de zonage 707 — corrections générales)", () => {
  const result = detectZonageChange(PV_VARENNES_2026_04_TEXT);

  it("détecte avisDeMotion ('Avis de motion est donné' pour règlement 707-164)", () => {
    // Real: "Avis de motion est donné par monsieur le conseiller Marc-André Savaria
    // Qu'à une séance subséquente de ce conseil tenue à un jour ultérieur, il sera
    // soumis pour adoption le règlement 707-164 modifiant le règlement de zonage numéro 707..."
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (707-164 modifiant le règlement de zonage numéro 707)", () => {
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '707-164' en reglementNumbers", () => {
    // REGLEMENT_NUMBER_RE matches "707-164" from "règlement 707-164".
    // "707" (base bylaw, no hyphen) is not matched.
    expect(result.reglementNumbers).toContain("707-164");
  });

  it("le texte brut contient 'règlement de zonage' et '707-164'", () => {
    expect(PV_VARENNES_2026_04_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_VARENNES_2026_04_TEXT).toContain("707-164");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ProcesVerbauxGenericAdapter.list() — Mont-Saint-Hilaire (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Mont-Saint-Hilaire (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_MSH_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(MONT_SAINT_HILAIRE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 5 refs PV dans la fenêtre 6 mois", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("tous les refs ont city 'mont-saint-hilaire'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("mont-saint-hilaire");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ProcesVerbauxGenericAdapter.list() — Boucherville (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Boucherville (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_BOUCHERVILLE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(BOUCHERVILLE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 5 refs dans la fenêtre 6 mois", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("tous les refs ont city 'boucherville'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("boucherville");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Varennes (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Varennes (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_VARENNES_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(VARENNES_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 8 refs PV dans la fenêtre 6 mois (ODJ + PV)", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(8);
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("tous les refs ont city 'varennes'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("varennes");
    }
  });
});
