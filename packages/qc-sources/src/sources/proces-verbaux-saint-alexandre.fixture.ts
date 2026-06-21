/**
 * Real procès-verbaux fixture data for Saint-Alexandre
 * (MRC Haut-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (séances page):
 *     https://saint-alexandre.ca/la-municipalite/vie-democratique/seances-du-conseil/
 *     HTTP 200, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (March 2, 2026):
 *     https://saint-alexandre.ca/wp-content/uploads/2026/03/Proces-verbal-preliminaire-2-mars-2026.pdf
 *     HTTP 200, text-layer PDF (pdftotext), public / no login.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_ALEXANDRE_INDEX_HTML — verbatim HTML excerpt from the séances
 *      page (simple WordPress list with direct PDF links).
 *   2. PV_SAINT_ALEXANDRE_2026_03_TEXT — pdftotext excerpt from the real
 *      March 2, 2026 PV containing avis de motion + zonage change 26-434.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://saint-alexandre.ca/ → HTTP 200
 *   - https://saint-alexandre.ca/robots.txt →
 *       User-agent: * / Disallow: (empty — no restrictions) / Sitemap present
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("Avis de motion est par la présente donnée"
 *     pour règlement 26-434)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "Avis de motion est par la présente donnée par le conseiller Florent Raymond
 *     qu'un règlement sera soumis à ce conseil...Règlement amendant le règlement de
 *     zonage 20-366 afin de modifier les normes d'abattage d'arbres"
 *     REGLEMENT_NUMBER_RE matches "26-434" (2+3 digits).
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage 20-366" / "règlement de zonage".
 *     reglementNumbers: ["26-434"] (20-366 excluded as modified bylaw).
 */

/**
 * Real HTML excerpt from the séances du conseil page of Municipalité de
 * Saint-Alexandre, captured 2026-06-10 from:
 * https://saint-alexandre.ca/la-municipalite/vie-democratique/seances-du-conseil/
 *
 * The page uses a WordPress theme with a simple <ul> list of PV PDF links.
 * Each entry contains a PDF link and an associated YouTube "Voir la vidéo" link.
 *
 * Direct PDF links found on page (captured 2026-06-10):
 *   2026-06-01: Projet-dordre-du-jour_Seance-1er-juin-2026.pdf (ODJ)
 *   2026-05-04: PV-4-mai-2026.pdf
 *   2026-04-07: PV-7-avril-2026.pdf
 *   2026-03-02: Proces-verbal-preliminaire-2-mars-2026.pdf ← zonage PV
 *   2026-02-23: PV-Extra-23-fev-2026.pdf (extraordinaire)
 *   2026-02-02: PV-2-fevrier-2026.pdf
 *   2026-01-12: PV-12-janvier-2026.pdf
 *   2026-01-12: PV-EXTRA-12-janvier-2026.pdf (extraordinaire)
 *   2025-12-15: PV-extra-15-decembre-2025.pdf (extraordinaire)
 */
export const PV_SAINT_ALEXANDRE_INDEX_HTML = `<ul>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/05/Projet-dordre-du-jour_Seance-1er-juin-2026.pdf">Projet d'ordre du jour – Séance ordinaire du 1er juin 2026</a>
    <a href="https://youtu.be/HB4CLJhRKgo">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/05/PV-4-mai-2026.pdf">Procès verbal préliminaire – Séance ordinaire du 4 mai 2026</a>
    <a href="https://youtu.be/7PacRlQGEy8">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/04/PV-7-avril-2026.pdf">Procès verbal – Séance ordinaire 7 avril 2026</a>
    <a href="https://youtu.be/QhZ4s6dVoe0">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/03/Proces-verbal-preliminaire-2-mars-2026.pdf">Procès-verbal – Séance ordinaire du 2 mars 2026</a>
    <a href="https://youtu.be/REt47N-2kUs">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/02/PV-Extra-23-fev-2026.pdf">Procès-verbal – Séance extraordinaire du 23 février 2026</a>
    <a href="https://youtu.be/qr7dixLxaeU">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/01/PV-2-fevrier-2026.pdf">Procès-verbal – 2 février 2026</a>
    <a href="https://youtu.be/LKkHZ71At8g">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/01/PV-12-janvier-2026.pdf">Procès-verbal – 12 janvier 2026</a>
    <a href="https://youtu.be/Hd4DZPom8IA">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2026/01/PV-EXTRA-12-janvier-2026.pdf">Procès-verbal – Séance extraordinaire du 12 janvier 2026</a>
    <a href="https://youtu.be/b0_wAbyJXuQ">Voir la vidéo</a>
  </li>
  <li>
    <a href="https://saint-alexandre.ca/wp-content/uploads/2025/12/PV-extra-15-decembre-2025.pdf">Procès-verbal – Séance extraordinaire du 15 décembre 2025</a>
    <a href="https://youtu.be/JoH7egQVtXI">Voir la vidéo</a>
  </li>
</ul>`;

/**
 * Real pdftotext excerpt from the March 2, 2026 ordinary council session PV of
 * Municipalité de Saint-Alexandre, captured 2026-06-10 from:
 * https://saint-alexandre.ca/wp-content/uploads/2026/03/Proces-verbal-preliminaire-2-mars-2026.pdf
 *
 * This excerpt covers the AMÉNAGEMENT, URBANISME ET DÉVELOPPEMENT section with:
 *   - Avis de motion et dépôt du projet de règlement 26-433 (occupation des bâtiments)
 *   - Avis de motion de dépôt du projet de règlement 26-434 sur le zonage ← DÉTECTION
 *   - Adoption du premier projet de règlement 26-434 modifiant le règlement de zonage
 *   - Avis de motion du dépôt du projet de règlement 26-435 (permis et certificats)
 *   - Adoption du premier projet de règlement 26-435
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("Avis de motion est par la présente donnée" pour 26-434)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "Avis de motion est par la présente donnée par le conseiller Florent Raymond
 *     qu'un règlement sera soumis...Règlement amendant le règlement de zonage
 *     20-366 afin de modifier les normes d'abattage d'arbres"
 *     REGLEMENT_NUMBER_RE matches "26-434" (2+3 digits format).
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage 20-366" / "règlement de zonage".
 *     "20-366" excluded as modified bylaw by filterNewReglements logic.
 *     reglementNumbers: ["26-434"]
 */
export const PV_SAINT_ALEXANDRE_2026_03_TEXT = `AMÉNAGEMENT, URBANISME ET DÉVELOPPEMENT

SÉANCE ORDINAIRE DU 2 MARS 2026
MUNICIPALITÉ DE SAINT-ALEXANDRE
MRC DU HAUT-RICHELIEU

Service de l'urbanisme - Rapport
Le rapport des permis du mois de février 2026, émis par l'inspectrice municipale, madame Louise
Nadeau, totalisant onze (11) permis est déposé devant le conseil.

26-03-69

Nomination des membres citoyens du comité consultatif d'urbanisme
Il est proposé par la conseillère Marie-Eve Denicourt, appuyée par le conseiller Jean-François
Berthiaume et résolu :
DE renouveler le mandat de deux membres citoyens, soient messieurs Maxime Bourgeois et
René Bessette, pour un terme de deux ans au sein du comité consultatif d'urbanisme.
Adoptée à l'unanimité

Avis & Dépôt

Avis de motion et dépôt du projet de règlement 26-433 sur l'occupation et l'entretien des
bâtiments
Avis de motion est par la présente donnée par le conseiller Florent Raymond qu'un règlement sera
soumis à ce conseil à sa prochaine séance ou à une séance subséquente concernant l'occupation et
l'entretien des bâtiments.
Conformément aux dispositions de l'article 445 du Code municipal du Québec, le conseiller Florent
Raymond dépose une copie du projet de règlement 26-433, Règlement sur l'occupation et l'entretien
des bâtiments.
Une consultation publique sur le règlement se tiendra le lundi 23 mars à 19h00 à l'Hôtel de Ville de
Saint-Alexandre.

Avis & Dépôt

Avis de motion de dépôt du projet de règlement 26-434 sur le zonage
Avis de motion est par la présente donnée par le conseiller Florent Raymond qu'un règlement sera
soumis à ce conseil à sa prochaine séance ou à une séance subséquente concernant des
modifications au règlement de zonage.
Conformément aux dispositions de l'article 445 du Code municipal du Québec, le conseiller Florent
Raymond dépose une copie du projet de règlement 26-434, Règlement amendant le règlement de
zonage 20-366 afin de modifier les normes d'abattage d'arbres et de faire certaines corrections.

26-03-70

Adoption du premier projet de règlement 26-434 modifiant le règlement de zonage
CONSIDÉRANT QUE la Municipalité de Saint-Alexandre a adopté un règlement sur le zonage;
CONSIDÉRANT QUE la Loi sur l'aménagement et l'urbanisme permet à une municipalité de modifier
ce règlement;
CONSIDÉRANT QUE le conseil municipal trouve pertinent de procéder à la modification de son
règlement de zonage no. 20-366 afin d'y apporter certains ajustements;
CONSIDÉRANT QUE la modification proposée est conforme aux objectifs du plan d'urbanisme;
CONSIDÉRANT QUE le conseil municipal a reçu des demandes de modifications réglementaires;
CONSIDÉRANT QU'un avis de motion a été donné par le conseiller Florent Raymond lors de la
séance du 2 mars 2026;
Il est proposé par le conseiller Michaël Roy, appuyé par la conseillère Marie-Eve Denicourt et résolu :
QUE le conseil municipal de Saint-Alexandre adopte le premier projet de règlement 26-434,
Règlement amendant le règlement de zonage 20-366 afin de modifier les normes d'abattage
d'arbres et de faire certaines corrections;
QUE le projet de règlement soit transmis à la MRC du Haut-Richelieu;
QU'une consultation publique sur le projet de règlement ait lieu le lundi 23 mars 2026 à 19h00 à
l'Hôtel de Ville de Saint-Alexandre.
Adoptée à l'unanimité`;
