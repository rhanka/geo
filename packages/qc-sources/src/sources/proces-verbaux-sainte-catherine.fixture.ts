/**
 * Real procès-verbaux fixture data for Sainte-Catherine (Rive-Sud) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.sainte-catherine.qc.ca/ville/conseil-municipal/seances-publiques/
 *     HTTP 200, 224 031 bytes, public / no login, robots.txt: Disallow /craft/ only.
 *   - PV PDF (May 12, 2026): https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf
 *     HTTP 200, 1 403 064 bytes (PDF), extracted via pdftotext → 89 474 bytes.
 *
 * Nothing is fabricated. Only excerpts are included (not full PDFs) to keep
 * fixture size reasonable. Each section is labelled with its source URL and
 * the date it was fetched.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINTE_CATHERINE_INDEX_HTML — real subset of the PV list page HTML
 *      (verbatim <ul>/<li>/<a> structure), containing 2026 PV PDF links.
 *   2. PV_SAINTE_CATHERINE_2026_05_TEXT — pdftotext excerpt from the real
 *      May 12, 2026 PV. Contains "AVIS DE MOTION" for règlement 1008-00-50
 *      (circulation) and 944-26 (emprunt/préemption). No règlement de zonage
 *      → expected result: avisDeMotion=true, changementZonage=false.
 *
 * Note: Sainte-Catherine uses règlement numbering like "1008-00-50" and "944-26"
 * (4-digit prefix, NOT matching the simple "2-3 digits dash 1-3 digits" pattern).
 * The May 12 PV avis de motion are for circulation and emprunt, not zonage.
 * This is an honest negative result — no zonage change in this particular PV.
 */

/**
 * Real HTML snippet from the PV index page of Ville de Sainte-Catherine,
 * captured 2026-06-10. Shows 2026 PV entries with real PDF URLs.
 * The structure uses nested <ul>/<li>/<a> links per session.
 *
 * Source: https://www.ville.sainte-catherine.qc.ca/ville/conseil-municipal/seances-publiques/
 * Fetched: 2026-06-10 / HTTP 200 / robots.txt: Disallow /craft/ only
 */
export const PV_SAINTE_CATHERINE_INDEX_HTML = `
<ul>
<li>Séance extraordinaire du 2 juin 2026, 19 h | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/2026-06-02-PV-Extraordinaire.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance extraordinaire du 22 mai 2026, 16 h 30 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260522-extra-16h30-vns-vp20260525.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance ordinaire du 12 mai 2026, 19 h 30 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance extraordinaire du 21 avril 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260421-extra-vs-vp20260513.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance ordinaire du 14 avril 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260414-vs-vp20260513.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance extraordinaire du 17 mars 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/2026-03-17-PV-extraordinaire.pdf">Procès-verbal</a></li>
<li>Séance ordinaire du 10 mars 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/2026-03-10-PV-ordinaire.pdf">Procès-verbal</a></li>
<li>Séance ordinaire du 10 février 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260210-vs-vp20260311.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance ordinaire du 20 janvier 2026 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/Pv-Cm-20260120-Vs-Vp20260211.pdf">Procès-verbal</a></li>
</ul>
<ul>
<li>Séance ordinaire du 9 décembre 2025, 19 h 30 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20251209-vs-vp20260121.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance ordinaire du 25 novembre 2025, 19 h 30 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20251125-vs-vp20251210.pdf" target="_blank">Procès-verbal</a></li>
<li>Séance ordinaire du 2 octobre 2025, 19 h 30 | <a href="https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20251002-vs-vp20251126.pdf" target="_blank">Procès-verbal</a></li>
</ul>
`;

/**
 * NEGATIVE fixture — excerpt from the real May 12, 2026 PV of Sainte-Catherine.
 *
 * Source: https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf
 * Fetched: 2026-06-10 / HTTP 200 / pdftotext extracted
 *
 * This excerpt contains two "avis de motion" entries:
 *   1. Règlement 1008-00-50 — modifiant la circulation (stationnement, sécurité publique)
 *   2. Règlement 944-26 — autorisant un emprunt pour l'exercice d'un droit de préemption
 *
 * Detection expected (HONEST NEGATIVE):
 *   avisDeMotion: true   (motions are present)
 *   reglementNumbers: [] (neither matches the zonage-specific hyphen pattern
 *                         with règlement de zonage context — 1008-00-50 matches
 *                         rule number but context is "circulation", not "zonage")
 *   changementZonage: false (no règlement de zonage reference in context)
 */
export const PV_SAINTE_CATHERINE_2026_05_TEXT = `
VILLE DE SAINTE-CATHERINE
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Sainte-Catherine, tenue
le 12 mai 2026, à 19 h 30, à l'hôtel de ville, sis au 5465, boulevard Marie-Victorin, Ville de
Sainte-Catherine, sous la présidence de M. Sylvain Bouchard, maire.

AVIS DE MOTION ET DÉPÔT DE PROJETS DE RÈGLEMENT
198-05-26

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT NUMÉRO
1008-00-50 MODIFIANT LE RÈGLEMENT NUMÉRO 1008-00 CONCERNANT
LA CIRCULATION, LE STATIONNEMENT ET LA SÉCURITÉ PUBLIQUE

CONSIDÉRANT l'adoption de la résolution numéro 123-04-26 autorisant l'implantation d'une
signalisation d'interdiction de stationnement, en tout temps, du côté impair de la Promenade du
Collège, entre les numéros civiques 735 et 795;

CONSIDÉRANT l'analyse du comité de circulation ainsi que les objectifs de faciliter l'accès aux
entrées charretières et de sécuriser les déplacements dans ce secteur;

CONSIDÉRANT QU'il y a lieu de modifier le règlement numéro 1008-00 concernant la
circulation, le stationnement et la sécurité publique afin d'y intégrer cette nouvelle interdiction de
stationnement;

Mme la conseillère Amélie Côté donne avis de motion à l'effet que le règlement numéro
1008-00-50 sera soumis pour adoption à la prochaine séance ou à une séance subséquente.
QUE le projet de règlement est déposé conformément aux dispositions de la loi.
QUE le préambule fasse partie intégrante de la présente résolution.

199-05-26

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT D'EMPRUNT
944-26 AUTORISANT UNE DÉPENSE ET UN EMPRUNT DE 8 000 000 $
POUR FINANCER L'ACQUISITION D'IMMEUBLES À LA SUITE DE
L'EXERCICE D'UN DROIT DE PRÉEMPTION (45 ET 85 RUE JOGUES)

CONSIDÉRANT l'adoption du règlement numéro 943-26 concernant l'exercice du droit de
préemption;

CONSIDÉRANT QUE la Ville peut, conformément à ce règlement et aux dispositions applicables
de la Loi sur l'aménagement et l'urbanisme exercer un droit de préemption afin d'acquérir un
immeuble assujetti;

CONSIDÉRANT la publication par la Ville d'un avis d'assujettissement d'un immeuble au droit
de préemption au Registre foncier sur les lots 3 874 267 et 3 874 267 du cadastre du Québec,
correspondant aux immeubles situés au 45 et 85, rue Jogues à Sainte-Catherine;

CONSIDÉRANT QU'il est nécessaire de décréter une dépense et un emprunt afin d'acquitter le
prix d'acquisition et les frais afférents lors de l'exercice du droit de préemption.

Mme la conseillère Marie Levert donne avis de motion à l'effet que le règlement numéro 944-26
autorisant un emprunt de 8 000 000 $ pour financer l'acquisition d'immeubles à la suite de
l'exercice d'un droit de préemption (lot 3 874 267 et lot 3 874 268 du cadastre du Québec) sera
soumis pour adoption à la prochaine séance ou à une séance subséquente.
QUE le projet de règlement est déposé conformément aux dispositions de la loi.
QUE le préambule fasse partie intégrante de la présente résolution.
`;
