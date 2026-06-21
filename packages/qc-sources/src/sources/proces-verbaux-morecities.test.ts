/**
 * Tests for real PV scraping of additional cities near Montréal.
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK):
 *   - La Prairie: https://laprairie.ca/
 *     robots.txt: Disallow /administration/ only — target page allowed
 *   - Châteauguay: https://ville.chateauguay.qc.ca/
 *     robots.txt: Disallow /wp-admin/, Crawl-delay 3 — content pages allowed
 *   - Delson: https://ville.delson.qc.ca/
 *     robots.txt: Disallow: (empty — no restrictions)
 *   - Vaudreuil-Dorion: https://www.ville.vaudreuil-dorion.qc.ca/
 *     robots.txt: Disallow /assets/admin/, search pages — content pages allowed
 *
 * Zonage detection results per city (honest — anti-invention):
 *   - La Prairie May 2026: avisDeMotion=true, changementZonage=false
 *     (motions for taxes/patrimoine/circulation, no "règlement de zonage" in ±400 window)
 *   - Châteauguay Feb 2026: avisDeMotion=true, changementZonage=true
 *     (real zonage changes Z-3001 ARE present and now detected via REGLEMENT_ZONAGE_LETTER_RE;
 *     "règlement de zonage Z-3001" in same sentence as avis de motion → true positive)
 *   - Delson May 2026: avisDeMotion=true, changementZonage=false
 *     (only emprunt expropriation bylaw reference, no zonage)
 *   - Vaudreuil-Dorion May 2026: avisDeMotion=true, changementZonage=false (CORRIGÉ)
 *     (tarification + démolition motions; "Règlement de zonage" only in next agenda item
 *     26-05-0429, past the \n\n paragraph boundary — forward window now capped there)
 *
 * Test suite:
 *   1. parsePvIndex — La Prairie: parses c-document-card accordion HTML → PDF links
 *   2. parsePvIndex — Châteauguay: parses session-container HTML → PDF links
 *   3. parsePvIndex — Delson: parses wp-block-file HTML → PDF links
 *   4. parsePvIndex — Vaudreuil-Dorion: parses <li><a href="...pv.pdf"> HTML → PDF links
 *   5. detectZonageChange — La Prairie May 2026: avisDeMotion=true, changementZonage=false
 *   6. detectZonageChange — Châteauguay Feb 2026: avisDeMotion=true, changementZonage=true
 *      (Z-3001 detected via REGLEMENT_ZONAGE_LETTER_RE — "règlement de zonage Z-3001")
 *   7. detectZonageChange — Delson May 2026: avisDeMotion=true, changementZonage=false
 *   8. detectZonageChange — Vaudreuil-Dorion May 2026: avisDeMotion=true, changementZonage=false
 *      (CORRIGÉ: forward window capped at \\n\\n, no cross-item contamination)
 *   9. ProcesVerbauxGenericAdapter.list() — La Prairie (mocked fetch)
 *   10. ProcesVerbauxGenericAdapter.list() — Châteauguay (mocked fetch)
 *   11. ProcesVerbauxGenericAdapter.list() — Delson (mocked fetch)
 *   12. ProcesVerbauxGenericAdapter.list() — Vaudreuil-Dorion (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  LAPRAIRIE_PV_CONFIG,
  CHATEAUGUAY_PV_CONFIG,
  DELSON_PV_CONFIG,
  VAUDREUIL_DORION_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_LAPRAIRIE_INDEX_HTML,
  PV_LAPRAIRIE_2026_05_TEXT,
} from "./proces-verbaux-laprairie.fixture.js";
import {
  PV_CHATEAUGUAY_INDEX_HTML,
  PV_CHATEAUGUAY_2026_02_TEXT,
} from "./proces-verbaux-chateauguay.fixture.js";
import {
  PV_DELSON_INDEX_HTML,
  PV_DELSON_2026_05_TEXT,
} from "./proces-verbaux-delson.fixture.js";
import {
  PV_VAUDREUIL_DORION_INDEX_HTML,
  PV_VAUDREUIL_DORION_2026_05_TEXT,
} from "./proces-verbaux-vaudreuil-dorion.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — La Prairie: c-document-card accordion HTML
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – La Prairie index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_LAPRAIRIE_INDEX_HTML,
    "https://laprairie.ca/ville/democratie/seances-du-conseil",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF laprairie.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("laprairie.ca");
    }
  });

  it("inclut le PV du 19 mai 2026 (2026-05-19_pv_non_officiel.pdf)", () => {
    const may19 = items.find((i) => i.url.includes("2026-05-19"));
    expect(may19).toBeDefined();
  });

  it("inclut le PV du 21 avril 2026 (2026-04-21_pv-R.pdf)", () => {
    const apr21 = items.find((i) => i.url.includes("2026-04-21"));
    expect(apr21).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Châteauguay: session-container WordPress HTML
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Châteauguay index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_CHATEAUGUAY_INDEX_HTML,
    "https://ville.chateauguay.qc.ca/affaires-municipales/seances-du-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF ville.chateauguay.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("chateauguay");
    }
  });

  it("inclut le PV du 20 avril 2026 (PV_2026-04-20.pdf)", () => {
    const apr20 = items.find((i) => i.url.includes("PV_2026-04-20"));
    expect(apr20).toBeDefined();
  });

  it("inclut le PV du 23 février 2026 (PV_2026-02-23.pdf)", () => {
    const feb23 = items.find((i) => i.url.includes("PV_2026-02-23"));
    expect(feb23).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Delson: WordPress wp-block-file / act-collapsible HTML
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Delson index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_DELSON_INDEX_HTML,
    "https://ville.delson.qc.ca/la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/",
  );

  it("parse au moins 4 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it("tous les items ont des URLs https PDF ville.delson.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("delson.qc.ca");
    }
  });

  it("inclut le PV du 12 mai 2026 (2026-05-12-ordinaire-20h-2.pdf)", () => {
    const may12 = items.find((i) => i.url.includes("2026-05-12-ordinaire-20h-2"));
    expect(may12).toBeDefined();
  });

  it("inclut le PV du 14 avril 2026 (2026-04-14-ordinaire-20h.pdf)", () => {
    const apr14 = items.find((i) => i.url.includes("2026-04-14-ordinaire-20h"));
    expect(apr14).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parsePvIndex — Vaudreuil-Dorion: simple <li><a> list HTML
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Vaudreuil-Dorion index HTML (2026 séances)", () => {
  const items = parsePvIndex(
    PV_VAUDREUIL_DORION_INDEX_HTML,
    "https://www.ville.vaudreuil-dorion.qc.ca/fr/la-ville/conseil-municipal/seances-publiques",
  );

  it("parse au moins 10 items de PV dans la liste 2026", () => {
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("tous les items ont des URLs https PDF ville.vaudreuil-dorion.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("vaudreuil-dorion.qc.ca");
    }
  });

  it("inclut le PV du 19 mai 2026 (20260519_pv.pdf)", () => {
    const may19 = items.find((i) => i.url.includes("20260519_pv"));
    expect(may19).toBeDefined();
  });

  it("inclut le PV du 1er juin 2026 (20260601_pv_sa.pdf)", () => {
    const jun1 = items.find((i) => i.url.includes("20260601_pv_sa"));
    expect(jun1).toBeDefined();
  });

  it("inclut des PV de janvier à juin 2026 (au moins 6 séances ordinaires)", () => {
    const ordinaires = items.filter((i) => i.url.match(/2026\d{4}_pv/));
    expect(ordinaires.length).toBeGreaterThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — La Prairie May 2026: avis de motion, PAS de zonage
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – La Prairie Mai 2026 (motions taxes/patrimoine, pas zonage)", () => {
  const result = detectZonageChange(PV_LAPRAIRIE_2026_05_TEXT);

  it("détecte avisDeMotion (motions pour 1572-M, 1574-M, 1575-M présentes)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("ne lève PAS changementZonage (règlement 1572-M = taxes, pas zonage)", () => {
    // The motions are for taxes (1572-M), patrimoine (1574-M), circulation (1575-M).
    // None references "règlement de zonage" in the ±400 chars window.
    expect(result.changementZonage).toBe(false);
  });

  it("le texte brut contient bien les avis de motion (1572-M, 1574-M)", () => {
    expect(PV_LAPRAIRIE_2026_05_TEXT).toContain("1572-M");
    expect(PV_LAPRAIRIE_2026_05_TEXT).toContain("avis de motion");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Châteauguay Fév 2026: zonage réel Z-3001, détecté
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Châteauguay Fév 2026 (zonage réel Z-3001, détecté via REGLEMENT_ZONAGE_LETTER_RE)", () => {
  const result = detectZonageChange(PV_CHATEAUGUAY_2026_02_TEXT);

  it("détecte avisDeMotion (motions 2026-02-119 et 2026-02-120 présentes)", () => {
    // The Feb 23, 2026 PV contains "donne avis de motion" for two zonage changes.
    expect(result.avisDeMotion).toBe(true);
  });

  it("lève changementZonage=true (Z-3001 détecté via REGLEMENT_ZONAGE_LETTER_RE)", () => {
    // The PV contains real zonage changes: "règlement de zonage Z-3001" in the
    // same sentence as "donne avis de motion".  The REGLEMENT_ZONAGE_LETTER_RE
    // pattern matches Z-prefix numbers when immediately preceded by "règlement de
    // zonage", distinguishing them from zone codes (e.g. C-754) and non-zonage
    // bylaws (e.g. "règlement de construction Z-3300").
    expect(result.changementZonage).toBe(true);
  });

  it("extrait le n° de règlement Z-3001 (style lettre-préfixe Châteauguay)", () => {
    // REGLEMENT_ZONAGE_LETTER_RE captures Z-3001 from "règlement de zonage Z-3001".
    expect(result.reglementNumbers).toContain("Z-3001");
  });

  it("le texte contient bien 'règlement de zonage Z-3001' et 'zone C-754'", () => {
    // Confirms the real content is present verbatim in the fixture.
    expect(PV_CHATEAUGUAY_2026_02_TEXT).toContain("règlement de zonage Z-3001");
    expect(PV_CHATEAUGUAY_2026_02_TEXT).toContain("zone C-754");
    expect(PV_CHATEAUGUAY_2026_02_TEXT).toContain("zone C-810");
    expect(PV_CHATEAUGUAY_2026_02_TEXT).toContain("zone H-812");
  });

  it("zoneRefs contient C-754, C-810, H-812 (vraies zones — correction pollution données)", () => {
    // FIX: Zone codes C-754, C-810, H-812 are genuine zone designators
    // (text: "zone C-754", "zone C-810", "zone H-812") and must appear in zoneRefs.
    expect(result.zoneRefs).toContain("C-754");
    expect(result.zoneRefs).toContain("C-810");
    expect(result.zoneRefs).toContain("H-812");
  });

  it("zoneRefs N'INCLUT PAS Z-3001 ni Z-3300 (n° de règlement, pas codes de zone)", () => {
    // FIX: Z-3001 is a règlement number (captured by REGLEMENT_ZONAGE_LETTER_RE),
    // not a zone code. Z-3300 is "règlement de construction Z-3300" — also a bylaw
    // identifier. Neither should appear in zoneRefs.
    expect(result.zoneRefs).not.toContain("Z-3001");
    expect(result.zoneRefs).not.toContain("Z-3300");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6b. detectZonageChange — Saint-Constant Mai 2026: non-régression zoneRefs
// ─────────────────────────────────────────────────────────────────────────────

import {
  PV_SAINT_CONSTANT_2026_05_TEXT,
} from "./proces-verbaux-saint-constant.fixture.js";

describe("detectZonageChange – Saint-Constant Mai 2026 (non-régression zoneRefs H-431)", () => {
  const result = detectZonageChange(PV_SAINT_CONSTANT_2026_05_TEXT);

  it("détecte avisDeMotion (motion pour 1926-26 et 1927-26 présente)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("n'inclut pas de codes Z-* dans zoneRefs (Saint-Constant n'a pas de règlements lettre-préfixe)", () => {
    // Non-regression: the fix must not break cities using digit-only bylaw numbers.
    // Saint-Constant uses "1926-26" style — no Z-prefix codes to exclude.
    for (const zone of result.zoneRefs) {
      expect(zone).not.toMatch(/^Z-\d/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. detectZonageChange — Delson Mai 2026: emprunt expropriation, pas de zonage
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Delson Mai 2026 (emprunt expropriation, 0 zonage)", () => {
  const result = detectZonageChange(PV_DELSON_2026_05_TEXT);

  it("détecte avisDeMotion (référence passée à avis de motion Règlement n° 757)", () => {
    // The PV contains "il y a eu avis de motion, dépôt, présentation et adoption
    // du projet de Règlement n° 757" in a ATTENDU QUE clause.
    expect(result.avisDeMotion).toBe(true);
  });

  it("ne lève PAS changementZonage (règlement 757 = emprunt expropriation, pas zonage)", () => {
    expect(result.changementZonage).toBe(false);
  });

  it("aucun mot-clé zonage dans le texte Delson Mai 2026", () => {
    // Confirmed: zero mentions of "zonage" in the May 12, 2026 Delson PV.
    expect(PV_DELSON_2026_05_TEXT.toLowerCase()).not.toContain("zonage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. detectZonageChange — Vaudreuil-Dorion Mai 2026: motions non-zonage (CORRIGÉ)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Vaudreuil-Dorion Mai 2026 (tarification + démolition, faux positif supprimé)", () => {
  const result = detectZonageChange(PV_VAUDREUIL_DORION_2026_05_TEXT);

  it("détecte avisDeMotion (motions pour 1709-38 tarification et 1835-01 démolition)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("reglementNumbers VIDE (1709-38 tarification et 1835-01 démolition NE sont PAS de zonage)", () => {
    // PRÉCISION FIX: reglementNumbers n'est désormais peuplé QUE pour les motions
    // dont le contexte immédiat contient un mot-clé de zonage ("zonage", "règlement
    // de zonage", "règlement d'urbanisme"). Les règlements 1709-38 (tarification)
    // et 1835-01 (démolition) ne sont pas de zonage → reglementNumbers est vide.
    // Le texte source contient bien ces règlements (vérifiable ci-dessous) mais
    // leur contexte d'avis de motion ne mentionne pas "zonage".
    expect(result.reglementNumbers).toEqual([]);
  });

  it("NE lève PAS changementZonage (faux positif corrigé — fenêtre forward bornée par \\n\\n)", () => {
    // FIX: The "Règlement de zonage (règlement no 1872)" mention is in item
    // 26-05-0429 (dérogation enseigne), ~325 chars after the last "donne avis de
    // motion" for règlement 1835-01 (démolition).  The previous ±400-char flat
    // window reached across the blank-line separator between the two items and
    // falsely flagged this as a zonage change.
    //
    // The corrected algorithm caps the FORWARD window at the first \n\n after the
    // motion phrase end.  Item 26-05-0428 ends with \n\n before 26-05-0429, so the
    // "Règlement de zonage" in 26-05-0429 is no longer in scope.
    // Règlements 1709-38 (tarification) and 1835-01 (démolition) are NOT zonage.
    expect(result.changementZonage).toBe(false);
  });

  it("le texte contient 'Règlement de zonage' dans le contexte de l'item 26-05-0429 (dérogation enseigne)", () => {
    // Confirms the content is present — the fix works by bounding the window, not
    // by removing zonage text from the fixture.
    expect(PV_VAUDREUIL_DORION_2026_05_TEXT).toContain("Règlement de zonage");
    expect(PV_VAUDREUIL_DORION_2026_05_TEXT).toContain("1835-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — La Prairie (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – La Prairie (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_LAPRAIRIE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(LAPRAIRIE_PV_CONFIG, {
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

  it("tous les refs ont city 'la-prairie'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("la-prairie");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ProcesVerbauxGenericAdapter.list() — Châteauguay (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Châteauguay (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_CHATEAUGUAY_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(CHATEAUGUAY_PV_CONFIG, {
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

  it("tous les refs ont city 'chateauguay'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("chateauguay");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ProcesVerbauxGenericAdapter.list() — Delson (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Delson (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_DELSON_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(DELSON_PV_CONFIG, {
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

  it("tous les refs ont city 'delson'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("delson");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. ProcesVerbauxGenericAdapter.list() — Vaudreuil-Dorion (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Vaudreuil-Dorion (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_VAUDREUIL_DORION_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(VAUDREUIL_DORION_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 183,
  });

  it("yields au moins 10 refs PV dans la fenêtre 6 mois", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(10);
  });

  it("tous les refs ont city 'vaudreuil-dorion'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("vaudreuil-dorion");
    }
  });

  it("tous les refs ont sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });
});
