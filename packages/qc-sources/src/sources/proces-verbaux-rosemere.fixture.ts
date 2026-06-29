/**
 * Real procès-verbaux fixture data for Rosemère (MRC Thérèse-De Blainville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.rosemere.qc.ca/seances-conseil/
 *     HTTP 200 (via redirect: ville.rosemere.qc.ca → www.ville.rosemere.qc.ca/seances-conseil/).
 *     robots.txt: User-agent: * / Sitemap only — NO Disallow rules (permissive).
 *   - PV PDF (March 9, 2026):
 *     https://www.ville.rosemere.qc.ca/images/clients/PV%202026-03-09%20FINAL.pdf
 *     HTTP 200, text layer present (pdftotext → 1204 lines).
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_ROSEMERE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (simple anchor list of Procès-verbal links by date).
 *   2. PV_ROSEMERE_2026_03_TEXT — pdftotext excerpt from the March 9, 2026 PV.
 *      Contains:
 *        - Adoption of second project of Règlement 801-70 modifying Règlement 801 Zonage
 *          (including lot 3 005 325 in zone C-18)
 *        - Avis de motion for Règlement 801-71 modifying Règlement de zonage 801
 *          (concordance with MRC Thérèse-De Blainville Règlement 24-02)
 *        - Adoption of Règlement 801-71 project (consultation publique)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.rosemere.qc.ca/ → HTTP 200 (with PHP session cookie)
 *   - https://www.ville.rosemere.qc.ca/robots.txt → User-agent: * / Sitemap only (no Disallow)
 *   - Target page is accessible → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true
 *     ("La conseillère MARIE-HÉLÈNE FORTIN donne avis de motion qu'il sera
 *      adopté séance tenante le projet de Règlement 801-71 modifiant le
 *      Règlement de zonage 801")
 *     → AVIS_MOTION_RE matches "donne avis de motion"
 *   - changementZonage: true
 *     ("Règlement de zonage 801" appears in same paragraph)
 *     → REGLEMENT_NOHYPHEN_RE captures 801 as zone règlement number;
 *        OR the context window includes "Règlement de zonage" keyword directly.
 *   - reglementNumbers: includes "801-71" (hyphenated: REGLEMENT_NUMBER_RE matches
 *     "Règlement 801-71 modifiant le Règlement de zonage 801")
 *   - zoneRefs: may include "C-18" (zone mentioned in 801-70 adoption context)
 *
 * NOTE: Rosemère uses sequential hyphenated règlement numbers (801-70, 801-71)
 * where "801" is the parent règlement and "-70"/"-71" are amendment suffixes.
 * REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}) matches "801-71" correctly.
 */

/**
 * Real HTML snippet from the PV index page of Ville de Rosemère,
 * captured 2026-06-10 from:
 * https://www.ville.rosemere.qc.ca/seances-conseil/
 *
 * Key PV PDF links present (2025-12 through 2026-04):
 *   - PV 2026-04-13 FINAL.pdf (April 13, 2026)
 *   - PV 2026-03-09 FINAL.pdf (March 9, 2026)
 *   - PV 2026-02-09 FINAL.pdf (February 9, 2026)
 *   - PV 2026-02-02 EXTRA FINAL.pdf (February 2, 2026, extraordinary)
 *   - PV 2026-01-19 FINAL.pdf (January 19, 2026)
 *   - Several 2025 PVs
 *
 * The index uses simple <a> tags with href="/images/clients/PV YYYY-MM-DD FINAL.pdf"
 * (relative paths) and text "Procès-verbal" or "procès verbal" as labels.
 */
export const PV_ROSEMERE_INDEX_HTML = `
<div class="seances-conseil-list">
<a href="/images/clients/PV%202026-04-13%20FINAL.pdf">Procès-verbal</a>
<a href="/images/clients/PV%202026-03-09%20FINAL.pdf">Procès-verbal</a>
<a href="/images/clients/PV%202026-02-09%20FINAL.pdf">Procès-verbal</a>
<a href="/images/clients/PV%202026-02-02%20EXTRA%20FINAL.pdf">Procès-verbal</a>
<a href="/images/clients/PV%202026-01-19%20FINAL.pdf">Procès-verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-12-08%20FINAL.pdf" target="_blank">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-12-08%20extra%20FINAL.pdf" target="_blank">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-11-24%20FINAL.pdf" target="_blank">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-10-01.pdf">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-09-08.pdf">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-08-18%20FINAL.pdf">procès verbal</a>
<a href="https://www.ville.rosemere.qc.ca/images/clients/PV%202025-07-07%20FINAL.pdf">procès verbal</a>
</div>
`;

/**
 * Real pdftotext excerpt from the March 9, 2026 PV of Ville de Rosemère,
 * captured 2026-06-10 from:
 * https://www.ville.rosemere.qc.ca/images/clients/PV%202026-03-09%20FINAL.pdf
 *
 * Key sections:
 *   5.3.3: Adoption (second project) of Règlement 801-70 modifying Règlement 801 Zonage
 *          (include lot 3 005 325 in zone C-18)
 *   5.3.4: Avis de motion for Règlement 801-71 modifying Règlement de zonage 801
 *          (concordance with MRC Thérèse-De Blainville Règlement 24-02)
 *   5.3.5: Adoption of Règlement 801-71 project with public consultation
 *
 * Détection honnête:
 *   - avisDeMotion: true
 *     (AVIS_MOTION_RE: "donne avis de motion" → matches
 *      "La conseillère MARIE-HÉLÈNE FORTIN donne avis de motion qu'il sera
 *      adopté séance tenante le projet de Règlement 801-71 modifiant le
 *      Règlement de zonage 801")
 *   - changementZonage: true
 *     (REGLEMENT_NUMBER_RE: "Règlement 801-71" → "801-71"; zonage context:
 *      "Règlement de zonage 801" in same paragraph)
 *   - reglementNumbers: contains "801-71" (new règlement de zonage amendment)
 *   - NOTE: "801-70" adoption section also references "Règlement 801 - Zonage"
 *     but uses past-tense "a été dûment donné" — AVIS_MOTION_PAST_TENSE_RE also matches.
 */
export const PV_ROSEMERE_2026_03_TEXT = `
2026-03-09

PROCÈS-VERBAL d'une séance ordinaire du conseil municipal, tenue à
l'hôtel de ville de Rosemère, le 9 mars 2026, sous la présidence de
madame la mairesse MARIE-ELAINE PITRE.
SONT PRÉSENTS :
Madame la mairesse : Marie-Elaine Pitre
Mesdames les conseillères : Marie-Hélène Fortin, Stéphanie Nantel et Annick Lemelin
Lagacé
Messieurs les conseillers : Jean-François Gagnière, Sébastien Jacquet et Elmer van der
Vlugt

5.3.3. 801-70 - Règlement modifiant le Règlement 801 - Zonage, afin de
modifier des dispositions ainsi qu'inclure le lot 3 005 325 à la zone C-18
- Adoption du second projet de règlement
2026-03-078
CONSIDÉRANT qu'en vertu de l'article 113 paragraphe 1° de la Loi sur
l'aménagement et l'urbanisme, une Ville peut diviser le territoire en zones;
CONSIDÉRANT qu'en vertu de l'article 113 paragraphe 3° de la Loi sur
l'aménagement et l'urbanisme, une Ville peut spécifier pour une zone les
usages qui sont autorisés et ceux prohibés;
CONSIDÉRANT que les dispositions assujetties à l'article 113 paragraphes
1° et 3° sont susceptibles d'approbation référendaire;
CONSIDÉRANT qu'une demande de modification du règlement de zonage a
été déposée en décembre 2025;
CONSIDÉRANT qu'un avis de motion a été dûment donné à la séance du
9 février 2026;
CONSIDÉRANT que le premier projet de règlement a été adopté lors de la
séance du 9 février 2026;
CONSIDÉRANT la consultation publique sur ledit projet tenue avant la
présente séance;
PAR CONSÉQUENT
Sur proposition de la conseillère MARIE-HÉLÈNE FORTIN, appuyée par la
conseillère ANNICK LEMELIN LAGACÉ, il est résolu :
D'ADOPTER le second projet de Règlement 801-70 modifiant le règlement
801 - Zonage, afin de modifier des dispositions ainsi qu'inclure le lot
3 005 325 à la zone C-18 sans changement.
ADOPTÉE À L'UNANIMITÉ.

5.3.4. 801-71 - Règlement modifiant le Règlement de zonage 801 afin d'assurer
la conformité au Règlement 24-02 de la MRC de Thérèse-De Blainville
et aux Règlements 800-06 et 800-08 de la Ville de Rosemère relatifs au
pôle régional - Règlement de concordance - Avis de motion
2026-03-079
La conseillère MARIE-HÉLÈNE FORTIN donne avis de motion qu'il sera
adopté séance tenante le projet de Règlement 801-71 modifiant le
Règlement de zonage 801 afin d'assurer la conformité au Règlement 24-02
de la MRC de Thérèse-De Blainville et aux Règlements 800-06 et 800-08 de
la Ville de Rosemère relatifs au pôle régional - Règlement de concordance.

5.3.5. 801-71 - Règlement modifiant le Règlement de zonage 801 afin d'assurer
la conformité au Règlement 24-02 de la MRC de Thérèse-De Blainville
et aux Règlements 800-06 et 800-08 de la Ville de Rosemère relatifs au
pôle régional - Règlement de concordance - Adoption de projet et
consultation publique
2026-03-080
CONSIDÉRANT que le Règlement 801 de zonage est en vigueur;
CONSIDÉRANT qu'un avis de motion a été dûment donné à la séance du
9 mars 2026;
PAR CONSÉQUENT
Sur proposition de la conseillère MARIE-HÉLÈNE FORTIN, appuyée par la
conseillère ANNICK LEMELIN LAGACÉ, il est résolu :
D'ADOPTER le projet de Règlement 801-71 modifiant le Règlement de
zonage 801 afin d'assurer la conformité au Règlement 24-02 de la MRC de
Thérèse-De Blainville et aux Règlements 800-06 et 800-08 de la Ville de
Rosemère relatifs au pôle régional - Règlement de concordance.
DE FIXER la date de la séance de consultation publique sur ledit projet de
règlement au 27 avril 2026, à 18 h 30, au centre communautaire Memorial
(202, chemin de la Grande-Côte), salle Horizon.
ADOPTÉE À L'UNANIMITÉ.
`;
