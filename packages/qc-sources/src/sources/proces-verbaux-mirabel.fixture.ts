/**
 * Real procès-verbaux fixture data for Mirabel (Laurentides) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://mirabel.ca/seances-conseil
 *     HTTP 200, 328 935 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (April 13, 2026):
 *     https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Proces-verbal_FINAL.pdf
 *     HTTP 200 (PDF), extracted via pdftotext.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_MIRABEL_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (table structure with direct PDF links per session date).
 *   2. PV_MIRABEL_2026_04_TEXT — pdftotext excerpt from the April 13, 2026 PV.
 *      Contains:
 *        - Resolution 224-04-2026: Adoption du projet de règlement numéro U-2701
 *          modifiant le règlement de zonage numéro U-2300 (premier projet)
 *        - Resolution 225-04-2026: Avis de motion pour règlement modifiant le
 *          règlement de zonage numéro U-2300 (zones H 7-81, H 7-88, H 12-47, H 12-59)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://mirabel.ca/ → HTTP 200
 *   - https://mirabel.ca/robots.txt → User-Agent: * / Disallow: (empty — no restrictions)
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true (Resolution 225-04-2026: "Avis de motion est donné par monsieur
 *     le conseiller Robert Charron qu'à une prochaine séance de ce conseil, il sera présenté
 *     un règlement modifiant le règlement de zonage numéro U-2300")
 *   - changementZonage: true (ZONAGE_KEYWORDS_RE: "règlement de zonage numéro U-2300"
 *     present within ±400 chars of "Avis de motion est donné")
 *   - reglementNumbers: [] — Mirabel uses letter+digit numbering (U-2300, U-2701) but
 *     REGLEMENT_NUMBER_RE only matches when "règlement" precedes a \d{2,4}-\d{1,4} pattern.
 *     "U-2300" doesn't match because it has a letter prefix; REGLEMENT_VPREFIX_RE would
 *     need format [A-Z]\d{2,4}-\d{4}-\d{1,3} (e.g. V654-2026-33) which U-2300 doesn't fit.
 *     Honest result: no reglementNumbers extracted.
 *   - ANTI-FAUX-POSITIF: résolution 223-04-2026 "Avis de motion" for U-2700
 *     (règlement sur les permis et certificats) does NOT reference "zonage" →
 *     changementZonage stays false for that motion context.
 */

/**
 * Real HTML snippet from the PV index page of Ville de Mirabel,
 * captured 2026-06-10 from https://mirabel.ca/seances-conseil
 *
 * The page uses a custom table layout with paired "Ordre du jour" + "Procès-verbal" links per row.
 * Applicable liens PV PDF 2026 (confirmed HTTP 200):
 *   - 2026-05-25_Proces-verbal_FINAL.pdf (25 mai 2026)
 *   - 2026-05-11_Proces-verbal_FINAL.pdf (11 mai 2026)
 *   - 2026-04-27_Proces-verbal_FINAL.pdf (27 avril 2026)
 *   - 2026-04-13_Proces-verbal_FINAL.pdf (13 avril 2026)
 *   - 2026-03-23_Proces-verbal_FINAL.pdf (23 mars 2026)
 *   - 2026-03-09_Proces-verbal_FINAL.pdf (9 mars 2026)
 *   - 2026-02-23_Proces-verbal_FINAL.pdf (23 février 2026)
 *   - 2026-02-09_-_Proces-verbal_FINAL.pdf (9 février 2026)
 *   - 2026-01-26_Proces-verbal_FINAL.pdf (26 janvier 2026)
 *   - 2026-01-12_Proces-verbal_FINAL.pdf (12 janvier 2026)
 */
export const PV_MIRABEL_INDEX_HTML = `
<table style="width: 100%;">
<tbody>
<tr>
<td style="width: 33.3333%;"><a title="2026-05-25_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-05-25_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-05-25_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-05-25_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-05-11_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-05-11_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-05-11_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-05-11_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-04-27_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-27_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-04-27_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-27_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
</tr>
<tr>
<td style="width: 33.3333%;"><a title="2026-04-13_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-04-13_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-03-23_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-03-23_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-03-23_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-03-23_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-03-09_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-03-09_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-03-09_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-03-09_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
</tr>
<tr>
<td style="width: 33.3333%;"><a title="2026-02-23_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-02-23_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-02-23_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-02-23_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-02-09_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-02-09_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-02-09_-_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-02-09_-_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2026-01-26_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-01-26_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-01-26_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-01-26_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
</tr>
<tr>
<td style="width: 33.3333%;"><a title="2026-01-12_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-01-12_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2026-01-12_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-01-12_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;">Procès-verbal</td>
<td style="width: 33.3333%;"><a title="2025-12-08_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-12-08_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2025-12-08_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-12-08_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
</tr>
<tr>
<td style="width: 33.3333%;"><a title="2025-11-24_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-11-24_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2025-11-24_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-11-24_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2025-11-10_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-11-10_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2025-11-10_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-11-10_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
<td style="width: 33.3333%;"><a title="2025-10-27_Ordre_du_jour.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-10-27_Ordre_du_jour.pdf" target="_blank" rel="noopener">Ordre du jour</a><br /><a title="2025-10-27_Proces-verbal_FINAL.pdf" href="https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2025/2025-10-27_Proces-verbal_FINAL.pdf" target="_blank" rel="noopener">Procès-verbal</a></td>
</tr>
</tbody>
</table>
`;

/**
 * Real pdftotext excerpt from the April 13, 2026 PV of Ville de Mirabel,
 * captured 2026-06-10 from:
 * https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Proces-verbal_FINAL.pdf
 *
 * Key sections:
 *   - Resolution 224-04-2026: Adoption du premier projet de règlement numéro U-2701
 *     modifiant le règlement de zonage numéro U-2300 (zones H 7-81, H 7-88, H 12-47, H 12-59)
 *   - Resolution 225-04-2026: AVIS DE MOTION pour règlement modifiant le règlement de
 *     zonage numéro U-2300 (même objet — U-2701)
 *
 * Détection honnête:
 *   - avisDeMotion: true (Resolution 225-04-2026: "Avis de motion est donné par monsieur
 *     le conseiller Robert Charron qu'à une prochaine séance de ce conseil, il sera présenté
 *     un règlement modifiant le règlement de zonage numéro U-2300")
 *   - changementZonage: true ("règlement de zonage numéro U-2300" in avis de motion context)
 *   - reglementNumbers: [] (Mirabel uses letter-prefix format "U-2300", "U-2701"
 *     which doesn't match REGLEMENT_NUMBER_RE \d{2,4}-\d{1,4} — no letters allowed;
 *     REGLEMENT_VPREFIX_RE requires [A-Z]\d{2,4}-\d{4}-\d{1,3} → "U-2300" is 4 digits without year)
 *     Honest absence: municipality uses non-standard numbering format.
 *   - ANTI-FAUX-POSITIF: Resolution 223-04-2026 "Avis de motion" for U-2700 (permis et
 *     certificats) is NOT a zonage change → confirmed no "zonage" in its context window.
 */
export const PV_MIRABEL_2026_04_TEXT = `
LE 13 AVRIL 2026
PROVINCE DE QUÉBEC
Séance ordinaire du conseil municipal de la Ville de Mirabel, tenue dans la
salle du conseil municipal, secteur de Sainte-Monique, Mirabel,
le lundi 13 avril 2026, à 19 heures, sous la présidence de Mme la mairesse,
Roxanne Therrien.

Sont présents les conseillères et conseillers :
Mmes

MM.

Marie-Eve Verdier
Émilie Derganc
Isabelle Gauthier
Caroline Morin
Catherine Maréchal
David Bélanger
Robert Charron
Patrick Rebelo
Vincent Charbonneau
Sébastien Hamel

Sont également présents :
M.
Mme

Sébastien Gauthier, directeur général adjoint
Isabelle Bourcier, greffière

223-04-2026

Avis de motion pour la présentation prochaine d'un
règlement modifiant le règlement sur les permis et
certificats numéro U-2303 de façon à réviser certains
honoraires exigibles pour les permis de lotissement.
(U-2700) (G8 400)

Avis de motion est donné par monsieur le conseiller Sébastien Hamel qu'à
une prochaine séance de ce conseil, il sera présenté un règlement modifiant
le règlement sur les permis et certificats numéro U-2303 de façon à réviser
certains honoraires exigibles pour les permis de lotissement, des copies du
règlement étant mises à la disposition des citoyens.
MME LA CONSEILLÈRE MARIE-EVE VERDIER S'ABSTIENT DE VOTER
SUR CETTE RÉSOLUTION.

224-04-2026

Adoption du projet de règlement numéro U-2701
modifiant le règlement de zonage numéro U-2300 de
façon à :
- ajouter l'usage « H1 – habitation unifamiliale » de structure
  jumelée dans les zones H 7-81 et H 7-88, dans le secteur
  de Saint-Janvier;
- modifier les normes applicables pour l'usage « H1 – habitation
  unifamiliale » de structure jumelée dans les zones H 12-47 et
  H 12-59, dans le secteur du Domaine-Vert Sud. (G8 400)

CONSIDÉRANT QU'il y a lieu de procéder à certaines modifications au
règlement de zonage numéro U-2300;
CONSIDÉRANT QUE les dispositions de ce règlement sont susceptibles
d'approbation référendaire;
Il est proposé par monsieur le conseiller Robert Charron, appuyé par
monsieur le conseiller Vincent Charbonneau et résolu unanimement :
D'adopter le projet de règlement numéro PU-2701 modifiant le règlement de
zonage numéro U-2300 de façon à :
- ajouter l'usage « H1 – habitation unifamiliale » de structure jumelée
  dans les zones H 7-81 et H 7-88, dans le secteur de Saint-Janvier;
- modifier les normes applicables pour l'usage « H1 – habitation
  unifamiliale » de structure jumelée dans les zones H 12-47 et H 12-59,
  dans le secteur du Domaine-Vert Sud.
MME LA CONSEILLÈRE MARIE-EVE VERDIER S'ABSTIENT DE VOTER
SUR CETTE RÉSOLUTION.

225-04-2026

Avis de motion pour la présentation prochaine d'un
règlement modifiant le règlement de zonage
numéro U-2300 de façon à :
- ajouter l'usage « H1 – habitation unifamiliale » de structure
  jumelée dans les zones H 7-81 et H 7-88, dans le secteur
  de Saint-Janvier;
- modifier les normes applicables pour l'usage « H1 – habitation
  unifamiliale » de structure jumelée dans les zones H 12-47 et
  H 12-59, dans le secteur du Domaine-Vert Sud. (U-2701) (G8 400)

Avis de motion est donné par monsieur le conseiller Robert Charron qu'à une
prochaine séance de ce conseil, il sera présenté un règlement modifiant le
règlement de zonage numéro U-2300 de façon à :
- ajouter l'usage « H1 – habitation unifamiliale » de structure jumelée
  dans les zones H 7-81 et H 7-88, dans le secteur de Saint-Janvier;
- modifier les normes applicables pour l'usage « H1 – habitation
  unifamiliale » de structure jumelée dans les zones H 12-47 et H 12-59,
  dans le secteur du Domaine-Vert Sud,
des copies du règlement étant mises à la disposition des citoyens.
MME LA CONSEILLÈRE MARIE-EVE VERDIER S'ABSTIENT DE VOTER
SUR CETTE RÉSOLUTION.

226-04-2026

Avis de motion pour la présentation prochaine d'un
règlement relatif au Code d'éthique et de déontologie des
membres du conseil municipal et remplacement du
règlement numéro 2500 et dépôt d'un projet de
règlement. (G8 400) (2696)

Avis de motion est donné par monsieur le conseiller David Bélanger qu'à une
prochaine séance de ce conseil, il sera présenté un règlement relatif au Code
d'éthique et de déontologie des membres du conseil municipal
et remplacement du règlement numéro 2500, des copies du règlement étant
mises à la disposition des citoyens.
`;
