/**
 * Real procès-verbaux fixture data for Sainte-Thérèse (Basses-Laurentides) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/
 *     HTTP 200, 225 827 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: /administration, /administration/backend — PV pages allowed.
 *   - PV PDF (March 2, 2026):
 *     https://www.sainte-therese.ca/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-02_ordinaire.pdf
 *     HTTP 200, 3 407 337 bytes (PDF), extracted via pdftotext → 2377 lines.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINTE_THERESE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (c-small-document-card links under accordion-proces-verbaux-2026, same CMS as La Prairie).
 *   2. PV_SAINTE_THERESE_2026_03_TEXT — pdftotext excerpt from the March 2, 2026 PV.
 *      Contains adoption of règlement 1200-93 (P-2) N.S. agrandissant la zone C-254
 *      à même la zone H-202-1 de l'annexe A du règlement de zonage 1200 N.S.
 *      (avis de motion donné le 2 février 2026)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.sainte-therese.ca/ → HTTP 200
 *   - https://www.sainte-therese.ca/robots.txt → Disallow: /administration, /administration/backend
 *   - Target page is NOT under /administration → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("ATTENDU l'avis de motion (avis de présentation) donné" présent)
 *   - changementZonage: true (règlement 1200-93 agrandissant zone C-254, règlement de zonage 1200 N.S.)
 *   - reglementNumbers: ["1200-93"] (REGLEMENT_NUMBER_RE: "règlement numéro 1200-93")
 *   - NOTE: "1200-93" matches \d{2,4}-\d{1,4}: 4 digits + 2 digits = "1200-93"
 *   - zoneRefs: ["C-254", "H-202"] possible (ZONE_CODE_RE all-uppercase)
 */

/**
 * Real HTML snippet from the PV index page of Ville de Sainte-Thérèse,
 * captured 2026-06-10 from https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/
 *
 * The page uses the same CMS as La Prairie / Blainville (October CMS).
 * PV links are in c-small-document-card format under accordion-proces-verbaux-2026.
 *
 * Key PV PDF links present (2026):
 *   - 26-06-01_ordinaire.pdf (Séance ordinaire 1er juin 2026)
 *   - 26-05-04_ordinaire.pdf (Séance ordinaire 4 mai 2026)
 *   - 26-04-20_extra.pdf (Séance extraordinaire 20 avril 2026)
 *   - 26-04-13_ordinaire.pdf (Séance ordinaire 13 avril 2026)
 *   - 26-03-30_extra.pdf (Séance extraordinaire 30 mars 2026)
 *   - 26-03-02_ordinaire.pdf (Séance ordinaire 2 mars 2026)
 *   - 26-02-02_ordinaire.pdf (Séance ordinaire 2 février 2026)
 *   - 26-01-19_extra.pdf (Séance extraordinaire 19 janvier 2026)
 *   - 26-01-12_ordinaire.pdf (Séance ordinaire 12 janvier 2026)
 */
export const PV_SAINTE_THERESE_INDEX_HTML = `
<div class="c-rubric-card  || js-accordion" id="accordion-proces-verbaux-2026">
    <div class="c-rubric-card__header || js-accordion-toggle">
        <h2 class="c-rubric-card__title">Procés-verbaux - 2026</h2>
    </div>
    <div class="c-rubric-card__content || js-accordion-content" id="accordion-content-proces-verbaux-2026">
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-06-01_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 1er juin 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-05-04_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 4 mai 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-04-20_extra.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance extraordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 20 avril 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-04-13_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 13 avril 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-30_extra.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance extraordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 30 mars 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-02_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 2 mars 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-02-02_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 2 février 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-01-19_extra.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance extraordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 19 janvier 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-01-12_ordinaire.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <span class="c-small-document-card__surtitle">Séance ordinaire</span>
                <h2 class="c-small-document-card__title">Lundi 12 janvier 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="https://www.sainte-therese.ca/ville/democratie/archives-proces-verbaux" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procés-verbaux</h2>
            </div>
        </a>
    </div>
</div>
`;

/**
 * Real pdftotext excerpt from the March 2, 2026 PV of Ville de Sainte-Thérèse,
 * captured 2026-06-10 from:
 * https://www.sainte-therese.ca/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-02_ordinaire.pdf
 *
 * Key section: RÉSOLUTION 2026-112 — Adoption du projet de règlement 1200-93 (P-2) N.S.
 * modifiant les limites des zones C-254 et H-202.1 (22 et 24-26, boulevard Desjardins Est).
 * Text contains: "ATTENDU l'avis de motion (avis de présentation) donné à la séance
 * ordinaire du 2 février 2026" and "règlement de zonage 1200 N.S."
 *
 * Détection honnête:
 *   - avisDeMotion: true
 *   - changementZonage: true (règlement 1200-93 + "règlement de zonage 1200 N.S.")
 *   - reglementNumbers: ["1200-93"] (REGLEMENT_NUMBER_RE matches "règlement numéro 1200-93")
 *   NOTE: "1200-93" has 4 digits + 2 digits → matches \d{2,4}-\d{1,4}
 */
export const PV_SAINTE_THERESE_2026_03_TEXT = `
INITIALES DU MAIRE

Lundi le 2 mars 2026
À compter de 19 h 30
Salle des délibérations du conseil municipal
6, rue de l'Église, Sainte-Thérèse

Les membres du conseil municipal présents sont :

Christian Charron

Maire

CONSEILLERS(ÈRES)
Armando Melo
Héloïse Bélanger
Barbara Morin
Michel Milette
Katherine Vézina
Johane Michaud
Jacynthe Prince
Mylène Morissette

DISTRICTS
Blanchard
Chapleau
De Sève
Ducharme
Lonergan
Marie-Thérèse
Morris
Verschelden

formant quorum et siégeant sous la présidence de son Honneur Monsieur le Maire
Christian Charron.

Assistent également à la séance ordinaire du conseil :
Philippe Huot
Christian Schryburt

Greffier
Directeur général

Monsieur le Maire constate le quorum et ouvre la séance à 19 h 31.

- 77 -

INITIALES DU MAIRE

1. -

ADOPTION DES PROCÈS-VERBAUX

RÉSOLUTION 2026-108

1.1

QUE le procès-verbal de la séance ordinaire du 2 février 2026, tel que rédigé sur
les copies remises aux membres du conseil le 20 février 2026, soit et est approuvé.
Adoptée à l'unanimité.

3. -

RÉGLEMENTATION MUNICIPALE

RÉSOLUTION 2026-112

3.4
Adoption
du projet de
règlement
1200-93
(P-2) N.S. modifiant les
limites des zones
C-254 et H-202.1
(22 et
24-26, boulevard
Desjardins Est)

ATTENDU l'avis de motion (avis de présentation) donné à la séance
ordinaire du 2 février 2026 par M. le Conseiller Michel Milette et le dépôt du projet
de règlement 1200-93 (P-1) N.S. à la même séance ;
ATTENDU l'assemblée de consultation publique tenue le
23 février 2026 relativement à ce projet de règlement ;

Sur proposition de M. le Conseiller Michel Milette appuyée par
Mme la Conseillère Mylène Morissette, il est résolu:
- QUE le projet de règlement numéro 1200-93 (P-2) N.S. agrandissant la zone C-254
à même la zone H-202-1 de l'annexe A du règlement de zonage 1200 N.S., soit et
est adopté;
- QUE ce projet soit présenté aux personnes intéressées ayant droit de signer une
demande d'approbation référendaire et qu'un avis public invitant ces personnes à
présenter une demande soit et est diffusé.

- 80 -

INITIALES DU MAIRE

RÉSOLUTION 2026-112 (suite)

Mme la Conseillère Katherine Vézina demande le vote sur la résolution :

Ont voté pour

Ont voté contre

M. le Maire Christian Charron
Mme la Conseillère Héloïse Bélanger
M. le Conseiller Michel Milette
Mme la Conseillère Jacynthe Prince
Mme la Conseillère Mylène Morissette

M. le Conseiller Armando Melo
Mme la Conseillère Barbara Morin
Mme la Conseillère Katherine Vézina
Mme la Conseillère Johane Michaud

Adoptée à la majorité.

RÉSOLUTION 2026-113

3.5
Avis de motion
et adoption du
projet de
règlement
1202-6 N.S.

M. le Conseiller Armando Melo donne avis de motion de la présentation pour
adoption à une séance subséquente du Règlement 1202-6 N.S. visant à simplifier la
construction de bâtiments accessoires.
Le projet de règlement est déposé.

Adoptée à l'unanimité.

RÉSOLUTION 2026-116

3.8
Adoption
du règlement
1367 N.S.
décrétant le
Code d'éthique
et de déontologie
des élus de
la Ville de
Sainte-Thérèse

ATTENDU l'avis de motion (avis de présentation) donné à la séance
du 2 février 2026 par Mme la Conseillère Jacynthe Prince et le dépôt du projet de
règlement 1367 N.S. à la même séance;

Sur proposition de Mme la Conseillère Jacynthe Prince appuyée par
M. le Conseiller Armando Melo, il est résolu:
- QUE le règlement 1367 N.S. décrétant le Code d'éthique et de déontologie des élus
de la Ville de Sainte-Thérèse, lequel abroge et remplace le règlement numéro
1322 N.S. et ses amendements, soit et est adopté.

Adoptée à l'unanimité.
`;
