/**
 * Tests for real PV scraping of cities in MRC Vaudreuil-Soulanges near Montréal.
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Les Cèdres: https://www.ville.lescedres.qc.ca/
 *     robots.txt: Disallow /admin/, /includes/ — content pages allowed.
 *     URL: https://www.ville.lescedres.qc.ca/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour
 *   - Pincourt: https://www.villepincourt.qc.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://www.villepincourt.qc.ca/fr/la-ville/administration/seances-et-proces-verbaux
 *   - Coteau-du-Lac: https://coteau-du-lac.com/
 *     robots.txt: Disallow /administration — content/media pages allowed.
 *     URL: https://coteau-du-lac.com/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux
 *   - Les Coteaux: https://les-coteaux.qc.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://les-coteaux.qc.ca/citoyens/greffe/seance-du-conseil/
 *
 * Sites inaccessibles ou sans couche texte (documentés honnêtement — 2026-06-10):
 *   - Saint-Lazare (ville.saint-lazare.qc.ca): HTTP 403 — bloqué
 *   - L'Île-Perrot (ile-perrot.qc.ca): ECONNREFUSED
 *   - Notre-Dame-de-l'Île-Perrot (ndip.org): HTTP 200, mais PDFs non publiés (page vide)
 *   - Saint-Zotique (st-zotique.com): ECONNREFUSED (au moment du test réseau)
 *   - Rigaud (ville.rigaud.qc.ca): ECONNREFUSED
 *   - Saint-Polycarpe (stpolycarpe.ca): ECONNREFUSED (DNS ne répond pas)
 *   - Vaudreuil-sur-le-Lac (vsll.ca): HTTP 200 mais PV non publiés (administration provisoire)
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Les Cèdres Mai 2026:
 *       avisDeMotion=true, changementZonage=false
 *       (motions 540-2026, 541-2026, 542-2026 pour drainage — pas de "zonage" dans le PV)
 *   - Pincourt Mai 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (780-33 modifiant le Règlement de zonage no 780 — gîte touristique restriction)
 *   - Coteau-du-Lac Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (URB-400 — AVIS DE MOTION pour modification zones RO-2..RO-7)
 *   - Les Coteaux Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (317-01 modifiant Règlement de zonage numéro 317 — correctifs remplacement)
 *
 * Suite de tests:
 *   1. parsePvIndex — Les Cèdres: parse les liens PDF table HTML (URLs relatives)
 *   2. parsePvIndex — Pincourt: parse les liens PDF liste HTML (URLs absolues)
 *   3. parsePvIndex — Coteau-du-Lac: parse les liens PDF liste HTML (URLs absolues)
 *   4. parsePvIndex — Les Coteaux: parse les liens PDF liste HTML WordPress
 *   5. detectZonageChange — Les Cèdres Mai 2026: 3 motions drainage, 0 zonage
 *   6. detectZonageChange — Pincourt Mai 2026: zonage RÉEL détecté (780-33)
 *   7. detectZonageChange — Coteau-du-Lac Avril 2026: zonage RÉEL détecté (URB-400)
 *   8. detectZonageChange — Les Coteaux Avril 2026: zonage RÉEL détecté (317-01)
 *   9. ProcesVerbauxGenericAdapter.list() — Les Cèdres (mocked fetch)
 *   10. ProcesVerbauxGenericAdapter.list() — Pincourt (mocked fetch)
 *   11. ProcesVerbauxGenericAdapter.list() — Coteau-du-Lac (mocked fetch)
 *   12. ProcesVerbauxGenericAdapter.list() — Les Coteaux (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  LES_CEDRES_PV_CONFIG,
  PINCOURT_PV_CONFIG,
  COTEAU_DU_LAC_PV_CONFIG,
  LES_COTEAUX_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_LES_CEDRES_INDEX_HTML,
  PV_LES_CEDRES_2026_05_TEXT,
} from "./proces-verbaux-les-cedres.fixture.js";
import {
  PV_PINCOURT_INDEX_HTML,
  PV_PINCOURT_2026_05_TEXT,
} from "./proces-verbaux-pincourt.fixture.js";
import {
  PV_COTEAU_DU_LAC_INDEX_HTML,
  PV_COTEAU_DU_LAC_2026_04_TEXT,
} from "./proces-verbaux-coteau-du-lac.fixture.js";
import {
  PV_LES_COTEAUX_INDEX_HTML,
  PV_LES_COTEAUX_2026_04_TEXT,
} from "./proces-verbaux-les-coteaux.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Les Cèdres: table HTML with relative PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Les Cèdres index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_LES_CEDRES_INDEX_HTML,
    "https://www.ville.lescedres.qc.ca/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF ville.lescedres.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("lescedres.qc.ca");
    }
  });

  it("inclut le PV du 12 mai 2026 (pv_ass_2026_05_12.pdf)", () => {
    const may12 = items.find((i) => i.url.includes("2026_05_12"));
    expect(may12).toBeDefined();
  });

  it("inclut le PV du 20 janvier 2026 (0._pv_ass_2026_01_20.pdf)", () => {
    const jan20 = items.find((i) => i.url.includes("2026_01_20"));
    expect(jan20).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Pincourt: list HTML with absolute PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Pincourt index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_PINCOURT_INDEX_HTML,
    "https://www.villepincourt.qc.ca/fr/la-ville/administration/seances-et-proces-verbaux",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF villepincourt.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("villepincourt.qc.ca");
    }
  });

  it("inclut le PV du 12 mai 2026 (2026-05-12_-_PV_OFFICIEL.pdf)", () => {
    const may12 = items.find((i) => i.url.includes("2026-05-12"));
    expect(may12).toBeDefined();
  });

  it("inclut le PV du 20 janvier 2026 (2026-01-20_-_PV_OFFICIEL.pdf)", () => {
    const jan20 = items.find((i) => i.url.includes("2026-01-20"));
    expect(jan20).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Coteau-du-Lac: list HTML with absolute PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Coteau-du-Lac index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_COTEAU_DU_LAC_INDEX_HTML,
    "https://coteau-du-lac.com/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux",
  );

  it("parse au moins 8 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(8);
  });

  it("tous les items ont des URLs https PDF coteau-du-lac.com", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("coteau-du-lac.com");
    }
  });

  it("inclut le PV du 14 avril 2026 (FINAL_PVSO14avril2026-version-approuve.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("14avril2026"));
    expect(apr14).toBeDefined();
  });

  it("inclut le PV du 13 janvier 2026 (FINAL_PVSO13janvier2026.pdf)", () => {
    const jan13 = items.find((i) => i.url.includes("13janvier2026"));
    expect(jan13).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parsePvIndex — Les Coteaux: WordPress list HTML
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Les Coteaux index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_LES_COTEAUX_INDEX_HTML,
    "https://les-coteaux.qc.ca/citoyens/greffe/seance-du-conseil/",
  );

  it("parse au moins 4 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it("tous les items ont des URLs https PDF les-coteaux.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("les-coteaux.qc.ca");
    }
  });

  it("inclut le PV du 20 avril 2026 (pv_so_20260420.pdf)", () => {
    const apr20 = items.find((i) => i.url.includes("20260420"));
    expect(apr20).toBeDefined();
  });

  it("inclut le PV du 19 janvier 2026 (pv_so_20260119.pdf)", () => {
    const jan19 = items.find((i) => i.url.includes("20260119"));
    expect(jan19).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Les Cèdres Mai 2026: drainage motions, 0 zonage
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Les Cèdres Mai 2026 (drainage 540-542, pas de zonage)", () => {
  const result = detectZonageChange(PV_LES_CEDRES_2026_05_TEXT);

  it("détecte avisDeMotion (3 motions drainage 540-2026, 541-2026, 542-2026)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("ne lève PAS changementZonage (motions pour drainage, aucun mot 'zonage' dans le PV)", () => {
    // All 3 motions are for drainage borrowing/spending, NOT for any zonage règlement.
    // The word "zonage" does not appear anywhere in the Les Cèdres May 2026 PV.
    expect(result.changementZonage).toBe(false);
  });

  it("reglementNumbers est vide (540-2026, 541-2026, 542-2026 ne sont pas zonage)", () => {
    expect(result.reglementNumbers).toEqual([]);
  });

  it("le texte ne contient pas 'zonage'", () => {
    expect(PV_LES_CEDRES_2026_05_TEXT.toLowerCase()).not.toContain("zonage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Pincourt Mai 2026: zonage réel 780-33, détecté
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Pincourt Mai 2026 (780-33 gîte touristique — zonage réel détecté)", () => {
  const result = detectZonageChange(PV_PINCOURT_2026_05_TEXT);

  it("détecte avisDeMotion ('avis de motion a été donné' pour Règlement no 780-33)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (780-33 modifiant le Règlement de zonage no 780)", () => {
    // The May 12, 2026 PV contains "Considérant qu'un avis de motion a été donné pour
    // le projet de Règlement no 780-33 modifiant le Règlement de zonage et de plans
    // d'implantation et d'intégration architecturale no 780".
    // "Règlement de zonage" appears in the same paragraph as "avis de motion".
    expect(result.changementZonage).toBe(true);
  });

  it("le texte contient 'Règlement de zonage' et '780-33' dans le même contexte", () => {
    expect(PV_PINCOURT_2026_05_TEXT).toContain("780-33");
    expect(PV_PINCOURT_2026_05_TEXT.toLowerCase()).toContain("règlement de zonage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. detectZonageChange — Coteau-du-Lac Avril 2026: avisDeMotion=true, zonage
//    détecté sur le second avis (160-04-2026) via "règlement de zonage"
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Coteau-du-Lac Avril 2026 (avis de motion RO-2..RO-7, Règlement de zonage no URB-400)", () => {
  const result = detectZonageChange(PV_COTEAU_DU_LAC_2026_04_TEXT);

  it("détecte avisDeMotion ('AVIS DE MOTION est donné' ou 'avis de motion a été déposé' présents)", () => {
    // Resolution 159-04-2026 contains "AVIS DE MOTION est donné" and
    // resolution 160-04-2026 contains "avis de motion a été déposé" — both
    // reference the modification of zones RO-2..RO-7 of the Règlement de zonage no URB-400.
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : REGLEMENT_MULTIPREFIX_RE capture 'URB-400' via 'Règlement de zonage no URB-400'", () => {
    // The header paragraph "159-04-2026\nAvis de motion. Modification...du Règlement de
    // zonage no URB-400" is captured in the backward window of the first "Avis de motion"
    // match (no \n\n before it in the excerpt). REGLEMENT_MULTIPREFIX_RE matches
    // "Règlement de zonage no URB-400" (URB = [A-Z]{2,4}, 400 = \d{2,4}) and
    // ZONAGE_KEYWORDS_RE fires on "de zonage".
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient 'URB-400' (règlement de zonage cible)", () => {
    // URB-400 is the municipal zonage bylaw being amended for zones RO-2..RO-7.
    // It is captured by REGLEMENT_MULTIPREFIX_RE from "Règlement de zonage no URB-400".
    expect(result.reglementNumbers).toContain("URB-400");
  });

  it("ANTI-FAUX-POSITIF: reglementNumbers ne contient PAS les codes de zones RO-2..RO-7", () => {
    // RO-2, RO-3, RO-4, RO-5, RO-7 have only 1 digit after the dash — they do NOT
    // satisfy \d{2,4} (min 2 digits) in REGLEMENT_MULTIPREFIX_RE. They are zone codes
    // not règlement numbers. Verbatim anti-FP check.
    for (const num of result.reglementNumbers) {
      expect(num).not.toMatch(/^RO-[2-9]$/);
    }
  });

  it("le texte contient 'Règlement de zonage no URB-400' et les zones RO-2..RO-7", () => {
    expect(PV_COTEAU_DU_LAC_2026_04_TEXT).toContain("Règlement de zonage no URB-400");
    expect(PV_COTEAU_DU_LAC_2026_04_TEXT).toContain("RO-2");
    expect(PV_COTEAU_DU_LAC_2026_04_TEXT).toContain("RO-7");
  });

  it("le texte contient 'règlement de zonage' (en minuscules) dans le contexte 160-04-2026", () => {
    // Resolution 160-04-2026 references "le règlement de zonage qui sont applicables"
    // which confirms the zonage keyword is present in the abandonment context.
    expect(PV_COTEAU_DU_LAC_2026_04_TEXT.toLowerCase()).toContain("règlement de zonage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. detectZonageChange — Les Coteaux Avril 2026: zonage réel 317-01
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Les Coteaux Avril 2026 (317-01 correctifs zonage — zonage réel)", () => {
  const result = detectZonageChange(PV_LES_COTEAUX_2026_04_TEXT);

  it("détecte avisDeMotion (avis de motion pour 317-01 et 167-2022-01)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage (317-01 modifie le règlement de zonage 317 — détection réelle)", () => {
    // The April 20, 2026 PV adopts "RÈGLEMENT NUMÉRO 317-01 MODIFIANT LE RÈGLEMENT DE
    // ZONAGE NUMÉRO 317". The widened backward window (PR #110) now reaches the heading,
    // so the real zoning change is detected — matching the documented reality. The
    // parser identifies the targeted zoning bylaw (317); 167-2022-01 (contrôle des
    // chiens) reste exclu (hors contexte zonage).
    expect(result.changementZonage).toBe(true);
    expect(result.reglementNumbers).toContain("317");
    expect(result.reglementNumbers).not.toContain("167-2022-01");
  });

  it("le texte contient 'RÈGLEMENT DE ZONAGE NUMÉRO 317' (en-tête) et '317-01'", () => {
    // Note: pdftotext wraps "Règlement de\nzonage numéro 317" across lines;
    // the verbatim heading is all-caps: "RÈGLEMENT DE ZONAGE NUMÉRO 317".
    expect(PV_LES_COTEAUX_2026_04_TEXT).toContain("RÈGLEMENT DE ZONAGE NUMÉRO 317");
    expect(PV_LES_COTEAUX_2026_04_TEXT).toContain("317-01");
  });

  it("le texte contient aussi l'avis de motion 167-2022-01 (contrôle chiens — pas zonage)", () => {
    // 167-2022-01 is about dog control, not zonage. Its avis de motion is also present.
    expect(PV_LES_COTEAUX_2026_04_TEXT).toContain("167-2022-01");
    expect(PV_LES_COTEAUX_2026_04_TEXT).toContain("donnent avis de motion");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Les Cèdres (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Les Cèdres (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LES_CEDRES_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LES_CEDRES_PV_CONFIG, {
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

  it("tous les refs ont city 'les-cedres'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("les-cedres");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ProcesVerbauxGenericAdapter.list() — Pincourt (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Pincourt (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_PINCOURT_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(PINCOURT_PV_CONFIG, {
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

  it("tous les refs ont city 'pincourt'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("pincourt");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ProcesVerbauxGenericAdapter.list() — Coteau-du-Lac (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Coteau-du-Lac (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_COTEAU_DU_LAC_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(COTEAU_DU_LAC_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 8 refs PV dans la fenêtre 6 mois", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(8);
  });

  it("tous les refs ont city 'coteau-du-lac'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("coteau-du-lac");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. ProcesVerbauxGenericAdapter.list() — Les Coteaux (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Les Coteaux (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LES_COTEAUX_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LES_COTEAUX_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 4 refs PV dans la fenêtre 6 mois", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  it("tous les refs ont city 'les-coteaux'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("les-coteaux");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});
