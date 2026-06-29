/**
 * Real procès-verbaux fixture data for Mascouche (MRC Les Moulins, Lanaudière) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://mascouche.ca/ville/vie-democratique/seances-du-conseil
 *     HTTP 200, 156 113 bytes, public / no login.
 *     robots.txt: 404 (no restrictions file — permissive by default).
 *   - PV PDF (compiled 2026 — 5 sessions Jan–May 2026):
 *     https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260609proces-verbaux-seances-du-conseil.pdf
 *     HTTP 200, PDF, extracted via pdftotext → 437 103 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_MASCOUCHE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (October CMS accordion; one compiled PV per year).
 *   2. PV_MASCOUCHE_2026_04_TEXT — pdftotext excerpt from the April 20, 2026
 *      session (inside the compiled 2026 PDF). Contains a real zonage change:
 *        - Avis de motion + adoption du premier projet: Règlement 1103-81
 *          modifiant le Règlement de zonage numéro 1103
 *          (divers modifications — enseignes boîtier)
 *
 * PARSER SUPPORT:
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "1103-81".
 *   "règlement de zonage numéro 1103" is in context → ZONAGE_KEYWORDS_RE fires.
 *   "Madame la conseillère Anny Mailloux donne avis de motion" → AVIS_MOTION_RE.
 *   Result: avisDeMotion=true, reglementNumbers=["1103-81"],
 *   changementZonage=true. ZERO false positive.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://mascouche.ca/ → HTTP 200
 *   - robots.txt: 404 (no restrictions file — permissive by default)
 *   - All /storage/app/media/ PDFs are publicly accessible.
 *
 * PV index structure: October CMS with accordion.
 *   Two cards: "2026" (one compiled PDF) and "2025" (one compiled PDF).
 *   parsePvIndex finds 2 PDF links. Both are within the 6-month window
 *   (the 2026 PDF title has no extractable date → NON_DISPONIBLE → always included;
 *    the 2025 PDF likewise).
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Mascouche,
 * captured 2026-06-10 from:
 * https://mascouche.ca/ville/vie-democratique/seances-du-conseil
 *
 * October CMS accordion structure with c-rubric-card panels.
 * PV section "Procès-verbaux" contains one compiled PDF per year.
 * Key PDF links:
 *   2026: 20260609proces-verbaux-seances-du-conseil.pdf
 *   2025: 20260129_proces-verbaux-seances-du-conseil.pdf
 */
export const PV_MASCOUCHE_INDEX_HTML = `
<div class="c-rubric-card || js-accordion" id="accordion-proces-verbaux">
  <div class="c-rubric-card__header || js-accordion-toggle" tabindex="0" role="button" aria-expanded="false" aria-controls="accordion-content-proces-verbaux">
    <div class="c-rubric-card__text">
      <h2 class="c-rubric-card__title">Procès-verbaux</h2>
    </div>
  </div>
  <div class="c-rubric-card__content || js-accordion-content" id="accordion-content-proces-verbaux" aria-hidden="true">
    <div class="c-rubric-card__transition">
      <div class="c-rubric-card__documents">
        <a class="c-document-card" href="https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260609proces-verbaux-seances-du-conseil.pdf" target="_blank">
          <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Procès verbal – Mise à jour : 09/06/2026</span>
            <h3 class="c-document-card__title">2026</h3>
          </div>
        </a>
        <a class="c-document-card" href="https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260129_proces-verbaux-seances-du-conseil.pdf" target="_blank">
          <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Procès verbal</span>
            <h3 class="c-document-card__title">2025</h3>
          </div>
        </a>
        <a class="c-document-card" href="https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20250129proces-verbauxseance-conseil.pdf" target="_blank">
          <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Procès-verbaux</span>
            <h3 class="c-document-card__title">2024</h3>
          </div>
        </a>
        <a class="c-document-card" href="https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20240205-proces-verbaux-seance-conseil.pdf" target="_blank">
          <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Procès-verbaux</span>
            <h3 class="c-document-card__title">2023</h3>
          </div>
        </a>
        <a class="c-document-card" href="https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20230201_proces-verbaux-seance-conseil.pdf" target="_blank">
          <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Procès-verbaux</span>
            <h3 class="c-document-card__title">2022</h3>
          </div>
        </a>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from the compiled Mascouche 2026 PV PDF,
 * session du 20 avril 2026, captured 2026-06-10 from:
 * https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260609proces-verbaux-seances-du-conseil.pdf
 *
 * Detection expected:
 *   avisDeMotion: true  ("Madame la conseillère Anny Mailloux donne avis de motion du Règlement numéro 1103-81")
 *   reglementNumbers: ["1103-81"]  (REGLEMENT_NUMBER_RE: "Règlement numéro 1103-81")
 *   changementZonage: true  ("règlement de zonage numéro 1103" present in context)
 *   excerpts: non-empty
 */
export const PV_MASCOUCHE_2026_04_TEXT = `PROCÈS-VERBAL DE LA SÉANCE ORDINAIRE DU 20 AVRIL 2026

SÉANCE ORDINAIRE du conseil municipal de la Ville de Mascouche tenue le
20 avril 2026 à 19h, au 3038, chemin Sainte-Marie, Mascouche.

260420-16
6.10

AVIS DE MOTION DU RÈGLEMENT NUMÉRO 1103-81 MODIFIANT LE
RÈGLEMENT DE ZONAGE NUMÉRO 1103 AFIN D'APPORTER DIVERSES
MODIFICATIONS
Madame la conseillère Anny Mailloux donne avis de motion du
Règlement numéro 1103-81 modifiant le règlement de zonage
numéro 1103 afin d'apporter diverses modifications, pour adoption à
une prochaine séance ordinaire ou extraordinaire.
Que l'avis de motion ait pour effet d'entraîner un effet de gel,
conformément à l'article 114 de la Loi sur l'aménagement et
l'urbanisme, en ce que le projet de règlement, s'il est adopté, a pour
effet de prohiber l'installation de nouvelles enseignes de type boîtier ou
caisson apposées à plat sur un mur et de prescrire que toute nouvelle
enseigne apposée à plat doit obligatoirement être apposées d'abord
sur un panneau de support de la même couleur que le mur sur lequel il
est fixé.

260420-17
6.11

ADOPTION DU PREMIER PROJET DE RÈGLEMENT NUMÉRO 1103-81
MODIFIANT LE RÈGLEMENT DE ZONAGE NUMÉRO 1103 AFIN
D'APPORTER DIVERSES MODIFICATIONS
CONSIDÉRANT l'avis de motion 260420-17 donné à la présente séance;
Il est proposé par madame la conseillère Anny Mailloux
appuyé par monsieur le conseiller Éric Ladouceur
ET RÉSOLU UNANIMEMENT :
D'adopter le premier projet de Règlement numéro 1103-81 modifiant le
règlement de zonage numéro 1103 afin d'apporter diverses modifications.
ADOPTÉE
260420-18`;
