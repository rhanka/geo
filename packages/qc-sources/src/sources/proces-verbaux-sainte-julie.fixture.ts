/**
 * Real procès-verbaux fixture data for Sainte-Julie (MRC Marguerite-D'Youville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://saintejulie.ca/administration/seances-publiques
 *     HTTP 200, 204 321 bytes, public / no login.
 *     robots.txt: 404 (no robots.txt, permissive by default).
 *     Custom CMS (saintejulie.ca) with accordeon structure for PV lists.
 *   - PV PDF (March 10, 2026):
 *     https://saintejulie.ca/uploads/html_content/Séances%20publiques/2026-03-10_-_Proces-verbal.pdf
 *     HTTP 200, 526 KB (PDF), extracted via pdftotext → ~100 KB.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINTE_JULIE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (custom CMS accordeon structure: 2026 section + 2025 section with direct PDF links).
 *   2. PV_SAINTE_JULIE_2026_03_TEXT — pdftotext excerpt from March 10, 2026 PV.
 *      Contains "avis de motion" for one real zonage change:
 *        - Règlement 1101-132 modifiant le Règlement de zonage 1101 afin de modifier
 *          la grille des usages et des normes de la zone C-150.
 *
 * PARSER SUPPORT: Sainte-Julie uses règlement numbering NNNN-NNN format (1101-132).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "1101-132" directly (4+3 digits).
 *   "1101" alone (the base zonage bylaw) is not hyphenated so is not matched by
 *   MODIFIANT_REGLEMENT_RE (which requires \d{2,4}-\d{1,4} form).
 *   "Règlement de zonage 1101" is referenced → ZONAGE_KEYWORDS_RE fires.
 *   filterNewReglements returns ["1101-132"] (the new amendment).
 *   Result: avisDeMotion=true, reglementNumbers=["1101-132"], changementZonage=true.
 *   ZERO false positive: 1101-132 genuinely modifies the zonage bylaw.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://saintejulie.ca/ → HTTP 200 (custom CMS)
 *   - robots.txt → HTTP 404 (no restrictions file; permissive by default)
 *   - All uploads/html_content PDFs are publicly accessible.
 *
 * IMPORTANT: The index URL uses percent-encoded path:
 *   https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/YYYY-MM-DD_-_Proces-verbal.pdf
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Sainte-Julie,
 * captured 2026-06-10 from:
 * https://saintejulie.ca/administration/seances-publiques
 *
 * Custom CMS "accordeon" structure. Two <li> items visible:
 *   - "Procès-verbaux des séances tenues en 2026": 7 individual PV PDF links (Jan–Apr 2026)
 *   - "Procès-verbaux des séances tenues en 2025": 20 individual PV PDF links (Jan–Dec 2025)
 *
 * Key 2026 PV PDF links:
 *   2026-01-13, 2026-01-26, 2026-02-10, 2026-03-10, 2026-03-30, 2026-04-14, 2026-04-27
 *
 * Key 2025 PV PDF links (selected):
 *   2025-01-14, 2025-02-11, 2025-03-11, 2025-12-16 (budget), 2025-12-18
 */
export const PV_SAINTE_JULIE_INDEX_HTML = `
<ul class="accordeon">
  <li class="accordeon__content">
    <div class="accordeon__subject">
      <h1 class="accordeon__title">Proc&egrave;s-verbaux des s&eacute;ances tenues en 2026</h1>
    </div>
    <div class="accordeon__description content__wysiwyg">
      <p>
        <a title="2026-01-13_-_Proces-verbal.pdf (398 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-01-13_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-01-13 - S&eacute;ance ordinaire du 13 janvier 2026</a><br />
        <a title="2026-01-26_-_Proces-verbal.pdf (199 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-01-26_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-01-26 - S&eacute;ance extraordinaire du 26 janvier 2026</a><br />
        <a title="2026-02-10_-_Proces-verbal.pdf (448 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-02-10_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-02-10 - S&eacute;ance ordinaire du 10 f&eacute;vrier 2026</a><br />
        <a title="2026-03-10_-_Proces-verbal.pdf (526 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-03-10_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-03-10 - S&eacute;ance ordinaire du 10 mars 2026</a><br />
        <a title="2026-03-30_-_Proces-verbal.pdf (311 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-03-30_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-03-30 - S&eacute;ance extraordinaire du 30 mars 2026</a><br />
        <a title="2026-04-14_-_Proces-verbal.pdf (517 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-04-14_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-04-14 - S&eacute;ance ordinaire du 14 avril 2026</a><br />
        <a title="2026-04-27_-_Proces-verbal.pdf (198 KB)" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-04-27_-_Proces-verbal.pdf" target="_blank" rel="noopener">2026-04-27 - S&eacute;ance extraordinaire du 27 avril 2026</a>
      </p>
    </div>
  </li>
  <li class="accordeon__content">
    <div class="accordeon__subject">
      <h1 class="accordeon__title">Proc&egrave;s-verbaux des s&eacute;ances tenues en 2025</h1>
    </div>
    <div class="accordeon__description content__wysiwyg">
      <p>
        <a title="2025-01-14_-_Proces-verbal.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-01-14_-_Proces-verbal.pdf" target="_blank" rel="noopener">2025-01-14 - S&eacute;ance ordinaire du 14 janvier 2025</a><br />
        <a title="2025-01-27_-_Proces-verbal.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-01-27_-_Proces-verbal.pdf" target="_blank" rel="noopener">2025-01-27 - S&eacute;ance extraordinaire du 27 janvier 2025</a><br />
        <a title="2025-02-11_-_Proces-verbal.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-02-11_-_Proces-verbal.pdf" target="_blank" rel="noopener">2025-02-11 - S&eacute;ance ordinaire du 11 f&eacute;vrier 2025</a><br />
        <a title="2025-03-11_-_Proces-verbal.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-03-11_-_Proces-verbal.pdf" target="_blank" rel="noopener">2025-03-11 - S&eacute;ance ordinaire du 11 mars 2025</a><br />
        <a title="2025-05-05_-_Proces-verbal_corrige.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-05-05_-_Proces-verbal_corrige.pdf" target="_blank" rel="noopener">2025-05-05 - S&eacute;ance ordinaire du 5 mai 2025 (corrig&eacute;)</a><br />
        <a title="2025-12-16_-_Proces-verbal_corrige_-_Budget.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-12-16_-_Proces-verbal_corrige_-_Budget.pdf" target="_blank" rel="noopener">2025-12-16 - S&eacute;ance extraordinaire du 16 d&eacute;cembre 2025 (Budget)</a><br />
        <a title="2025-12-18_-_Proces-verbal.pdf" href="https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2025-12-18_-_Proces-verbal.pdf" target="_blank" rel="noopener">2025-12-18 - S&eacute;ance ordinaire du 18 d&eacute;cembre 2025</a>
      </p>
    </div>
  </li>
</ul>
`;

/**
 * Real pdftotext excerpt from Sainte-Julie PV March 10, 2026.
 * Source: https://saintejulie.ca/uploads/html_content/Séances%20publiques/2026-03-10_-_Proces-verbal.pdf
 * Captured: 2026-06-10
 *
 * Contains avis de motion for ONE real zonage change:
 *   - Règlement 1101-132 modifiant le Règlement de zonage 1101 afin de modifier
 *     la grille des usages et des normes de la zone C-150 relativement à diverses
 *     dispositions (adopted as first project at the same session).
 *
 * Non-zonage motions also present:
 *   - Règlement 1084-14 (limite de vitesse) — NOT zonage
 *   - Règlement 1282-3 (subvention mazout) — NOT zonage
 *   - Règlement 1358 (travaux cours d'eau) — NOT zonage
 *   - Règlement 1354-1 (taxation) — NOT zonage
 *   - Règlement 1360 (occupation bâtiments) — NOT zonage
 *   - Règlement 1102-13 (règlement de construction) — NOT zonage
 *
 * DETECTION:
 *   "Avis de motion est donné...le Règlement 1101-132 modifiant le Règlement de
 *   zonage 1101 afin de modifier la grille des usages et des normes de la zone C-150"
 *   → REGLEMENT_NUMBER_RE matches "1101-132" (4+3 digit format)
 *   → ZONAGE_KEYWORDS_RE fires on "Règlement de zonage 1101"
 *   → filterNewReglements: "1101" base bylaw not in modifiedNums set (no hyphen)
 *   → reglementNumbers=["1101-132"], changementZonage=true, zoneRefs=["C-150"]
 *   ZERO false positive: confirmed genuine zonage modification.
 */
export const PV_SAINTE_JULIE_2026_03_TEXT = `
Procès-verbal de la quatrième (4e) séance du conseil municipal de la Ville de Sainte-Julie,
tenue le mardi 10 mars 2026 à 19 h 30.

26-104 11.1. Avis de motion et dépôt d'un projet de règlement – Règlement 1084-14
modifiant le Règlement 1084 fixant les limites de vitesse permises sur le
territoire de la Ville de Sainte-Julie afin de réduire la limite de vitesse
à 60 km/h sur un tronçon du chemin de la Belle-Rivière

26-105 11.2.  Avis de motion et dépôt d'un projet de règlement – Règlement 1282-3
modifiant le Règlement 1282 visant l'instauration d'un programme de
subvention pour favoriser le remplacement de systèmes de chauffage
résidentiels au mazout relativement à diverses dispositions

26-110 11.7. Avis de motion et adoption d'un premier projet de règlement –
Règlement 1101-132 modifiant le Règlement de zonage 1101 afin de modifier
la grille des usages et des normes de la zone C-150 relativement à diverses
dispositions

AVIS DE MOTION ET DÉPÔT D'UN PROJET DE RÈGLEMENT –
RÈGLEMENT 1084-14 MODIFIANT LE RÈGLEMENT 1084 FIXANT LES LIMITES DE
VITESSE PERMISES SUR LE TERRITOIRE DE LA VILLE DE SAINTE-JULIE AFIN DE
RÉDUIRE LA LIMITE DE VITESSE À 60 KM/H SUR UN TRONÇON DU CHEMIN DE LA
BELLE-RIVIÈRE
Avis de motion est donné par M. Sylvain Dubuc que le Règlement 1084-14 modifiant le
Règlement 1084 fixant les limites de vitesse permises sur le territoire de la Ville de
Sainte-Julie afin de réduire la limite de vitesse à 60 km/h sur un tronçon du chemin de la
Belle-Rivière sera présenté pour adoption à une prochaine séance du conseil.
Le projet de règlement 1084-14 est déposé séance tenante par ce membre du conseil.

26-110
AVIS DE MOTION ET ADOPTION D'UN PREMIER PROJET DE RÈGLEMENT –
RÈGLEMENT 1101-132 MODIFIANT LE RÈGLEMENT DE ZONAGE 1101 AFIN DE
MODIFIER LA GRILLE DES USAGES ET DES NORMES DE LA ZONE C-150
RELATIVEMENT À DIVERSES DISPOSITIONS
Avis de motion est donné par Mme Edith Lalanne que le Règlement 1101-132 modifiant
le Règlement de zonage 1101 afin de modifier la grille des usages et des normes de la
zone C-150 relativement à diverses dispositions sera présenté pour adoption à une
séance distincte du conseil;
ATTENDU QU'il y a lieu de modifier la grille des usages et des normes de la zone C-150,
figurant à l'Annexe A du Règlement de zonage 1101, afin d'apporter des précisions quant
aux usages permis dans cette zone;
ATTENDU QUE ce projet de règlement contient des dispositions susceptibles
d'approbation référendaire;
Il est PROPOSÉ par Mme Edith Lalanne APPUYÉ par Mme Lucie Bisson
RÉSOLU :
D'adopter le premier projet du Règlement 1101-132 modifiant le Règlement de
zonage 1101 afin de modifier la grille des usages et des normes de la zone C-150
relativement à diverses dispositions;
DE présenter ce projet de règlement lors d'une assemblée publique de consultation qui
se tiendra le 13 avril 2026 dans la salle du conseil de l'hôtel de ville de Sainte-Julie;
DE transmettre copie de la présente résolution et de ce projet de règlement à la
Municipalité régionale de comté de Marguerite-D'Youville.
ADOPTÉE À L'UNANIMITÉ DES CONSEILLERS
`;
