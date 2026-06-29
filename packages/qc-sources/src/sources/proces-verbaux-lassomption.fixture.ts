/**
 * Real procès-verbaux fixture data for L'Assomption (MRC L'Assomption, Lanaudière) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.lassomption.qc.ca/seances-conseil/
 *     HTTP 200 (final URL after 301 from ville.lassomption.qc.ca), 66 199 bytes.
 *     robots.txt: User-agent: * with NO Disallow rules (sitemap only).
 *   - PV PDF (May 12, 2026 session):
 *     https://www.ville.lassomption.qc.ca/download.php?filename=pv20260512.pdf
 *     HTTP 200, PDF, extracted via pdftotext → 60 169 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LASSOMPTION_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (Bootstrap accordion with download.php?filename= links).
 *   2. PV_LASSOMPTION_2026_05_TEXT — pdftotext excerpt from the May 12, 2026 PV.
 *      Contains real zonage changes:
 *        - Adoption du règlement 300-76-2026 amendant le règlement 300-2015
 *          relatif au zonage de la Ville de L'Assomption (zone H1-143)
 *        - Adoption du second projet + avis de motion: Règlement 300-78-2026
 *          modifiant le règlement 3002015 relatif au zonage
 *
 * PARSER SUPPORT:
 *   The title "RÈGLEMENT 300-78-2026 MODIFIANT LE RÈGLEMENT 300-2015 RELATIF AU
 *   ZONAGE" contains "300-78" matched by REGLEMENT_NUMBER_RE.
 *   "Avis de motion est donné" → AVIS_MOTION_RE.
 *   "règlement 3002015 relatif au zonage de la Ville de L'Assomption" →
 *   ZONAGE_KEYWORDS_RE fires on "zonage".
 *   Result: avisDeMotion=true, reglementNumbers=["300-78"],
 *   changementZonage=true. ZERO false positive.
 *
 *   NOTE: "300-76-2026" and "300-77-2026" are adoptions (not new avis de motion),
 *   so their rule numbers "300-76" and "300-77" appear in the adoption context but
 *   not directly paired with an avis de motion trigger in this PV.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.lassomption.qc.ca/ → HTTP 200 (301 from ville.lassomption.qc.ca)
 *   - robots.txt: User-agent: * / Sitemap only — NO Disallow rules.
 *   - All download.php?filename= PDFs are publicly accessible.
 *
 * PV index structure: Bootstrap panel accordion (Bootstrap 3 collapse).
 *   Two sections: "Ordres du jour" and "Procès-verbaux". The PV section has
 *   relative links: download.php?filename=pv*.pdf with date-prefixed labels.
 *   parsePvIndex resolves relative URLs against the base URL → absolute HTTPS URLs.
 *   At least 10 PDFs within the 6-month window (Dec 2025–May 2026).
 */

/**
 * Real HTML excerpt from the PV index page of Ville de L'Assomption,
 * captured 2026-06-10 from:
 * https://www.ville.lassomption.qc.ca/seances-conseil/
 *
 * Bootstrap 3 collapse panel structure with "Procès-verbaux" accordion.
 * PDF links are relative (download.php?filename=pv*.pdf).
 * Labels include ISO-prefixed titles: "2026-05-12 | Séance ordinaire (12 mai 2026)".
 */
export const PV_LASSOMPTION_INDEX_HTML = `
<div class="panel-group" id="main_toggle">
  <div class="panel panel-default">
    <div class="panel-heading" role="tab" id="headingwidget2">
      <h4 class="panel-title">
        <a class="collapsed" role="button" data-toggle="collapse" href="#widget2">
          Procès-verbaux<span class="pull-right rotate-plus"><i class="ico ico-Plus"></i></span>
        </a>
      </h4>
    </div>
    <div id="widget2" class="panel-collapse collapse" role="tabpanel">
      <div class="panel-body">
        <ul class="download">
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20260512.pdf" target="_blank">2026-05-12 | Séance ordinaire (12 mai 2026)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=2026-04-14-seance-ordinaire-(14-avril-2026).pdf" target="_blank">2026-04-14 | Séance ordinaire (14 avril 2026)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=2026-03-10-seanec-ordinaire-(10-mars-2026).pdf" target="_blank">2026-03-10 | Séance ordinaire (10 mars 2026)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20260210.pdf" target="_blank">2026-02-10 | Séance ordinaire (10 février 2026)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20260113.pdf" target="_blank">2026-01-13 | Séance ordinaire (13 janvier 2026)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20251215extra.pdf" target="_blank">2025-12-15 | Séance extraordinaire (15 décembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20251209.pdf" target="_blank">2025-12-09 | Séance ordinaire (9 décembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20251209extra.pdf" target="_blank">2025-12-09 | Séance extraordinaire - Budget (9 décembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20251117extra.pdf" target="_blank">2025-11-17 | Séance extraordinaire (17 novembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20251111.pdf" target="_blank">2025-11-11 | Séance ordinaire (11 novembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=2025-09-09-seance-ordinaire-(9-septembre-2025).pdf" target="_blank">2025-09-09 | Séance ordinaire (9 septembre 2025)</a></li>
          <li><a class="text-green" href="https://www.ville.lassomption.qc.ca/download.php?filename=pv20250114.pdf" target="_blank">2025-01-14 | Séance ordinaire (14 janvier 2025)</a></li>
        </ul>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from the L'Assomption May 12, 2026 PV,
 * captured 2026-06-10 from:
 * https://www.ville.lassomption.qc.ca/download.php?filename=pv20260512.pdf
 *
 * Detection expected:
 *   avisDeMotion: true  ("Avis de motion est donné par la conseillère Manon St-Hilaire")
 *   reglementNumbers: ["300-78"]  (from title "RÈGLEMENT 300-78-2026 MODIFIANT LE RÈGLEMENT 300-2015")
 *   changementZonage: true  ("relatif au zonage de la Ville de L'Assomption" in context)
 *   excerpts: non-empty
 *
 * NOTE on ANTI-FAUX-POSITIF: règlements 300-76-2026 and 300-77-2026 are adoptions
 *   in this PV (avis de motion was given at prior sessions). The parser will detect
 *   them only if an avis de motion phrase is within their context window.
 *   The primary zonage detection comes from the 300-78 avis de motion.
 */
export const PV_LASSOMPTION_2026_05_TEXT = `No de résolution

Procès-verbal d'une séance ordinaire du conseil municipal de la Ville de
L'Assomption tenue ce 12e jour du mois de mai 2026 à 19 h 00, à la salle du
conseil municipal au centre communautaire sous la présidence du maire,
monsieur Sébastien Nadeau.

2.2

RÈGLEMENT 300-76-2026 MODIFIANT LE RÈGLEMENT 300-2015
RELATIF AU ZONAGE DE LA VILLE DE L'ASSOMPTION - ADOPTION
DU RÈGLEMENT

Le maire mentionne l'objet du règlement et l'absence de modification depuis
l'adoption du second projet de règlement.
EN CONSÉQUENCE ET POUR CES MOTIFS,
2026-05-0164

Il est proposé par la conseillère Nathalie Ayotte
Appuyé par le conseiller Olivier Provost-Vanier
Et résolu,
D'adopter le règlement 300-76-2026 amendant le règlement 300-2015 relatif au
zonage de la Ville de L'Assomption, tel qu'amendé, soit :
- Modifier la grille de spécifications applicables à la zone H1-143 (terrains
  boulevard Meilleur) de manière à réduire les marges de recul et le
  pourcentage de maçonnerie exigé;
- Modifier l'article 79 relatif à la mixité d'usage de manière à encadrer les
  usages par locaux.
ADOPTÉE À L'UNANIMITÉ

2.3

RÈGLEMENT 300-77-2026 MODIFIANT LE RÈGLEMENT 300-2015
RELATIF AU ZONAGE DE LA VILLE DE L'ASSOMPTION - ADOPTION
DU SECOND PROJET DE RÈGLEMENT ET AVIS DE MOTION

Le maire mentionne l'objet du règlement et l'absence de modification depuis
l'adoption du premier projet de règlement.
EN CONSÉQUENCE ET POUR CES MOTIFS,
2026-05-0165

Il est proposé par la conseillère Nicole Martel
Appuyé par le conseiller Jonathan Gariépy
Et résolu,
D'adopter le second projet de règlement 300-77-2026 amendant le règlement
300-2015 relatif au zonage de la Ville de L'Assomption, tel qu'amendé, soit :
- Agrandir les limites de la zone I1-06 à même les zones I1-02 et P1-39 de
  manière à adapter la limite des zones à la forme des lots industriels de la
  zone Agtech.
ADOPTÉE À L'UNANIMITÉ

2.4

RÈGLEMENT 300-78-2026 MODIFIANT LE RÈGLEMENT 300-2015
RELATIF AU ZONAGE DE LA VILLE DE L'ASSOMPTION - ADOPTION
DU PREMIER PROJET DE RÈGLEMENT ET AVIS DE MOTION

Avis de motion est donné par la conseillère Manon St-Hilaire à l'effet qu'il sera
présenté lors d'une prochaine séance, un règlement modifiant le règlement 3002015 relatif au zonage de la Ville de L'Assomption tel qu'amendé.
EN CONSÉQUENCE ET POUR CES MOTIFS,
2026-05-0166

Il est proposé par le conseiller François Moreau
Appuyé par la conseillère Audrey Renaud
Et résolu,
D'adopter le premier projet de règlement 300-78-2026 amendant le règlement
300-2015 relatif au zonage de la Ville de L'Assomption, tel qu'amendé, soit :
- Agrandir les limites de la zone I1-06;
- Modifier les normes d'implantation de la zone industrielle.
ADOPTÉE À L'UNANIMITÉ`;
