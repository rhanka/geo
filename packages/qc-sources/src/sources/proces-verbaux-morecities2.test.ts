/**
 * Tests for real PV scraping of additional cities near Montréal (round 2).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK):
 *   - Sainte-Martine: https://sainte-martine.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux
 *   - Candiac: https://candiac.ca/
 *     robots.txt: Disallow: /admin, /uploads/carrier — content pages allowed
 *     URL: https://candiac.ca/la-ville/vie-democratique/seances-publiques
 *   - Saint-Rémi: https://www.saint-remi.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/
 *
 * Sites inaccessibles (000 / connect timeout — documentés honnêtement):
 *   - Saint-Philippe, Saint-Mathieu, Saint-Isidore, Léry, Pincourt,
 *     Notre-Dame-de-l'Île-Perrot: DNS ne résout pas / connexion refusée 2026-06-10.
 *   - Les Cèdres: HTTP 403 Forbidden sur le site principal.
 *   - Mercier: HTTP 404 sur la page ciblée (URL correcte introuvable).
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Sainte-Martine Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 2026-510 modifiant le règlement de zonage 2019-342, zone MxtV-2)
 *   - Candiac: PV text non disponible (PDFs scannés, aucune couche texte)
 *       → détection non applicable; index listing OK (≥5 refs PDF dans la fenêtre)
 *   - Saint-Rémi Avril 2026:
 *       avisDeMotion=true, changementZonage=true (DÉTECTION RÉELLE)
 *       (V654-2026-33 amendant règlement de zonage V654-2017-00 — capturé par
 *       REGLEMENT_VPREFIX_RE quand contexte contient "règlement de zonage")
 *       reglementNumbers=[V654-2026-33]
 *
 * Suite de tests:
 *   1. parsePvIndex — Sainte-Martine: parse les liens PDF directs (document-item structure)
 *   2. parsePvIndex — Candiac: parse les liens PDF directs (ul/li structure)
 *   3. parsePvIndex — Saint-Rémi: parse les liens PDF directs (Elementor accordion structure)
 *   4. detectZonageChange — Sainte-Martine Avril 2026: zonage RÉEL détecté (2026-510)
 *   5. detectZonageChange — Saint-Rémi Avril 2026: avisDeMotion=true, changementZonage=true
 *      (V654-2026-33 détecté via REGLEMENT_VPREFIX_RE, V654-2017-00 exclu comme modifié)
 *   6. ProcesVerbauxGenericAdapter.list() — Sainte-Martine (mocked fetch)
 *   7. ProcesVerbauxGenericAdapter.list() — Candiac (mocked fetch)
 *   8. ProcesVerbauxGenericAdapter.list() — Saint-Rémi (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  SAINTE_MARTINE_PV_CONFIG,
  CANDIAC_PV_CONFIG,
  SAINT_REMI_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_SAINTE_MARTINE_INDEX_HTML,
  PV_SAINTE_MARTINE_2026_04_TEXT,
} from "./proces-verbaux-sainte-martine.fixture.js";
import {
  PV_CANDIAC_INDEX_HTML,
  PV_CANDIAC_SCANNED_NOTE,
} from "./proces-verbaux-candiac.fixture.js";
import {
  PV_SAINT_REMI_INDEX_HTML,
  PV_SAINT_REMI_2026_04_TEXT,
} from "./proces-verbaux-saint-remi.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Sainte-Martine: document-item structure with nested <h3>
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Sainte-Martine index HTML (publications page)", () => {
  const items = parsePvIndex(
    PV_SAINTE_MARTINE_INDEX_HTML,
    "https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF sainte-martine.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("sainte-martine.ca");
    }
  });

  it("inclut le PV du 14 avril 2026 (conseil-avril-2026.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("conseil-avril-2026.pdf"));
    expect(apr14).toBeDefined();
  });

  it("inclut le PV du 17 mars 2026 (conseil-mars-2026-vf.pdf)", () => {
    const mar17 = items.find((i) => i.url.includes("conseil-mars-2026-vf.pdf"));
    expect(mar17).toBeDefined();
  });

  it("inclut le PV du 18 novembre 2025 (conseil-novembre-2025-vf.pdf)", () => {
    const nov18 = items.find((i) => i.url.includes("conseil-novembre-2025-vf.pdf"));
    expect(nov18).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Candiac: ul/li structure with direct PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Candiac index HTML (séances-publiques page)", () => {
  const items = parsePvIndex(
    PV_CANDIAC_INDEX_HTML,
    "https://candiac.ca/la-ville/vie-democratique/seances-publiques",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF candiac.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("candiac.ca");
    }
  });

  it("inclut le PV du 20 avril 2026 (2026-04-20_pv_SIGNE.pdf)", () => {
    const apr20 = items.find((i) => i.url.includes("2026-04-20_pv_SIGNE.pdf"));
    expect(apr20).toBeDefined();
  });

  it("inclut le PV du 25 mai 2026 (2026-05-25_pv_NON_APPROUVE.pdf)", () => {
    const may25 = items.find((i) => i.url.includes("2026-05-25_pv_NON_APPROUVE.pdf"));
    expect(may25).toBeDefined();
  });

  it("inclut le PV du 8 décembre 2025 (2025-12-08_pv_SIGNE.pdf)", () => {
    const dec8 = items.find((i) => i.url.includes("2025-12-08_pv_SIGNE.pdf"));
    expect(dec8).toBeDefined();
  });

  it("note honnête: PDFs Candiac sont scannés (aucune couche texte)", () => {
    // ANTI-INVENTION: we cannot detect zonage changes for Candiac without OCR.
    // The scanned note confirms this limitation.
    expect(PV_CANDIAC_SCANNED_NOTE).toContain("SCANNED_PDF_NO_TEXT_LAYER");
    expect(PV_CANDIAC_SCANNED_NOTE).toContain("OCR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Saint-Rémi: Elementor accordion structure
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Rémi index HTML (seances page)", () => {
  const items = parsePvIndex(
    PV_SAINT_REMI_INDEX_HTML,
    "https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste (Archives 2025)", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF saint-remi.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("saint-remi.ca");
    }
  });

  it("inclut le PV du 15 décembre 2025 (20251215_pv.pdf)", () => {
    const dec15 = items.find((i) => i.url.includes("20251215_pv.pdf"));
    expect(dec15).toBeDefined();
  });

  it("inclut le PV du 17 novembre 2025 (20251117_pv.pdf)", () => {
    const nov17 = items.find((i) => i.url.includes("20251117_pv.pdf"));
    expect(nov17).toBeDefined();
  });

  it("inclut le PV du 1er octobre 2025 (20251001_pv.pdf)", () => {
    const oct1 = items.find((i) => i.url.includes("20251001_pv.pdf"));
    expect(oct1).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectZonageChange — Sainte-Martine Avril 2026: zonage RÉEL détecté
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Sainte-Martine Avril 2026 (zonage réel 2026-510, zone MxtV-2)", () => {
  const result = detectZonageChange(PV_SAINTE_MARTINE_2026_04_TEXT);

  it("détecte avisDeMotion (multiples 'Donne avis de motion' présents)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (règlement 2026-510 modifiant zonage 2019-342)", () => {
    // Real: "Donne avis de motion qu'il sera présenté pour adoption...
    // le Règlement numéro 2026-510 modifiant le Règlement de zonage numéro 2019-342"
    expect(result.changementZonage).toBe(true);
  });

  it("extrait UNIQUEMENT 2026-510 en reglementNumbers (seul vrai règlement de zonage)", () => {
    // PRÉCISION FIX (anti-sur-agrégation Sainte-Martine):
    // Le PV contient 5 avis de motion pour règlements 2026-507..2026-511.
    // Seul 2026-510 (et 2026-511 si présent dans le fixture) modifie
    // le "Règlement de zonage numéro 2019-342" → reglementNumbers = [2026-510].
    //
    // Règlements exclus par la règle de contexte immédiat (\n\n borné) :
    //   - 2026-507 = contrôle animaux (pas de "zonage" dans son contexte)
    //   - 2026-508 = nuisances modifiant règlement 2011-185 (pas de "zonage")
    //   - 2026-509 = plan d'urbanisme modifiant règlement 2019-341 ("urbanisme"
    //     sans "règlement de" = ne déclenche pas ZONAGE_KEYWORDS_RE)
    //   - 2019-342 = l'ANCIEN règlement modifié (exclu par filterNewReglements)
    //
    // Proof from real PV text:
    // "Donne avis de motion...le Règlement numéro 2026-510 modifiant le Règlement
    // de zonage numéro 2019-342 afin d'agrandir la zone MxtV-2."
    // → "règlement de zonage" présent → hasZonageKw=true
    // → "Règlement numéro 2026-510" = NEW, "zonage numéro 2019-342" = MODIFIÉ
    // → filterNewReglements retient [2026-510]
    expect(result.reglementNumbers).toContain("2026-510");
    // 2019-342 est l'ancien règlement modifié, PAS un nouvel avis de motion de zonage
    expect(result.reglementNumbers).not.toContain("2019-342");
    // 2026-507, 2026-508, 2026-509 ne sont pas de zonage
    expect(result.reglementNumbers).not.toContain("2026-507");
    expect(result.reglementNumbers).not.toContain("2026-508");
    expect(result.reglementNumbers).not.toContain("2026-509");
    // 2011-185 et 2019-341 ne sont pas de zonage
    expect(result.reglementNumbers).not.toContain("2011-185");
    expect(result.reglementNumbers).not.toContain("2019-341");
  });

  it("zoneRefs contient MxtV-2 (zone à casse mixte, capturée par ZONE_CODE_CONTEXT_RE)", () => {
    // PRECISION FIX: ZONE_CODE_CONTEXT_RE now captures mixed-case zone codes preceded
    // by the word "zone" (e.g. "zone MxtV-2"). The all-uppercase ZONE_CODE_RE cannot
    // match "MxtV" (mixed case) or the single-digit suffix "-2" (requires 2+ digits).
    // Verbatim from real PV: "afin d'agrandir la zone MxtV-2"
    expect(result.zoneRefs).toContain("MxtV-2");
  });

  it("le texte brut contient bien 'règlement de zonage' et 'zone MxtV-2'", () => {
    expect(PV_SAINTE_MARTINE_2026_04_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_SAINTE_MARTINE_2026_04_TEXT).toContain("zone MxtV-2");
    expect(PV_SAINTE_MARTINE_2026_04_TEXT).toContain("2026-510");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Saint-Rémi Avril 2026: changementZonage=true, V654-2026-33
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Saint-Rémi Avril 2026 (V-prefix détecté, changementZonage=true)", () => {
  const result = detectZonageChange(PV_SAINT_REMI_2026_04_TEXT);

  it("détecte avisDeMotion ('donne avis de motion' présent pour V654-2026-33)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (V654-2026-33 amendant règlement de zonage V654-2017-00)", () => {
    // PRECISION FIX: REGLEMENT_VPREFIX_RE now captures compound V-prefix règlement
    // numbers (e.g. V654-2026-33) when the context window contains "règlement de
    // zonage". The phrase "amendant le règlement de zonage numéro V654-2017-00" in
    // the same context provides the zonage keyword.
    expect(result.changementZonage).toBe(true);
  });

  it("extrait V654-2026-33 en reglementNumbers (nouveau règlement de zonage)", () => {
    // V654-2026-33 is the NEW règlement (object of the avis de motion).
    // V654-2017-00 is the OLD règlement (excluded by MODIFIANT_REGLEMENT_VPREFIX_RE
    // + filterNewReglements: "amendant le règlement de zonage numéro V654-2017-00").
    expect(result.reglementNumbers).toContain("V654-2026-33");
    // V654-2017-00 = l'ancien règlement modifié, PAS un nouvel avis de motion
    expect(result.reglementNumbers).not.toContain("V654-2017-00");
  });

  it("NE contient PAS V655-2026-03 ni V700-2026-09 (lotissement + tarification — pas zonage)", () => {
    // V655-2026-03 = règlement de lotissement (context has no "zonage" keyword)
    // V700-2026-09 = tarification (context has no "zonage" keyword)
    // Both are excluded by the ZONAGE_KEYWORDS_RE guard on REGLEMENT_VPREFIX_RE.
    expect(result.reglementNumbers).not.toContain("V655-2026-03");
    expect(result.reglementNumbers).not.toContain("V700-2026-09");
  });

  it("le texte contient bien 'règlement de zonage' et 'V654-2026-33' (détection réelle)", () => {
    expect(PV_SAINT_REMI_2026_04_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_SAINT_REMI_2026_04_TEXT).toContain("V654-2026-33");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ProcesVerbauxGenericAdapter.list() — Sainte-Martine (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Sainte-Martine (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINTE_MARTINE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINTE_MARTINE_PV_CONFIG, {
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

  it("tous les refs ont city 'sainte-martine'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("sainte-martine");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ProcesVerbauxGenericAdapter.list() — Candiac (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Candiac (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_CANDIAC_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(CANDIAC_PV_CONFIG, {
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

  it("tous les refs ont city 'candiac'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("candiac");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ProcesVerbauxGenericAdapter.list() — Saint-Rémi (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Saint-Rémi (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINT_REMI_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINT_REMI_PV_CONFIG, {
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

  it("tous les refs ont city 'saint-remi'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("saint-remi");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});
