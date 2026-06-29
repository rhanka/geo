/**
 * Real procès-verbaux fixture data for Beloeil (MRC La Vallée-du-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.beloeil.ca/mairie/seances-du-conseil/
 *     HTTP 200, 166 515 bytes, public / no login.
 *     robots.txt: Disallow: (empty — no restrictions). Yoast sitemap listed.
 *   - PV PDF (February 23, 2026):
 *     https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260223_pv.pdf
 *     HTTP 200, 611 335 bytes (PDF), extracted via pdftotext → 70 410 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_BELOEIL_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (Elementor accordion with 2026 and 2025 sections; direct PDF links).
 *   2. PV_BELOEIL_2026_02_TEXT — pdftotext excerpt from the Feb 23, 2026 PV.
 *      Contains "avis de motion" for TWO real zonage changes:
 *        - Règlement 1667-127-2026 modifiant le Règlement de zonage 1667-00-2011
 *          (actualiser certaines dispositions environnementales)
 *        - Règlement 1667-128-2026 modifiant le Règlement de zonage 1667-00-2011
 *          (permettre usage C-5 dans zone C-523)
 *
 * PARSER SUPPORT: Beloeil uses 3-segment règlement numbering (1667-127-2026).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "1667-127" (prefix of "1667-127-2026").
 *   "1667-00-2011" (the modified base bylaw) → matched as "1667-00" by MODIFIANT_REGLEMENT_RE.
 *   filterNewReglements returns ["1667-127"] and ["1667-128"] respectively.
 *   "règlement de zonage" keyword present → changementZonage=true.
 *   Also note: the first avis de motion for 1667-127-2026 uses the phrase
 *   "modification de...plusieurs éléments du règlement de zonage" without naming
 *   the règlement number in the backward context — but the HEADER line
 *   "RÈGLEMENT 1667-127-2026 MODIFIANT LE RÈGLEMENT DE ZONAGE 1667-00-2011"
 *   is captured in the backward window of the "donne un avis de motion" phrase.
 *   Result: avisDeMotion=true, reglementNumbers=["1667-127", "1667-128"] (or subset),
 *   changementZonage=true. ZERO false positive: both rules genuinely modify zonage.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.beloeil.ca/ → HTTP 200
 *   - robots.txt: Disallow: (empty — no restrictions)
 *   - All wp-content/uploads PDFs are publicly accessible.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Beloeil,
 * captured 2026-06-10 from:
 * https://www.beloeil.ca/mairie/seances-du-conseil/
 *
 * WordPress + Elementor accordion structure.
 * Accordion item 1: "Ordre du jour et procès-verbaux 2026"
 *   — 8 sessions (Jan–Jun 2026): 8 PDF links (ODJ and PV mixed)
 * Accordion item 2: "Procès-verbaux 2025"
 *   — 1 compiled PDF (all 2025 sessions)
 * Accordion item 3: "Procès-verbaux 2024"
 *   — 1 compiled PDF.
 *
 * Key PV PDF links present in 2026 section:
 *   conseil_20260323_pv.pdf, conseil_20260223_pv.pdf, conseil_20260126_pv.pdf
 *
 * Key ODJ PDF links (also .pdf, will be parsed by parsePvIndex):
 *   conseil_20260608_extra_doc.pdf, conseil_20260525_pv_web.pdf,
 *   conseil_20260511_extra_doc_web.pdf, conseil_20260427_pv.pdf,
 *   conseil_20260408_odj.pdf
 */
export const PV_BELOEIL_INDEX_HTML = `
<div class="elementor-accordion">
  <div class="elementor-accordion-item">
    <h4 id="elementor-tab-title-4751" class="elementor-tab-title" data-tab="1" role="button">
      <a class="elementor-accordion-title" tabindex="0">Ordre du jour et procès-verbaux 2026</a>
    </h4>
    <div id="elementor-tab-content-4751" class="elementor-tab-content elementor-clearfix" data-tab="1" role="region">
      <p>Séance extraordinaire du 8 juin 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/06/conseil_20260608_extra_doc.pdf" target="_blank" rel="noopener">Ordre du jour</a></li></ul>
      <p>Séance ordinaire du 25 mai 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/05/conseil_20260525_pv_web.pdf" target="_blank" rel="noopener">Ordre du jour</a></li></ul>
      <p>Séance extraordinaire du 11 mai 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/05/conseil_20260511_extra_doc_web.pdf" target="_blank" rel="noopener">Ordre du jour</a></li></ul>
      <p>Séance ordinaire du 27 avril 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/04/conseil_20260427_pv.pdf" target="_blank" rel="noopener">Ordre du jour</a></li></ul>
      <p>Séance extraordinaire du 8 avril 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/04/conseil_20260408_odj.pdf" target="_blank" rel="noopener">Ordre du jour</a></li></ul>
      <p>Séance ordinaire du 23 mars 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260323_pv.pdf" target="_blank" rel="noopener">Procès-verbal (non-approuvé)</a></li></ul>
      <p>Séance ordinaire du 23 février 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260223_pv.pdf" target="_blank" rel="noopener">Procès-verbal</a></li></ul>
      <p>Séance ordinaire du 26 janvier 2026</p>
      <ul><li><a href="https://beloeil.ca/wp-content/uploads/2026/02/conseil_20260126_pv.pdf">Procès-verbal</a></li></ul>
    </div>
  </div>
  <div class="elementor-accordion-item">
    <h4 id="elementor-tab-title-4752" class="elementor-tab-title" data-tab="2" role="button">
      <a class="elementor-accordion-title" tabindex="0">Procès-verbaux 2025</a>
    </h4>
    <div id="elementor-tab-content-4752" class="elementor-tab-content elementor-clearfix" data-tab="2" role="region">
      <p><a href="https://beloeil.ca/wp-content/uploads/2026/02/proces_verbaux_2025.pdf" target="_blank" rel="noopener">Procès-verbaux des séances ordinaires et extraordinaires de l&#8217;année 2025</a></p>
    </div>
  </div>
  <div class="elementor-accordion-item">
    <h4 id="elementor-tab-title-4753" class="elementor-tab-title" data-tab="3" role="button">
      <a class="elementor-accordion-title" tabindex="0">Procès-verbaux 2024</a>
    </h4>
    <div id="elementor-tab-content-4753" class="elementor-tab-content elementor-clearfix" data-tab="3" role="region">
      <p><a href="https://beloeil.ca/wp-content/uploads/2026/01/proces_verbaux_2024.pdf" target="_blank" rel="noopener">Procès-verbaux des séances ordinaires et extraordinaires de l&#8217;année 2024</a></p>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from Beloeil PV February 23, 2026.
 * Source: https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260223_pv.pdf
 * Captured: 2026-06-10
 *
 * Contains avis de motion for TWO real zonage changes:
 *   - AVIS DE MOTION 2026-02-91: Règlement 1667-127-2026 modifiant le Règlement de
 *     zonage 1667-00-2011 afin d'actualiser certaines dispositions d'un point de vue
 *     environnemental et d'en faciliter l'application.
 *   - AVIS DE MOTION 2026-02-92: Règlement 1667-128-2026 modifiant le Règlement de
 *     zonage 1667-00-2011 visant à permettre le groupe d'usage « Commerce de
 *     divertissement et d'activités récréotouristiques (C-5) » dans la zone C-523.
 *   - AVIS DE MOTION 2026-02-93: Règlement 1666-07-2026 modifiant le Règlement 1666-00-2011
 *     édictant le Plan d'urbanisme (NOT zonage → changementZonage=false for this one,
 *     since "plan d'urbanisme" alone does not trigger ZONAGE_KEYWORDS_RE which requires
 *     "zonage" or "règlement de zonage" or "règlement d'urbanisme").
 *
 * Both 1667-127 and 1667-128 were subsequently adopted in the March 23, 2026 session
 * (confirmed in conseil_20260323_pv.pdf).
 *
 * DETECTION:
 *   - "1667-127" extracted by REGLEMENT_NUMBER_RE from "règlement 1667-127-2026" prefix.
 *   - "1667-128" extracted similarly.
 *   - "1667-00" (the modified bylaw) extracted by MODIFIANT_REGLEMENT_RE and excluded
 *     by filterNewReglements when distinct new numbers exist.
 *   - "règlement de zonage" keyword present in headers → changementZonage=true.
 *   - Zone C-523 mentioned for 1667-128-2026 → zoneRefs=["C-523"].
 *   Result: avisDeMotion=true, reglementNumbers contains "1667-127" and/or "1667-128",
 *   changementZonage=true. ZERO false positive.
 */
export const PV_BELOEIL_2026_02_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Beloeil,
tenue le lundi 23 février 2026.

Séance ordinaire – 23 février 2026

Page 15 sur 26

2026-02-91
37. AVIS DE MOTION ET ADOPTION DU PROJET DE RÈGLEMENT 1667-127-2026 MODIFIANT LE
RÈGLEMENT DE ZONAGE 1667-00-2011 AFIN D'ACTUALISER CERTAINES DISPOSITIONS D'UN POINT
DE VUE ENVIRONNEMENTAL ET D'EN FACILITER L'APPLICATION
Monsieur le conseiller Youann Blouin donne un avis de motion qu'un règlement ayant pour objet
de la modification de plusieurs éléments du règlement de zonage, sera déposé, pour adoption, à une
séance ultérieure.
Conformément aux dispositions de l'article 356 de la Loi sur les cités et villes, Monsieur le
conseiller Youann Blouin adopte également le projet du règlement 1667-127-2026.

2026-02-92
38. AVIS DE MOTION ET ADOPTION DU PROJET DE RÈGLEMENT 1667-128-2026 MODIFIANT LE
RÈGLEMENT DE ZONAGE 1667-00-2011 VISANT À PERMETTRE LE GROUPE D'USAGE « COMMERCE
DE DIVERTISSEMENT ET D'ACTIVITÉS RÉCRÉOTOURISTIQUES (C-5) » DANS LA ZONE C-523
Madame la conseillère Alexandra Picard-Dubé donne un avis de motion qu'un règlement ayant
pour objet de permettre le groupe d'usage « Commerce de divertissement et d'activités
récréotouristiques (C-5) » dans la zone C-523, sera déposé, pour adoption, à une séance ultérieure.
Conformément aux dispositions de l'article 356 de la Loi sur les cités et villes, Madame la
conseillère Alexandra Picard-Dubé adopte également le projet du règlement 1667-128-2026.

2026-02-93
39. AVIS DE MOTION DU RÈGLEMENT 1666-07-2026 MODIFIANT LE RÈGLEMENT 1666-00-2011
ÉDICTANT LE PLAN D'URBANISME DE LA VILLE DE BELOEIL RELATIVEMENT AU PLAN PARTICULIER
D'URBANISME DU NOUVEAU BELOEIL ET À DIVERSES DISPOSITIONS
Monsieur le conseiller Youann Blouin donne un avis de motion qu'un règlement ayant pour objet
d'adopter et d'annexer un plan particulier d'urbanisme pour le secteur du Nouveau Beloeil et de modifier
diverses dispositions, sera déposé, pour adoption, à une séance ultérieure.
`;
