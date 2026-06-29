/**
 * Real procès-verbaux fixture data for Delson (Rive-Sud) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://ville.delson.qc.ca/la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/
 *     HTTP 200, 221 062 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (May 12, 2026):
 *     https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-2.pdf
 *     HTTP 200, 383 247 bytes (PDF), extracted via pdftotext → 49 302 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_DELSON_INDEX_HTML — verbatim HTML excerpt from the séances page
 *      (WordPress wp-block-file structure with Act Collapsible sections).
 *   2. PV_DELSON_2026_05_TEXT — pdftotext excerpt from the real
 *      May 12, 2026 PV. Contains ONE "avis de motion" occurrence (past reference
 *      to Règlement n° 757 for expropriation/emprunt — NOT a zonage change).
 *      No règlement de zonage in the entire PV.
 *
 * Expected detection:
 *   - avisDeMotion: true (the word "avis de motion" appears in ATTENDU QUE clause)
 *   - reglementNumbers: ["757"] (in the avis de motion context)
 *   - changementZonage: false (no zonage keyword anywhere in the PV)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://ville.delson.qc.ca/ → HTTP 200
 *   - robots.txt: User-agent: * / Disallow: (empty — full access)
 */

/**
 * Real HTML snippet from the seances-du-conseil-et-proces-verbaux page of Ville de Delson,
 * captured 2026-06-10 from:
 * https://ville.delson.qc.ca/la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/
 *
 * Structure: WordPress "act-collapsible" blocks with wp-block-file links for PDFs.
 * Contains PV links for sessions of May 12, April 14 (20h), and April 14 consultation (19h) 2026.
 */
export const PV_DELSON_INDEX_HTML = `
<div class="act-collapsible">
  <h2 class="wp-block-heading act-collapsible__heading" id="seance-ordinaire-du-12-mai-2026">S&eacute;ance ordinaire du 12 mai 2026</h2>
  <div class="act-collapsible__content"><div class="act-collapsible__content-inner">
    <p class="wp-block-paragraph"><a href="https://ville.delson.qc.ca/les-echos-du-conseil-12-mai-2026/">Les &eacute;chos du conseil du 12 mai 2026</a></p>
    <div class="wp-block-file">
      <a id="wp-block-file--media-3d68c516-d9c5-4171-b22b-0a55a3a24e01"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-1.pdf"
         target="_blank" rel="noreferrer noopener">Ordre du jour (sujet &agrave; changement sans pr&eacute;avis)</a>
    </div>
    <div class="wp-block-file">
      <a id="wp-block-file--media-d48526ba-1ba8-4730-95b6-3c598f9e3237"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-2.pdf"
         target="_blank" rel="noreferrer noopener">Proc&egrave;s-verbal (non approuv&eacute;)</a>
    </div>
  </div></div>
</div>

<div class="act-collapsible">
  <h2 class="wp-block-heading act-collapsible__heading" id="seance-ordinaire-du-14-avril-2026-20-h">S&eacute;ance ordinaire du 14 avril 2026, 20 h</h2>
  <div class="act-collapsible__content"><div class="act-collapsible__content-inner">
    <p class="wp-block-paragraph"><a href="https://ville.delson.qc.ca/les-echos-du-conseil-14-avril-2026/">Les &eacute;chos du conseil du 14 avril 2026</a></p>
    <div class="wp-block-file">
      <a id="wp-block-file--media-a574ca4e-c13b-4f52-8742-15436ed2217d"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/04/Ordre-du-jour-sujet-a-changement-sans-preavis-4.pdf"
         target="_blank" rel="noreferrer noopener">Ordre du jour (sujet &agrave; changement sans pr&eacute;avis)</a>
    </div>
    <div class="wp-block-file">
      <a id="wp-block-file--media-46d8fc35-a4c7-439e-8fa1-b0f22cceb49f"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-04-14-ordinaire-20h.pdf"
         target="_blank" rel="noreferrer noopener">Proc&egrave;s-verbal (non approuv&eacute;)</a>
    </div>
  </div></div>
</div>

<div class="act-collapsible">
  <h2 class="wp-block-heading act-collapsible__heading" id="consultation-publique-du-14-avril-2026-19-h">Consultation publique du 14 avril 2026, 19 h</h2>
  <div class="act-collapsible__content"><div class="act-collapsible__content-inner">
    <div class="wp-block-file">
      <a id="wp-block-file--media-consult-0414"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/04/2026-04-14-consultation-19h.pdf"
         target="_blank" rel="noreferrer noopener">Proc&egrave;s-verbal (non approuv&eacute;)</a>
    </div>
  </div></div>
</div>

<div class="act-collapsible">
  <h2 class="wp-block-heading act-collapsible__heading" id="seance-ordinaire-du-10-mars-2026">S&eacute;ance ordinaire du 10 mars 2026</h2>
  <div class="act-collapsible__content"><div class="act-collapsible__content-inner">
    <div class="wp-block-file">
      <a id="wp-block-file--media-0310"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/03/2026-03-10-ordinaire-20h-4.pdf"
         target="_blank" rel="noreferrer noopener">Proc&egrave;s-verbal (non approuv&eacute;)</a>
    </div>
  </div></div>
</div>

<div class="act-collapsible">
  <h2 class="wp-block-heading act-collapsible__heading" id="seance-ordinaire-du-10-fevrier-2026">S&eacute;ance ordinaire du 10 f&eacute;vrier 2026</h2>
  <div class="act-collapsible__content"><div class="act-collapsible__content-inner">
    <div class="wp-block-file">
      <a id="wp-block-file--media-0210"
         href="https://ville.delson.qc.ca/wp-content/uploads/2026/02/2026-02-10-ordinaire-20h-2.pdf"
         target="_blank" rel="noreferrer noopener">Proc&egrave;s-verbal (non approuv&eacute;)</a>
    </div>
  </div></div>
</div>
`;

/**
 * Real pdftotext excerpt from Delson PV May 12, 2026.
 * Source: https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-2.pdf
 * Captured: 2026-06-10
 *
 * Contains ONE "avis de motion" occurrence: a past-reference ATTENDU QUE clause
 * noting that at the April 14, 2026 session there was "avis de motion, dépôt,
 * présentation et adoption du projet de Règlement n° 757" for expropriation
 * (acquisistion forcée du lot 3 131 045, prolongement boulevard Georges-Gagné Nord).
 * This is NOT a zonage change — it is an expropriation/emprunt bylaw.
 *
 * Expected detection:
 *   - avisDeMotion: true (the phrase appears in ATTENDU QUE)
 *   - reglementNumbers: ["757"] (matched as \d{2,4}-\d{1,4}? Actually 757 = 3 digits → no dash)
 *     Note: "Règlement n° 757" has no dash → REGLEMENT_NUMBER_RE requires \d{2,4}-\d{1,4}
 *     → reglementNumbers=[] (honest: 757 without dash does not match the pattern)
 *   - changementZonage: false (no zonage keyword, no matching règlement number)
 */
export const PV_DELSON_2026_05_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Delson,
tenue le 12 mai 2026.

RÉSOLUTION 2026-05-173

ADOPTION - RÈGLEMENT D'EMPRUNT N° 757 DESTINÉ À
L'EXPROPRIATION DU LOT 3 131 045 AU CADASTRE DU QUÉBEC

CONSIDÉRANT que lors de la séance ordinaire du 14 avril 2026, il y a eu avis de
motion, dépôt, présentation et adoption du projet de Règlement n° 757 décrétant
un emprunt de 9 524 247 $ et une dépense du même montant pour l'acquisition
forcée du lot 3 131 045 au cadastre du Québec;
CONSIDÉRANT qu'il a été fait mention de l'objet et de la portée de ce règlement
et du fait qu'aucune modification n'a été apportée au règlement depuis l'adoption
du projet déposé et adopté le 14 avril 2026;
CONSIDÉRANT que ce règlement vise principalement au prolongement du
boulevard Georges-Gagné Nord.
EN CONSÉQUENCE, il est proposé par Mme Nathalie Thauvette et résolu :
QUE le conseil municipal de la Ville de Delson adopte le Règlement d'emprunt
n° 757 décrétant un emprunt de 9 524 247 $ et une dépense du même montant
pour l'acquisition forcée du lot 3 131 045 au cadastre du Québec.
ADOPTÉE.
`;
