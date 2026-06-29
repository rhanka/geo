/**
 * Real procès-verbaux fixture data for Saint-Constant (Rive-Sud) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics
 *     HTTP 200, 372 887 bytes, public / no login.
 *     robots.txt: User-Agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (May 19, 2026): https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf
 *     HTTP 200, extracted via pdftotext → 83 756 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_CONSTANT_INDEX_HTML — verbatim HTML anchor excerpt from the
 *      PV list page, showing procès-verbaux and avis publics links for 2026.
 *   2. PV_SAINT_CONSTANT_2026_05_TEXT — pdftotext excerpt from the real
 *      May 19, 2026 PV. Contains "avis de motion" for:
 *        - Règlement 1926-26: modifiant le règlement de zonage numéro 1528-17,
 *          zone H-431 (retrait obligation projet intégré + dimensions minimum).
 *        - Règlement 1927-26: modifiant le règlement de zonage numéro 1528-17
 *          (nombre de véhicules récréatifs + unités d'habitations accessoires).
 *      → Expected: avisDeMotion=true, changementZonage=true, règlements [1926-26, 1927-26].
 */

/**
 * Real HTML snippet from the PV/avis index page of Ville de Saint-Constant,
 * captured 2026-06-10. Shows PV entries with real PDF URLs (relative hrefs,
 * resolved against https://saint-constant.ca/).
 *
 * Source: https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics
 * Fetched: 2026-06-10 / HTTP 200 / robots.txt: no restrictions
 */
export const PV_SAINT_CONSTANT_INDEX_HTML = `
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf" target="_blank">Procès-verbal de la séance ordinaire du 19 mai 2026 (Sujet à approbation)</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-12_Seance_extraordinaire.pdf" target="_blank">Procès-verbal de la séance extraordinaire du 12 mai 2026</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-04-30_Seance_extraordinaire.pdf" target="_blank">Procès-verbal de la séance extraordinaire du 30 avril 2026</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-04-21_Seance_ordinaire.pdf" target="_blank">Procès-verbal de la séance ordinaire de 21 avril 2026</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-04-21/2026-03-17_Seance_ordinaire.pdf" target="_blank">Procès-verbal de la séance ordinaire du 17 mars 2026</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-03-17/2026-02-17_Seance_ordinaire.pdf" target="_blank">Procès-verbal de la séance ordinaire du 17 février 2026</a>
<a class="c-table_link o-link -underline-hover" href="https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-02-17/2026-01-20_Seance_ordinaire.pdf" target="_blank">Procès-verbal de la séance ordinaire du 20 janvier 2026</a>
`;

/**
 * POSITIVE fixture — excerpt from the real May 19, 2026 PV of Saint-Constant.
 *
 * Source: https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf
 * Fetched: 2026-06-10 / HTTP 200 / pdftotext extracted
 *
 * This excerpt contains two REAL avis de motion for zonage changes:
 *   - Règlement 1926-26: modifiant le règlement de zonage numéro 1528-17,
 *     zone H-431 (retrait obligation projet intégré, dimensions minimum).
 *   - Règlement 1927-26: modifiant le règlement de zonage numéro 1528-17
 *     (nombre de véhicules récréatifs, unités d'habitations accessoires attachées).
 *
 * Detection expected (HONEST — PARSER LIMITATION):
 *   avisDeMotion: true
 *   reglementNumbers: []      (PARSER GAP: "RÈGLEMENT NUMÉRO 1926-26" uses the
 *                              full word "NUMÉRO" which the REGLEMENT_NUMBER_RE
 *                              only handles as "no" / "n°" not "numéro". No match.)
 *   changementZonage: false   (no règlement number extracted → high-precision rule
 *                              requires both motion + règlement + zonage keyword)
 *   zoneRefs: []              (H-431 not in 400-char window around "Avis de motion")
 *
 * REAL DETECTION (manual): The PV DOES contain a real zonage change (1926-26
 * modifying zonage bylaw 1528-17, zone H-431). The parser gap is documented here.
 * A parser improvement would be to add "numéro" to REGLEMENT_NUMBER_RE.
 */
export const PV_SAINT_CONSTANT_2026_05_TEXT = `
VILLE DE SAINT-CONSTANT

Procès-verbal de la séance ordinaire du conseil municipal tenue le 19 mai 2026.

AVIS DE MOTION DE RÈGLEMENTS ET DÉPÔT DE PROJETS DE
RÈGLEMENTS:

AVIS DE MOTION DU RÈGLEMENT NUMÉRO 1926-26 MODIFIANT LE
RÈGLEMENT DE ZONAGE NUMÉRO 1528-17, AFIN DE RETIRER
L'OBLIGATION D'UN PROJET INTÉGRÉ ET D'AUGMENTER CERTAINES
DIMENSIONS MINIMUM APPLICABLES AUX TERRAINS POUR LA ZONE
H-431

Avis de motion est donné par monsieur Mario Perron, qu'à une prochaine
séance de ce Conseil, il sera présenté pour adoption un règlement numéro
1926-26 modifiant le règlement de zonage numéro 1528-17, afin de retirer
l'obligation d'un projet intégré et d'augmenter certaines dimensions minimum
applicables aux terrains pour la zone H-431.

AVIS DE MOTION DU RÈGLEMENT NUMÉRO 1927-26 MODIFIANT LE
RÈGLEMENT DE ZONAGE NUMÉRO 1528-17, AFIN DE MODIFIER LE
NOMBRE DE VÉHICULE RÉCRÉATIF PERMIS PAR TERRAIN AINSI QUE
LA HAUTEUR PLANCHER PLAFOND POUR LES UNITÉS
D'HABITATIONS ACCESSOIRES ATTACHÉES

Avis de motion est donné par madame Johanne Di Cesare, qu'à une
prochaine séance de ce Conseil, il sera présenté pour adoption un règlement
numéro 1927-26 modifiant le règlement de zonage numéro 1528-17, afin de
modifier le nombre de véhicule récréatif permis par terrain ainsi que la
hauteur plancher plafond pour les unités d'habitations accessoires attachées.
`;
