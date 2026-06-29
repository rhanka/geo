/**
 * Tests for real PV scraping of cities in Basses-Laurentides / Laurentides
 * near Montréal (cluster nord: Sainte-Thérèse, Deux-Montagnes, Mirabel, Saint-Eustache).
 *
 * Fixtures are REAL data captured from public municipal websites 2026-06-10.
 * Nothing is fabricated (ANTI-INVENTION rule, rules/MASTER.md).
 *
 * Sites confirmed accessible (HTTP 200, robots.txt OK, text-layer PDFs):
 *   - Sainte-Thérèse: https://www.sainte-therese.ca/
 *     robots.txt: Disallow: /administration, /administration/backend only
 *     URL: https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/
 *     PDF: HTTP 200, 3 407 337 bytes, pdftotext → texte extractible
 *   - Deux-Montagnes: https://www.ville.deux-montagnes.qc.ca/
 *     robots.txt: Disallow: /administration, /administration/backend only
 *     URL: https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal
 *     PDF: HTTP 200, 266 630 bytes, pdftotext → texte extractible
 *   - Mirabel: https://mirabel.ca/
 *     robots.txt: User-Agent: * / Disallow: (empty — no restrictions)
 *     URL: https://mirabel.ca/seances-conseil
 *     PDF: HTTP 200, texte extractible (table layout, direct PDF links)
 *   - Saint-Eustache: https://www.saint-eustache.ca/
 *     robots.txt: Disallow: /administration, /administration/backend only
 *     URL: https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil
 *     PDF: HTTP 200, 1 591 967 bytes (compiled 2026), texte extractible
 *     NOTE: Saint-Eustache publishes annual compiled PDFs (2026PV_internet.pdf) — one per year.
 *
 * Sites inaccessibles (documentés honnêtement — 2026-06-10):
 *   - Boisbriand: HTTP 200 (site accessible), BUT April 2026 PV has "avis de motion" only
 *     for non-zonage règlements (RV-1787-1 tarifs, RV-1796 réserve financière) →
 *     avisDeMotion=true, changementZonage=false (honest, no false positive). Not included.
 *   - Rosemère: HTTP 301 redirect chain → final URL inaccessible (connection refused).
 *   - Blainville: robots.txt OK, site accessible, but seances page shows only ODJ (ordres
 *     du jour) — no PV PDF links found on the tested URL.
 *   - Bois-des-Filion: all tested domains (boisdesfilion.ca, www.boisdesfilion.ca,
 *     ville.boisdesfilion.qc.ca) → ECONNREFUSED / no response.
 *
 * Détections zonage réelles par ville (honest — anti-invention):
 *   - Sainte-Thérèse Mars 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 1200-93 agrandissant zone C-254, règlement de zonage 1200 N.S.)
 *       reglementNumbers=["1200-93"] (REGLEMENT_NUMBER_RE: "règlement numéro 1200-93")
 *   - Deux-Montagnes Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlements 1767/1768/1769/1770 modifiant Règlement de zonage Règl. n°1733)
 *       reglementNumbers=[] (non-hyphenated 4-digit numbers, no \d{2,4}-\d{1,4} match)
 *   - Mirabel Avril 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (résolution 225-04-2026: Avis de motion pour règlement modifiant zonage U-2300)
 *       reglementNumbers=[] (Mirabel uses letter-prefix format U-2300, U-2701 → no match)
 *   - Saint-Eustache Fév 2026:
 *       avisDeMotion=true, changementZonage=true
 *       (règlement 1998 "Règlement de zonage" remplaçant règlement 1675)
 *       reglementNumbers=[] (plain 4-digit numbers without hyphens)
 *
 * Suite de tests:
 *   1. parsePvIndex — Sainte-Thérèse: parse les liens PDF (c-small-document-card)
 *   2. parsePvIndex — Deux-Montagnes: parse les liens PDF (c-document-card)
 *   3. parsePvIndex — Mirabel: parse les liens PDF (table layout)
 *   4. parsePvIndex — Saint-Eustache: parse les liens PDF annuels compilés
 *   5. detectZonageChange — Sainte-Thérèse Mars 2026: zonage RÉEL (1200-93, zone C-254)
 *   6. detectZonageChange — Deux-Montagnes Avril 2026: zonage RÉEL (règl. 1767-1770, zone H-204...)
 *   7. detectZonageChange — Mirabel Avril 2026: zonage RÉEL (avis de motion pour zonage U-2300)
 *   8. detectZonageChange — Saint-Eustache Fév 2026: zonage RÉEL (règl. 1998 "Règlement de zonage")
 *   9. ProcesVerbauxGenericAdapter.list() — Sainte-Thérèse (mocked fetch)
 *   10. ProcesVerbauxGenericAdapter.list() — Deux-Montagnes (mocked fetch)
 *   11. ProcesVerbauxGenericAdapter.list() — Mirabel (mocked fetch)
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  parsePvIndex,
} from "./proces-verbaux-parser.js";
import {
  SAINTE_THERESE_PV_CONFIG,
  DEUX_MONTAGNES_PV_CONFIG,
  MIRABEL_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_SAINTE_THERESE_INDEX_HTML,
  PV_SAINTE_THERESE_2026_03_TEXT,
} from "./proces-verbaux-sainte-therese.fixture.js";
import {
  PV_DEUX_MONTAGNES_INDEX_HTML,
  PV_DEUX_MONTAGNES_2026_04_TEXT,
} from "./proces-verbaux-deux-montagnes.fixture.js";
import {
  PV_MIRABEL_INDEX_HTML,
  PV_MIRABEL_2026_04_TEXT,
} from "./proces-verbaux-mirabel.fixture.js";
import {
  PV_SAINT_EUSTACHE_INDEX_HTML,
  PV_SAINT_EUSTACHE_2026_02_TEXT,
} from "./proces-verbaux-saint-eustache.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parsePvIndex — Sainte-Thérèse
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Sainte-Thérèse index HTML (c-small-document-card structure)", () => {
  const items = parsePvIndex(
    PV_SAINTE_THERESE_INDEX_HTML,
    "https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF sainte-therese.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("sainte-therese.ca");
    }
  });

  it("inclut le PV du 2 mars 2026 (26-03-02_ordinaire.pdf)", () => {
    const mar02 = items.find((i) => i.url.includes("26-03-02_ordinaire.pdf"));
    expect(mar02).toBeDefined();
  });

  it("inclut le PV du 4 mai 2026 (26-05-04_ordinaire.pdf)", () => {
    const may04 = items.find((i) => i.url.includes("26-05-04_ordinaire.pdf"));
    expect(may04).toBeDefined();
  });

  it("inclut le PV du 1er juin 2026 (26-06-01_ordinaire.pdf)", () => {
    const jun01 = items.find((i) => i.url.includes("26-06-01_ordinaire.pdf"));
    expect(jun01).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parsePvIndex — Deux-Montagnes
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Deux-Montagnes index HTML (c-document-card structure)", () => {
  const items = parsePvIndex(
    PV_DEUX_MONTAGNES_INDEX_HTML,
    "https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF deux-montagnes.qc.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("deux-montagnes");
    }
  });

  it("inclut le PV du 9 avril 2026 (2026-04-09-proces-verbal-ordinaire.pdf)", () => {
    const apr09 = items.find((i) =>
      i.url.includes("2026-04-09-proces-verbal-ordinaire.pdf"),
    );
    expect(apr09).toBeDefined();
  });

  it("inclut le PV du 12 mars 2026 (2026-03-12-proces-verbal-ordinaire.pdf)", () => {
    const mar12 = items.find((i) =>
      i.url.includes("2026-03-12-proces-verbal-ordinaire.pdf"),
    );
    expect(mar12).toBeDefined();
  });

  it("inclut le PV du 15 janvier 2026 (2026-01-15-proces-verbal-ordinaire.pdf)", () => {
    const jan15 = items.find((i) =>
      i.url.includes("2026-01-15-proces-verbal-ordinaire.pdf"),
    );
    expect(jan15).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Mirabel
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Mirabel index HTML (table layout avec liens PDF directs)", () => {
  const items = parsePvIndex(
    PV_MIRABEL_INDEX_HTML,
    "https://mirabel.ca/seances-conseil",
  );

  it("parse au moins 5 items de PV dans la liste", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("tous les items ont des URLs https PDF mirabel.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("mirabel.ca");
    }
  });

  it("inclut le PV du 13 avril 2026 (2026-04-13_Proces-verbal_FINAL.pdf)", () => {
    const apr13 = items.find((i) =>
      i.url.includes("2026-04-13_Proces-verbal_FINAL.pdf"),
    );
    expect(apr13).toBeDefined();
  });

  it("inclut le PV du 11 mai 2026 (2026-05-11_Proces-verbal_FINAL.pdf)", () => {
    const may11 = items.find((i) =>
      i.url.includes("2026-05-11_Proces-verbal_FINAL.pdf"),
    );
    expect(may11).toBeDefined();
  });

  it("inclut un PV 2025 (2025-11-24_Proces-verbal_FINAL.pdf)", () => {
    const nov24 = items.find((i) =>
      i.url.includes("2025-11-24_Proces-verbal_FINAL.pdf"),
    );
    expect(nov24).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parsePvIndex — Saint-Eustache
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Eustache index HTML (annual compiled PDFs)", () => {
  const items = parsePvIndex(
    PV_SAINT_EUSTACHE_INDEX_HTML,
    "https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil",
  );

  it("parse au moins 2 items de PV compilés (2026PV et 2025PV)", () => {
    // Saint-Eustache publishes annual compiled PDFs — at least 2026 and 2025
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("tous les items ont des URLs https PDF saint-eustache.ca", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
      expect(item.url).toContain("saint-eustache.ca");
    }
  });

  it("inclut le PV compilé 2026 (2026PV_internet.pdf)", () => {
    const pv2026 = items.find((i) => i.url.includes("2026PV_internet.pdf"));
    expect(pv2026).toBeDefined();
  });

  it("inclut le PV compilé 2025 (2025PV_internet.pdf)", () => {
    const pv2025 = items.find((i) => i.url.includes("2025PV_internet.pdf"));
    expect(pv2025).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectZonageChange — Sainte-Thérèse Mars 2026: fenêtre étendue au 2e paragraphe
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Sainte-Thérèse Mars 2026 (règlement 1200-93, zone C-254)", () => {
  const result = detectZonageChange(PV_SAINTE_THERESE_2026_03_TEXT);

  it("détecte avisDeMotion (ATTENDU l'avis de motion présent)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : fenêtre étendue au 2e paragraphe (règlement 1200-93 + règlement de zonage 1200 N.S.)", () => {
    // EXTENDED FORWARD WINDOW (fix 2026-06): when the first forward paragraph after
    // "ATTENDU l'avis de motion" contains a règlement number (règlement 1200-93) but
    // NO zonage keyword, detectZonageChange now extends the forward window to the
    // second \n\n. This captures "règlement de zonage 1200 N.S." in the
    // "Sur proposition … QUE le projet de règlement numéro 1200-93 … agrandissant
    // la zone C-254 à même la zone H-202-1 de l'annexe A du règlement de zonage
    // 1200 N.S., soit et est adopté" paragraph.
    // Anti-FP: extension only fires when the 1st forward para has a règlement number;
    // Vaudreuil-Dorion's "démolition" para has no hyphenated number → no extension.
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient '1200-93' (REGLEMENT_NUMBER_RE via fenêtre étendue)", () => {
    expect(result.reglementNumbers).toContain("1200-93");
  });

  it("le texte brut contient 'règlement de zonage 1200 N.S.' et '1200-93'", () => {
    const lower = PV_SAINTE_THERESE_2026_03_TEXT.toLowerCase();
    expect(lower).toContain("règlement de zonage");
    expect(PV_SAINTE_THERESE_2026_03_TEXT).toContain("1200-93");
    expect(PV_SAINTE_THERESE_2026_03_TEXT).toContain("zone C-254");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectZonageChange — Deux-Montagnes Avril 2026: entiers captés via REGLEMENT_NOHYPHEN_RE
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Deux-Montagnes Avril 2026 (règl. de zonage Règl. n°1733, zones H-204/H-381/P-386)", () => {
  const result = detectZonageChange(PV_DEUX_MONTAGNES_2026_04_TEXT);

  it("détecte avisDeMotion ('avis de motion...a dûment été donné' présent)", () => {
    // AVIS_MOTION_RE matches "avis de motion" in "un avis de motion du présent règlement
    // a dûment été donné" (non-past-tense form — "dûment" intervenes before "a").
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : règlements 1767–1770 captés via REGLEMENT_NOHYPHEN_RE (entiers nº/n°)", () => {
    // REGLEMENT_NOHYPHEN_RE (fix 2026-06): captures 3-4 digit integers immediately
    // preceded by "règlement nº/n°/no/numéro", ONLY when the context window already
    // has a ZONAGE_KEYWORDS_RE match. In Deux-Montagnes, each section header reads:
    //   "Adoption – Règlement nº 1767 - Règlement modifiant le Règlement de zonage
    //    (Règl. n°1733)"
    // The backward window from "avis de motion" captures this header (prev \n\n is
    // right before the section header). REGLEMENT_NOHYPHEN_RE extracts 1767 (new)
    // and 1733 (modified via MODIFIANT_NOHYPHEN_RE → excluded). Final: [1767].
    // Anti-FP guard: the ZONAGE_KEYWORDS_RE test ensures integers are only captured
    // in a confirmed zonage context, not for any règlement mention.
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient au moins un des règlements 1767–1770", () => {
    const nums = result.reglementNumbers;
    const hasAny = nums.some((n) => ["1767", "1768", "1769", "1770"].includes(n));
    expect(hasAny).toBe(true);
  });

  it("reglementNumbers ne contient pas 1733 (règlement modifié, exclu)", () => {
    // 1733 is the MODIFIED règlement (Règl. n°1733 in the "modifiant" clause).
    // MODIFIANT_NOHYPHEN_RE marks it as modified → excluded by filterNewReglements.
    expect(result.reglementNumbers).not.toContain("1733");
  });

  it("le texte brut contient 'Règlement de zonage' et les zones H-204, H-381, P-386", () => {
    const text = PV_DEUX_MONTAGNES_2026_04_TEXT;
    expect(text.toLowerCase()).toContain("règlement de zonage");
    expect(text).toContain("H-204");
    expect(text).toContain("H-381");
    expect(text).toContain("P-386");
  });

  it("le texte brut contient '1767' et '1768' (adoptions règlements zonage)", () => {
    expect(PV_DEUX_MONTAGNES_2026_04_TEXT).toContain("1767");
    expect(PV_DEUX_MONTAGNES_2026_04_TEXT).toContain("1768");
    expect(PV_DEUX_MONTAGNES_2026_04_TEXT).toContain("1769");
    expect(PV_DEUX_MONTAGNES_2026_04_TEXT).toContain("1770");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. detectZonageChange — Mirabel Avril 2026: U-2300 capté via REGLEMENT_ZONAGE_LETTER_RE étendu
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Mirabel Avril 2026 (avis de motion règlement de zonage U-2300)", () => {
  const result = detectZonageChange(PV_MIRABEL_2026_04_TEXT);

  it("détecte avisDeMotion (résolution 225-04-2026: Avis de motion est donné)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : U-2300 capté par REGLEMENT_ZONAGE_LETTER_RE étendu (numéro intercalé)", () => {
    // REGLEMENT_ZONAGE_LETTER_RE extended (fix 2026-06): now allows an optional
    // n°/nº/no/numéro between "règlement de zonage" and the letter-prefix code.
    // In Mirabel, résolution 225-04-2026 reads:
    //   "un règlement modifiant le règlement de zonage numéro U-2300 de façon à…"
    // The extended regex matches "règlement de zonage numéro U-2300" → U-2300.
    // Precision preserved: "règlement de zonage" prefix still required (prevents
    // "zone U-xxx" or "règlement sur les permis... U-2303" from matching).
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient 'U-2300'", () => {
    expect(result.reglementNumbers).toContain("U-2300");
  });

  it("ANTI-FAUX-POSITIF: résolution 223-04-2026 (U-2700 permis et certificats) n'est PAS zonage", () => {
    // Resolution 223-04-2026: Avis de motion for U-2700 (règlement sur les permis et certificats)
    // does NOT contain "zonage" → changementZonage stays false for that window.
    const text223 = "Avis de motion est donné par monsieur le conseiller Sébastien Hamel qu'à une prochaine séance de ce conseil, il sera présenté un règlement modifiant le règlement sur les permis et certificats numéro U-2303 de façon à réviser certains honoraires exigibles pour les permis de lotissement";
    const result223 = detectZonageChange(text223);
    expect(result223.changementZonage).toBe(false);
  });

  it("le texte brut contient 'règlement de zonage numéro U-2300' et 'Avis de motion'", () => {
    const lower = PV_MIRABEL_2026_04_TEXT.toLowerCase();
    expect(lower).toContain("règlement de zonage");
    expect(lower).toContain("avis de motion");
    expect(PV_MIRABEL_2026_04_TEXT).toContain("U-2300");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. detectZonageChange — Saint-Eustache Fév 2026: 1998 capté via REGLEMENT_NOHYPHEN_RE
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – Saint-Eustache Fév 2026 (règlement 1998 Règlement de zonage, remplace 1675)", () => {
  const result = detectZonageChange(PV_SAINT_EUSTACHE_2026_02_TEXT);

  it("détecte avisDeMotion ('donne avis de motion' présent)", () => {
    // "Monsieur le maire Marc Lamarre donne avis de motion"
    expect(result.avisDeMotion).toBe(true);
  });

  it("changementZonage=true : règlement 1998 capté via REGLEMENT_NOHYPHEN_RE (entier numéro 1998)", () => {
    // REGLEMENT_NOHYPHEN_RE (fix 2026-06): captures non-hyphenated integers
    // preceded by "règlement numéro", ONLY in a confirmed zonage context.
    // In Saint-Eustache, the context window for "donne avis de motion" includes:
    //   "Règlement numéro 1998 intitulé « Règlement de zonage »"
    // REGLEMENT_NOHYPHEN_RE extracts: 1998 (new), 1675 (to be replaced).
    // REMPLACER_NOHYPHEN_RE marks 1675 as modified ("remplacer le règlement
    // numéro 1675 en vigueur concernant le règlement de zonage") → excluded.
    // Final reglementNumbers: ["1998"].
    // Anti-FP: the "concernant le règlement de LOTISSEMENT" section (4.3.5) does
    // NOT have "zonage" in its window → REGLEMENT_NOHYPHEN_RE not applied there.
    expect(result.changementZonage).toBe(true);
  });

  it("reglementNumbers contient '1998' et ne contient pas '1675' (remplacé, exclu)", () => {
    expect(result.reglementNumbers).toContain("1998");
    // 1675 is the OLD règlement being replaced (not the new proposed one).
    // REMPLACER_NOHYPHEN_RE marks it as modified → excluded by filterNewReglements.
    expect(result.reglementNumbers).not.toContain("1675");
  });

  it("le texte brut contient 'règlement de zonage' et '1998' et '1675'", () => {
    const lower = PV_SAINT_EUSTACHE_2026_02_TEXT.toLowerCase();
    expect(lower).toContain("règlement de zonage");
    expect(PV_SAINT_EUSTACHE_2026_02_TEXT).toContain("1998");
    expect(PV_SAINT_EUSTACHE_2026_02_TEXT).toContain("1675");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ProcesVerbauxGenericAdapter.list() — Sainte-Thérèse (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Sainte-Thérèse (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINTE_THERESE_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(SAINTE_THERESE_PV_CONFIG, {
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

  it("tous les refs ont city 'sainte-therese'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("sainte-therese");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ProcesVerbauxGenericAdapter.list() — Deux-Montagnes (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Deux-Montagnes (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_DEUX_MONTAGNES_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(DEUX_MONTAGNES_PV_CONFIG, {
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

  it("tous les refs ont city 'deux-montagnes'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("deux-montagnes");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ProcesVerbauxGenericAdapter.list() — Mirabel (mocked fetch)
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – Mirabel (mocked fetch)", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html; charset=utf-8" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_MIRABEL_INDEX_HTML).buffer,
  });

  const adapter = new ProcesVerbauxGenericAdapter(MIRABEL_PV_CONFIG, {
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

  it("tous les refs ont city 'mirabel'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("mirabel");
    }
  });
});
