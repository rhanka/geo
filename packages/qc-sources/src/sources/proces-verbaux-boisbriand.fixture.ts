/**
 * Real procès-verbaux fixture data for Boisbriand (MRC Thérèse-De Blainville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://boisbriand.ca/ville/vie-democratique/seances-du-conseil
 *     (October CMS — boisbriand.ca redirects to www.ville.boisbriand.qc.ca).
 *     HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 *   - PV PDF (April 14, 2026):
 *     https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-04-14_Seance-ordinaire.pdf
 *     HTTP 200, text layer present (pdftotext → 1264 lines).
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_BOISBRIAND_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (c-document-card links under accordion "Procès-verbaux - 2026", October CMS).
 *   2. PV_BOISBRIAND_2026_04_TEXT — pdftotext excerpt from the April 14, 2026 PV.
 *      Contains:
 *        - Résolution 2026-04-177: Règlement RV-1787-1 AVIS DE MOTION ET DÉPÔT
 *          (modifying RV-1787 on tarifs — NOT zonage)
 *        - Résolution 2026-04-178: Règlement RV-1796 AVIS DE MOTION ET DÉPÔT
 *          (réserve financière — NOT zonage)
 *        - Résolution 2026-04-199: INTENTION DE MODIFIER RV-1441 SUR LE ZONAGE
 *          (not a standard "avis de motion" — it's an "intention" resolution)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://boisbriand.ca/ → HTTP 404 (but /ville/vie-democratique/seances-du-conseil → 200)
 *   - https://www.ville.boisbriand.qc.ca/ → HTTP 200
 *   - https://www.ville.boisbriand.qc.ca/robots.txt → Disallow: /administration,
 *     /administration/, /administration/backend, /administration/backend/ only
 *   - Target page is NOT under /administration → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   ANTI-FAUX-POSITIF: This PV has avis de motion for RV-1787-1 (tarifs) and RV-1796
 *   (réserve financière), neither of which is a zonage change. The "intention to modify
 *   RV-1441 sur le zonage" resolution is NOT a standard "avis de motion" — it uses
 *   different language ("D'exprimer l'intention de la Ville de Boisbriand d'adopter
 *   prochainement un projet de règlement") and is NOT preceded by "avis de motion" in
 *   the same paragraph.
 *   - avisDeMotion: true (AVIS_MOTION_RE matches for RV-1787-1 and RV-1796)
 *   - changementZonage: false (honest negative — no "règlement de zonage" in ±400 char
 *     window around the avis de motion phrases for RV-1787-1 and RV-1796)
 *   - reglementNumbers: [] (no zonage context → REGLEMENT_NOHYPHEN_RE not applied;
 *     "RV-1787-1" uses RV prefix → not matched by \d{2,4}-\d{1,4})
 *   NOTE: This is an honest zero — no false positive. The zonage modification for RV-1441
 *   uses a different procedural mechanism (intention resolution + contrôle intérimaire).
 */

/**
 * Real HTML snippet from the PV index page of Ville de Boisbriand,
 * captured 2026-06-10 from:
 * https://boisbriand.ca/ville/vie-democratique/seances-du-conseil
 * (October CMS accordion, "Procès-verbaux - 2026" section)
 *
 * Key PV PDF links present:
 *   - 2026-04-14_Seance-ordinaire.pdf (April 14, 2026)
 *   - 2026-03-31_Seance-extraordinaire.pdf (March 31, 2026 extraordinary)
 *   - 2026-03-10_Seance-ordinaire.pdf (March 10, 2026)
 *   - 2026-02-03_Seance-ordinaire.pdf (February 3, 2026)
 *   - 2026-01-20_Seance-ordinaire.pdf (January 20, 2026)
 *   - Several 2025 PVs
 */
export const PV_BOISBRIAND_INDEX_HTML = `
<div class="c-rubric-card || js-accordion" id="accordion-proces-verbaux-2026">
    <div class="c-rubric-card__header || js-accordion-toggle" tabindex="0" role="button" aria-expanded="false" aria-controls="accordion-content-proces-verbaux-2026">
        <h2 class="c-rubric-card__title">Procès-verbaux - 2026</h2>
    </div>
    <div class="c-rubric-card__content || js-accordion-content" id="accordion-content-proces-verbaux-2026" aria-hidden="true">
        <div class="c-documents">
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-04-14_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">14 avril 2026</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-03-31_Seance-extraordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance extraordinaire</span>
                    <span class="c-document-card__title">31 mars 2026</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-03-10_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">10 mars 2026</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-02-03_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">3 février 2026</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-01-20_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">20 janvier 2026</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2025/2025-12-02_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">2 décembre 2025</span>
                </a>
            </div>
            <div class="c-documents__item">
                <a class="c-document-card" href="https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2025/2025-11-18_Seance-ordinaire.pdf" target="_blank">
                    <span class="c-document-card__surtitle">Séance ordinaire</span>
                    <span class="c-document-card__title">18 novembre 2025</span>
                </a>
            </div>
        </div>
    </div>
</div>
`;

/**
 * Real pdftotext excerpt from the April 14, 2026 PV of Ville de Boisbriand,
 * captured 2026-06-10 from:
 * https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-04-14_Seance-ordinaire.pdf
 *
 * Key sections:
 *   2026-04-177: Règlement RV-1787-1 AVIS DE MOTION ET DÉPÔT
 *     (modifying RV-1787 on tarifs — NOT a zonage change)
 *   2026-04-178: Règlement RV-1796 AVIS DE MOTION ET DÉPÔT
 *     (réserve financière — NOT a zonage change)
 *   2026-04-199: INTENTION DE MODIFIER RV-1440 (plan d'urbanisme) ET RV-1441 (zonage)
 *     (not an "avis de motion" — uses "D'exprimer l'intention" language)
 *
 * Détection honnête (ANTI-FAUX-POSITIF):
 *   - avisDeMotion: true (AVIS_MOTION_RE matches "donne avis de motion")
 *   - changementZonage: false
 *     (no "règlement de zonage" within ±400 chars of the "avis de motion" phrases;
 *     the zonage context is in the "intention" resolution which uses different language)
 *   - reglementNumbers: [] (no zonage context for the avis de motion items;
 *     "RV-1787-1" uses RV prefix → not matched by \d{2,4}-\d{1,4})
 */
export const PV_BOISBRIAND_2026_04_TEXT = `
2026-04-14

PROCÈS-VERBAL – SÉANCE ORDINAIRE DU 14 AVRIL 2026

VILLE DE BOISBRIAND

2026-04-177
RÈGLEMENT RV-1787-1 - AVIS DE MOTION ET DÉPÔT

Le conseiller Patrick Thifault donne avis de motion de la présentation pour adoption à une
séance subséquente du Règlement RV-1787-1 modifiant le Règlement RV-1787 sur le
financement des dépenses et sur l'imposition des taxes et compensations pour l'exercice
financier 2026 en introduisant un crédit de taxes relatif à certains terrains vagues.
Le projet de règlement est déposé.

2026-04-178
RÈGLEMENT RV-1796 - AVIS DE MOTION ET DÉPÔT

La conseillère Lori Doucet donne avis de motion de la présentation pour adoption à une
séance subséquente du Règlement RV-1796 sur la réserve financière pour l'environnement,
le développement durable et la lutte contre les changements climatiques.
Le projet de règlement est déposé.

2026-04-199
INTENTION DE MODIFIER LE RÈGLEMENT RV-1440 SUR LE PLAN D'URBANISME ET LE
RÈGLEMENT RV-1441 SUR LE ZONAGE POUR ENCADRER LA COHABITATION ENTRE DES
ZONES INDUSTRIELLES ET RÉSIDENTIELLES

ATTENDU QUE plusieurs zones industrielles situées sur le territoire de la Ville de Boisbriand
sont adjacentes à des zones résidentielles situées sur le territoire de la Ville de Boisbriand
et à des aires résidentielles situées sur le territoire de la Ville de Mirabel aux limites de la
Ville de Boisbriand;
ATTENDU QUE les usages exercés ou pouvant être exercés dans ces zones industrielles
causent ou peuvent causer des nuisances, dont du bruit, de la poussière, des vibrations,
des odeurs, des amoncellements de matières et de la lumière;
ATTENDU QUE la Ville de Boisbriand souhaite favoriser la cohabitation entre les zones
industrielles et les zones ou les aires résidentielles;
En conséquence, il est :
PROPOSÉ PAR M. JONATHAN THIBAULT
APPUYÉ PAR M. DANIEL KAESER
D'exprimer l'intention de la Ville de Boisbriand d'adopter prochainement un projet de
règlement modifiant le Règlement RV-1440 sur le plan d'urbanisme afin d'encadrer la
cohabitation entre des zones industrielles situées sur le territoire de la Ville de Boisbriand
et des zones résidentielles situées sur le territoire de la Ville de Boisbriand ainsi que des
aires résidentielles situées sur le territoire de la Ville de Mirabel aux limites de la Ville de
Boisbriand.
Adoptée
`;
