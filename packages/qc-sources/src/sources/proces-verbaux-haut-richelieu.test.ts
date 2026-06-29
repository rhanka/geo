/**
 * Tests for real PV scraping of cities in the MRC du Haut-Richelieu near Montréal
 * (MRC Haut-Richelieu cluster — Saint-Alexandre, Saint-Valentin, Henryville).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Saint-Alexandre (saint-alexandre.ca):
 *     robots.txt: Disallow: (empty — no restrictions)
 *     URL: https://saint-alexandre.ca/la-municipalite/vie-democratique/seances-du-conseil/
 *   - Saint-Valentin (municipalite.saint-valentin.qc.ca):
 *     robots.txt: HTTP 200, content-length 0 (empty — no restrictions)
 *     URL: https://municipalite.saint-valentin.qc.ca/proces-verbaux
 *   - Henryville (henryville.ca):
 *     robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed
 *     URL: https://henryville.ca/conseil-municipal/proces-verbaux/
 *
 * Sites inaccessibles ou sans PV (documentés honnêtement — 2026-06-10):
 *   - Saint-Jean-sur-Richelieu: ECONNREFUSED (ville.saint-jean-sur-richelieu.qc.ca)
 *   - Iberville (secteur): ECONNREFUSED (all tested domains)
 *   - Saint-Luc (secteur): ECONNREFUSED (all tested domains)
 *   - Sainte-Brigide-d'Iberville: ECONNREFUSED (all tested domains)
 *   - Mont-Saint-Grégoire: ECONNREFUSED (all tested domains)
 *   - Lacolle: ECONNREFUSED (all tested domains)
 *   - Saint-Blaise-sur-Richelieu: ECONNREFUSED (all tested domains)
 *   - Saint-Paul-de-l'Île-aux-Noix: ECONNREFUSED (all tested domains)
 *   - Noyan: ECONNREFUSED (all tested domains)
 *   - Saint-Sébastien: ECONNREFUSED (all tested domains)
 *   - Saint-Valentin (procès-verbaux direct): accessible but older PVs redirect
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Saint-Alexandre Mars 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 26-434 amendant le règlement de zonage 20-366 —
 *        normes d'abattage d'arbres et corrections générales)
 *   - Saint-Valentin Janvier 2026:
 *       avisDeMotion=true (past-tense), changementZonage=true
 *       (règlement 506-1 amendant le règlement de zonage 506 du périmètre
 *        d'urbanisation — multifamiliale bi-/tri-familiale 4 logements zone P-02)
 *   - Henryville Janvier 2026:
 *       avisDeMotion=true, changementZonage=false (HONEST ZERO)
 *       (avis de motion pour règlements d'emprunt 238-2026/239-2026 — aqueduc,
 *        aucun changement de zonage dans la fenêtre de 6 mois)
 *
 * Suite de tests:
 *   1. parsePvIndex — Saint-Alexandre: parse les liens PDF WordPress liste simple
 *   2. parsePvIndex — Saint-Valentin: parse les liens PDF custom CMS liste annuelle
 *   3. parsePvIndex — Henryville: parse les liens PDF WordPress liste annuelle (HTTP links)
 *   4. detectZonageChange — Saint-Alexandre Mars 2026: zonage RÉEL (26-434)
 *   5. detectZonageChange — Saint-Valentin Janvier 2026: zonage RÉEL (506-1, past-tense)
 *   6. detectZonageChange — Henryville Janvier 2026: zéro honnête (emprunt uniquement)
 *   7. ProcesVerbauxGenericAdapter.list() — Saint-Alexandre (mocked fetch)
 *   8. ProcesVerbauxGenericAdapter.list() — Saint-Valentin (mocked fetch)
 *   9. ProcesVerbauxGenericAdapter.list() — Henryville (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  SAINT_ALEXANDRE_PV_CONFIG,
  SAINT_VALENTIN_PV_CONFIG,
  HENRYVILLE_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_SAINT_ALEXANDRE_INDEX_HTML,
  PV_SAINT_ALEXANDRE_2026_03_TEXT,
} from "./proces-verbaux-saint-alexandre.fixture.js";
import {
  PV_SAINT_VALENTIN_INDEX_HTML,
  PV_SAINT_VALENTIN_2026_01_TEXT,
} from "./proces-verbaux-saint-valentin.fixture.js";
import {
  PV_HENRYVILLE_INDEX_HTML,
  PV_HENRYVILLE_2026_01_TEXT,
} from "./proces-verbaux-henryville.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Saint-Alexandre: WordPress simple list with PDF links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Alexandre index HTML (WordPress liste simple avec PDFs)", () => {
  const items = parsePvIndex(
    PV_SAINT_ALEXANDRE_INDEX_HTML,
    "https://saint-alexandre.ca/la-municipalite/vie-democratique/seances-du-conseil/",
  );

  it("parse au moins 7 items de PV dans la liste 2025-2026", () => {
    // 9 PDF links total (ODJ juin + 8 PV/extraord)
    expect(items.length).toBeGreaterThanOrEqual(7);
  });

  it("tous les items ont des URLs https PDF saint-alexandre.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("saint-alexandre.ca");
    }
  });

  it("inclut le PV du 2 mars 2026 (Proces-verbal-preliminaire-2-mars-2026.pdf)", () => {
    const mar2 = items.find((i) => i.url.includes("2-mars-2026"));
    expect(mar2).toBeDefined();
  });

  it("inclut le PV du 7 avril 2026 (PV-7-avril-2026.pdf)", () => {
    const apr7 = items.find((i) => i.url.includes("PV-7-avril-2026.pdf"));
    expect(apr7).toBeDefined();
  });

  it("inclut un PV 2025 (PV-extra-15-decembre-2025.pdf)", () => {
    const dec15 = items.find((i) => i.url.includes("PV-extra-15-decembre-2025.pdf"));
    expect(dec15).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Saint-Valentin: custom CMS with annual sections
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Valentin index HTML (CMS custom, sections annuelles)", () => {
  const items = parsePvIndex(
    PV_SAINT_VALENTIN_INDEX_HTML,
    "https://municipalite.saint-valentin.qc.ca/proces-verbaux",
  );

  it("parse au moins 4 items de PV dans la liste 2025-2026", () => {
    // 3 links 2026 + 2 links 2025 = 5 PDF links
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it("tous les items ont des URLs https PDF saint-valentin.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("saint-valentin.qc.ca");
    }
  });

  it("inclut le PV du 13 janvier 2026 (PV%2013%20JANVIER.pdf)", () => {
    const jan13 = items.find((i) => i.url.includes("PV%2013%20JANVIER.pdf"));
    expect(jan13).toBeDefined();
  });

  it("inclut le PV du 14 avril 2026 (PV%2014%20AVRIL.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("PV%2014%20AVRIL.pdf"));
    expect(apr14).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Henryville: WordPress annual list (HTTP links for 2025-2026)
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Henryville index HTML (WordPress liste annuelle, HTTP links 2025-2026)", () => {
  const items = parsePvIndex(
    PV_HENRYVILLE_INDEX_HTML,
    "https://henryville.ca/conseil-municipal/proces-verbaux/",
  );

  it("parse au moins 5 items de PV dans la liste 2025-2026", () => {
    // 1 link 2026 + 8 links 2025 = 9 total
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("inclut le PV du 12 janvier 2026 (proces-verbal-20260112.pdf)", () => {
    const jan12 = items.find((i) => i.url.includes("proces-verbal-20260112.pdf"));
    expect(jan12).toBeDefined();
  });

  it("inclut le PV du 1er décembre 2025 (proces-verbal-20251201.pdf)", () => {
    const dec1 = items.find((i) => i.url.includes("proces-verbal-20251201.pdf"));
    expect(dec1).toBeDefined();
  });

  it("inclut le PV du 17 décembre 2025 (proces-verbal-20251217.pdf)", () => {
    const dec17 = items.find((i) => i.url.includes("proces-verbal-20251217.pdf"));
    expect(dec17).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectZonageChange — Saint-Alexandre Mars 2026: zonage RÉEL (26-434)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Saint-Alexandre Mars 2026 (zonage réel 26-434, règl. zonage 20-366)", () => {
  const result = detectZonageChange(PV_SAINT_ALEXANDRE_2026_03_TEXT);

  it("détecte avisDeMotion ('Avis de motion est par la présente donnée' pour 26-434)", () => {
    // Real: "Avis de motion est par la présente donnée par le conseiller Florent Raymond
    // qu'un règlement sera soumis...concernant des modifications au règlement de zonage."
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (26-434 amendant le règlement de zonage 20-366)", () => {
    // The avis de motion explicitly names "règlement de zonage" in the same paragraph.
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '26-434' en reglementNumbers (2+3 digits format)", () => {
    // REGLEMENT_NUMBER_RE matches "26-434" from "règlement 26-434".
    expect(result.reglementNumbers).toContain("26-434");
  });

  it("n'inclut PAS '20-366' (ancien règlement modifié, exclu par filterNewReglements)", () => {
    // "20-366" is the modified base bylaw ("règlement de zonage 20-366"),
    // excluded when "26-434" (new) is also present.
    expect(result.reglementNumbers).not.toContain("20-366");
  });

  it("le texte brut contient 'règlement de zonage' et '26-434'", () => {
    expect(PV_SAINT_ALEXANDRE_2026_03_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_SAINT_ALEXANDRE_2026_03_TEXT).toContain("26-434");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Saint-Valentin Janvier 2026: zonage RÉEL (506-1)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Saint-Valentin Janvier 2026 (zonage réel 506-1, multifamiliale zone P-02)", () => {
  const result = detectZonageChange(PV_SAINT_VALENTIN_2026_01_TEXT);

  it("détecte avisDeMotion (past-tense: 'avis de motion a été donné' pour 506-1)", () => {
    // Real: "CONSIDÉRANT QU'un avis de motion a été donné par Madame Hélène Blanchard
    // conseillère à la séance ordinaire du 2 décembre 2025" within the adoption resolution
    // of règlement 506-1 amendant le règlement de zonage.
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (506-1 amendant le règlement de zonage 506 — zone P-02)", () => {
    // "règlement de zonage" appears in "modifier son règlement de zonage"
    // and "règlement 506 relatif au zonage du périmètre d'urbanisation".
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '506-1' en reglementNumbers (3+1 digits format)", () => {
    // REGLEMENT_NUMBER_RE matches "506-1" from "règlement numéro 506-1".
    expect(result.reglementNumbers).toContain("506-1");
  });

  it("le texte brut contient 'règlement de zonage' et '506-1'", () => {
    expect(PV_SAINT_VALENTIN_2026_01_TEXT.toLowerCase()).toContain("règlement de zonage");
    expect(PV_SAINT_VALENTIN_2026_01_TEXT).toContain("506-1");
  });

  it("detecte la densification multifamiliale (densiteAutorisee non-null)", () => {
    // The fixture explicitly mentions "habitation multifamiliale", "bi-familiale",
    // "tri-familiale" in the adoption resolution text.
    expect(result.densiteAutorisee).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Henryville Janvier 2026: zéro honnête (emprunt)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Henryville Janvier 2026 (zéro honnête — avis emprunt uniquement)", () => {
  const result = detectZonageChange(PV_HENRYVILLE_2026_01_TEXT);

  it("détecte avisDeMotion ('UN AVIS DE MOTION est donné' pour règlement d'emprunt)", () => {
    // Real: "UN AVIS DE MOTION est donné par monsieur Michel Lord...règlement décrétant
    // un emprunt de 95 000$ pour le branchement à l'aqueduc"
    expect(result.avisDeMotion).toBe(true);
  });

  it("NE lève PAS changementZonage=true (emprunt — pas de 'zonage' dans le contexte)", () => {
    // ANTI-FAUX-POSITIF: The motion is for a règlement d'emprunt (238-2026, 239-2026)
    // for aqueduc works. The word "zonage" does not appear in the motion context.
    // ZONAGE_KEYWORDS_RE does not fire → changementZonage must be false.
    expect(result.changementZonage).toBe(false);
  });

  it("reglementNumbers est vide (aucun numéro de zonage extrait)", () => {
    // The context references only "règlement d'emprunt" numbers without ZONAGE_KEYWORDS,
    // so extractReglementNumbers does not return zonage-context numbers.
    expect(result.reglementNumbers).toHaveLength(0);
  });

  it("le texte brut contient 'AVIS DE MOTION' mais PAS 'zonage'", () => {
    expect(PV_HENRYVILLE_2026_01_TEXT).toContain("AVIS DE MOTION");
    expect(PV_HENRYVILLE_2026_01_TEXT.toLowerCase()).not.toContain("zonage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ProcesVerbauxGenericAdapter.list() — Saint-Alexandre (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Saint-Alexandre (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINT_ALEXANDRE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINT_ALEXANDRE_PV_CONFIG, {
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

  it("tous les refs ont city 'saint-alexandre'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("saint-alexandre");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ProcesVerbauxGenericAdapter.list() — Saint-Valentin (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Saint-Valentin (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINT_VALENTIN_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINT_VALENTIN_PV_CONFIG, {
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

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("tous les refs ont city 'saint-valentin'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("saint-valentin");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Henryville (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Henryville (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_HENRYVILLE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(HENRYVILLE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 2 refs PV dans la fenêtre 6 mois", async () => {
    // 2026-06-10 − 183 jours = 2025-12-09. Avec la datation corrigée des labels,
    // "1er décembre 2025" → 2025-12-01 (8 jours AVANT le début de fenêtre, donc
    // hors fenêtre) ; restent 2026-01-12 et 2025-12-17 dans la fenêtre → 2 refs.
    // (Auparavant "1er décembre" restait NON_DISPONIBLE et était inclus à tort.)
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("tous les refs ont city 'henryville'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("henryville");
    }
  });
});
