/**
 * Real procès-verbaux fixture data for Boucherville (MRC Marguerite-D'Youville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.boucherville.ca/mairie-conseil/seances-du-conseil/
 *     HTTP 200, public / no login.
 *     robots.txt: Disallow /wp-admin/ only — wp-content/uploads allowed.
 *   - PV PDF (March 16, 2026):
 *     https://www.boucherville.ca/wp-content/uploads/2026/03/PV_seance_260316.pdf
 *     HTTP 200, extracted via pdftotext → 61 714 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size reasonable.
 *
 * TWO fixtures are provided:
 *   1. PV_BOUCHERVILLE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (WordPress. PV links are HTML intermediate pages, not direct PDFs).
 *   2. PV_BOUCHERVILLE_2026_03_TEXT — pdftotext excerpt from the March 16, 2026 PV.
 *      Contains NEW avis de motion for FOUR real zonage changes:
 *        - Règlement numéro 2026-290-50 modifiant le Règlement de zonage numéro 2018-290
 *          (affichage dans les zones C-555, C-665 et C-707)
 *        - Règlement numéro 2026-290-53 modifiant le Règlement de zonage numéro 2018-290
 *          (usage C13-02-10 dans la zone C-326)
 *        - Règlement numéro 2026-290-54 modifiant le Règlement de zonage numéro 2018-290
 *          (logements accessoires dans certaines zones du Vieux-Boucherville)
 *        - Règlement numéro 2026-290-55 modifiant le Règlement de zonage numéro 2018-290
 *          (usage R3-01-01 terrain de golf dans la zone P-656)
 *
 * PARSER SUPPORT: Boucherville uses 3-segment numbering (2026-290-50).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "2026-290" (first two segments).
 *   All four rules share the prefix "2026-290" — parser may extract "2026-290" once or more.
 *   "Règlement de zonage numéro 2018-290" → MODIFIANT_REGLEMENT_RE matches "2018-290".
 *   filterNewReglements excludes "2018-290" (modified bylaw) when "2026-290" (new) exists.
 *   "règlement de zonage" keyword present → changementZonage=true.
 *   Also: zones C-555, C-665, C-707, C-326, P-656 are mentioned → zoneRefs populated.
 *   Result: avisDeMotion=true, reglementNumbers contains "2026-290", changementZonage=true.
 *   ZERO false positive: all four rules genuinely modify the Règlement de zonage 2018-290.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.boucherville.ca/ → HTTP 200
 *   - robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 *   - All PDFs under wp-content/uploads/ are publicly accessible.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Boucherville,
 * captured 2026-06-10 from:
 * https://www.boucherville.ca/mairie-conseil/seances-du-conseil/
 *
 * WordPress. PV links are HTML intermediate pages (Procès-verbal links to
 * /medias-publications/publications/... pages). The individual publication page
 * contains a direct PDF link (PV_seance_YYMMDD.pdf).
 * parsePvIndex finds the .ca/medias-publications/... links as HTML items.
 * Since they don't end in .pdf, they appear as HTML content type refs in the adapter.
 *
 * NOTE: The PDF direct links (PV_seance_*.pdf) are accessible via one extra click
 * on the publication detail page. They ARE directly accessible when the URL is known.
 * The index page itself does NOT expose the direct PDF links — only the HTML page links.
 *
 * Key PV HTML page links present in 2026 section:
 *   - Procès-verbal du 25 mai 2026 → /publications/proces-verbal-...-25-mai-2026/
 *   - Procès-verbal du 27 avril 2026 → /publications/proces-verbal-...-27-avril-2026/
 *   - Procès-verbal du 30 mars 2026 → /publications/proces-verbal-...-30-mars-2026/
 *   - Procès-verbal du 16 mars 2026 → /publications/proces-verbal-...-16-mars-2026/
 *   - Procès-verbal du 16 février 2026 → /publications/proces-verbal-...-16-fevrier-2026/
 */
export const PV_BOUCHERVILLE_INDEX_HTML = `
<div class="seances-list">
  <h2>2026</h2>
  <div class="session-item">
    <h3>Séance ordinaire du 25 mai 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-25-mai-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/05/2026-434-1_projet_regl_circulation_VR.pdf" target="_blank" rel="noreferrer noopener">2026-434-1</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/05/2026-472-1_projet_regl_regime_retraite_MAJ.pdf" target="_blank" rel="noreferrer noopener">2026-472-1</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/05/2026-480_projet_regl_deneigement.pdf" target="_blank" rel="noreferrer noopener">2026-480</a></p>
  </div>
  <div class="session-item">
    <h3>Séance ordinaire du 27 avril 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-27-avril-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/04/2026-290-53_second_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-53</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/04/2026-290-55_second_projer_regl_MODIF.pdf" target="_blank" rel="noreferrer noopener">2026-290-55</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/04/2026-290-56_second_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-56</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/04/2026-290-57_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-57</a></p>
  </div>
  <div class="session-item">
    <h3>Séance extraordinaire du 30 mars 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-extraordinaire-du-conseil-municipal-du-30-mars-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
  </div>
  <div class="session-item">
    <h3>Séance ordinaire du 16 mars 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-16-mars-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/03/2026-290-53_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-53</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/03/2026-290-54_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-54</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/03/2026-290-55_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-55</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/03/2026-290-56_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-56</a></p>
  </div>
  <div class="session-item">
    <h3>Séance ordinaire du 16 février 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-16-fevrier-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/02/2026-290-52_second_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-52</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/02/2026-466_Projet_Code_ethique_deontologie_Elus_vf.pdf" target="_blank" rel="noreferrer noopener">2026-466</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/02/2026-467_projet_regl_occupation_entretien_batiments.pdf" target="_blank" rel="noreferrer noopener">2026-467</a></p>
  </div>
  <div class="session-item">
    <h3>Séance ordinaire du 19 janvier 2026</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-19-janvier-2026/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
    <p><a href="https://www.boucherville.ca/wp-content/uploads/2026/01/2026-290-52_projet_regl_zonage.pdf" target="_blank" rel="noreferrer noopener">2026-290-52</a></p>
  </div>
  <h2>2025</h2>
  <div class="session-item">
    <h3>Séance ordinaire du 17 novembre 2025</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-17-novembre-2025/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
  </div>
  <div class="session-item">
    <h3>Séance ordinaire du 6 octobre 2025</h3>
    <p><a href="https://www.boucherville.ca/medias-publications/publications/proces-verbal-de-la-seance-ordinaire-du-conseil-municipal-du-6-octobre-2025/" target="_blank" data-type="link" rel="noreferrer noopener">Procès-verbal</a></p>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from Boucherville PV March 16, 2026.
 * Source: https://www.boucherville.ca/wp-content/uploads/2026/03/PV_seance_260316.pdf
 * Captured: 2026-06-10
 *
 * Contains NEW avis de motion for FOUR real zonage changes:
 *   - 260316-4: Règlement numéro 2026-290-50 modifiant le Règlement de zonage numéro 2018-290
 *     afin de modifier certaines dispositions relatives à l'affichage dans les zones C-555, C-665 et C-707.
 *     "Anne Barabé donne un avis de motion à l'effet qu'à une prochaine séance ... un règlement
 *     modifiant le Règlement de zonage numéro 2018-290 afin de modifier certaines dispositions
 *     relatives à l'affichage dans les zones C-555, C-665 et C-707."
 *   - 260316-5: Règlement numéro 2026-290-53 (zone C-326 — salle de jeux d'arcade)
 *   - 260316-6: Règlement numéro 2026-290-54 (logements accessoires Vieux-Boucherville)
 *   - 260316-7: Règlement numéro 2026-290-55 (terrain de golf zone P-656)
 *
 * Also: adoption of règlement 2026-07-9 (rémunération élus) and others NOT related to zonage.
 *
 * DETECTION:
 *   - "donne un avis de motion" present (four times for zonage) → avisDeMotion=true.
 *   - "Règlement de zonage numéro 2018-290" in backward window → changementZonage=true.
 *   - REGLEMENT_NUMBER_RE extracts "2026-290" from "règlement 2026-290-50" (first 2 segments).
 *   - "2018-290" (the modified base bylaw) → MODIFIANT_REGLEMENT_RE match → excluded by
 *     filterNewReglements when "2026-290" exists.
 *   - Zones C-555, C-665, C-707, C-326, P-656 mentioned.
 *   Result: avisDeMotion=true, reglementNumbers=["2026-290"], changementZonage=true.
 *   ZERO false positive: all four rules genuinely modify le Règlement de zonage 2018-290.
 */
export const PV_BOUCHERVILLE_2026_03_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Boucherville,
tenue le lundi 16 mars 2026.

260316-3

Avis de motion – Règlement numéro 2026-07-9
sur la rémunération des élus municipaux
M. le maire Jean Martel donne un avis de motion à l'effet qu'à une
prochaine séance de ce conseil sera présenté pour adoption un règlement
sur la rémunération des élus municipaux et le remboursement de
dépenses afin de mettre à jour les noms de la liste des comités,
commissions et groupes de travail à l'annexe A.

260316-4

Avis de motion – Règlement numéro 2026-290-50
modifiant le Règlement de zonage numéro 2018-290
afin de modifier certaines dispositions relatives à
l'affichage dans les zones C-555, C-665 et C-707
Mme la conseillère Anne Barabé donne un avis de motion à l'effet qu'à une
prochaine séance de ce conseil sera présenté pour adoption un règlement
modifiant le Règlement de zonage numéro 2018-290 afin de modifier
certaines dispositions relatives à l'affichage dans les zones C-555, C-665
et C-707.

260316-5

Avis de motion – Règlement numéro 2026-290-53
modifiant le Règlement de zonage numéro 2018-290
afin d'autoriser l'usage C13-02-10 (salle de jeux d'arcade) à titre
d'usage complémentaire dans un établissement
occupé par l'usage principal R4-02-02
(centre d'amusement intérieur) dans la zone C-326
M. le conseiller François Desmarais donne un avis de motion à l'effet qu'à
une prochaine séance de ce conseil sera présenté pour adoption un
règlement modifiant le Règlement de zonage numéro 2018-290 afin
d'autoriser l'usage C13-02-10 (salle de jeux d'arcade) à titre d'usage
complémentaire dans un établissement occupé par l'usage principal
R4-02-02 (centre d'amusement intérieur) dans la zone C-326.

260316-6

Avis de motion – Règlement numéro 2026-290-54
modifiant le Règlement de zonage numéro 2018-290
afin d'autoriser les logements accessoires dans
certaines zones du Vieux-Boucherville
Mme la conseillère Isabelle Bleau donne un avis de motion à l'effet
qu'à une prochaine séance de ce conseil sera présenté pour adoption
un règlement modifiant le Règlement de zonage numéro 2018-290
afin d'autoriser les logements accessoires dans certaines zones du
Vieux-Boucherville.

260316-7

Avis de motion – Règlement numéro 2026-290-55
modifiant le Règlement de zonage numéro 2018-290
afin de réviser diverses dispositions relatives à l'usage
R3-01-01 (terrain de golf) dans la zone P-656
M. le conseiller Raouf Absi donne un avis de motion à l'effet qu'à une
prochaine séance de ce conseil sera présenté pour adoption un règlement
modifiant le Règlement de zonage numéro 2018-290 afin de réviser
diverses dispositions relatives à l'usage R3-01-01 (terrain de golf) dans la
zone P-656.
`;
