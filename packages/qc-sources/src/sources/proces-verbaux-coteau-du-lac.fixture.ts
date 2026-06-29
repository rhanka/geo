/**
 * Real procès-verbaux fixture data for Coteau-du-Lac (MRC Vaudreuil-Soulanges) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://coteau-du-lac.com/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux
 *     HTTP 200, public / no login. October CMS with storage/app/media paths.
 *     robots.txt: Disallow /administration, /administration/ — content pages allowed.
 *   - PV PDF (April 14, 2026):
 *     https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO14avril2026-version-approuve.pdf
 *     HTTP 200, 875 726 bytes (PDF), extracted via pdftotext → 85 330 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_COTEAU_DU_LAC_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (direct absolute PDF links under /storage/app/media/…/proces-verbaux/2026/).
 *   2. PV_COTEAU_DU_LAC_2026_04_TEXT — pdftotext excerpt from the real April 14, 2026 PV.
 *      Contains "AVIS DE MOTION est donné" for modification des grilles des usages
 *      et des normes des zones RO-2, RO-3, RO-4, RO-5 et RO-7 du Règlement de
 *      zonage no URB-400.
 *
 * Expected detection (honest — anti-invention):
 *   - avisDeMotion: true ("AVIS DE MOTION est donné" for zones RO-2..RO-7)
 *   - changementZonage: true ("Règlement de zonage no URB-400" cited in same item
 *     as the avis de motion — URB-400 is the zonage règlement being amended)
 *   - reglementNumbers: ["URB-400"] (letter-prefix zonage règlement number)
 *   - zoneRefs: ["RO-2", "RO-3", "RO-4", "RO-5", "RO-7"] (zones cited in avis)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://coteau-du-lac.com/ → HTTP 200
 *   - robots.txt: Disallow /administration — content/media pages allowed.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Coteau-du-Lac,
 * captured 2026-06-10 from:
 * https://coteau-du-lac.com/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux
 *
 * Structure: direct absolute PDF links under /storage/app/media/.../proces-verbaux/2026/
 * 10 PV links for 2026 (January through May 12, 2026 — not yet approved).
 */
export const PV_COTEAU_DU_LAC_INDEX_HTML = `
<ul>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/PROJET_SO12mai2026-version-non-approuve.pdf">Séance ordinaire du conseil Mardi 12 mai 2026 (non approuvé)</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSE28avril2026-version-approuve.pdf">Séance extraordinaire du conseil Mardi 28 avril 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO14avril2026-version-approuve.pdf">Séance ordinaire du conseil Mardi 14 avril 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSE24mars2026-version-approuve.pdf">Séance extraordinaire du conseil Mardi 24 mars 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO10mars2026-version-approuve.pdf">Séance ordinaire du conseil Mardi 10 mars 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSE3mars2026.pdf">Séance extraordinaire du conseil Mardi 3 mars 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO10fevrier2026.pdf">Séance ordinaire du conseil Mardi 10 février 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSE10fevrier2026.pdf">Séance extraordinaire du conseil Mardi 10 février 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PV-SE19janvier2026.pdf">Séance extraordinaire du conseil Lundi 19 janvier 2026</a></li>
  <li><a href="https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO13janvier2026.pdf">Séance ordinaire du conseil Mardi 13 janvier 2026</a></li>
</ul>
`;

/**
 * Real pdftotext excerpt from Coteau-du-Lac PV April 14, 2026.
 * Source: https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO14avril2026-version-approuve.pdf
 * Captured: 2026-06-10
 *
 * Contains:
 *   - Resolution 159-04-2026: "AVIS DE MOTION est donné par Monsieur Alexis Buisson"
 *     for modification des grilles des usages et des normes des zones RO-2, RO-3,
 *     RO-4, RO-5 et RO-7 du Règlement de zonage no URB-400 — REAL zonage change.
 *   - Resolution 160-04-2026: Arrêt définitif du processus (council votes to STOP
 *     the process) — also references the same avis de motion.
 *
 * Expected detection:
 *   - avisDeMotion: true ("AVIS DE MOTION est donné" for Règlement de zonage no URB-400)
 *   - changementZonage: true (Règlement de zonage no URB-400 in same item as avis)
 *   - reglementNumbers includes URB-400 (letter-prefix zonage bylaw number)
 *   - zoneRefs includes RO-2, RO-3, RO-4, RO-5, RO-7
 */
export const PV_COTEAU_DU_LAC_2026_04_TEXT = `
PROCÈS-VERBAUX DES DÉLIBÉRATIONS DU CONSEIL
DE LA VILLE DE COTEAU-DU-LAC

Approuvé à la séance ordinaire du 12 mai 2026 par sa résolution #191-05-2026

PROVINCE DE QUÉBEC
MRC DE VAUDREUIL-SOULANGES
Séance ordinaire du conseil de la Ville de Coteau-du-Lac, tenue le 14 avril 2026
au Pavillon Wilson, à 19 h, et à laquelle sont présents la mairesse, Madame
Andrée Brosseau, et les conseiller(-ère)s suivant(e)s : Messieurs Sébastien
Daoust-Charest, François Décosse, Alexis Buisson, David-Lee Amos et Patrick
Delforge, le tout formant quorum sous la présidence de la mairesse Madame
Andrée Brosseau.

136-04-2026
Validation et adoption de l'ordre du jour
ATTENDU QUE la présente séance ordinaire a été transmise aux membres du conseil conformément
à l'article 16 du Règlement no 357 « Règlement sur la régie interne des séances du conseil de la Ville
de Coteau-du-Lac »;
Il est proposé par le conseiller Monsieur François Décosse,
Et résolu
QUE,
le conseil approuve l'ordre du jour tel que modifié par l'ajout des points suivants :
6.3. Procédures relatives aux règlements
Arrêt définitif du processus de modification du plan d'urbanisme et des règlements
d'urbanisme applicables aux zones RO-2, RO-3, RO-4, RO-5 et RO-7
ADOPTÉE à l'unanimité

159-04-2026
Avis de motion. Modification des grilles des usages et des normes des zones RO-2, RO-3, RO-4,
RO-5 et RO-7 du Règlement de zonage no URB-400

AVIS DE MOTION est donné par Monsieur Alexis Buisson, conseiller municipal à l'effet qu'un
règlement avec dispense de lecture sera déposé à une séance ultérieure pour adoption afin de modifier
les usages autorisés, le type de bâtiment autorisé et la dimension de lot des grilles des usages et des
normes des zones RO-2, RO-3, RO-4, RO-5 et RO-7 comme suit :
ZONE RO-2
Usages autorisés :
AVANT                  APRÈS
Habitation unifamiliale (H1)   Conservation
Parc et espace vert (R1-01)    Aucun

ZONE RO-3
Usages autorisés :
AVANT                  APRÈS
Habitation unifamiliale (H1)   Conservation
Parc et espace vert (R1-01)    Aucun

160-04-2026
Arrêt définitif du processus de modification du plan d'urbanisme et des règlements d'urbanisme
applicables aux zones RO-2, RO-3, RO-4, RO-5 et RO-7
CONSIDÉRANT QU'un avis de motion a été déposé par le conseiller Monsieur Alexis Buisson afin de
mettre en place des amendements réglementaires afin de modifier le plan d'urbanisme et les usages
autorisés et les normes applicables aux zones RO-2, RO-3, RO-4, RO-5 et RO-7 ;
CONSIDÉRANT QUE le Conseil municipal souhaite maintenir les usages autorisés actuellement en
vertu du règlement de zonage qui sont applicables à ces zones et ne rien modifier d'autre dans la
réglementation d'urbanisme ;
CONSIDÉRANT QUE le Conseil juge qu'il n'est pas opportun de poursuivre le processus de modification
du plan d'urbanisme et des règlements d'urbanisme ;
Il est proposé par le conseiller Monsieur David-Lee Amos,
Et résolu
QUE,
le Conseil municipal s'oppose, par la présente résolution, de donner suite au processus d'adoption
de règlements visant à modifier le plan d'urbanisme ainsi les usages autorisés et les normes applicables
en vertu de l'actuel règlement de zonage aux zones RO-2, RO-3, RO-4, RO-5 et RO-7, notamment afin
de convertir des zones où la construction résidentielle est possible en zones de conservation ;
et met définitivement un terme au processus de modification du plan d'urbanisme et des règlements
d'urbanisme initié par l'avis de motion déposé ce jour par le conseiller Monsieur Alexis Buisson.
ADOPTÉE à l'unanimité
`;
