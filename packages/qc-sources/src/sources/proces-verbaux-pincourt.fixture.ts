/**
 * Real procès-verbaux fixture data for Pincourt (MRC Vaudreuil-Soulanges) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.villepincourt.qc.ca/fr/la-ville/administration/seances-et-proces-verbaux
 *     HTTP 200, public / no login. Custom CMS with direct PDF links.
 *     robots.txt: Disallow: (empty — no restrictions).
 *   - PV PDF (May 12, 2026):
 *     https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-05-12_-_PV_OFFICIEL.pdf
 *     HTTP 200, 460 728 bytes (PDF), extracted via pdftotext → 44 745 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_PINCOURT_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (direct absolute PDF links under /uploads/Proces-verbaux/2026/).
 *   2. PV_PINCOURT_2026_05_TEXT — pdftotext excerpt from the real May 12, 2026 PV.
 *      Contains reference to "avis de motion a été donné" for Règlement no 780-33
 *      modifiant le Règlement de zonage et de plans d'implantation (hébergement gîte).
 *
 * Expected detection (honest — anti-invention):
 *   - avisDeMotion: true ("avis de motion a été donné" for Règlement no 780-33)
 *   - changementZonage: true ("Règlement de zonage" appears in same paragraph as
 *     "avis de motion a été donné" — Règlement no 780-33 modifiant le Règlement de
 *     zonage no 780, gîte touristique restriction)
 *   - reglementNumbers: ["780-33"] (number directly associated with zonage motion)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.villepincourt.qc.ca/ → HTTP 200
 *   - robots.txt: Disallow: (empty — no restrictions)
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Pincourt,
 * captured 2026-06-10 from:
 * https://www.villepincourt.qc.ca/fr/la-ville/administration/seances-et-proces-verbaux
 *
 * Structure: direct absolute PDF links under /uploads/Proces-verbaux/2026/
 * 7 PV links for 2026 (January through May 12, 2026), including one extraordinary session.
 */
export const PV_PINCOURT_INDEX_HTML = `
<ul>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-05-12_-_PV_OFFICIEL.pdf">Projet - Séance du 12 mai 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-04-21_-_PV_OFFICIEL.pdf">Projet - Séance du 21 avril 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-04-14_-_PV_OFFICIEL.pdf">Projet - Séance du 14 avril 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-03-10_-_PV_OFFICIEL.pdf">Projet - Séance du 10 mars 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-02-24_-_PV_EXTRA_OFFICIEL.pdf">Projet - Séance extraordinaire du 24 février 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-02-10_-_PV_OFFICIEL.pdf">Projet - Séance du 10 février 2026</a></li>
  <li><a href="https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-01-20_-_PV_OFFICIEL.pdf">Projet - Séance du 20 janvier 2026</a></li>
</ul>
`;

/**
 * Real pdftotext excerpt from Pincourt PV May 12, 2026.
 * Source: https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-05-12_-_PV_OFFICIEL.pdf
 * Captured: 2026-06-10
 *
 * Contains:
 *   - Resolution 2026-05-150: Adoption du Règlement no 780-33 modifiant le Règlement
 *     de zonage et de plans d'implantation et d'intégration architecturale no 780.
 *     Context: "Considérant qu'un avis de motion a été donné pour le projet de
 *     Règlement no 780-33 modifiant le Règlement de zonage". Hébergement gîte
 *     touristique restriction to unifamiliales détachées.
 *
 * Expected detection:
 *   - avisDeMotion: true ("avis de motion a été donné" present)
 *   - changementZonage: true (Règlement de zonage no 780 explicitly cited in the
 *     same paragraph as "avis de motion a été donné")
 *   - reglementNumbers: ["780-33"]
 */
export const PV_PINCOURT_2026_05_TEXT = `
PROCÈS-VERBAL de la séance ordinaire tenue le mardi 12 mai 2026 à 19 heures, au lieu
ordinaire des séances dudit conseil et selon la loi
PRÉSENCES :
Monsieur Claude Comeau, maire
Madame Denise Bergeron, conseillère
Madame Diane Boyer, conseillère
Monsieur Mario Demers, conseiller
Monsieur René Lecavalier, conseiller
Madame Carmen Pilote, conseillère
Madame Melanie Rose, conseillère
AUTRE PRÉSENCE :
Me Charlotte Gagné, directrice générale adjointe et greffière
OUVERTURE DE LA SÉANCE – 19 HEURES

2026-05-123

OUVERTURE DE LA SÉANCE ORDINAIRE DU MARDI 12 MAI 2026 ET ADOPTION DE
L'ORDRE DU JOUR
PROPOSÉ PAR    Mario Demers
APPUYÉ PAR     René Lecavalier

D'ouvrir la séance ordinaire du mardi 12 mai 2026 à 19 heures et d'adopter l'ordre du
jour de ladite séance.
RÉSOLU À L'UNANIMITÉ

2026-05-150

ADOPTION DU RÈGLEMENT NO 780-33 MODIFIANT LE RÈGLEMENT DE ZONAGE ET DE
PLANS D'IMPLANTATION ET D'INTÉGRATION ARCHITECTURALE NO 780, TEL
QU'AMENDÉ
Considérant que le Règlement de zonage et de plans d'implantation et d'intégration
architecturale no 780 et ses amendements en vigueur s'appliquent sur le territoire de la
Ville de Pincourt;
Considérant que la Ville de Pincourt a adopté le Règlement de zonage et de plans
d'implantation et d'intégration architecturale no 780, tel qu'amendé, afin de régir
l'occupation et l'utilisation du sol sur son territoire;
Considérant que ledit règlement de zonage permet, à certaines conditions, l'usage
additionnel « Hébergement de type gîte touristique »;
Considérant que le conseil municipal souhaite mieux encadrer cet usage afin de
préserver la quiétude, la sécurité et la qualité de vie des secteurs résidentiels;
Considérant que la proximité des habitations jumelées ou contiguës peut accentuer les
impacts négatifs liés à l'hébergement touristique à court terme;
Considérant que la Ville peut modifier sa réglementation de zonage afin d'encadrer les
usages futurs, tout en respectant les droits acquis existants;
Considérant qu'un avis de motion a été donné pour le projet de Règlement no 780-33
modifiant le Règlement de zonage et de plans d'implantation et d'intégration
architecturale no 780, tel qu'amendé, que ledit projet a été déposé et que le premier
projet a été adopté lors de la séance ordinaire du mardi 10 mars 2026, sous la résolution
2026-03-068;
Considérant la tenue de la consultation publique sur ledit projet de règlement le mardi
14 avril 2026 à compter de 18 h 30;
Considérant l'adoption du second projet de règlement lors de la séance ordinaire du
14 avril 2026 sous la résolution 2026-04-108;
Considérant l'avis de demande de participation à un référendum publié le 16 avril 2026;
Considérant qu'aucune demande de participation à un référendum n'a été reçue pour
ledit projet de règlement, il est
PROPOSÉ PAR   Diane Boyer
APPUYÉ PAR    Denise Bergeron

D'adopter le Règlement no 780-33 modifiant le Règlement de zonage et de plans
d'implantation et d'intégration architecturale no 780, tel qu'amendé, de façon à
restreindre l'usage additionnel « Hébergement de type gîte touristique » aux résidences
unifamiliales détachées.
RÉSOLU À L'UNANIMITÉ
`;
