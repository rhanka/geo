/**
 * Real procès-verbaux fixture data for Vaudreuil-Dorion (Vaudreuil-Soulanges) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.vaudreuil-dorion.qc.ca/fr/la-ville/conseil-municipal/seances-publiques
 *     HTTP 200, 783 063 bytes, public / no login.
 *     robots.txt: Disallow: /assets/admin/, /assets/scripts/, /assets/styles/,
 *                            /fr/recherche?query=*, /en/search?query=* (content pages allowed).
 *   - PV PDF (May 19, 2026):
 *     https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260519_pv.pdf
 *     HTTP 200, 107 386 bytes (PDF), extracted via pdftotext → 25 679 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_VAUDREUIL_DORION_INDEX_HTML — verbatim HTML list from the seances-publiques
 *      page showing 2026 PV PDF links (<li><a href="...">...</a></li> structure).
 *   2. PV_VAUDREUIL_DORION_2026_05_TEXT — pdftotext excerpt from the real
 *      May 19, 2026 PV. Contains "avis de motion" for:
 *        - Règlement no 1709-38 modifiant tarification (NOT zonage)
 *        - Règlement no 1835-01 démolition/comité (NOT zonage)
 *      Règlement de zonage is mentioned once (in a derogation context,
 *      NOT in avis de motion ±400 chars window).
 *
 * Expected detection (after paragraph-boundary fix in detectZonageChange):
 *   - avisDeMotion: true (motions present with règlement numbers 1709-38, 1835-01)
 *   - changementZonage: false (the "Règlement de zonage" mention is in item 26-05-0429,
 *     separated from the last motion by \n\n — forward window capped at paragraph break)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.vaudreuil-dorion.qc.ca/ → HTTP 200
 *   - robots.txt: no restrictions on content pages (/fr/la-ville/...)
 */

/**
 * Real HTML snippet from the seances-publiques page of Ville de Vaudreuil-Dorion,
 * captured 2026-06-10 from:
 * https://www.ville.vaudreuil-dorion.qc.ca/fr/la-ville/conseil-municipal/seances-publiques
 *
 * Structure: <ul> with <li><a href="...PV_2026/...pdf"> links.
 * 14 PV links for 2026 (January through June 1, 2026).
 */
export const PV_VAUDREUIL_DORION_INDEX_HTML = `
<div class="tab-content">
  <ul>
    <li><a title="1er juin 2026 - S&eacute;ance ordinaire" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260601_pv_sa.pdf" target="_blank" rel="noopener">1er juin 2026 - S&eacute;ance ordinaire</a></li>
    <li><a title="20260601_cons_sa.pdf (9 KB)" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260601_cons_sa.pdf" target="_blank" rel="noopener">1er juin 2026 - Assembl&eacute;e publique de consultation</a></li>
    <li><a title="19 mai 2026 - S&eacute;ance ordinaire" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260519_pv.pdf" target="_blank" rel="noopener">19 mai 2026 - S&eacute;ance ordinaire</a></li>
    <li><a title="20260511_extra_pv_sa.pdf (12 KB)" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260511_extra_pv_sa.pdf" target="_blank" rel="noopener">11 mai 2026 - S&eacute;ance extraordinaire</a></li>
    <li><a title="4 mai 2026 - S&eacute;ance ordinaire" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260504_pv.pdf" target="_blank" rel="noopener">4 mai 2026 - S&eacute;ance ordinaire</a></li>
    <li><a title="20 avril 2026 - S&eacute;ance ordinaire" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260420_pv.pdf" target="_blank" rel="noopener">20 avril 2026 - S&eacute;ance ordinaire</a></li>
    <li><a title="7 avril 2026 - S&eacute;ance ordinaire" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260407_pv.pdf" target="_blank" rel="noopener">7 avril 2026 - S&eacute;ance ordinaire</a></li>
    <li><a title="20260316_pv.pdf (162 KB)" href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260316_pv.pdf" target="_blank" rel="noopener">16 mars 2026 - S&eacute;ance ordinaire</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260316_cons.pdf" target="_blank" rel="noopener">16 mars 2026 - Assembl&eacute;e publique de consultation</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260302_pv.pdf" target="_blank" rel="noopener">2 mars 2026 - S&eacute;ance ordinaire</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260216_pv.pdf" target="_blank" rel="noopener">16 f&eacute;vrier 2026 - S&eacute;ance ordinaire</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260202_pv.pdf" target="_blank" rel="noopener">2 f&eacute;vrier 2026 - S&eacute;ance ordinaire</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260119_pv.pdf" target="_blank" rel="noopener">19 janvier 2026 - S&eacute;ance ordinaire</a></li>
    <li><a href="https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260112_extra_pv.pdf" target="_blank" rel="noopener">12 janvier 2026 - S&eacute;ance extraordinaire </a></li>
  </ul>
</div>
`;

/**
 * Real pdftotext excerpt from Vaudreuil-Dorion PV May 19, 2026.
 * Source: https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260519_pv.pdf
 * Captured: 2026-06-10
 *
 * Contains:
 *   - "donne avis de motion" for Règlement no 1709-38 (tarification) — NOT zonage
 *   - "donne avis de motion" for Règlement no 1835-01 (démolition) — NOT zonage
 *   - "Règlement de zonage (règlement no 1872)" appears only in a derogation context
 *     (enseignes publicitaires), not in avis de motion context.
 *
 * Expected detection (after paragraph-boundary fix):
 *   - avisDeMotion: true
 *   - reglementNumbers: ["1709-38", "1835-01"] (both in avis de motion context)
 *   - changementZonage: false (the "Règlement de zonage no 1872" mention is in the
 *     NEXT agenda item 26-05-0429, separated from the last motion by \n\n; the
 *     corrected forward window is capped at that paragraph break)
 */
export const PV_VAUDREUIL_DORION_2026_05_TEXT = `
SÉANCE ORDINAIRE DU 19 MAI 2026

Procès-verbal de la séance ordinaire tenue par le conseil de la Ville de Vaudreuil-Dorion
le 19 mai 2026 à 19 h, au lieu ordinaire, conformément à la Loi sur les cités et villes.
Présences :
Les conseillères Jasmine Sharma, Sarah Champagne, Nancy Dallaire et Vanessa Leduc
ainsi que les conseillers Luc Marsan, François Séguin, Alexandre Ménard-Levasseur et
John McRae sous la présidence du maire Paul Dumoulin, formant quorum.

26-05-0424 Mise à jour / Règlement no 1744 / Gestion des eaux pluviales
Il est proposé par la conseillère Nancy Dallaire et résolu à l'unanimité que soit adoptée
la mise à jour du règlement relatif à la gestion des eaux pluviales no 1744 afin
d'apporter des précisions aux exigences requises et d'assujettir les immeubles
institutionnels à celles-ci ainsi que de remplacer le plan identifiant la zone du bassin
versant de la rivière Quinchien à l'annexe A.
« ADOPTÉE »

26-05-0426 Avis de motion et dépôt de projet / Règlement no 1709-38 / Tarification /
Ajouts et mise à jour de divers tarifs
La conseillère Vanessa Leduc dépose le projet de règlement no 1709-38 modifiant le
Règlement imposant un mode de tarification pour le financement de certains biens,
services ou activités afin d'ajouter et de mettre à jour divers tarifs et donne avis de motion
qu'à une séance ultérieure de ce conseil, le règlement sera présenté pour adoption.

26-05-0427 Adoption de projet / Règlement no 1835-01 / Démolition / Attribution des
fonctions du comité de démolition au conseil municipal
Il est
PROPOSÉ PAR la conseillère Nancy Dallaire
APPUYÉ PAR le conseiller John McRae
ET RÉSOLU à l'unanimité des conseillers présents
QUE soit adopté le projet de règlement no 1835-01 intitulé :
« Règlement modifiant le Règlement régissant la démolition d'immeubles no 1835 afin
d'attribuer les fonctions du comité de démolition au conseil municipal »
QUE soit délégué à la greffière le pouvoir de fixer la date, l'endroit et l'heure de la
consultation requise ;
QU'une copie de ce projet soit transmise à la MRC de Vaudreuil-Soulanges.
« ADOPTÉE »

26-05-0428 Avis de motion / Règlement no 1835-01 / Démolition / Attribution des
fonctions du comité de démolition au conseil municipal
La conseillère Nancy Dallaire donne avis de motion qu'à une séance ultérieure de ce
conseil, il sera présenté, pour adoption, un règlement modifiant le Règlement régissant la
démolition d'immeubles no 1835 afin d'attribuer les fonctions du comité de démolition au
conseil municipal.

26-05-0429 Autorisation de signature — dérogation à l'article 10.13 du Règlement de zonage
(règlement no 1872) — enseigne publicitaire
Le conseil autorise une dérogation à l'article 10.13 du Règlement de zonage (règlement no 1872)
qui prévoit l'alignement vertical des enseignes, sous réserve de conditions applicables.
« ADOPTÉE »
`;
