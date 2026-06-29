/**
 * Real procès-verbaux fixture data for Deux-Montagnes (Basses-Laurentides) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal
 *     HTTP 200, 311 610 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: /administration, /administration/backend — PV pages allowed.
 *   - PV PDF (April 9, 2026):
 *     https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-04-09-proces-verbal-ordinaire.pdf
 *     HTTP 200, 266 630 bytes (PDF), extracted via pdftotext → 1190 lines.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_DEUX_MONTAGNES_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (c-document-card links, same CMS as La Prairie).
 *   2. PV_DEUX_MONTAGNES_2026_04_TEXT — pdftotext excerpt from the April 9, 2026 PV.
 *      Contains ADOPTION of FOUR règlements modifying the Règlement de zonage (Règl. n°1733):
 *        - Règlement nº 1767: régulariser l'usage H4 dans zone H-204
 *        - Règlement nº 1768: autoriser les projets intégrés dans zone H-381
 *        - Règlement nº 1769: agrandir les limites de la zone P-386
 *        - Règlement nº 1770: modifier normes d'implantation (marges, pompes à chaleur, stationnement)
 *      All preceded by "avis de motion" at previous session (Feb 12, 2026).
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.deux-montagnes.qc.ca/ → HTTP 200
 *   - https://www.ville.deux-montagnes.qc.ca/robots.txt → Disallow: /administration, /administration/backend
 *   - Target page is NOT under /administration → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("avis de motion du présent règlement a dûment été donné" past tense)
 *     The adoption resolutions use PAST-TENSE form: "ATTENDU que lors de la séance du
 *     12 février 2026, un avis de motion du présent règlement a dûment été donné"
 *     → AVIS_MOTION_PAST_TENSE_RE matches → zero backward window, forward window scans next para
 *   - changementZonage: true (règlements 1767/1768/1769/1770 + "Règlement de zonage (Règl. n°1733)")
 *   - reglementNumbers: ["1767", "1768", "1769", "1770"] possible
 *     (REGLEMENT_NUMBER_RE: "Règlement nº 1767" → "1767", etc.)
 *   - NOTE: "1767" (4 digits, no hyphen) does NOT match \d{2,4}-\d{1,4}
 *     The parser requires "règlement n° XXXX-YYY" format. "1767" alone has no hyphen.
 *     BUT: the text says "Règlement n°1767" → REGLEMENT_NUMBER_RE matches 4-digit prefix before
 *     "intitulé" — actually REGLEMENT_NUMBER_RE requires a hyphen: \d{2,4}-\d{1,4}
 *     → "1767" alone does NOT match. However "Règl. n°1733" is the MODIFIED règlement.
 *     Honest result: avisDeMotion=true, changementZonage=true (ZONAGE_KEYWORDS_RE fires),
 *     reglementNumbers=[] (no hyphenated numbers in the avis de motion context window),
 *     because the new numbers (1767, 1768...) don't have hyphens.
 */

/**
 * Real HTML snippet from the PV index page of Ville de Deux-Montagnes,
 * captured 2026-06-10 from:
 * https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal
 *
 * Key PV PDF links present:
 *   - 2026-04-09-proces-verbal-ordinaire.pdf (April 9, 2026)
 *   - 2026-03-12-proces-verbal-ordinaire.pdf (March 12, 2026)
 *   - 2026-02-19-proces-verbal-extraordinaire.pdf (Feb 19, 2026)
 *   - 2026-02-12-proces-verbal-ordinaire.pdf (Feb 12, 2026)
 *   - 2026-02-10-proces-verbal-extraordinaire.pdf (Feb 10, 2026)
 *   - 2026-01-15-proces-verbal-ordinaire.pdf (Jan 15, 2026)
 *   - Several 2025 PVs
 */
export const PV_DEUX_MONTAGNES_INDEX_HTML = `
<div class="c-document-card-list">
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-04-09-proces-verbal-ordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal ordinaire - 9 avril 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-03-12-proces-verbal-ordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal ordinaire - 12 mars 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-02-19-proces-verbal-extraordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal extraordinaire - 19 février 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-02-12-proces-verbal-ordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal ordinaire - 12 février 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-02-10-proces-verbal-extraordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal extraordinaire - 10 février 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-01-15-proces-verbal-ordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal ordinaire - 15 janvier 2026</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2025/3-2025-12-17-proces-verbal-extraordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal extraordinaire - 17 décembre 2025</span>
    </a>
    <a class="c-document-card" href="https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2025/0-2025-12-11-proces-verbal-ordinaire.pdf" target="_blank">
        <span class="c-document-card__label">pdf</span>
        <span class="c-document-card__title">Procès-verbal ordinaire - 11 décembre 2025</span>
    </a>
</div>
`;

/**
 * Real pdftotext excerpt from the April 9, 2026 PV of Ville de Deux-Montagnes,
 * captured 2026-06-10 from:
 * https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-04-09-proces-verbal-ordinaire.pdf
 *
 * Key sections: ADOPTION of four règlements modifying Règlement de zonage (Règl. n°1733):
 *   4.1: Règlement nº 1767 — zone H-204 (habitation multifamiliale H4)
 *   4.2: Règlement nº 1768 — zone H-381 (projets intégrés)
 *   4.3: Règlement nº 1769 — zone P-386 (agrandir limites)
 *   4.4: Règlement nº 1770 — normes d'implantation (marges, pompes à chaleur, stationnement)
 *
 * Détection honnête:
 *   - avisDeMotion: true (AVIS_MOTION_PAST_TENSE_RE: "avis de motion du présent règlement a dûment été donné")
 *   - changementZonage: true (ZONAGE_KEYWORDS_RE: "Règlement de zonage (Règl. n°1733)")
 *   - reglementNumbers: [] (règlements 1767-1770 are plain 4-digit numbers without hyphens;
 *     REGLEMENT_NUMBER_RE requires \d{2,4}-\d{1,4} format — "1767" alone doesn't match)
 *     "Règl. n°1733" is the MODIFIED bylaw; no new hyphenated number extracted.
 *   - NOTE: This is an honest absence — the municipality uses non-hyphenated sequential numbers.
 */
export const PV_DEUX_MONTAGNES_2026_04_TEXT = `
2026-04-09

PROCÈS-VERBAL d'une séance ordinaire du conseil municipal, tenue à
l'hôtel de ville de Deux-Montagnes, le 9 avril 2026 à 19 h, sous la
présidence du maire, monsieur Denis Martin.
Présences: Margaret Lavallée, Micheline Groulx Stabile, Eric Langlois
Manon Robitaille et Marc-André Sauvageau
Julie Guindon, directrice générale
Jacques Robichaud, greffier
Absence : Erik Johnson

1.

Séance ordinaire
La séance est ouverte par monsieur le maire Denis Martin à 19 h.

1.1

Adoption de l'ordre du jour
IL EST
Proposé par madame Manon Robitaille
Appuyé par madame Margaret Lavallée
Et unanimement résolu

2026-04-09.077

D'ADOPTER l'ordre du jour de la présente séance tel que présenté.
ADOPTÉE

3.

Dépôt des procès-verbaux
Le greffier dépose le procès-verbal suivant :
➢ Comité consultatif d'urbanisme du 1er avril 2026

4.

Règlements municipaux

4.1

Adoption – Règlement nº 1767 - Règlement modifiant le Règlement de
zonage (Règl. n°1733) aux fins de régulariser l'usage « Habitation
multifamiliale (H4) » dans deux secteurs de la zone H-204
CONSIDÉRANT que lors de la séance du 12 février 2026, un avis de
motion du présent règlement a dûment été donné et un premier projet
de règlement a été adopté ;
CONSIDÉRANT la tenue, le 12 mars 2026, d'une assemblée publique
aux fins de consultation ;
CONSIDÉRANT que ce règlement n'est pas susceptible d'approbation
référendaire : aucune demande de participation à un référendum n'a
été reçue dans le délai imparti ;
CONSIDÉRANT que ce règlement a pour objet de régulariser l'usage
« Habitation multifamiliale (H4) » dans deux secteurs de la zone H-204 ;
IL EST
Proposé par madame Manon Robitaille
Appuyé par madame Micheline Groulx Stabile
Et unanimement résolu

- 64 -

2026-04-09.084

D'ADOPTER, sans changement, le Règlement n°1767 intitulé
« Règlement modifiant le Règlement de zonage (Règl. n°1733) aux fins
de régulariser l'usage « Habitation multifamiliale (H4) » dans deux
secteurs de la zone H-204 », tel que déposé.
ADOPTÉE

4.2

Adoption - Règlement nº 1768 - Règlement modifiant le Règlement de
zonage (Règl. n°1733) afin d'autoriser les projets intégrés dans la zone
H-381
CONSIDÉRANT que lors de la séance du 12 février 2026, un avis de
motion du présent règlement a dûment été donné et un premier projet
de règlement a été adopté ;
CONSIDÉRANT la tenue, le 12 mars 2026, d'une assemblée publique
aux fins de consultation ;
CONSIDÉRANT que ce règlement n'est pas susceptible d'approbation
référendaire : aucune demande de participation à un référendum n'a
été reçue dans le délai imparti ;
CONSIDÉRANT que ce règlement a pour objet d'autoriser les projets
intégrés dans la zone H-381 ;
IL EST
Proposé par madame Margaret Lavallée
Appuyé par madame Manon Robitaille
Et unanimement résolu

2026-04-09.085

D'ADOPTER, sans changement, le Règlement n°1768 intitulé
« Règlement modifiant le Règlement de zonage (Règl. n°1733) afin
d'autoriser les projets intégrés dans la zone H-381 », tel que déposé.
ADOPTÉE

4.3

Adoption - Règlement nº 1769 - Règlement modifiant le Règlement de
zonage (Règl. n°1733) afin d'agrandir les limites de la zone P-386
CONSIDÉRANT que lors de la séance du 12 février 2026, un avis de
motion du présent règlement a dûment été donné et qu'un premier
projet de règlement a été adopté ;
CONSIDÉRANT la tenue, le 12 mars 2026, d'une assemblée publique
aux fins de consultation ;
CONSIDÉRANT que ce règlement n'est pas susceptible d'approbation
référendaire : aucune demande de participation à un référendum n'a
été reçue dans le délai imparti ;
CONSIDÉRANT que ce règlement a pour objet d'agrandir les limites de
la zone P-386 à même une partie de la zone GM-384 ;
IL EST
Proposé par madame Margaret Lavallée
Appuyé par monsieur Eric Langlois
Et unanimement résolu

- 65 -

2026-04-09.086

D'ADOPTER, sans changement, le Règlement n°1769 intitulé
« Règlement modifiant le Règlement de zonage (Règl. n°1733) afin
d'agrandir les limites de la zone P-386 », tel que déposé.
ADOPTÉE

4.4

Adoption - Règlement nº 1770 - Règlement modifiant le Règlement de
zonage (Règl. n°1733) aux fins de modifier certaines normes
d'implantation concernant les marges, la localisation des pompes à
chaleur, climatiseurs et génératrices, et certaines dispositions relatives
à l'aménagement et l'entretien d'une aire de stationnement
CONSIDÉRANT que lors de la séance du 12 février 2026, un avis de
motion du présent règlement a dûment été donné et qu'un premier
projet de règlement a été adopté ;
CONSIDÉRANT la tenue, le 12 mars 2026, d'une assemblée publique
aux fins de consultation ;
CONSIDÉRANT que ce règlement ne contient aucune disposition propre
à un règlement susceptible d'approbation référendaire ;
CONSIDÉRANT que ce règlement a pour objet de modifier certaines
normes d'implantation concernant les marges, la localisation des
pompes à chaleur, climatiseurs et génératrices, et certaines
dispositions relatives à l'aménagement et l'entretien d'une aire de
stationnement ;
IL EST
Proposé par monsieur Eric Langlois
Appuyé par monsieur Marc-André Sauvageau
Et unanimement résolu

2026-04-09.087

D'ADOPTER le Règlement n°1770 intitulé « Règlement modifiant le
Règlement de zonage (Règl. n°1733) aux fins de modifier certaines
normes d'implantation concernant les marges, la localisation des
pompes à chaleur, climatiseurs et génératrices, et certaines
dispositions relatives à l'aménagement et l'entretien d'une aire de
stationnement », tel que déposé.
ADOPTÉE

- 66 -

4.5

Avis de motion et dépôt d'un projet de règlement – Règlement relatif à
la tarification de certains services municipaux
Monsieur Marc-André Sauvageau donne avis de motion qu'il sera
présenté lors d'une prochaine séance un règlement relatif à la
tarification de certains services municipaux.
Le projet de règlement est déposé.

2026-04-09.088
`;
