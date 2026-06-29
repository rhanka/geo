/**
 * Tests for real PV scraping of cities near Montréal (Rive-Sud cluster).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, no CAPTCHA):
 *   - Sainte-Catherine: https://www.ville.sainte-catherine.qc.ca/
 *     robots.txt: Disallow /craft/ only
 *   - Saint-Constant: https://saint-constant.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *
 * Test suite:
 *   1. detectZonageChange — PARSER LIMITATION (Saint-Constant May 2026 PV:
 *      real zonage change règlements 1926-26/1927-26 present in text but the
 *      parser uses "NUMÉRO" style which REGLEMENT_NUMBER_RE does not match.
 *      avisDeMotion=true but changementZonage=false — honest limitation, documented).
 *   2. detectZonageChange — NEGATIVE (Sainte-Catherine May 2026 PV, avis de
 *      motion for circulation + emprunt — NO zonage change in this PV).
 *   3. parsePvIndex — Sainte-Catherine PV index HTML: parses 2026 PV links.
 *   4. parsePvIndex — Saint-Constant PV index HTML: parses 2026 PV links.
 *   5. ProcesVerbauxGenericAdapter — Sainte-Catherine list() with mocked fetch.
 *   6. ProcesVerbauxGenericAdapter — Saint-Constant list() with mocked fetch.
 *   7. isAvisLieAuZonage — Saint-Constant avis publics 1926-26 (projet règlement
 *      de zonage consultation publique) classified as zonage.
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  filterPvByWindow,
  parsePvIndex,
  PV_NON_DISPONIBLE,
} from "./proces-verbaux-parser.js";
import {
  SAINTE_CATHERINE_PV_CONFIG,
  SAINT_CONSTANT_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_SAINTE_CATHERINE_INDEX_HTML,
  PV_SAINTE_CATHERINE_2026_05_TEXT,
} from "./proces-verbaux-sainte-catherine.fixture.js";
import {
  PV_SAINT_CONSTANT_INDEX_HTML,
  PV_SAINT_CONSTANT_2026_05_TEXT,
} from "./proces-verbaux-saint-constant.fixture.js";
import { isAvisLieAuZonage } from "./avis-publics-generic.js";
import { inferAvisType } from "./avis-publics-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectZonageChange — DÉTECTION RÉELLE (Saint-Constant May 2026)
//    Real zonage change present in the live PV text, now auto-detected after the
//    REGLEMENT_NUMBER_RE fix (supports "RÈGLEMENT NUMÉRO 1926-26", full "numéro"
//    word). Règlements 1926-26 & 1927-26 modify zoning bylaw 1528-17, zone H-431.
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – DÉTECTION RÉELLE (Saint-Constant May 2026, style 'NUMÉRO')", () => {
  const result = detectZonageChange(PV_SAINT_CONSTANT_2026_05_TEXT);

  it("détecte avisDeMotion (motions présentes dans le texte réel)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("extrait les n° de règlement réels en style 'NUMÉRO' (1926-26, 1927-26)", () => {
    // REGLEMENT_NUMBER_RE handles "règlement numéro 1926-26" (full word "numéro"),
    // in addition to "règlement no/n° X". Saint-Constant uses the "NUMÉRO" style.
    expect(result.reglementNumbers).toContain("1926-26");
    expect(result.reglementNumbers).toContain("1927-26");
  });

  it("lève changementZonage=true (vrai changement de zonage détecté)", () => {
    // The real PV contains a zonage change: 1926-26 & 1927-26 modify zoning bylaw
    // 1528-17, zone H-431. Auto-detected via "règlement de zonage" + n° règlement.
    expect(result.changementZonage).toBe(true);
  });

  it("référence la zone réelle H-431", () => {
    expect(result.zoneRefs).toContain("H-431");
  });

  it("le texte brut contient bien les mots-clés attendus", () => {
    const lower = PV_SAINT_CONSTANT_2026_05_TEXT.toLowerCase();
    expect(lower).toContain("1926-26");
    expect(lower).toContain("règlement de zonage");
    expect(lower).toContain("1528-17");
    expect(lower).toContain("h-431");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. detectZonageChange — NEGATIVE (Sainte-Catherine May 2026, no zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – NEGATIVE (Sainte-Catherine May 2026, circulation + emprunt)", () => {
  const result = detectZonageChange(PV_SAINTE_CATHERINE_2026_05_TEXT);

  it("détecte avisDeMotion (motions présentes)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("ne lève PAS changementZonage (pas de référence à un règlement de zonage)", () => {
    // The motions are for circulation (1008-00-50) and emprunt (944-26).
    // Neither references "règlement de zonage" → changementZonage must be false.
    expect(result.changementZonage).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Sainte-Catherine HTML: real 2026 PV links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Sainte-Catherine index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_SAINTE_CATHERINE_INDEX_HTML,
    "https://www.ville.sainte-catherine.qc.ca/ville/conseil-municipal/seances-publiques/",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF Sainte-Catherine", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("ville.sainte-catherine.qc.ca");
    }
  });

  it("inclut le PV du 12 mai 2026 (PvCm-20260512)", () => {
    const may12 = items.find((i) => i.url.includes("PvCm-20260512"));
    expect(may12).toBeDefined();
  });

  it("inclut le PV du 2 juin 2026 (2026-06-02-PV-Extraordinaire)", () => {
    const jun2 = items.find((i) => i.url.includes("2026-06-02-PV-Extraordinaire"));
    expect(jun2).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parsePvIndex — Saint-Constant HTML: real 2026 PV links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Constant index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_SAINT_CONSTANT_INDEX_HTML,
    "https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF saint-constant.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("saint-constant.ca");
    }
  });

  it("inclut le PV du 19 mai 2026 (2026-05-19_PV_Seance_ordinaire)", () => {
    const may19 = items.find((i) => i.url.includes("2026-05-19_PV_Seance_ordinaire"));
    expect(may19).toBeDefined();
  });

  it("inclut le titre contenant 'Procès-verbal'", () => {
    const withTitle = items.filter((i) =>
      i.title.toLowerCase().includes("procès-verbal") ||
      i.title.toLowerCase().includes("proces-verbal"),
    );
    expect(withTitle.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ProcesVerbauxGenericAdapter — Sainte-Catherine list() with mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Sainte-Catherine (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINTE_CATHERINE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINTE_CATHERINE_PV_CONFIG, {
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

  it("tous les refs ont city 'sainte-catherine'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("sainte-catherine");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ProcesVerbauxGenericAdapter — Saint-Constant list() with mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Saint-Constant (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINT_CONSTANT_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINT_CONSTANT_PV_CONFIG, {
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

  it("tous les refs ont city 'saint-constant'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("saint-constant");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. isAvisLieAuZonage — Saint-Constant avis publics 1926-26 (real)
// ─────────────────────────────────────────────────────────────────────────────

describe("isAvisLieAuZonage – Saint-Constant avis publics 2026 (réels)", () => {
  it("Consultation publique projet règlement 1926-26 — inferAvisType retourne 'consultation' (priorité du mot 'consultation')", () => {
    // Real title from saint-constant.ca/fr/seances-du-conseil-et-documents-publics
    // fetched 2026-06-10: "Consultation publique sur le projet de règlement numéro 1926-26"
    // inferAvisType returns "consultation" because "consultation" keyword takes precedence
    // over "projet" + "règlement" in the current priority order. Honest result.
    const title = "Consultation publique sur le projet de règlement numéro 1926-26";
    const avisType = inferAvisType(title);
    expect(avisType).toBe("consultation");
  });

  it("Consultation publique projet règlement 1926-26 détecté comme zonage via 'projet de règlement' (positif)", () => {
    // Even as type "consultation", the title "Consultation publique sur le projet de règlement"
    // contains "projet" + "règlement" — but isAvisLieAuZonage only checks the title for
    // "projet de règlement" (keyword "projet de règlement" / "projet de reglement").
    const title = "Consultation publique sur le projet de règlement numéro 1926-26";
    const avisType = inferAvisType(title); // "consultation"
    expect(
      isAvisLieAuZonage({
        title,
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://saint-constant.ca/uploads/Greffe/AvisPublics2025/Avis_publics_2026/CP/CP_Proj_reg_1926-26.pdf",
        type: avisType,
        bylaws: ["1926-26"],
      }),
    ).toBe(true);
  });

  it("Entrée en vigueur règlement 1917-26 non classé comme zonage sans contexte (conservateur)", () => {
    // Real avis: "Entrée en vigueur - Règlement numéro 1917-26"
    // No explicit "zonage" keyword in title → honest negative
    const title = "Entrée en vigueur - Règlement numéro 1917-26";
    const avisType = inferAvisType(title);
    expect(avisType).toBe("entree-en-vigueur");
    expect(
      isAvisLieAuZonage({
        title,
        dateLabel: "non-disponible",
        dateIso: "non-disponible",
        url: "https://saint-constant.ca/uploads/Greffe/AvisPublics2025/Avis_publics_2026/EEV1917-26.pdf",
        type: avisType,
        bylaws: ["1917-26"],
      }),
    ).toBe(false);
  });

  it("filterPvByWindow inclut les items dans la fenêtre 6 mois", () => {
    const items = parsePvIndex(
      PV_SAINT_CONSTANT_INDEX_HTML,
      "https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics",
    );
    // Window: 2025-12-10 to 2026-06-10 (6 months)
    const filtered = filterPvByWindow(items, "2025-12-10", "2026-06-10");
    // All 2026 items should be within window
    const allInWindow = filtered.every(
      (i) =>
        i.dateIso === PV_NON_DISPONIBLE ||
        (i.dateIso >= "2025-12-10" && i.dateIso <= "2026-06-10"),
    );
    expect(allInWindow).toBe(true);
    // Conservative: items with NON_DISPONIBLE dates included
    const ndItems = items.filter((i) => i.dateIso === PV_NON_DISPONIBLE);
    for (const nd of ndItems) {
      expect(filtered).toContain(nd);
    }
  });
});
