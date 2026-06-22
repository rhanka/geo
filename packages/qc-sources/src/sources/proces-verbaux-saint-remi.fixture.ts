/**
 * Real procès-verbaux fixture data for Saint-Rémi (MRC Les Jardins-de-Napierville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (main list): https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/
 *     HTTP 200, 458 288 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - Session sub-page (April 20, 2026):
 *     https://www.saint-remi.ca/seances/seance-ordinaire-du-conseil-municipal-20-avril-2026/
 *     HTTP 200, 341 805 bytes.  Direct PDF link: 20260420_pv.pdf.
 *   - PV PDF (April 20, 2026):
 *     https://www.saint-remi.ca/wp-content/uploads/2026/05/20260420_pv.pdf
 *     HTTP 200, 594 966 bytes (PDF), 26 pages, extracted via pdftotext → 63 481 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_REMI_INDEX_HTML — verbatim HTML excerpt from the main séances page
 *      (Elementor accordion with Archive 2025 direct PDF links + 2026 sub-page entry).
 *   2. PV_SAINT_REMI_2026_04_TEXT — pdftotext excerpt from the real April 20, 2026 PV.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.saint-remi.ca/ → HTTP 200
 *   - https://www.saint-remi.ca/robots.txt → Disallow: (empty — no restrictions)
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true (multiple "donne avis de motion" occurrences)
 *   - changementZonage: true (DÉTECTION RÉELLE via REGLEMENT_VPREFIX_RE)
 *     V654-2026-33 amendant le règlement de zonage V654-2017-00 → capturé par
 *     REGLEMENT_VPREFIX_RE quand le contexte contient "règlement de zonage".
 *     V654-2017-00 exclu par MODIFIANT_REGLEMENT_VPREFIX_RE + filterNewReglements.
 *     V655-2026-03 (lotissement) et V700-2026-09 (tarification) NON capturés car
 *     leur contexte ne contient pas "règlement de zonage".
 *     reglementNumbers: ["V654-2026-33"]
 */

/**
 * Real HTML snippet from the séances page of Ville de Saint-Rémi,
 * captured 2026-06-10 from https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/
 *
 * The main page structure: Elementor accordion with "Archives 2025" section containing
 * direct PDF links, and a post grid with 2026 sub-page entries.
 *
 * Key direct PDF links (from Archives 2025 accordion):
 *   - 20251215_pv.pdf (Procès-verbal 15 décembre 2025)
 *   - 20251208_extra_pv_taxation.pdf (Procès-verbal 8 décembre 2025 – Taxation)
 *   - 20251208_extra_pv_budget.pdf (Procès-verbal 8 décembre 2025 – Budget)
 *   - 20251117_pv.pdf (Procès-verbal 17 novembre 2025)
 *   - 20251001_pv.pdf (Procès-verbal 1er octobre 2025)
 *   - 20250915_pv.pdf (Procès-verbal 15 septembre 2025)
 *   - 20250818_pv.pdf (Procès-verbal 18 août 2025)
 *   - 20250714_pv.pdf (Procès-verbal 14 juillet 2025)
 *   - 20250616_pv.pdf (Procès-verbal 16 juin 2025)
 *   - 20250520_pv-17-juin.pdf (Procès-verbal 20 mai 2025)
 *
 * 2026 sub-page link (parsePvIndex does not follow sub-pages; direct PDF absent from main index):
 *   - Séance ordinaire du conseil municipal – 20 avril 2026
 */
export const PV_SAINT_REMI_INDEX_HTML = `
<div class="elementor-accordion">
  <div class="elementor-accordion-item">
    <div class="elementor-tab-title">Archives 2025</div>
    <div class="elementor-tab-content">
      <ul>
        <li>
          <div>Séance ordinaire du conseil municipal du 15 décembre 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2026/01/20251215_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance extraordinaire du conseil municipal du 8 décembre 2025 – Taxation</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/12/20251208_extra_pv_taxation.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance extraordinaire du conseil municipal du 8 décembre 2025 – Budget</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/12/20251208_extra_pv_budget.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 17 novembre 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/12/20251117_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 1er octobre 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/11/20251001_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 15 septembre 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/10/20250915_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 18 août 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/09/20250818_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 14 juillet 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/08/20250714_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 16 juin 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/07/20250616_pv.pdf">Procès-verbal</a></li>
          </ul>
        </li>
        <li>
          <div>Séance ordinaire du conseil municipal du 20 mai 2025</div>
          <ul>
            <li><a href="https://www.saint-remi.ca/wp-content/uploads/2025/06/20250520_pv-17-juin.pdf">Procès-verbal</a></li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</div>
<!-- 2026 sessions are listed as sub-page links (not direct PDFs) in the main index.
     parsePvIndex only finds direct PDF links; sub-pages require an additional fetch.
     The adapter config pvIndexUrl points to this main page; 2026 PVs are accessible
     via individual session sub-pages (e.g. /seances/seance-ordinaire-du-conseil-municipal-20-avril-2026/).
     The Archives 2025 accordion above provides the direct PDF links for the 6-month window. -->
`;

/**
 * Real pdftotext excerpt from the April 20, 2026 ordinary council session PV of
 * Ville de Saint-Rémi, captured 2026-06-10 from:
 * https://www.saint-remi.ca/wp-content/uploads/2026/05/20260420_pv.pdf
 *
 * This excerpt covers the SERVICE DE L'URBANISME section with the avis de motion
 * for règlement V654-2026-33 (zonage change) and V655-2026-03 (lotissement),
 * and the SERVICE DU GREFFE section with the taxification motion.
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("donne avis de motion" present multiple times)
 *   - changementZonage: true (DÉTECTION RÉELLE via REGLEMENT_VPREFIX_RE)
 *     V654-2026-33 amendant le règlement de zonage V654-2017-00 → capturé car le
 *     contexte de l'avis de motion contient "règlement de zonage" (ZONAGE_KEYWORDS_RE).
 *     V655-2026-03 et V700-2026-09 NON capturés (leur contexte ne mentionne pas "zonage").
 *   - reglementNumbers: ["V654-2026-33"] (V654-2017-00 exclu car c'est le modifié)
 */
export const PV_SAINT_REMI_2026_04_TEXT = `SERVICE DE L'URBANISME

************************************************************************
2026-04-0100
3.1

AVIS DE MOTION - DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO V654-2026-33
AMENDANT LE RÈGLEMENT DE ZONAGE NUMÉRO V654-2017-00 ET SES
AMENDEMENTS (CONCORDANCE AU RÈGLEMENT URB-205-18-2025)

ATTENDU l'article 356 de la Loi sur les cités et villes (RLRQ, chapitre C-19);
Madame Annie Payant, conseillère, par la présente :
•

donne avis de motion, qu'il sera adopté, à une séance ultérieure, le règlement
numéro V654-2026-33 amendant le règlement de zonage numéro V654-2017-00
et ses amendements (concordance au règlement URB-205-18-2025).

•

dépose le projet du règlement numéro V654-2026-33 intitulé : Règlement
numéro V654-2026-33 amendant le règlement de zonage numéro V654-2017-00
et ses amendements (concordance au règlement URB-205-18-2025).

************************************************************************
2026-04-0103
3.3

AVIS DE MOTION - DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO V655-2026-03
AMENDANT LE RÈGLEMENT DE LOTISSEMENT NUMÉRO V655-2017-00 ET SES
AMENDEMENTS (CONCORDANCE AU RÈGLEMENT URB-205-21-2025)

ATTENDU l'article 356 de la Loi sur les cités et villes (RLRQ, chapitre C-19);
Monsieur Dany Brosseau, conseiller, par la présente :
•

donne avis de motion, qu'il sera adopté, à une séance ultérieure, le règlement
numéro V655-2026-03 amendant le règlement de lotissement numéro V655-2017-00
et ses amendements (concordance au règlement URB-205-21-2025).

•

dépose le projet du règlement numéro V655-2026-03 intitulé : Règlement
numéro V655-2026-03 amendant le règlement de lotissement numéro V655-2017-00
et ses amendements (concordance au règlement URB-205-21-2025).

************************************************************************
4.9

AVIS DE MOTION - DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO V700-2026-09
AMENDANT LE RÈGLEMENT NUMÉRO V700-2020-00 DÉCRÉTANT L'IMPOSITION
DES TAUX DE TARIFICATION DES SERVICES MUNICIPAUX ET SES AMENDEMENTS

Monsieur Xavier Pouliot Aguillon, conseiller, par la présente :
•

donne avis de motion, qu'il sera adopté, à une séance ultérieure, le règlement
numéro V700-2026-09 amendant le règlement numéro V700-2020-00 décrétant
l'imposition des taux de tarification des services municipaux et ses amendements.

`;
