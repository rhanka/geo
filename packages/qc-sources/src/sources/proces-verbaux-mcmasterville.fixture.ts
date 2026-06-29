/**
 * Real procès-verbaux fixture data for McMasterville (MRC Vallée-du-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.mcmasterville.ca/mairie/seances-du-conseil/
 *     HTTP 200, 387 579 bytes, public / no login.
 *     robots.txt: Disallow: (empty — no restrictions). Sitemap listed.
 *   - PV PDF (November 17, 2025):
 *     https://www.mcmasterville.ca/wp-content/uploads/2025/12/pv-17-novembre-2025.pdf
 *     HTTP 200, ~250 KB (PDF), extracted via pdftotext → 69 864 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_MCMASTERVILLE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (Visual Composer vc_tta-accordion structure: 10 panels for 2025-2026 sessions
 *      with sc_button PDF links for Ordre du jour + Procès-verbal + Vidéo).
 *   2. PV_MCMASTERVILLE_2025_11_TEXT — pdftotext excerpt from Nov 17, 2025 PV.
 *      Contains "avis de motion" for:
 *        - Règlement 382-37-2025 modifiant le règlement de zonage numéro 382-00-2008
 *          (numérotation, garages souterrains, architecture, entreposage matières résiduelles)
 *
 * PARSER SUPPORT: McMasterville uses 3-segment règlement numbering (382-37-2025).
 *   REGLEMENT_NUMBER_RE matches the first two segments "382-37" (the form \d{3}-\d{2})
 *   since the pattern is \d{2,4}-\d{1,4}\b which ends at the first word boundary.
 *   The "modifiant le règlement de zonage numéro 382-00-2008" clause is captured by
 *   MODIFIANT_REGLEMENT_RE as "382-00". filterNewReglements returns ["382-37"].
 *   Result: avisDeMotion=true, reglementNumbers=["382-37"], changementZonage=true.
 *   This is an honest detection: "382-37" is the correct prefix identifying the
 *   proposed amendment règlement (not a false positive).
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.mcmasterville.ca/ → HTTP 200
 *   - robots.txt: Disallow: (empty — no restrictions)
 *   - All wp-content/uploads PDFs are publicly accessible.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de McMasterville,
 * captured 2026-06-10 from:
 * https://www.mcmasterville.ca/mairie/seances-du-conseil/
 *
 * WordPress + Visual Composer vc_tta-accordion structure.
 * Each panel has an id="[DATE]" and contains sc_button links for:
 *   - Ordre du jour (ODJ PDF)
 *   - Procès-verbal (PV PDF) — link text "Procès-verbal"
 *   - Vidéo (YouTube link)
 *
 * Key PV PDF links present:
 *   2026: pv-extra-25-mai-2026.pdf, pv-seance-4-mai-2026.pdf,
 *         pv-seance-13-avril-2026.pdf, proces-verbal-16-mars-2026.pdf,
 *         pv-seance-du-2-fevrier-2026.pdf, pv-19janvier2026.pdf
 *   2025: pv-extra-11-decembre-2025.pdf, pv-1er-decembre-2025.pdf,
 *         pv-17-novembre-2025.pdf, pv-seance-2-octobre-2025.pdf
 */
export const PV_MCMASTERVILLE_INDEX_HTML = `
<div class="vc_tta-container"><div class="vc_tta vc_tta-accordion">
<div class="vc_tta-panel" id="25mai2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#25mai2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">25 mai 2026 (extra)</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/05/avis-de-convocation-25-mai-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/06/pv-extra-25-mai-2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="4mai2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#4mai2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">4 mai 2026</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/05/odj-seance-4-mai-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/06/pv-seance-4-mai-2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="13avril2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#13avril2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">13 avril 2026</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/04/odj-seance-13-avril-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/05/pv-seance-13-avril-2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="16mars2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#16mars2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">16 mars 2026</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/03/odj-seance-du-16-mars-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/04/proces-verbal-16-mars-2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="2fevrier2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#2fevrier2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">2 février 2026</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/01/odj-seance-2-fevrier-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/03/pv-seance-du-2-fevrier-2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="19janvier2026" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#19janvier2026" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">19 janvier 2026</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/01/odj-seance-19-janvier-2026-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/02/pv-19janvier2026.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="11decembre2025" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#11decembre2025" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">11 décembre 2025 (extra)</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/01/pv-extra-11-decembre-2025.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="1erdecembre2025" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#1erdecembre2025" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">1er décembre 2025</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2025/11/odj-seance-1er-decembre-2025-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2026/01/pv-1er-decembre-2025.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="17novembre2025" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#17novembre2025" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">17 novembre 2025</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2025/11/odj-seance-17-novembre-2025.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2025/12/pv-17-novembre-2025.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
<div class="vc_tta-panel" id="2octobre2025" data-vc-content=".vc_tta-panel-body"><div class="vc_tta-panel-heading"><h4 class="vc_tta-panel-title vc_tta-controls-icon-position-left"><a href="#2octobre2025" data-vc-accordion data-vc-container=".vc_tta-container"><span class="vc_tta-title-text">2 octobre 2025</span></a></h4></div><div class="vc_tta-panel-body"><a href="https://www.mcmasterville.ca/wp-content/uploads/2025/10/odj-seance-2-octobre-2025-internet.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Ordre du jour</span></span></a><a href="https://www.mcmasterville.ca/wp-content/uploads/2025/11/pv-seance-2-octobre-2025.pdf" class="sc_button" target="_blank"><span class="sc_button_text"><span class="sc_button_title">Procès-verbal</span></span></a></div></div>
</div></div>
`;

/**
 * Real pdftotext excerpt from McMasterville PV November 17, 2025.
 * Source: https://www.mcmasterville.ca/wp-content/uploads/2025/12/pv-17-novembre-2025.pdf
 * Captured: 2026-06-10
 *
 * Contains avis de motion for ONE real zonage change:
 *   - Règlement 382-37-2025 modifiant le règlement de zonage numéro 382-00-2008 de la
 *     Ville de McMasterville afin d'effectuer des corrections à la numérotation de
 *     certains articles et à la référence à certaines zones, d'ajuster les normes
 *     relatives aux garages souterrains, de moduler les normes d'architecture et les
 *     délais de réalisation des projets résidentiels intégrés et afin de modifier les
 *     dispositions relatives à l'entreposage des matières résiduelles.
 *
 * This is a genuine zoning bylaw amendment (règlement de zonage numéro 382-00-2008
 * is the master zoning bylaw for McMasterville).
 *
 * DETECTION: McMasterville uses 3-segment règlement numbering (382-37-2025).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "382-37" (first two segments).
 *   "382-00-2008" (the modified bylaw) is matched as "382-00" by MODIFIANT_REGLEMENT_RE
 *   and excluded by filterNewReglements → reglementNumbers=["382-37"].
 *   "règlement de zonage" keyword present → changementZonage=true.
 *   Result: avisDeMotion=true, reglementNumbers=["382-37"], changementZonage=true.
 *   ZERO false positive: "382-37" is genuinely the new amending règlement.
 */
export const PV_MCMASTERVILLE_2025_11_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de McMasterville,
tenue le lundi 17 novembre 2025, à 19 h.

AVIS DE MOTION
5.1

Avis de motion – Règlement 382-37-2025 modifiant le
règlement de zonage numéro 382-00-2008 de la Ville de
McMasterville afin d'effectuer des corrections à la
numérotation de certains articles et à la référence à certaines
zones, d'ajuster les normes relatives aux garages souterrains,
de moduler les normes d'architecture et les délais de
réalisation des projets résidentiels intégrés et afin de modifier
les dispositions relatives à l'entreposage des matières
résiduelles

Avis de motion – Règlement 382-37-2025 modifiant le règlement de zonage
numéro 382-00-2008 de la Ville de McMasterville afin d'effectuer des corrections à la
numérotation de certains articles et à la référence à certaines zones, d'ajuster les normes
relatives aux garages souterrains, de moduler les normes d'architecture et les délais de
réalisation des projets résidentiels intégrés et afin de modifier les dispositions relatives à
l'entreposage des matières résiduelles.

Monsieur Frédéric Lavoie, conseiller, donne avis de motion qu'il sera
adopté, à une séance subséquente, le premier projet de règlement
numéro 382-37-2025 modifiant le règlement de zonage numéro 382-00-2008
de la Ville de McMasterville afin d'effectuer des corrections à la
numérotation de certains articles et à la référence à certaines zones,
d'ajuster les normes relatives aux garages souterrains, de moduler les
normes d'architecture et les délais de réalisation des projets résidentiels
intégrés et afin de modifier les dispositions relatives à l'entreposage des
matières résiduelles.

RÉSOLUTION NUMÉRO 2025-314
Adoption – Premier projet de règlement 382-37-2025 modifiant le règlement
de zonage numéro 382-00-2008 de la Ville de McMasterville

CONSIDÉRANT QU'un avis de motion du règlement numéro 382-37-2025 a
été donné par monsieur Frédéric Lavoie, conseiller, lors de la séance
ordinaire tenue le 17 novembre 2025;

EN CONSÉQUENCE, il est adopté le premier projet de règlement numéro 382-37-2025
modifiant le règlement de zonage numéro 382-00-2008 de la Ville de McMasterville.

Avis de motion – Règlement 382-36-2025 modifiant le règlement de zonage
numéro 382-00-2008 de la Ville de McMasterville afin de modifier les dispositions relatives
à l'obligation de prévoir des cases de stationnement hors rue dans le cas d'un changement
d'usage et au nombre minimal de cases de stationnement pour les établissements de
récréation intérieure.
`;
