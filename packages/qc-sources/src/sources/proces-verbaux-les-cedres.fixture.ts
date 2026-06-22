/**
 * Real procès-verbaux fixture data for Les Cèdres (MRC Vaudreuil-Soulanges) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.lescedres.qc.ca/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour
 *     HTTP 200, public / no login. Drupal CMS with table layout.
 *     robots.txt: Disallow /includes/, /misc/, /modules/, /profiles/, /scripts/, /themes/,
 *                 /admin/ — content pages allowed.
 *   - PV PDF (May 12, 2026):
 *     https://www.ville.lescedres.qc.ca/sites/default/files/PDF/pv_ass_2026_05_12.pdf
 *     HTTP 200, 923 613 bytes (PDF), extracted via pdftotext → 50 778 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LES_CEDRES_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (table structure with relative /sites/default/files/PDF/ links).
 *   2. PV_LES_CEDRES_2026_05_TEXT — pdftotext excerpt from the real May 12, 2026 PV.
 *      Contains "donne avis de motion" for drainage règlements 540-2026, 541-2026,
 *      542-2026. NO zonage mention.
 *
 * Expected detection (honest — anti-invention):
 *   - avisDeMotion: true (3 drainage motions 540-2026, 541-2026, 542-2026)
 *   - changementZonage: false (0 occurrences of "zonage" in the document)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.lescedres.qc.ca/ → HTTP 200
 *   - robots.txt: Disallow /admin/, /includes/, etc. — content pages allowed.
 */

/**
 * Real HTML excerpt from the PV index page of Municipalité des Cèdres,
 * captured 2026-06-10 from:
 * https://www.ville.lescedres.qc.ca/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour
 *
 * Structure: HTML table with relative href links to /sites/default/files/PDF/*.pdf
 * 7 PV links for 2026 (January through June 9, 2026), including one extraordinary session.
 */
export const PV_LES_CEDRES_INDEX_HTML = `
<table>
  <tr>
    <td>9 juin - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/1.1_ass_2026_06_09.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/pv_ass_2026_06_09.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>28 mai - séance extraordinaire</td>
    <td></td>
    <td><a href="/sites/default/files/PDF/pv_ass_extra_2026_05_28.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>12 mai - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/1.1_oj_ass_2026_05_12.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/pv_ass_2026_05_12.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>14 avril - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/1.1_oj_ass_2026_04_14.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/0.0_pv_ass_2026_04_14.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>10 mars - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/Proces_verbaux/1.1_oj_ass_2026_03_10.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/pv_ass_2026_03_10.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>10 février - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/Proces_verbaux/1.1_oj_ass_2026_02_10.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/Proces_verbaux/pv_ass_2026_02_10_0.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
  <tr>
    <td>20 janvier - séance ordinaire</td>
    <td><a href="/sites/default/files/PDF/Proces_verbaux/1.1_oj_ass_2026_01_20.pdf" target="_blank" rel="noopener noreferrer">OD</a></td>
    <td><a href="/sites/default/files/PDF/0._pv_ass_2026_01_20.pdf" target="_blank" rel="noopener noreferrer">PV</a></td>
  </tr>
</table>
`;

/**
 * Real pdftotext excerpt from Les Cèdres PV May 12, 2026.
 * Source: https://www.ville.lescedres.qc.ca/sites/default/files/PDF/pv_ass_2026_05_12.pdf
 * Captured: 2026-06-10
 *
 * Contains:
 *   - "donne avis de motion" for Règlement no 540-2026 (drainage secteur Sophie) — NOT zonage
 *   - "donne avis de motion" for Règlement no 541-2026 (drainage secteur Daoust) — NOT zonage
 *   - "donne avis de motion" for Règlement no 542-2026 (drainage secteur Marsan) — NOT zonage
 *   - Zero occurrences of "zonage" anywhere in the document.
 *
 * Expected detection:
 *   - avisDeMotion: true (3 drainage motions present)
 *   - changementZonage: false (no "zonage" keyword in text)
 *
 * Note: PDF contains a watermark overlay (LL_E, O_FF, IC, IE, etc.) but pdftotext
 * extracts readable text correctly.
 */
export const PV_LES_CEDRES_2026_05_TEXT = `
MUNICIPALITÉ DES CÈDRES
MRC DE VAUDREUIL-SOULANGES
PROVINCE DE QUÉBEC
Procès-verbal
Séance ordinaire du 12 mai 2026

Procès-verbal de la séance ordinaire du Conseil municipal tenue le 12 mai
2026 à 19h à l'Hôtel de ville sis au 1060, chemin du Fleuve, Les Cèdres
(Québec), J7T 1A1

Sont présents :
La conseillère, Patricia Perron ainsi que les conseillers, Alex Allen, Claude
Généreux, Loïc Dewavrin, Russell Piché et Patrick Nadeau et siégeant sous
la présidence du maire, Michel Proulx, formant quorum

Sont également présents :
Jimmy Poulin, directeur général et greffier-trésorier agissant à titre de
secrétaire de la séance et Chantal Primeau, directrice des affaires juridiques
et greffière-trésorière adjointe

2026-05-165

Adoption de l'ordre du jour de la séance ordinaire du 12 mai 2026

Il est proposé par    Russell Piché
Appuyé par            Patricia Perron
Et résolu

D'ADOPTER l'ordre du jour de la séance ordinaire du 12 mai 2026.

2026-05-171

Avis de motion et projet de règlement numéro 540-2026 décrétant une
dépense et un emprunt de 197 000 $ pour les travaux de drainage dans le
secteur Sophie
Conformément à l'article 445 du Code municipal du Québec (C. c-27.1)

Le conseiller, Russell Piché, donne avis de motion qu'il sera soumis lors
d'une prochaine séance du Conseil municipal, pour adoption, le règlement
numéro 540-2026 décrétant une dépense et un emprunt de 197 000 $ pour
les travaux de drainage dans le secteur Sophie;

Un projet de ce règlement est présenté séance tenante; l'avis de motion
étant assorti d'une demande de dispense de lecture.

2026-05-172

Avis de motion et projet de règlement numéro 541-2026 décrétant une
dépense et un emprunt de 197 000 $ pour les travaux de drainage dans le
secteur Daoust
Conformément à l'article 445 du Code municipal du Québec (C. c-27.1)

Le conseiller, Patrick Nadeau, donne avis de motion qu'il sera soumis lors
d'une prochaine séance du Conseil municipal, pour adoption, le règlement
numéro 541-2026 décrétant une dépense et un emprunt de 197 000 $ pour
les travaux de drainage dans le secteur Daoust;

Un projet de ce règlement est présenté séance tenante; l'avis de motion
étant assorti d'une demande de dispense de lecture.

2026-05-173

Avis de motion et projet de règlement numéro 542-2026 décrétant une
dépense et un emprunt de 197 000 $ pour les travaux de drainage dans le
secteur Marsan
Conformément à l'article 445 du Code municipal du Québec (C. c-27.1)

Le conseiller, Claude Généreux, donne avis de motion qu'il sera soumis
lors d'une prochaine séance du Conseil municipal, pour adoption, le
règlement numéro 542-2026 décrétant une dépense et un emprunt de 197
000 $ pour les travaux de drainage dans le secteur Marsan;

Un projet de ce règlement est présenté séance tenante; l'avis de motion
étant assorti d'une demande de dispense de lecture.

2026-05-174

Adoption du règlement numéro 538-2026 relatif à la circulation de
véhicules lourds sur le ponceau Wallot

ATTENDU le rapport reçu de la firme Parallèle 54 expert conseil sur l'état du
ponceau situé sur le cours d'eau Wallot sous le chemin Saint-Féréol;
un avis de motion de ce règlement a été donné par le conseiller, Alex Allen,
lors de la séance du 14 avril 2026;

Il est proposé par   Alex Allen
Appuyé par           Russell Piché
Et résolu

D'ADOPTER le règlement numéro 538-2026 intitulé « Règlement relatif à la
circulation de véhicules lourds sur le ponceau Wallot ».
`;
