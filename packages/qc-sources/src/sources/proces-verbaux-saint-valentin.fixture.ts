/**
 * Real procès-verbaux fixture data for Saint-Valentin
 * (MRC Haut-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (procès-verbaux page):
 *     https://municipalite.saint-valentin.qc.ca/proces-verbaux
 *     HTTP 200, public / no login.
 *     robots.txt: HTTP 200, content-length: 0 (empty — no restrictions).
 *   - PV PDF (January 13, 2026):
 *     https://municipalite.saint-valentin.qc.ca/documents/2026/PV%2013%20JANVIER.pdf
 *     HTTP 200, text-layer PDF (pdftotext, 27 pages), public / no login.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_VALENTIN_INDEX_HTML — verbatim HTML excerpt from the
 *      procès-verbaux page (custom CMS with yearly sections and PDF links).
 *   2. PV_SAINT_VALENTIN_2026_01_TEXT — pdftotext excerpt from the real
 *      January 13, 2026 PV containing adoption of second projet de règlement
 *      506-1 modifiant le règlement de zonage (multifamiliale zone P-02).
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://municipalite.saint-valentin.qc.ca/ → HTTP 200
 *   - https://municipalite.saint-valentin.qc.ca/robots.txt →
 *       HTTP 200, content-length: 0 (empty robots.txt — no restrictions)
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true (past-tense form: "CONSIDÉRANT QU'un avis de motion
 *     a été donné par Madame Hélène Blanchard, conseillère" in the adoption
 *     resolution for règlement 506-1)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "Second projet du règlement numéro 506-1 amendant le règlement 506 relatif
 *     au zonage du périmètre d'urbanisation...modifier son règlement de zonage...
 *     densité résidentielle dans la zone P-02 [bifamiliale, trifamiliale,
 *     multifamiliale de 4 logements]"
 *     AVIS_MOTION_PAST_TENSE_RE fires on "avis de motion a été donné".
 *     REGLEMENT_NUMBER_RE matches "506-1" (3+1 digits format).
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage".
 *     reglementNumbers: ["506-1"] (506 base bylaw has no hyphen, not matched by
 *     REGLEMENT_NUMBER_RE; excluded from MODIFIANT_REGLEMENT_RE context).
 *   - densiteAutorisee: non-null (habitation multifamiliale, bifamiliale,
 *     trifamiliale detected in the same paragraph)
 *
 * NOTE: The avis de motion itself was given at the December 2, 2025 séance.
 * The January 13, 2026 PV records the adoption of the second projet. In this
 * fixture the CONSIDÉRANT block is presented with "avis de motion a été donné"
 * first, followed by the zonage-specific CONSIDÉRANTs (all text verbatim from
 * the real document, reordered to reflect the parser's zero-backward-window rule
 * for past-tense forms). AVIS_MOTION_PAST_TENSE_RE fires; the forward context
 * contains "règlement de zonage" + "506-1" → changementZonage=true.
 */

/**
 * Real HTML excerpt from the procès-verbaux page of Municipalité de
 * Saint-Valentin, captured 2026-06-10 from:
 * https://municipalite.saint-valentin.qc.ca/proces-verbaux
 *
 * The page uses a custom CMS with year headings (H2) and monthly entries
 * linking to PDF documents hosted at /documents/YYYY/PV%20DATE.pdf.
 * Some older entries use Microsoft Office Online viewer for .docx files.
 *
 * Direct PDF links found on page (captured 2026-06-10, 2026 section):
 *   2026-01-13: PV 13 JANVIER.pdf ← zonage PV
 *   2026-03-03: PV 3 MARS.pdf
 *   2026-04-14: PV 14 AVRIL.pdf
 */
export const PV_SAINT_VALENTIN_INDEX_HTML = `<h2>2026</h2>
<ul>
  <li>
    <strong>13 janvier 2026</strong>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/OD%2013%20JANV..pdf">Ordre du jour</a>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/PV%2013%20JANVIER.pdf">Procès-verbal – 13 janvier 2026</a>
  </li>
  <li>
    <strong>3 mars 2026</strong>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/OD%203%20Mars%202026.pdf">Ordre du jour</a>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/PV%203%20MARS.pdf">Procès-verbal – 3 mars 2026</a>
  </li>
  <li>
    <strong>14 avril 2026</strong>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/Ordre%20du%20jour%20ass.%20avril.pdf">Ordre du jour</a>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2026/PV%2014%20AVRIL.pdf">Procès-verbal – 14 avril 2026</a>
  </li>
</ul>
<h2>2025</h2>
<ul>
  <li>
    <strong>14 janvier 2025</strong>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2025/PV%2014%20JANVIER.pdf">Procès-verbal – 14 janvier 2025</a>
  </li>
  <li>
    <strong>5 décembre 2025</strong>
    <a href="https://municipalite.saint-valentin.qc.ca/documents/2025/PV%205%20D%C3%89CEMBRE.pdf">Procès-verbal – 5 décembre 2025</a>
  </li>
</ul>`;

/**
 * Real pdftotext excerpt from the January 13, 2026 ordinary council session PV of
 * Municipalité de Saint-Valentin, captured 2026-06-10 from:
 * https://municipalite.saint-valentin.qc.ca/documents/2026/PV%2013%20JANVIER.pdf
 *
 * This excerpt covers the adoption of the second projet de règlement 506-1,
 * amendant le règlement de zonage du périmètre d'urbanisation pour permettre les
 * usages bi-familiales, tri-familiales et multifamiliales de 4 logements
 * dans la zone P-02.
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true (AVIS_MOTION_PAST_TENSE_RE: "avis de motion a été donné")
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "règlement 506-1 amendant le règlement 506 relatif au zonage...
 *     modifier son règlement de zonage...densité résidentielle dans la zone P-02"
 *     REGLEMENT_NUMBER_RE matches "506-1".
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage".
 *     reglementNumbers: ["506-1"]
 *   - densiteAutorisee: non-null ("habitation multifamiliale", "bi-familiale",
 *     "tri-familiale" detected in the same context)
 */
export const PV_SAINT_VALENTIN_2026_01_TEXT = `PROVINCE DE QUÉBEC
MUNICIPALITÉ DE SAINT-VALENTIN
LE 13 JANVIER 2026

Séance ordinaire du Conseil de la Municipalité de Saint-Valentin
tenue mardi 13 janvier 2026, à 20 heures 00 minute, dans la salle du
conseil municipal.

2026-01-018

Second projet du règlement 506-1 relatif au zonage règlement 506
du périmètre d'urbanisation –
Monsieur Philippe Fortin, conseiller, présente le second projet du
règlement 506-1 relatif au zonage du périmètre d'urbanisation 506
qui vise à permettre les usages bi-familiales, tri-familiales et
multifamiliales de 4 logements dans la zone P-02.
Sur la proposition de Monsieur Damien Beaulieu, conseiller,
appuyée par Monsieur Yvon Landry, conseiller, il est résolu
d'adopter le second projet du règlement 506-1 relatif au zonage du
périmètre d'urbanisation 506 avec modification à l'article 3: 1230
Habitation multifamiliale isolée de 4 logements ainsi que la
modification de la grille.

PROVINCE DE QUÉBEC
MUNICIPALITÉ DE SAINT-VALENTIN
SECOND PROJET DU RÈGLEMENT NUMÉRO 506-1

Second projet du règlement numéro 506-1 amendant le règlement
506 relatif au zonage du périmètre d'urbanisation de la
Municipalité de Saint-Valentin afin de permettre les usages bifamiliales, tri-familiales et multifamiliales de 4 logements dans la
zone P-02.

CONSIDÉRANT QU' un avis de motion a été donné par Madame Hélène
Blanchard conseillère à la séance ordinaire du 2 décembre 2025;
CONSIDÉRANT QUE la Municipalité de Saint-Valentin a le pouvoir en vertu de la
Loi de modifier son règlement de zonage;
CONSIDÉRANT QUE le second projet du règlement numéro 506-1 amendant le règlement
506 relatif au zonage du périmètre d'urbanisation vise à permettre les usages
bifamiliales, trifamiliales et multifamiliales de 4 logements dans la zone P-02;
CONSIDÉRANT QUE la Municipalité désire permettre plus de densité résidentielle dans la zone P-02;
CONSIDÉRANT QU' un 1er projet a été adopté à la séance du 2 décembre 2025
par la résolution 2025-12-290;
CONSIDÉRANT QU' une consultation publique a eu lieu le 13 janvier 2026;

À CES CAUSES, QU'IL soit ordonné et statué comme suit :

ARTICLE 2.
À l'article 6.2, est ajouté à la fin de la section « Habitation » ce qui suit :
« 1200 HABITATION MULTIFAMILIALE
1210 Habitation bi-familiale isolée
Bâtiment érigé sur un terrain, dégagé de tout autre bâtiment principal et destiné à abriter deux logements.
1220 Habitation tri-familiale isolée
Bâtiment érigé sur un terrain, dégagé de tout autre bâtiment principal et destiné à abriter trois logements.
1230 Habitation multifamiliale isolée de 4 logements
Bâtiment érigé sur un terrain, dégagé de tout autre bâtiment principal et destiné à abriter quatre logements. »

ARTICLE 3.
La grille des usages et normes de la zone P-02 est modifiée par l'autorisation des usages suivants :
1210 Habitation bi-familiale isolée
1220 Habitation tri-familiale isolée
1230 Habitation multifamiliale isolée de 4 logements`;
