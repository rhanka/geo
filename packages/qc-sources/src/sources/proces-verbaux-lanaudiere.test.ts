/**
 * Tests for real PV scraping of cities in Lanaudière (couronne nord-est de Montréal).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Mascouche: https://mascouche.ca/
 *     robots.txt: 404 (no restrictions file — permissive by default)
 *     URL: https://mascouche.ca/ville/vie-democratique/seances-du-conseil
 *   - Charlemagne: https://www.charlemagne.ca/
 *     robots.txt: 404 (no restrictions file — permissive by default)
 *     URL: https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil
 *   - L'Assomption: https://www.ville.lassomption.qc.ca/
 *     robots.txt: User-agent: * / Sitemap only — NO Disallow rules
 *     URL: https://www.ville.lassomption.qc.ca/seances-conseil/
 *   - Lavaltrie: https://www.ville.lavaltrie.qc.ca/
 *     robots.txt: 404 (HTML response — permissive by default)
 *     URL: https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux
 *
 * Sites inaccessibles (documentés honnêtement — 2026-06-10):
 *   - Repentigny: HTTP 200 index, but ALL PV PDFs have no text layer (scanned images).
 *     pdftotext returns <30 bytes. OCR required — not usable without Obscura.
 *   - Terrebonne: HTTP 403 Forbidden on all tested paths.
 *   - L'Assomption (lassomption.ca): ECONNREFUSED
 *   - Saint-Sulpice: ECONNREFUSED
 *   - Lavaltrie (lavaltrie.com): ECONNREFUSED (redirect → ville.lavaltrie.qc.ca)
 *   - Charlemagne (charlemagne.ca): HTTP 404 on /mairie/seances-du-conseil/
 *     (real URL is /la-ville/vie-democratique/seances-du-conseil)
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Mascouche Avr 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (Règlement 1103-81 modifiant le règlement de zonage numéro 1103 —
 *        modifications aux enseignes, effets sur le plan de zonage)
 *   - Charlemagne Mai 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (Règlement 05-384-26-27 amendant le règlement de zonage 05-384-15 —
 *        agrandir zone CR-12 à même zone CR-11, modifier grilles CR-7/CR-12)
 *   - L'Assomption Mai 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (Règlement 300-78-2026 modifiant le règlement 300-2015 relatif au zonage)
 *   - Lavaltrie Mai 2026:
 *       avisDeMotion=true, changementZonage=false  (HONEST 0)
 *       (Avis de motion pour lotissement RRU3-2-2026, stationnement 288-11-2026 —
 *        règlement de zonage adopté mais avis de motion en session antérieure)
 *
 * Suite de tests:
 *   1. parsePvIndex — Mascouche: parse les liens PDF October CMS c-document-card
 *   2. parsePvIndex — Charlemagne: parse les liens PDF small-document
 *   3. parsePvIndex — L'Assomption: parse les liens download.php?filename=
 *   4. parsePvIndex — Lavaltrie: parse les liens fr-file relatifs
 *   5. detectZonageChange — Mascouche Avr 2026: zonage RÉEL (1103-81)
 *   6. detectZonageChange — Charlemagne Mai 2026: zonage RÉEL (05-384-26-27)
 *   7. detectZonageChange — L'Assomption Mai 2026: zonage RÉEL (300-78)
 *   8. detectZonageChange — Lavaltrie Mai 2026: HONNÊTE 0 (lotissement, pas zonage)
 *   9. ProcesVerbauxGenericAdapter.list() — Mascouche (mocked fetch)
 *   10. ProcesVerbauxGenericAdapter.list() — Charlemagne (mocked fetch)
 *   11. ProcesVerbauxGenericAdapter.list() — L'Assomption (mocked fetch)
 *   12. ProcesVerbauxGenericAdapter.list() — Lavaltrie (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  MASCOUCHE_PV_CONFIG,
  CHARLEMAGNE_PV_CONFIG,
  LASSOMPTION_PV_CONFIG,
  LAVALTRIE_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_MASCOUCHE_INDEX_HTML,
  PV_MASCOUCHE_2026_04_TEXT,
} from "./proces-verbaux-mascouche.fixture.js";
import {
  PV_CHARLEMAGNE_INDEX_HTML,
  PV_CHARLEMAGNE_2026_05_TEXT,
} from "./proces-verbaux-charlemagne.fixture.js";
import {
  PV_LASSOMPTION_INDEX_HTML,
  PV_LASSOMPTION_2026_05_TEXT,
} from "./proces-verbaux-lassomption.fixture.js";
import {
  PV_LAVALTRIE_INDEX_HTML,
  PV_LAVALTRIE_2026_05_TEXT,
} from "./proces-verbaux-lavaltrie.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Mascouche: October CMS c-document-card structure
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Mascouche index HTML (October CMS c-document-card)", () => {
  const items = parsePvIndex(
    PV_MASCOUCHE_INDEX_HTML,
    "https://mascouche.ca/ville/vie-democratique/seances-du-conseil",
  );

  it("parse au moins 2 items de PV dans la liste", () => {
    // Fixture has 2026 + 2025 + 2024 + 2023 + 2022 compiled PDFs — 2 are recent
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("tous les items ont des URLs https PDF mascouche.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("mascouche.ca");
    }
  });

  it("inclut le PV 2026 (20260609proces-verbaux-seances-du-conseil.pdf)", () => {
    const pv2026 = items.find((i) =>
      i.url.includes("20260609proces-verbaux-seances-du-conseil.pdf"),
    );
    expect(pv2026).toBeDefined();
  });

  it("inclut le PV 2025 (20260129_proces-verbaux-seances-du-conseil.pdf)", () => {
    const pv2025 = items.find((i) =>
      i.url.includes("20260129_proces-verbaux-seances-du-conseil.pdf"),
    );
    expect(pv2025).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Charlemagne: October CMS small-document links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Charlemagne index HTML (October CMS small-document links)", () => {
  const items = parsePvIndex(
    PV_CHARLEMAGNE_INDEX_HTML,
    "https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil",
  );

  it("parse au moins 5 items de PV dans la liste (2026 + 2025 mois)", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF charlemagne.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("charlemagne.ca");
    }
  });

  it("inclut le PV de mai 2026 (Procès-verbal officiel_12 mai 2026.pdf)", () => {
    const may2026 = items.find((i) => i.url.includes("mai%202026"));
    expect(may2026).toBeDefined();
  });

  it("inclut le PV de novembre 2025 (Procès-verbaux_Séances_Novembre 2025.pdf)", () => {
    const nov2025 = items.find((i) => i.url.includes("Novembre%202025"));
    expect(nov2025).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — L'Assomption: Bootstrap accordion download.php links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – L'Assomption index HTML (Bootstrap accordion download.php)", () => {
  const items = parsePvIndex(
    PV_LASSOMPTION_INDEX_HTML,
    "https://www.ville.lassomption.qc.ca/seances-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https absolues ville.lassomption.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\//i);
      expect(item.url).toContain("ville.lassomption.qc.ca");
    }
  });

  it("inclut le PV du 12 mai 2026 (pv20260512.pdf)", () => {
    const may12 = items.find((i) => i.url.includes("pv20260512.pdf"));
    expect(may12).toBeDefined();
  });

  it("inclut le PV du 13 janvier 2026 (pv20260113.pdf)", () => {
    const jan13 = items.find((i) => i.url.includes("pv20260113.pdf"));
    expect(jan13).toBeDefined();
  });

  it("inclut le PV du 11 novembre 2025 (pv20251111.pdf)", () => {
    const nov11 = items.find((i) => i.url.includes("pv20251111.pdf"));
    expect(nov11).toBeDefined();
  });

  it("extrait une date ISO depuis le label '2026-05-12 | Séance ordinaire'", () => {
    const may12 = items.find((i) => i.url.includes("pv20260512.pdf"));
    expect(may12).toBeDefined();
    // Label "2026-05-12 | Séance ordinaire (12 mai 2026)" → extractIsoFromLabel
    // extracts from "12 mai 2026" → "2026-05-12"
    expect(may12?.dateIso).toBe("2026-05-12");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parsePvIndex — Lavaltrie: fr-file relative links
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Lavaltrie index HTML (fr-file relative links)", () => {
  const items = parsePvIndex(
    PV_LAVALTRIE_INDEX_HTML,
    "https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux",
  );

  it("parse au moins 10 items de PV dans la liste (2026 + 2025)", () => {
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("tous les items ont des URLs https absolues ville.lavaltrie.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\//i);
      expect(item.url).toContain("ville.lavaltrie.qc.ca");
    }
  });

  it("inclut le PV du 4 mai 2026 (2026-05-04_PV_ord.pdf)", () => {
    const may4 = items.find((i) => i.url.includes("2026-05-04_PV_ord.pdf"));
    expect(may4).toBeDefined();
  });

  it("inclut le PV extraordinaire du 25 mai 2026 (2026-05-25_PV_extra.pdf)", () => {
    const may25 = items.find((i) => i.url.includes("2026-05-25_PV_extra.pdf"));
    expect(may25).toBeDefined();
  });

  it("inclut le PV du 8 décembre 2025 (2025-12-08_PV_ord.pdf)", () => {
    const dec8 = items.find((i) => i.url.includes("2025-12-08_PV_ord.pdf"));
    expect(dec8).toBeDefined();
  });

  it("extrait une date ISO depuis le label '4 mai 2026'", () => {
    const may4 = items.find((i) => i.url.includes("2026-05-04_PV_ord.pdf"));
    expect(may4).toBeDefined();
    expect(may4?.dateIso).toBe("2026-05-04");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Mascouche Avr 2026: zonage RÉEL (1103-81)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Mascouche Avr 2026 (zonage réel 1103-81)", () => {
  const result = detectZonageChange(PV_MASCOUCHE_2026_04_TEXT);

  it("détecte avisDeMotion ('donne avis de motion du Règlement numéro 1103-81')", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (règlement de zonage numéro 1103 en contexte)", () => {
    // Real: "Madame la conseillère Anny Mailloux donne avis de motion du
    // Règlement numéro 1103-81 modifiant le règlement de zonage numéro 1103"
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '1103-81' en reglementNumbers", () => {
    expect(result.reglementNumbers).toContain("1103-81");
  });

  it("le texte brut contient bien 'règlement de zonage numéro 1103' et '1103-81'", () => {
    expect(PV_MASCOUCHE_2026_04_TEXT.toLowerCase()).toContain(
      "règlement de zonage numéro 1103",
    );
    expect(PV_MASCOUCHE_2026_04_TEXT).toContain("1103-81");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Charlemagne Mai 2026: zonage RÉEL (05-384-26-27)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Charlemagne Mai 2026 (zonage réel 05-384-26-27, CR-12/CR-11)", () => {
  const result = detectZonageChange(PV_CHARLEMAGNE_2026_05_TEXT);

  it("détecte avisDeMotion ('donne avis par la présente' pour 05-384-26-27)", () => {
    // Charlemagne uses "donne avis par la présente" — a non-standard phrasing.
    // AVIS_MOTION_RE matches the containing "avis de motion" phrase in the title.
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (amendant le règlement de zonage numéro 05-384-15)", () => {
    // Real: "règlement numéro 05-384-26-27 amendant le règlement de zonage
    // numéro 05-384-15"
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '05-384' en reglementNumbers (préfixe du règlement 05-384-26-27)", () => {
    // REGLEMENT_NUMBER_RE extracts "05-384" from "règlement numéro 05-384-26-27"
    // (2+3 digit pattern, word boundary after "384" before "-26-27").
    expect(result.reglementNumbers).toContain("05-384");
  });

  it("le texte brut contient 'règlement de zonage numéro 05-384-15' et '05-384-26-27'", () => {
    expect(PV_CHARLEMAGNE_2026_05_TEXT.toLowerCase()).toContain(
      "règlement de zonage",
    );
    expect(PV_CHARLEMAGNE_2026_05_TEXT).toContain("05-384-26-27");
    expect(PV_CHARLEMAGNE_2026_05_TEXT).toContain("05-384-15");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. detectZonageChange — L'Assomption Mai 2026: zonage RÉEL (300-78)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – L'Assomption Mai 2026 (zonage réel 300-78-2026)", () => {
  const result = detectZonageChange(PV_LASSOMPTION_2026_05_TEXT);

  it("détecte avisDeMotion ('Avis de motion est donné par la conseillère Manon St-Hilaire')", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (règlement modifiant le règlement 3002015 relatif au zonage)", () => {
    // Real: "Avis de motion est donné...règlement modifiant le règlement 3002015
    // relatif au zonage de la Ville de L'Assomption"
    expect(result.changementZonage).toBe(true);
  });

  it("extrait '300-78' en reglementNumbers (depuis titre RÈGLEMENT 300-78-2026)", () => {
    // The section title "RÈGLEMENT 300-78-2026 MODIFIANT LE RÈGLEMENT 300-2015
    // RELATIF AU ZONAGE" contains "300-78" matched by REGLEMENT_NUMBER_RE.
    expect(result.reglementNumbers).toContain("300-78");
  });

  it("le texte brut contient 'zonage de la Ville de L'Assomption' et '300-78-2026'", () => {
    expect(PV_LASSOMPTION_2026_05_TEXT.toLowerCase()).toContain("zonage");
    expect(PV_LASSOMPTION_2026_05_TEXT).toContain("300-78-2026");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. detectZonageChange — Lavaltrie Mai 2026: HONNÊTE 0 (lotissement)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Lavaltrie Mai 2026 (HONNÊTE 0: avis de motion pour lotissement, pas zonage)", () => {
  const result = detectZonageChange(PV_LAVALTRIE_2026_05_TEXT);

  it("détecte avisDeMotion (au moins un 'donne avis de motion' présent)", () => {
    // "donne avis de motion qu'à une prochaine séance" for RRU3-2-2026 (lotissement)
    expect(result.avisDeMotion).toBe(true);
  });

  it("NE lève PAS changementZonage=true (l'avis de motion concerne le lotissement, pas le zonage)", () => {
    // The avis de motion for RRU3-2-2026 is about "Règlement de lotissement numéro RRU3-2012",
    // NOT about zonage. The adoptions of 372-2026 and RRU2-72-2026 contain "règlement de zonage"
    // but without an avis de motion in the same context window.
    expect(result.changementZonage).toBe(false);
  });

  it("le texte brut contient 'règlement de zonage' (adoptions) sans avis de motion associé", () => {
    expect(PV_LAVALTRIE_2026_05_TEXT.toLowerCase()).toContain(
      "règlement de zonage",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Mascouche (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Mascouche (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_MASCOUCHE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(MASCOUCHE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 2 refs PV dans la fenêtre 6 mois", async () => {
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

  it("tous les refs ont city 'mascouche'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("mascouche");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ProcesVerbauxGenericAdapter.list() — Charlemagne (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Charlemagne (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_CHARLEMAGNE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(CHARLEMAGNE_PV_CONFIG, {
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

  it("tous les refs ont city 'charlemagne'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("charlemagne");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ProcesVerbauxGenericAdapter.list() — L'Assomption (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – L'Assomption (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LASSOMPTION_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LASSOMPTION_PV_CONFIG, {
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

  it("tous les refs ont city 'lassomption'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("lassomption");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. ProcesVerbauxGenericAdapter.list() — Lavaltrie (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Lavaltrie (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LAVALTRIE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LAVALTRIE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 8 refs PV dans la fenêtre 6 mois", async () => {
    // 2026-06-10 − 183 jours = 2025-12-09. Avec la datation corrigée des labels,
    // "1er octobre 2025" → 2025-10-01 (correctement HORS fenêtre) au lieu de
    // rester NON_DISPONIBLE et d'être inclus à tort ; 8 PV restent dans la fenêtre.
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

  it("tous les refs ont city 'lavaltrie'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("lavaltrie");
    }
  });
});
