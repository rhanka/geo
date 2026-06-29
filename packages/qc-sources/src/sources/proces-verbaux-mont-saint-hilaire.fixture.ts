/**
 * Real procès-verbaux fixture data for Mont-Saint-Hilaire (MRC La Vallée-du-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.villemsh.ca/ville/conseil-municipal/seances-du-conseil/
 *     HTTP 200, public / no login.
 *     robots.txt: Disallow /wp-admin/ only — content and wp-content/uploads allowed.
 *   - PV PDF (March 9, 2026):
 *     https://www.villemsh.ca/wp-content/uploads/2026/04/Proces_verbal_2026_03_09.pdf
 *     HTTP 200, extracted via pdftotext → 60 850 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size reasonable.
 *
 * TWO fixtures are provided:
 *   1. PV_MSH_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (WordPress + accordion structure, 2026 and 2025 sections).
 *   2. PV_MSH_2026_03_TEXT — pdftotext excerpt from the March 9, 2026 PV.
 *      Contains NEW avis de motion for TWO real zonage changes:
 *        - Règlement numéro 1235-34 amendant le Règlement de zonage numéro 1235
 *          afin de modifier les limites de quatre zones dans le secteur de la rue des Vétérans
 *        (and a separate avis de motion for Code d'éthique 1376 — not a zonage change)
 *
 * PARSER SUPPORT: MSH uses 4-segment numbering (1235-34).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "1235-34" from "règlement 1235-34".
 *   "règlement de zonage numéro 1235" is the base bylaw — MODIFIANT_REGLEMENT_RE matches "1235"
 *   but "1235" alone (no hyphen) is not a standard REGLEMENT_NUMBER_RE pattern, so it is
 *   NOT in reglementNumbers. Only "1235-34" is extracted.
 *   "règlement de zonage" keyword present → changementZonage=true.
 *   Result: avisDeMotion=true, reglementNumbers=["1235-34"], changementZonage=true.
 *   ZERO false positive: 1235-34 genuinely modifies the zonage bylaw.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.villemsh.ca/ → HTTP 200
 *   - robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed
 *   - All PDFs under wp-content/uploads/ are publicly accessible.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Mont-Saint-Hilaire,
 * captured 2026-06-10 from:
 * https://www.villemsh.ca/ville/conseil-municipal/seances-du-conseil/
 *
 * WordPress + custom accordion structure.
 * Section 2026: 7 individual session PV PDFs (Jan–Jun 2026).
 * Section 2025: 16 session PDFs.
 *
 * Key PV PDF links present in 2026 section:
 *   Proces_verbal-_2026-06-01_site_Int._pas-approuve.pdf (June 1, 2026 — not yet approved)
 *   Proces_verbal_2026-05-04_site_Int.pdf (May 4, 2026)
 *   Proces_verbal_2026_04_13.pdf (April 13, 2026)
 *   Proces_verbal_2026_03_23.pdf (March 23, 2026)
 *   Proces_verbal_2026_03_09.pdf (March 9, 2026) ← contains zonage avis de motion
 *   Proces-verbal_2026-02-02.pdf (February 2, 2026)
 *   Proces_verbal_2026-01-12.pdf (January 12, 2026)
 */
export const PV_MSH_INDEX_HTML = `
<div class="accordion-container">
<div id="proces-verbaux-2026" class="accordion ac">
<div class="accordion__accordion">
<button class="accordion__header-row accordion-toggle ac-header ac-trigger">
<span class="accordion__header__title">Procès-verbaux 2026</span>
<span class="accordion__header__icon" role="presentation">
<span class="plus"></span>
</span>
</button>
<div class="accordion__sub-rows wysiwyg ac-panel">
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/06/Proces_verbal-_2026-06-01_site_Int._pas-approuve.pdf">Procès-verbal de la séance ordinaire du 1er juin 2026 &#8211; Ce procès-verbal n&rsquo;est pas encore approuvé</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/06/Proces_verbal_2026-05-04_site_Int.pdf">Procès-verbal de la séance ordinaire du 4 mai 2026</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/05/Proces_verbal_2026_04_13.pdf">Procès-verbal de la séance ordinaire du 13 avril 2026</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/04/Proces_verbal_2026_03_23.pdf">Procès-verbal de la séance extraordinaire du 23 mars 2026</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/04/Proces_verbal_2026_03_09.pdf">Procès-verbal de la séance ordinaire du 9 mars 2026</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/03/Proces-verbal_2026-02-02.pdf">Procès-verbal de la séance ordinaire du 2 février 2026</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/02/Proces_verbal_2026-01-12.pdf">Procès-verbal de la séance ordinaire du 12 janvier 2026</a></p>
</div>
</div>
</div>
<div id="proces-verbaux-2025" class="accordion ac">
<div class="accordion__accordion">
<button class="accordion__header-row accordion-toggle ac-header ac-trigger">
<span class="accordion__header__title">Procès-verbaux 2025</span>
<span class="accordion__header__icon" role="presentation">
<span class="plus"></span>
</span>
</button>
<div class="accordion__sub-rows wysiwyg ac-panel">
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/01/Proces_verbal_2025-12-23_approuve.pdf">Procès-verbal de la séance extraordinaire du 23 décembre 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2026/01/Proces_verbal_2025-12-17_approuve.pdf">Procès-verbal de la séance extraordinaire du 17 décembre 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/12/Seances_Proces-verbal-2025-11-10.pdf">Procès-verbal de la séance ordinaire du 10 novembre 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/11/Proces-verbal_2025-10-01.pdf">Procès-verbal de la séance ordinaire du 1er octobre 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces_verbal_2025-06-02.pdf">Procès-verbal de la séance ordinaire du 2 juin 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces-verbal_2025-05-05.pdf">Procès-verbal de la séance ordinaire du 5 mai 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces-verbal_2025-04-07.pdf">Procès-verbal de la séance ordinaire du 7 avril 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces-verbal_2025-03-03.pdf">Procès-verbal de la séance ordinaire du 3 mars 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces-verbal_2025-02-03.pdf">Procès-verbal de la séance ordinaire du 3 février 2025</a></p>
<p><a href="https://www.villemsh.ca/wp-content/uploads/2025/07/Seance-du-conseil_Proces-verbal_2025-01-13.pdf">Procès-verbal de la séance ordinaire du 13 janvier 2025</a></p>
</div>
</div>
</div>
</div>
`;

/**
 * Real pdftotext excerpt from Mont-Saint-Hilaire PV March 9, 2026.
 * Source: https://www.villemsh.ca/wp-content/uploads/2026/04/Proces_verbal_2026_03_09.pdf
 * Captured: 2026-06-10
 *
 * Contains NEW avis de motion (not adoption) for:
 *   - RÈGLEMENT NUMÉRO 1235-34 AMENDANT LE RÈGLEMENT DE ZONAGE NUMÉRO 1235
 *     afin de modifier les limites de quatre zones dans le secteur de la rue des Vétérans.
 *     "Madame Mélodie Georget, conseillère municipale, donne un avis de motion à l'effet
 *     qu'à une prochaine séance, elle présentera ou fera présenter un règlement amendant
 *     le Règlement de zonage numéro 1235 afin de modifier les limites de quatre zones
 *     dans le secteur de la rue des Vétérans."
 *   - Code d'éthique 1376 (NOT a zonage change)
 *
 * DETECTION:
 *   - "donne un avis de motion" present → avisDeMotion=true.
 *   - "règlement de zonage numéro 1235" in backward window → changementZonage=true.
 *   - REGLEMENT_NUMBER_RE extracts "1235-34" from "règlement 1235-34".
 *   - "1235" (base bylaw) not matched by REGLEMENT_NUMBER_RE (no hyphen).
 *   Result: avisDeMotion=true, reglementNumbers=["1235-34"], changementZonage=true.
 *   ZERO false positive: 1235-34 genuinely modifies the Règlement de zonage 1235.
 */
export const PV_MSH_2026_03_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Mont-Saint-Hilaire,
tenue le lundi 9 mars 2026, à 19 h.

2026-091

AVIS DE MOTION - PREMIER PROJET DE RÈGLEMENT NUMÉRO 1235-34 - RÈGLEMENT AMENDANT
LE RÈGLEMENT DE ZONAGE NUMÉRO 1235 AFIN DE MODIFIER LES LIMITES
DE QUATRE ZONES DANS LE SECTEUR DE LA RUE DES VÉTÉRANS
Madame Mélodie Georget, conseillère municipale, donne un avis de motion à l'effet
qu'à une prochaine séance, elle présentera ou fera présenter un règlement amendant
le Règlement de zonage numéro 1235 afin de modifier les limites de quatre zones
dans le secteur de la rue des Vétérans.

2026-092

PREMIER PROJET DE RÈGLEMENT NUMÉRO 1235-34 - RÈGLEMENT AMENDANT
LE RÈGLEMENT DE ZONAGE NUMÉRO 1235 AFIN DE MODIFIER LES LIMITES
DE QUATRE ZONES DANS LE SECTEUR DE LA RUE DES VÉTÉRANS - ADOPTION
IL EST PROPOSÉ PAR : Madame Mélodie Georget
APPUYÉ PAR : Madame Isabelle Thibeault
et adoptée à l'unanimité des conseillers :

2026-093

AVIS DE MOTION - RÈGLEMENT NUMÉRO 1376 - CODE D'ÉTHIQUE ET DE DÉONTOLOGIE
APPLICABLE À TOUT MEMBRE DU CONSEIL DE LA VILLE DE MONT-SAINT-HILAIRE - QUATRIÈME RÉVISION
Monsieur Louis Toner, conseiller municipal, donne un avis de motion à l'effet
qu'à une prochaine séance, il présentera ou fera présenter un règlement concernant
le Code d'éthique et de déontologie applicable à tout membre du conseil de la Ville
de Mont-Saint-Hilaire - Quatrième révision.
La Loi prévoit également que le projet de règlement doit être présenté lors d'une séance
par le membre du conseil qui donne l'avis de motion.
`;
