/**
 * Real procès-verbaux fixture data for Saint-Damase unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL text is copied verbatim from PUBLIC documents fetched 2026-06-10 from
 * https://www.st-damase.qc.ca/proces-verbaux/
 * Nothing is fabricated. Only excerpts are included (not full PDFs) to keep
 * fixture size reasonable. Each section is labelled with its source URL and
 * the date it was fetched.
 *
 * TWO fixtures are provided:
 *   1. POSITIVE — May 2025 PV: contains an "avis de motion" for Règlement 38-41
 *      modifying the "règlement de zonage" (zone 404 industrial zoning). This is
 *      the real PV where the zonage change was first announced.
 *      Source: https://www.st-damase.qc.ca/wp-content/uploads/2025/05/Proces-verbal-manuscrit-6-mai.pdf
 *      Fetched: 2026-06-10
 *
 *   2. NEGATIVE — March 2026 PV: contains an "avis de motion" for Règlement 158
 *      (building maintenance / occupancy rules) — NO zonage change.
 *      Source: https://www.st-damase.qc.ca/wp-content/uploads/2026/03/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-03-03_N_P.pdf
 *      Fetched: 2026-06-10
 */

/**
 * POSITIVE fixture — excerpt from the real May 2025 PV.
 *
 * Detection expected:
 *   avisDeMotion: true
 *   reglementNumbers: ["38-41"]
 *   changementZonage: true   (explicit "règlement de zonage" in context)
 *   excerpts: non-empty
 */
export const PV_SAINT_DAMASE_2025_05_POSITIVE = `PROVINCE DE QUÉBEC
MRC DES MASKOUTAINS
MUNICIPALITÉ DE SAINT-DAMASE
SÉANCE ORDINAIRE DU 6 MAI 2025

ADOPTION DE RÈGLEMENTS
AM 2025-05-104 12. AVIS DE MOTION - RÈGLEMENT 38-41 MODIFIANT LE RÈGLEMENT DE ZONAGE

CONCERNANT LES USAGES PERMIS DANS TOUTE PARTIE D'UNE CONSTRUCTION DANS LA
ZONE NUMÉRO 404 MODIFIANT LE RÈGLEMENT DE ZONAGE
Avis de motion est donné par Yves Monast, qu'il présentera pour adoption, lors d'une
séance ultérieure du conseil, le règlement numéro 38-41 modifiant le règlement de
zonage.
L'objet de ce règlement est de prévoir que, dans la zone à vocation industrielle numéro 404,
les espaces voués directement à la production industrielle doivent occuper un minimum de
60 % de la superficie totale de plancher du bâtiment. La zone 404 est située en bordure
sud de la rue Sainte-Anne, à proximité de la jonction avec la rue Saint-Joseph.
QUE le conseil accorde une dispense de lecture puisqu'une copie du projet de règlement
est remise aux membres du conseil avant l'adoption.
R 2025-05-105 13. ADOPTION DU PREMIER PROJET DE RÈGLEMENT 38-41 - RÈGLEMENT MODIFIANT LE
RÈGLEMENT DE ZONAGE CONCERNANT LES USAGES PERMIS DANS TOUTE PARTIE D'UNE
CONSTRUCTION DANS LA ZONE NUMÉRO 404
CONSIDÉRANT QUE le conseil municipal entend privilégier le maintien d'activités liées à la
production industrielle dans les bâtiments situés dans la zone numéro 404;
CONSIDÉRANT QU' un avis de motion du présent règlement a été donné lors de la séance
du conseil municipal tenue le 6 mai 2025, conformément à la loi, par Yves Monast;
CONSIDÉRANT QU' une demande de dispense de lecture du règlement fut faite lorsque
l'avis de motion fut donné;
EN CONSÉQUENCE, il est proposé par Guy Leroux, appuyé par Gaétan Jodoin, et résolu à
l'unanimité des conseillers présents:
QUE le conseil adopte, lors de la séance du 6 mai 2025, le premier projet de règlement
numéro 38-41 intitulé "Règlement modifiant le règlement de zonage concernant les usages
permis dans toute partie d'une construction dans la zone numéro 404".

QU' une assemblée de consultation soit tenue mardi, le 3 juin 2025, à 19 h à la mairie, située
au 115, rue Saint-Étienne, afin d'expliquer le projet de règlement et d'entendre les
personnes et organismes qui désirent s'exprimer à ce sujet.
ADOPTÉE`;

/**
 * NEGATIVE fixture — excerpt from the real March 2026 PV.
 *
 * Detection expected:
 *   avisDeMotion: true
 *   reglementNumbers: ["158"]       (but no zonage keyword in context)
 *   changementZonage: false         (no "règlement de zonage" in motion context)
 *   excerpts: may be non-empty (motion found but no zonage context)
 */
export const PV_SAINT_DAMASE_2026_03_NEGATIVE = `PROVINCE DE QUÉBEC
MRC DES MASKOUTAINS
MUNICIPALITÉ DE SAINT-DAMASE
SÉANCE ORDINAIRE DU 3 MARS 2026

ADOPTION DE RÈGLEMENTS
AM 2026-03-49 8. AVIS DE MOTION ET PRÉSENTATION DU PROJET DE RÈGLEMENT NUMÉRO 158 SUR
L'OCCUPATION ET L'ENTRETIEN DES BÂTIMENTS
Avis de motion est donné par monsieur le conseiller, Francis Lacasse, à l'effet que lors d'une
prochaine séance, le Conseil adoptera, le Règlement numéro 158 concernant l'occupation
et l'entretien des bâtiments.
Le règlement a pour but notamment d'empêcher le dépérissement des bâtiments, assurer
leur protection contre les intempéries et préserver l'intégrité de leur structure selon la Loi
sur l'aménagement et l'urbanisme (RLRQ, c. A-19.1) articles 145.41 et suivants. Le Règlement
sur l'occupation et l'entretien des bâtiments doit s'appliquer aux immeubles patrimoniaux
au sens du paragraphe 1o de l'article 148.0.1 de la Loi sur l'aménagement et l'urbanisme.
Un projet de règlement est déposé séance tenante et des copies sont mises à la disposition
du public.`;

/**
 * Real HTML index page excerpt from https://www.st-damase.qc.ca/proces-verbaux/
 * Fetched: 2026-06-10
 *
 * Contains the accordion-embedded PV PDF links for 2026. Used to test
 * `parsePvIndex()` — the parser must extract at least the 2026 PV PDFs.
 */
export const PV_SAINT_DAMASE_INDEX_HTML = `<div class="accordian fusion-accordian"><div class="panel-group" id="accordion-192-1">
<div class="fusion-panel panel-default panel-62f59d2901aa63574"><div class="panel-heading"><h4 class="panel-title toggle"><a href="#62f59d2901aa63574">Procès-verbaux 2026</a></h4></div>
<div id="62f59d2901aa63574" class="panel-collapse collapse">
<div class="panel-body toggle-content fusion-clearfix">
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/01/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-01-12.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 12 janvier 2026 (séance extraordinaire)</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/02/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-01-20.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 20 janvier 2026</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/02/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-02-03_N_P-.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 3 février 2026</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/03/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-03-03_N_P.pdf" target="_blank" rel="noopener">Proces-verbal manuscrit 3 mars 2026</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/04/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-03-16_N_P.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 16 mars 2026</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/04/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2026-04-07_N_P.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 7 avril 2026</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2026/05/Proces-verbal-manuscrit-5-mai-2026.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 5 mai 2026</a></p>
</div></div></div>
<div class="fusion-panel panel-default panel-9a827f87cefc21872"><div class="panel-heading"><h4 class="panel-title toggle"><a href="#9a827f87cefc21872">Procès-verbaux 2025</a></h4></div>
<div id="9a827f87cefc21872" class="panel-collapse collapse">
<div class="panel-body toggle-content fusion-clearfix">
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2025/05/Proces-verbal-manuscrit-6-mai.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 6 mai 2025</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2025/06/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2025-06-03.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 3 juin 2025</a></p>
<p><a href="https://www.st-damase.qc.ca/wp-content/uploads/2025/07/Proces-verbaux-Conseil_Municipalite-St-Damase_Reunion-2025-07-08.pdf" target="_blank" rel="noopener">Procès-verbal manuscrit 8 juillet 2025</a></p>
</div></div></div>
</div></div>`;
