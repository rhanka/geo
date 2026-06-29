/**
 * Real procès-verbaux fixture data for Châteauguay (Rive-Sud) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://ville.chateauguay.qc.ca/affaires-municipales/seances-du-conseil/
 *     HTTP 200, 279 775 bytes, public / no login.
 *     robots.txt: Disallow /wp-admin/, Crawl-delay: 3 (content pages allowed).
 *   - PV PDF (February 23, 2026):
 *     https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/PV_2026-02-23.pdf
 *     HTTP 200, 900 798 bytes (PDF), extracted via pdftotext → 112 321 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_CHATEAUGUAY_INDEX_HTML — verbatim HTML snippet from the PV list page
 *      (session-list-wrapper structure showing recent sessions with PV PDF links).
 *   2. PV_CHATEAUGUAY_2026_02_TEXT — pdftotext excerpt from the February 23, 2026 PV.
 *      Contains "avis de motion" for:
 *        - Règlement modifiant le règlement de zonage Z-3001 visant à permettre
 *          les bâtiments de 4 étages dans la zone C-754 (AVIS DE MOTION 2026-02-119)
 *        - Règlement modifiant le règlement de zonage Z-3001 visant à agrandir
 *          la zone C-810 à même la zone H-812 (AVIS DE MOTION 2026-02-120)
 *
 * PARSER SUPPORT: Châteauguay uses alphanumeric règlement numbering
 *   Z-3001 (format "[letter]-[digits]").  The REGLEMENT_ZONAGE_LETTER_RE pattern
 *   matches Z-prefix numbers that immediately follow "règlement de zonage", which
 *   is exactly the pattern in this PV:
 *     "règlement modifiant le règlement de zonage Z-3001 visant à..."
 *   Zone codes like "C-754" or non-zonage bylaws like "règlement de construction
 *   Z-3300" are NOT matched (precision guard).  Therefore:
 *     - avisDeMotion: true (motions found)
 *     - changementZonage: true (Z-3001 extracted, "zonage" keyword present)
 *     - reglementNumbers: ["Z-3001"]
 *   The zonage changes adopted as Z-3001-156-26 and Z-3001-157-26 in April 2026
 *   are confirmed in PV_2026-04-20.pdf.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://ville.chateauguay.qc.ca/ → HTTP 200
 *   - robots.txt: Disallow /wp-admin/, Allow *.css, *.js; Crawl-delay: 3
 *   - Content pages (not /wp-admin/) are fully allowed
 */

/**
 * Real HTML snippet from the PV index page of Ville de Châteauguay,
 * captured 2026-06-10 from:
 * https://ville.chateauguay.qc.ca/affaires-municipales/seances-du-conseil/
 *
 * Key PDF links present (PV files only):
 *   - PV_2026-04-20.pdf (Séance ordinaire 20 avril 2026)
 *   - PV_2026-04-09_extra.pdf (Séance extraordinaire 9 avril 2026)
 *   - PV_2026-03-16.pdf (Séance ordinaire 16 mars 2026)
 *   - PV_2026-03-12_extra.pdf (Séance extraordinaire 12 mars 2026)
 *   - PV_2026-02-23.pdf (Séance ordinaire 23 février 2026)
 */
export const PV_CHATEAUGUAY_INDEX_HTML = `
<div class="session-list-container">
  <ul class="session-list-wrapper no-bullet">
    <li class="session-container grid-x block-shadow-no-hover">
      <div class="cell medium-8 session-infos-container grid-x">
        <div class="cell small-12"><h4 class="h3">Lundi 20 avril 2026</h4></div>
        <div class="cell medium-6">
          <p class="session-type">S&eacute;ance ordinaire</p>
          <p class="session-hour">19 h</p>
        </div>
        <div class="cell medium-6 session-location-container">
          <p class="session-location">Salle du conseil</p>
          <p class="session-location">71, rue Principale</p>
        </div>
      </div>
      <div class="cell medium-4 session-link-container flex-container flex-dir-column align-center">
        <ul class="no-bullet">
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/04/V3_2026-04-20_ODJ.pdf" target="_blank"><span class="link-underline">Ordre du jour</span></a>
          </li>
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/05/PV_2026-04-20.pdf" target="_blank"><span class="link-underline">Proc&egrave;s-verbal</span></a>
          </li>
        </ul>
      </div>
    </li>
    <li class="session-container grid-x block-shadow-no-hover">
      <div class="cell medium-8 session-infos-container grid-x">
        <div class="cell small-12"><h4 class="h3">Jeudi 9 avril 2026</h4></div>
        <div class="cell medium-6">
          <p class="session-type">S&eacute;ance extraordinaire</p>
          <p class="session-hour">18 h</p>
        </div>
        <div class="cell medium-6 session-location-container">
          <p class="session-location">H&ocirc;tel de ville</p>
          <p class="session-location">5, boulevard D&rsquo;Youville</p>
        </div>
      </div>
      <div class="cell medium-4 session-link-container flex-container flex-dir-column align-center">
        <ul class="no-bullet">
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/04/ODJ_2026-04-09_extra.pdf" target="_blank"><span class="link-underline">Ordre du jour</span></a>
          </li>
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/05/PV_2026-04-09_extra.pdf" target="_blank"><span class="link-underline">Proc&egrave;s-verbal</span></a>
          </li>
        </ul>
      </div>
    </li>
    <li class="session-container grid-x block-shadow-no-hover">
      <div class="cell medium-8 session-infos-container grid-x">
        <div class="cell small-12"><h4 class="h3">Lundi 16 mars 2026</h4></div>
        <div class="cell medium-6">
          <p class="session-type">S&eacute;ance ordinaire</p>
          <p class="session-hour">19 h</p>
        </div>
        <div class="cell medium-6 session-location-container">
          <p class="session-location">Salle du conseil</p>
          <p class="session-location">71, rue Principale</p>
        </div>
      </div>
      <div class="cell medium-4 session-link-container flex-container flex-dir-column align-center">
        <ul class="no-bullet">
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/V5_2026-03-16_ODJ.pdf" target="_blank"><span class="link-underline">Ordre du jour</span></a>
          </li>
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/04/PV_2026-03-16.pdf" target="_blank"><span class="link-underline">Proc&egrave;s-verbal</span></a>
          </li>
        </ul>
      </div>
    </li>
    <li class="session-container grid-x block-shadow-no-hover">
      <div class="cell medium-8 session-infos-container grid-x">
        <div class="cell small-12"><h4 class="h3">Jeudi 12 mars 2026</h4></div>
        <div class="cell medium-6">
          <p class="session-type">S&eacute;ance extraordinaire</p>
          <p class="session-hour">18 h</p>
        </div>
        <div class="cell medium-6 session-location-container">
          <p class="session-location">H&ocirc;tel de ville</p>
        </div>
      </div>
      <div class="cell medium-4 session-link-container flex-container flex-dir-column align-center">
        <ul class="no-bullet">
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/ODJ_2026-03-12_extra.pdf" target="_blank"><span class="link-underline">Ordre du jour</span></a>
          </li>
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/04/PV_2026-03-12_extra.pdf" target="_blank"><span class="link-underline">Proc&egrave;s-verbal</span></a>
          </li>
        </ul>
      </div>
    </li>
    <li class="session-container grid-x block-shadow-no-hover">
      <div class="cell medium-8 session-infos-container grid-x">
        <div class="cell small-12"><h4 class="h3">Lundi 23 f&eacute;vrier 2026</h4></div>
        <div class="cell medium-6">
          <p class="session-type">S&eacute;ance ordinaire</p>
          <p class="session-hour">19 h</p>
        </div>
        <div class="cell medium-6 session-location-container">
          <p class="session-location">Salle du conseil</p>
          <p class="session-location">71, rue Principale</p>
        </div>
      </div>
      <div class="cell medium-4 session-link-container flex-container flex-dir-column align-center">
        <ul class="no-bullet">
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/02/2026-02-23_ODJ.pdf" target="_blank"><span class="link-underline">Ordre du jour</span></a>
          </li>
          <li>
            <a class="link-chevron" href="https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/PV_2026-02-23.pdf" target="_blank"><span class="link-underline">Proc&egrave;s-verbal</span></a>
          </li>
        </ul>
      </div>
    </li>
  </ul>
</div>
`;

/**
 * Real pdftotext excerpt from Châteauguay PV February 23, 2026.
 * Source: https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/PV_2026-02-23.pdf
 * Captured: 2026-06-10
 *
 * Contains avis de motion for TWO real zonage changes:
 *   - AVIS DE MOTION 2026-02-119: règlement modifiant le règlement de zonage Z-3001
 *     visant à permettre les bâtiments de 4 étages dans la zone C-754,
 *     secteur des boulevards René-Lévesque et Primeau.
 *   - AVIS DE MOTION 2026-02-120: règlement modifiant le règlement de zonage Z-3001
 *     visant à agrandir la zone C-810 à même la zone H-812,
 *     secteur de la rue Notre-Dame Nord.
 *
 * Both changes were adopted as final règlements Z-3001-157-26 and Z-3001-156-26
 * respectively in the April 20, 2026 council session (confirmed in PV_2026-04-20.pdf).
 *
 * DETECTION: Châteauguay uses alphanumeric numbering (Z-3001, G-062-22, etc.)
 * REGLEMENT_ZONAGE_LETTER_RE matches Z-prefix when preceded by "règlement de zonage".
 * "règlement de zonage Z-3001" → reglementNumbers=["Z-3001"], changementZonage=true.
 * Zone codes ("C-754") and non-zonage bylaws ("règlement de construction Z-3300") are
 * not matched (precision guard).
 * Result: avisDeMotion=true, reglementNumbers=["Z-3001"], changementZonage=true.
 */
export const PV_CHATEAUGUAY_2026_02_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Châteauguay,
tenue le lundi 23 février 2026, à 19 h, à la salle du conseil de l'hôtel de ville.

AVIS DE MOTION 2026-02-119

3.7

Modification du règlement de zonage visant à
permettre les bâtiments de 4 étages dans la
zone C-754 dans le secteur des boulevards
René-Lévesque et Primeau

Monsieur le conseiller Luc Daoust donne avis de motion qu'il y aura adoption, lors d'une
prochaine séance du conseil, d'un règlement modifiant le règlement de zonage Z-3001
visant à permettre les bâtiments de 4 étages dans la zone C-754 dans le secteur des
boulevards René-Lévesque et Primeau.
Un projet de règlement est déposé par monsieur le maire Éric Allard.

AVIS DE MOTION 2026-02-120

3.8

Modification du règlement de zonage visant à
agrandir la zone C-810 à même la zone H-812
dans le secteur de la rue Notre-Dame Nord

Monsieur le conseiller François Le Borgne donne avis de motion qu'il y aura adoption,
lors d'une prochaine séance du conseil, d'un règlement modifiant le règlement de
zonage Z-3001 visant à agrandir la zone C-810 à même la zone H-812 dans le secteur
de la rue Notre-Dame Nord.
Un projet de règlement est déposé par monsieur le maire Éric Allard.

AVIS DE MOTION 2026-02-121

3.9

Modification du règlement de construction
visant les clapets anti-retour

Monsieur le conseiller Michel Gendron donne avis de motion qu'il y aura adoption, lors d'une
prochaine séance du conseil, d'un règlement modifiant le règlement de construction Z-3300
afin de permettre l'installation d'un clapet anti-retour sur un collecteur sanitaire pour un
immeuble existant de la classe d'usage « Habitation unifamiliale (H1) ».
`;
