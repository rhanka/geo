/**
 * Real procès-verbaux fixture data for Les Coteaux (MRC Vaudreuil-Soulanges) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://les-coteaux.qc.ca/citoyens/greffe/seance-du-conseil/
 *     HTTP 200, public / no login. WordPress CMS (Yoast SEO sitemap).
 *     robots.txt: Disallow: (empty — no restrictions).
 *   - PV PDF (April 20, 2026):
 *     https://les-coteaux.qc.ca/wp-content/uploads/2026/05/pv_so_20260420.pdf
 *     HTTP 200, 1 277 917 bytes (PDF), extracted via pdftotext → 47 747 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LES_COTEAUX_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (WordPress links under /wp-content/uploads/2026/).
 *   2. PV_LES_COTEAUX_2026_04_TEXT — pdftotext excerpt from the real April 20, 2026 PV.
 *      Contains adoption of second projet of Règlement numéro 317-01 modifiant le
 *      Règlement de zonage numéro 317, plus avis de motion for Règlement 167-2022-01
 *      (control des chiens — NOT zonage).
 *
 * Expected detection (honest — anti-invention):
 *   - avisDeMotion: true ("avis de motion du présent règlement a été dûment donné"
 *     for Règlement 317-01 + "donnent avis de motion" for 167-2022-01)
 *   - changementZonage: true (Règlement de zonage numéro 317 explicitly cited in
 *     CONSIDÉRANT QUE clause of 317-01 adoption, which references the prior
 *     "avis de motion du présent règlement a été dûment donné lors de la séance
 *     ordinaire du conseil tenue le 16 mars 2026")
 *   - reglementNumbers: ["317-01"] (the modification règlement number)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://les-coteaux.qc.ca/ → HTTP 200
 *   - robots.txt: Disallow: (empty — no restrictions)
 */

/**
 * Real HTML excerpt from the PV index page of Municipalité des Coteaux,
 * captured 2026-06-10 from:
 * https://les-coteaux.qc.ca/citoyens/greffe/seance-du-conseil/
 *
 * Structure: WordPress CMS links under /wp-content/uploads/2026/
 * 6 PV links for 2026 (January through May 14, 2026 extraordinary).
 */
export const PV_LES_COTEAUX_INDEX_HTML = `
<ul>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/05/pv_se_20260514.pdf">2026/05/14 - Séance extraordinaire</a></li>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/05/pv_so_20260420.pdf">2026/04/20 - Séance ordinaire</a></li>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/04/pv_se_20260323.pdf">2026/03/23 - Séance extraordinaire</a></li>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/04/pv_so_20260316.pdf">2026/03/16 - Séance ordinaire</a></li>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/04/pv_so_20260216.pdf">2026/02/16 - Séance ordinaire</a></li>
  <li><a href="https://les-coteaux.qc.ca/wp-content/uploads/2026/02/pv_so_20260119.pdf">2026/01/19 - Séance ordinaire</a></li>
</ul>
`;

/**
 * Real pdftotext excerpt from Les Coteaux PV April 20, 2026.
 * Source: https://les-coteaux.qc.ca/wp-content/uploads/2026/05/pv_so_20260420.pdf
 * Captured: 2026-06-10
 *
 * Contains:
 *   - Adoption du second projet de Règlement numéro 317-01 modifiant le Règlement
 *     de zonage numéro 317 (correctifs suite à remplacement du règlement de zonage).
 *     Context: "CONSIDÉRANT QUE l'avis de motion du présent règlement a été dûment
 *     donné lors de la séance ordinaire du conseil tenue le 16 mars 2026".
 *   - "AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO 167-2022-01"
 *     for control des chiens — NOT zonage.
 *
 * Expected detection:
 *   - avisDeMotion: true (avis de motion for 317-01 + 167-2022-01)
 *   - changementZonage: true (Règlement de zonage numéro 317 cited in adoption context
 *     that references the prior avis de motion)
 *   - reglementNumbers: ["317-01"] (number associated with zonage modification)
 */
export const PV_LES_COTEAUX_2026_04_TEXT = `
PROCÈS-VERBAL DU CONSEIL DE
LA MUNICIPALITÉ DES COTEAUX

Procès-verbal de la séance ordinaire du Conseil municipal, tenue le 20 avril 2026 au
65, route 338, aux Coteaux, le tout conformément aux dispositions du Code municipal de la
province de Québec.
Sont présents : mesdames Angélique L'Écuyer et Sylvie Joly, conseillères, messieurs
Claude Lepage, Michel Joly, Carl Dussault et Gaétan St-Yves, conseillers et siégeant sous la
présidence de monsieur Sylvain Brazeau, maire.

26-04-9311

ADOPTION DU SECOND PROJET DE RÈGLEMENT NUMÉRO 317-01 MODIFIANT LE
RÈGLEMENT DE ZONAGE NUMÉRO 317 AFIN D'APPORTER DES CORRECTIFS SUITE
À SON REMPLACEMENT
CONSIDÉRANT QUE le territoire de la Municipalité des Coteaux est régi par le Règlement de
zonage numéro 317 en vigueur depuis le 12 novembre 2025;
CONSIDÉRANT QUE la Municipalité des Coteaux est régie par le Code municipal et
assujettie aux dispositions de la Loi sur l'aménagement et l'urbanisme et que le Règlement de
zonage numéro 317 ne peut être modifié que conformément aux dispositions de cette loi;
CONSIDÉRANT QUE la Municipalité souhaite apporter certains correctifs à son règlement de
zonage suite à la mise en application de son règlement de remplacement;
CONSIDÉRANT QUE l'avis de motion du présent règlement a été dûment donné lors de la
séance ordinaire du conseil tenue le 16 mars 2026 ;
CONSIDÉRANT QUE le premier projet de règlement a été adopté lors de la séance
extraordinaire du 23 mars 2026 ;
CONSIDÉRANT QU'une assemblée de consultation publique sur le projet de règlement a été
tenue le 13 avril 2026 ;
CONSIDÉRANT QUE la MRC de Vaudreuil-Soulanges a transmis son rapport d'analyse du
projet de règlement;

D'ADOPTER le second projet de Règlement numéro 317-01 modifiant le Règlement de
zonage numéro 317 afin d'apporter des correctifs suite à son remplacement.
ADOPTÉE

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO 167-2022-01
MODIFIANT LE RÈGLEMENT NUMÉRO 167-2022 CONCERNANT LE CONTRÔLE DES
CHIENS, DES CHATS ET AUTRES ANIMAUX AFIN DE RETIRER LES DISPOSITIONS
VISANT DES RACES SPÉCIFIQUES DE CHIEN, D'ASSURER LA CONCORDANCE AU
RÈGLEMENT P 38.002, R. 1 ET APPORTER DIVERSES MODIFICATIONS
Les membres du conseil municipal, par la présente :

donnent avis de motion, qu'il sera adopté, à une séance subséquente, le
Règlement numéro 167-2022-01 modifiant le règlement numéro 167-2022 concernant
le contrôle des chiens, des chats et autres animaux afin de retirer les dispositions visant
des races spécifiques de chien, d'assurer la concordance au règlement P-38.002, R. 1
et apporter diverses modifications.

déposent le projet de règlement numéro 167-2022-01 modifiant le règlement
numéro 167-2022 concernant le contrôle des chiens, des chats et autres animaux afin
de retirer les dispositions visant des races spécifiques de chien, d'assurer la
concordance au règlement P-38.002, R. 1 et apporter diverses modifications.
`;
