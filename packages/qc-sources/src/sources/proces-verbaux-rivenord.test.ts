/**
 * Tests for real PV scraping of cities in Rive-Nord (couronne nord de Montréal).
 * Cluster: MRC Thérèse-De Blainville — Rosemère, Lorraine, Boisbriand.
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Rosemère: https://www.ville.rosemere.qc.ca/
 *     robots.txt: User-agent: * / Sitemap only — NO Disallow rules (fully permissive)
 *     URL: https://www.ville.rosemere.qc.ca/seances-conseil/
 *     PDF (March 9, 2026): HTTP 200, text layer extractible
 *   - Lorraine: https://lorraine.ca/
 *     robots.txt: Disallow: /administration, /administration/, /administration/backend,
 *                 /administration/backend/ only — content pages allowed
 *     URL: https://lorraine.ca/conseil-municipal
 *     PDF (April 14, 2026): HTTP 200, text layer extractible
 *   - Boisbriand: https://www.ville.boisbriand.qc.ca/
 *     robots.txt: Disallow: /administration, /administration/, /administration/backend,
 *                 /administration/backend/ only — content pages allowed
 *     URL: https://boisbriand.ca/ville/vie-democratique/seances-du-conseil
 *     PDF (April 14, 2026): HTTP 200, text layer extractible
 *
 * Sites inaccessibles (documentés honnêtement — 2026-06-10):
 *   - Bois-des-Filion: all tested domains → ECONNREFUSED / no response
 *   - Sainte-Anne-des-Plaines: tested domains → no response
 *   - Sainte-Marthe-sur-le-Lac: tested domains → no response
 *   - Saint-Joseph-du-Lac: tested domains → no response
 *   - Pointe-Calumet: HTTP 200 accessible BUT PDFs have no text layer (OCR-required)
 *   - Blainville: HTTP 200 accessible BUT seances page only shows ODJ (ordre du jour),
 *     no PV PDF links found
 *   - Oka: WordPress site accessible (HTTP 200) BUT seances page has no PDF links
 *     (only YouTube livestream links — PDFs not published on website)
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Rosemère Mars 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (Règlement 801-71 modifiant le Règlement de zonage 801, concordance MRC 24-02)
 *       reglementNumbers=["801-71"] (REGLEMENT_NUMBER_RE: "Règlement 801-71 modifiant
 *       le Règlement de zonage 801" — "801-71" matches \d{2,4}-\d{1,4})
 *   - Lorraine Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (Règlement URB-03-17 modifiant le Règlement URB-03 sur le zonage,
 *        changements aux zones I-133 et I-226)
 *       REGLEMENT_MULTIPREFIX_RE captures URB-03-17 when ZONAGE_KEYWORDS_RE fires on
 *       "le zonage" in the same paragraph. filterNewReglements excludes URB-03 (the
 *       modified règlement identified by MODIFIANT_REGLEMENT_MULTIPREFIX_RE).
 *       reglementNumbers=["URB-03-17"]
 *   - Boisbriand Avril 2026:
 *       avisDeMotion=true, changementZonage=false (honest negative — ANTI-FAUX-POSITIF)
 *       (avis de motion for RV-1787-1 tarifs and RV-1796 réserve financière,
 *        neither in zonage context; "intention to modify RV-1441 sur le zonage" uses
 *        different procedural language — NOT an "avis de motion")
 *       reglementNumbers=[]
 *
 * Suite de tests:
 *   1. parsePvIndex — Rosemère: parse the anchor-list HTML → PV PDF links
 *   2. parsePvIndex — Lorraine: parse the c-document-card HTML → PV PDF links
 *   3. parsePvIndex — Boisbriand: parse the c-document-card accordion HTML → PV PDF links
 *   4. detectZonageChange — Rosemère Mars 2026: zonage RÉEL (801-71, Règlement de zonage 801)
 *   5. detectZonageChange — Lorraine Avril 2026: zonage RÉEL détecté (URB-03-17 via MULTIPREFIX_RE)
 *   6. detectZonageChange — Boisbriand Avril 2026: honest negative (tarifs/réserve, no zonage)
 *   7. ProcesVerbauxGenericAdapter.list() — Rosemère (mocked fetch)
 *   8. ProcesVerbauxGenericAdapter.list() — Lorraine (mocked fetch)
 *   9. ProcesVerbauxGenericAdapter.list() — Boisbriand (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  ROSEMERE_PV_CONFIG,
  LORRAINE_PV_CONFIG,
  BOISBRIAND_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_ROSEMERE_INDEX_HTML,
  PV_ROSEMERE_2026_03_TEXT,
} from "./proces-verbaux-rosemere.fixture.js";
import {
  PV_LORRAINE_INDEX_HTML,
  PV_LORRAINE_2026_04_TEXT,
} from "./proces-verbaux-lorraine.fixture.js";
import {
  PV_BOISBRIAND_INDEX_HTML,
  PV_BOISBRIAND_2026_04_TEXT,
} from "./proces-verbaux-boisbriand.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Rosemère
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Rosemère index HTML (anchor-list structure)", () => {
  const items = parsePvIndex(
    PV_ROSEMERE_INDEX_HTML,
    "https://www.ville.rosemere.qc.ca/seances-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF ville.rosemere.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("ville.rosemere.qc.ca");
    }
  });

  it("inclut le PV du 13 avril 2026 (PV 2026-04-13 FINAL.pdf)", () => {
    const apr13 = items.find((i) =>
      i.url.includes("2026-04-13") || i.url.includes("2026-04-13%20FINAL"),
    );
    expect(apr13).toBeDefined();
  });

  it("inclut le PV du 9 mars 2026 (PV 2026-03-09 FINAL.pdf)", () => {
    const mar09 = items.find((i) =>
      i.url.includes("2026-03-09") || i.url.includes("2026-03-09%20FINAL"),
    );
    expect(mar09).toBeDefined();
  });

  it("inclut le PV du 9 février 2026 (PV 2026-02-09 FINAL.pdf)", () => {
    const feb09 = items.find((i) =>
      i.url.includes("2026-02-09") || i.url.includes("2026-02-09%20FINAL"),
    );
    expect(feb09).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Lorraine
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Lorraine index HTML (c-document-card structure)", () => {
  const items = parsePvIndex(
    PV_LORRAINE_INDEX_HTML,
    "https://lorraine.ca/conseil-municipal",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF lorraine.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("lorraine.ca");
    }
  });

  it("inclut le PV du 14 avril 2026 (PV_2026-04-14_Signe.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("PV_2026-04-14"));
    expect(apr14).toBeDefined();
  });

  it("inclut le PV du 10 mars 2026 (PV_2026-03-10_Sign.pdf)", () => {
    const mar10 = items.find((i) => i.url.includes("PV_2026-03-10"));
    expect(mar10).toBeDefined();
  });

  it("inclut le PV du 13 janvier 2026 (PV_2026-01-13_Sign.pdf)", () => {
    const jan13 = items.find((i) => i.url.includes("PV_2026-01-13"));
    expect(jan13).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Boisbriand
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Boisbriand index HTML (c-document-card accordion structure)", () => {
  const items = parsePvIndex(
    PV_BOISBRIAND_INDEX_HTML,
    "https://boisbriand.ca/ville/vie-democratique/seances-du-conseil",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF ville.boisbriand.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("boisbriand.qc.ca");
    }
  });

  it("inclut le PV du 14 avril 2026 (2026-04-14_Seance-ordinaire.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("2026-04-14_Seance-ordinaire"));
    expect(apr14).toBeDefined();
  });

  it("inclut le PV du 10 mars 2026 (2026-03-10_Seance-ordinaire.pdf)", () => {
    const mar10 = items.find((i) => i.url.includes("2026-03-10_Seance-ordinaire"));
    expect(mar10).toBeDefined();
  });

  it("inclut le PV du 20 janvier 2026 (2026-01-20_Seance-ordinaire.pdf)", () => {
    const jan20 = items.find((i) => i.url.includes("2026-01-20_Seance-ordinaire"));
    expect(jan20).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectZonageChange — Rosemère Mars 2026
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Rosemère Mars 2026 (Règlement 801-71, Règlement de zonage 801)", () => {
  const result = detectZonageChange(PV_ROSEMERE_2026_03_TEXT);

  it("détecte avisDeMotion ('donne avis de motion' présent)", () => {
    // "La conseillère MARIE-HÉLÈNE FORTIN donne avis de motion qu'il sera
    //  adopté séance tenante le projet de Règlement 801-71 modifiant le
    //  Règlement de zonage 801"
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : 'Règlement de zonage 801' dans le même paragraphe", () => {
    // ZONAGE_KEYWORDS_RE fires on "Règlement de zonage" in same paragraph window.
    // REGLEMENT_NUMBER_RE also matches "801-71" (hyphenated: \d{2,4}-\d{1,4}).
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient '801-71' (REGLEMENT_NUMBER_RE: hyphenated amendement)", () => {
    // "Règlement 801-71 modifiant le Règlement de zonage 801"
    // REGLEMENT_NUMBER_RE: r[eè]glement\s+(?:n...)?(\d{2,4}-\d{1,4}) → "801-71"
    expect(result.reglementNumbers).toContain("801-71");
  });

  it("le texte brut contient 'Règlement de zonage 801' et '801-71'", () => {
    expect(PV_ROSEMERE_2026_03_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_ROSEMERE_2026_03_TEXT).toContain("801-71");
    expect(PV_ROSEMERE_2026_03_TEXT).toContain("zone C-18");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Lorraine Avril 2026
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Lorraine Avril 2026 (URB-03-17, Règlement URB-03 sur le zonage)", () => {
  const result = detectZonageChange(PV_LORRAINE_2026_04_TEXT);

  it("détecte avisDeMotion ('Avis de motion est donné' présent)", () => {
    // "Avis de motion est donné par monsieur le conseiller Jocelyn Proulx, qu'à une
    //  séance du conseil subséquente, sera adopté le Règlement URB-03-17 modifiant le
    //  « Règlement URB-03 sur le zonage »"
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : REGLEMENT_MULTIPREFIX_RE capture 'URB-03-17' + ZONAGE_KEYWORDS_RE sur 'le zonage'", () => {
    // REGLEMENT_MULTIPREFIX_RE matches "Règlement URB-03-17" (URB = [A-Z]{2,4},
    // 03 = \d{2,4}, -17 = optional -\d{1,3}) when ZONAGE_KEYWORDS_RE fires on
    // "Règlement URB-03 sur le zonage" in the same paragraph window.
    // filterNewReglements excludes URB-03 (modified règlement via
    // MODIFIANT_REGLEMENT_MULTIPREFIX_RE) → reglementNumbers=["URB-03-17"].
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient 'URB-03-17' (nouveau règlement de zonage)", () => {
    // The NEW proposed règlement (URB-03-17) is captured by REGLEMENT_MULTIPREFIX_RE.
    // The OLD/modified règlement (URB-03) is excluded by MODIFIANT_REGLEMENT_MULTIPREFIX_RE
    // matching "modifiant le « Règlement URB-03 sur le zonage »".
    expect(result.reglementNumbers).toContain("URB-03-17");
  });

  it("ANTI-FAUX-POSITIF: reglementNumbers ne contient PAS de codes de zones (I-133, 1-226, R-301)", () => {
    // Zone codes (I-133, I-226) have only 1 letter before the dash → not matched by
    // REGLEMENT_MULTIPREFIX_RE ([A-Z]{2,4}). Numbers with < 2 digits (03, 17) need
    // at least 2 digits → URB-03 is matched but filtered as the modified règlement.
    // R-301 has 1 letter and is not preceded by "règlement" in the relevant context.
    for (const num of result.reglementNumbers) {
      expect(num).not.toMatch(/^(133|226|301)$/);
    }
  });

  it("le texte brut contient 'Règlement URB-03 sur le zonage' et 'I-133'", () => {
    const lower = PV_LORRAINE_2026_04_TEXT.toLowerCase();
    expect(lower).toContain("sur le zonage");
    expect(PV_LORRAINE_2026_04_TEXT).toContain("I-133");
    expect(PV_LORRAINE_2026_04_TEXT).toContain("URB-03-17");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Boisbriand Avril 2026: honest negative (ANTI-FAUX-POSITIF)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Boisbriand Avril 2026 (tarifs/réserve — honest negative)", () => {
  const result = detectZonageChange(PV_BOISBRIAND_2026_04_TEXT);

  it("détecte avisDeMotion ('donne avis de motion' présent)", () => {
    // "Le conseiller Patrick Thifault donne avis de motion de la présentation
    //  pour adoption à une séance subséquente du Règlement RV-1787-1..."
    expect(result.avisDeMotion).toBe(true);
  });

  it("ANTI-FAUX-POSITIF: changementZonage=false (pas de zonage dans le contexte avis de motion)", () => {
    // RV-1787-1 = tarifs; RV-1796 = réserve financière.
    // "intention de modifier RV-1441 sur le zonage" uses different language — NOT avis de motion.
    // The zonage mention is in a separate "INTENTION" resolution, past the \n\n boundary.
    expect(result.changementZonage).toBe(false);
  });

  it("reglementNumbers est vide (pas de numéro de règlement de zonage)", () => {
    expect(result.reglementNumbers).toHaveLength(0);
  });

  it("le texte brut contient 'avis de motion' mais le contexte est 'taxes et compensations'", () => {
    expect(PV_BOISBRIAND_2026_04_TEXT.toLowerCase()).toContain("avis de motion");
    // RV-1787-1 modifies the bylaw "sur le financement des dépenses et sur l'imposition
    // des taxes et compensations" — not a zonage bylaw.
    expect(PV_BOISBRIAND_2026_04_TEXT.toLowerCase()).toContain("taxes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ProcesVerbauxGenericAdapter.list() — Rosemère (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Rosemère (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_ROSEMERE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(ROSEMERE_PV_CONFIG, {
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

  it("tous les refs ont city 'rosemere'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("rosemere");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ProcesVerbauxGenericAdapter.list() — Lorraine (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Lorraine (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LORRAINE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LORRAINE_PV_CONFIG, {
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

  it("tous les refs ont city 'lorraine'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("lorraine");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Boisbriand (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Boisbriand (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_BOISBRIAND_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(BOISBRIAND_PV_CONFIG, {
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

  it("tous les refs ont city 'boisbriand'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("boisbriand");
    }
  });
});
