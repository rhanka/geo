/**
 * Real procès-verbaux fixture data for La Prairie (Rive-Sud) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://laprairie.ca/ville/democratie/seances-du-conseil
 *     HTTP 200, 212 503 bytes, public / no login.
 *     robots.txt: Disallow: /administration/, /administration/backend/ only.
 *   - PV PDF (May 19, 2026): https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-05-19_pv_non_officiel.pdf
 *     HTTP 200, 1 125 406 bytes (PDF), extracted via pdftotext → 58 101 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LAPRAIRIE_INDEX_HTML — verbatim HTML anchor excerpt from the PV
 *      list page (accordion-2026 section), showing 2026 PV PDF links.
 *   2. PV_LAPRAIRIE_2026_05_TEXT — pdftotext excerpt from the real
 *      May 19, 2026 PV. Contains "avis de motion" for règlements 1572-M,
 *      1574-M, 1575-M (taxes, patrimoine, circulation) — NONE is a règlement
 *      de zonage → expected: avisDeMotion=true, changementZonage=false.
 *      Zonage is mentioned in dérogation mineures context (not in avis de motion
 *      ±400 chars window) → honest negative.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://laprairie.ca/ → HTTP 200
 *   - https://laprairie.ca/robots.txt → Disallow: /administration/, /administration/backend/
 *   - Target page is NOT under /administration/ → scraping allowed
 */

/**
 * Real HTML snippet from the PV index page of Ville de La Prairie,
 * captured 2026-06-10 from https://laprairie.ca/ville/democratie/seances-du-conseil
 * (accordion-2026 section, containing 2026 PV document-card links).
 *
 * Key PDF links present:
 *   - 2026-05-19_pv_non_officiel.pdf (Séance ordinaire 19 mai 2026)
 *   - 2026-04-21_pv-R.pdf (Séance ordinaire 21 avril 2026)
 *   - 2026-03-17_pv-R.pdf (Séance ordinaire 17 mars 2026)
 *   - 2026-02-17_pv-R.pdf (Séance ordinaire 17 février 2026)
 *   - 2026-01-20_pv-R.pdf (Séance ordinaire 20 janvier 2026)
 */
export const PV_LAPRAIRIE_INDEX_HTML = `
<div class="c-rubrics || js-scrollfire scrollfire-fade-up">
  <div class="c-rubrics__list || js-accordions">
    <div class="c-rubric-card || js-accordion" id="accordion-2026">
      <div class="c-rubric-card__header || js-accordion-toggle" tabindex="0" role="button" aria-expanded="false" aria-controls="accordion-content-2026">
        <div class="c-rubric-card__text">
          <h2 class="c-rubric-card__title">Proc&egrave;s-verbaux 2026</h2>
        </div>
      </div>
      <div class="c-rubric-card__content || js-accordion-content" id="accordion-content-2026" aria-hidden="true">
        <div class="c-rubric-card__documents">
          <div class="c-documents">
            <div class="c-documents__item">
              <a class="c-document-card || js-log-link-click-count" href="https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-05-19_pv_non_officiel.pdf" target="_blank">
                <div class="c-document-card__content">
                  <span class="c-document-card__surtitle">S&eacute;ance ordinaire</span>
                  <span class="c-document-card__title">19 mai 2026 (sujet &agrave; approbation)</span>
                </div>
              </a>
            </div>
            <div class="c-documents__item">
              <a class="c-document-card || js-log-link-click-count" href="https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-04-21_pv-R.pdf" target="_blank">
                <div class="c-document-card__content">
                  <span class="c-document-card__surtitle">S&eacute;ance ordinaire</span>
                  <span class="c-document-card__title">21 avril 2026</span>
                </div>
              </a>
            </div>
            <div class="c-documents__item">
              <a class="c-document-card || js-log-link-click-count" href="https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-03-17_pv-R.pdf" target="_blank">
                <div class="c-document-card__content">
                  <span class="c-document-card__surtitle">S&eacute;ance ordinaire</span>
                  <span class="c-document-card__title">17 mars 2026</span>
                </div>
              </a>
            </div>
            <div class="c-documents__item">
              <a class="c-document-card || js-log-link-click-count" href="https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-02-17_pv-R.pdf" target="_blank">
                <div class="c-document-card__content">
                  <span class="c-document-card__surtitle">S&eacute;ance ordinaire</span>
                  <span class="c-document-card__title">17 f&eacute;vrier 2026</span>
                </div>
              </a>
            </div>
            <div class="c-documents__item">
              <a class="c-document-card || js-log-link-click-count" href="https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-01-20_pv-R.pdf" target="_blank">
                <div class="c-document-card__content">
                  <span class="c-document-card__surtitle">S&eacute;ance ordinaire</span>
                  <span class="c-document-card__title">20 janvier 2026</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from La Prairie PV May 19, 2026.
 * Source: https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-05-19_pv_non_officiel.pdf
 * Captured: 2026-06-10
 *
 * Contains: avis de motion for règlements 1572-M, 1574-M, 1575-M
 *   - 1572-M: amendant taxes et compensations pour l'année 2026 (NOT zonage)
 *   - 1574-M: aide à la restauration bâtiments patrimoniaux (NOT zonage)
 *   - 1575-M: modifiant règlement circulation/stationnement (NOT zonage)
 * No "règlement de zonage" in avis de motion ±400 chars window.
 * Zonage is referenced only in "dérogation mineure" context (separate sections).
 *
 * Expected detection:
 *   - avisDeMotion: true (motions present)
 *   - changementZonage: false (no zonage keyword in avis de motion context)
 */
export const PV_LAPRAIRIE_2026_05_TEXT = `
Procès-verbal du conseil de la Ville de La Prairie (Québec)

Procès-verbal de la séance ordinaire du conseil municipal de la Ville de La Prairie,
tenue dans la salle du conseil de l'hôtel de ville, le mardi 19 mai 2026 à 19 h.
Étaient présents :
M. Frédéric Galantai, maire
M. Vincent Noël, conseiller
Mme Karine Laroche, conseillère
M. Denis Girard, conseiller
Mme Céline Gaudette, conseillère
Mme Julie Simoneau, conseillère
Mme Isabelle Lizée, conseillère
Formant le quorum requis.

RÉSOLUTION 2026-05-211
6.1

DÉPÔT DU PROCÈS-VERBAL DE L'ASSEMBLÉE PUBLIQUE DE
CONSULTATION DU 21 AVRIL 2026 SUR LES PROJETS DE
RÈGLEMENT 1247-11, 1568-M ET 1569-M

Le procès-verbal de l'assemblée publique de consultation tenue le 21 avril
2026 sur les projets de règlement 1247-11, 1568-M et 1569-M est déposé.

2026-05-212
6.2

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT
1572-M AMENDANT LE RÈGLEMENT 1565-M DÉCRÉTANT LES
TAXES ET COMPENSATIONS POUR L'ANNÉE 2026

M. Denis Girard donne un avis de motion que le Règlement 1572-M amendant
le Règlement 1565-M décrétant les taxes et compensations pour l'année 2026
sera soumis au conseil pour adoption lors d'une séance subséquente.

Ce règlement a pour objet modifier le Règlement 1565-M afin d'ajouter la
tarification de services rendus par la MRC de Roussillon, soit les coûts
d'entretien des cours d'eau, les frais liés aux vidanges d'installations
septiques, incluant les frais en cas de déplacement inutile, et les frais de
location et de levées de conteneurs.
M. Denis Girard dépose le projet de Règlement 1572-M amendant le
Règlement 1565-M décrétant les taxes et compensations pour l'année 2026.

2026-05-213
6.3

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT
1574-M AMENDANT LE RÈGLEMENT 1464-M ÉTABLISSANT UN
PROGRAMME D'AIDE À LA RESTAURATION DES BÂTIMENTS
D'INTÉRÊT PATRIMONIAL DU SITE PATRIMONIAL DE LA VILLE
DE LA PRAIRIE POUR LES ANNÉES 2020-2021, 2021-2022,
2022-2023

Mme Karine Laroche donne un avis de motion que le Règlement 1574-M
amendant le Règlement 1464-M établissant un programme d'aide à la
restauration des bâtiments d'intérêt patrimonial du site patrimonial de la
ville de La Prairie sera soumis au conseil pour adoption lors d'une séance
subséquente.

2026-05-214
6.4

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT
1575-M MODIFIANT LE RÈGLEMENT 1039-M CONCERNANT LA
CIRCULATION, LE STATIONNEMENT ET LA SÉCURITÉ ROUTIÈRE

Mme Céline Gaudette donne un avis de motion que le Règlement 1575-M
modifiant le Règlement 1039-M concernant la circulation, le stationnement et
la sécurité routière sera soumis au conseil pour adoption lors d'une séance
subséquente.

7.2

Demande de dérogation mineure 2026-0036 relative à
l'agrandissement d'un bâtiment commercial — 1250, rue Industrielle

Le service de l'urbanisme présente une demande de dérogation mineure à l'égard
de l'immeuble situé au 1250, rue Industrielle, portant le numéro de lot 4 510 393 du
cadastre du Québec, ayant pour effet d'autoriser les mesures suivantes qui dérogent
au Règlement de zonage 1250 :

1. Aucune bordure de béton entourant l'aire de stationnement n'est prévue,
   alors que l'article 598 prescrit que toute aire de stationnement doit être
   entourée d'une bordure de béton ;
`;
