/**
 * Real procès-verbaux fixture data for Varennes (MRC Marguerite-D'Youville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.varennes.qc.ca/la-ville/vie-democratique/seances-et-proces-verbaux
 *     HTTP 200, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (April 13, 2026):
 *     https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260413-PV-SO.pdf
 *     HTTP 200, extracted via pdftotext → 62 578 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size reasonable.
 *
 * TWO fixtures are provided:
 *   1. PV_VARENNES_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (custom CMS, two separate lists: ODJ PDFs and PV PDFs).
 *   2. PV_VARENNES_2026_04_TEXT — pdftotext excerpt from the April 13, 2026 PV.
 *      Contains NEW avis de motion for ONE real zonage change:
 *        - A-2026-17: Règlement 707-164 modifiant le règlement de zonage numéro 707
 *          afin d'y apporter diverses corrections, modifications, ajouts et précisions
 *          d'ordre général, technique ou administratif.
 *          "Avis de motion est donné par monsieur le conseiller Marc-André Savaria
 *          Qu'à une séance subséquente de ce conseil tenue à un jour ultérieur, il sera
 *          soumis pour adoption le règlement 707-164 modifiant le règlement de zonage
 *          numéro 707..."
 *
 * PARSER SUPPORT: Varennes uses 3-segment numbering (707-164).
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) matches "707-164" from "règlement 707-164".
 *   "règlement de zonage numéro 707" is the base bylaw — "707" alone (no hyphen) is
 *   not matched by REGLEMENT_NUMBER_RE, so it is NOT in reglementNumbers.
 *   "avis de motion est donné" matches the AVIS_DE_MOTION_RE pattern → avisDeMotion=true.
 *   "règlement de zonage" keyword present → changementZonage=true.
 *   Result: avisDeMotion=true, reglementNumbers=["707-164"], changementZonage=true.
 *   ZERO false positive: 707-164 genuinely modifies the règlement de zonage 707.
 *
 * NOTE: The April 13, 2026 PV also has items 6 and 7 from the agenda relating to
 *   Règlement 707-163 (milieux hydriques) — these were WITHDRAWN from the agenda
 *   ("le maire Martin Damphousse confirme le retrait des sujets ci-après") before
 *   the session, so NO avis de motion for 707-163 was formally given at this session.
 *   Only 707-164 has a formal avis de motion in this PV.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.varennes.qc.ca/ → HTTP 200
 *   - robots.txt: Disallow: (empty — no restrictions)
 *   - All PDFs under /uploads/conseil_municipal/ are publicly accessible.
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Varennes,
 * captured 2026-06-10 from:
 * https://www.ville.varennes.qc.ca/la-ville/vie-democratique/seances-et-proces-verbaux
 *
 * Custom CMS. Two separate sections:
 *   Section 1 (ODJ): list of PDF links for Ordres du jour (séances SO/SE)
 *   Section 2 (PV): list of PDF links for approved Procès-verbaux
 *
 * Key ODJ PDF links (2026 section):
 *   20260112-SO.pdf, 20260202-SO.pdf, 20260216-SE.pdf, 20260309-SO.pdf,
 *   20260413-SO.pdf, 20260504-SO.pdf, 20260601-SO.pdf
 *
 * Key PV PDF links (approved, 2026):
 *   20260413-PV-SO.pdf (April 13, 2026) ← contains zonage avis de motion
 *   20260309-PV-SO.pdf (March 9, 2026)
 *   20260216-PV-SE.pdf (February 16, 2026)
 *   20260202-PV-SO.pdf (February 2, 2026)
 *   20260112-PV-SO.pdf (January 12, 2026)
 */
export const PV_VARENNES_INDEX_HTML = `
<div class="c-content-page">
  <h2>Ordres du jour 2026</h2>
  <ul class="pv-list">
    <li><a title="20260112-SO.pdf (273 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20260112-SO.pdf">Séance ordinaire 12 janvier</a></li>
    <li><a title="20260202-SO.pdf (281 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20260202-SO.pdf">Séance ordinaire 2 février</a></li>
    <li><a title="20260216-SE.pdf (64 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20260216-SE.pdf">Séance extraordinaire 16 février</a></li>
    <li><a title="20260309-SO.pdf (360 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20260309-SO.pdf">Séance ordinaire 9 mars</a></li>
    <li><a title="20260413-SO.pdf (466 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260413-SO.pdf">Séance ordinaire 13 avril</a></li>
    <li><a title="20260504-SO.pdf (410 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260504-SO.pdf">Séance ordinaire 4 mai</a></li>
    <li><a title="20260601-SO.pdf (459 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260601-SO.pdf">Séance ordinaire 1er juin</a></li>
  </ul>
  <h2>Procès-verbaux approuvés 2026</h2>
  <ul class="c-block-documents">
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260413-PV-SO.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 13 avril</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260309-PV-SO.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 9 mars</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260216-PV-SE.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance extraordinaire 16 février</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260202-PV-SO.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 2 février</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20260112-PV-SO.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 12 janvier</span>
      </a>
    </li>
  </ul>
  <h2>Ordres du jour 2025</h2>
  <ul class="pv-list">
    <li><a title="20250113-SO.pdf (268 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250113-SO.pdf">Séance ordinaire 13 janvier</a></li>
    <li><a title="20250310-SO.pdf (269 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250310-SO.pdf">Séance ordinaire 10 mars</a></li>
    <li><a title="20250505-SO.pdf (293 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250505-SO.pdf">Séance ordinaire 5 mai</a></li>
    <li><a title="20250602-SO.pdf (301 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250602-SO.pdf">Séance ordinaire 2 juin</a></li>
    <li><a title="20250818-SO.pdf (283 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250818-SO.pdf">Séance ordinaire 18 août</a></li>
    <li><a title="20251124-SO.pdf (290 KB)" href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20251124-SO.pdf">Séance ordinaire 24 novembre</a></li>
  </ul>
  <h2>Procès-verbaux approuvés 2025</h2>
  <ul class="c-block-documents">
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20251124-SO_PV.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 24 novembre</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20251001-SO_PV.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 1er octobre</span>
      </a>
    </li>
    <li class="c-block-documents_item">
      <a href="https://www.ville.varennes.qc.ca/uploads/conseil_municipal/20250113-SO_PV.pdf" target="_blank" class="c-block-documents_link">
        <span class="c-block-documents_link_label">Séance ordinaire 13 janvier</span>
      </a>
    </li>
  </ul>
</div>
`;

/**
 * Real pdftotext excerpt from Varennes PV April 13, 2026.
 * Source: https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260413-PV-SO.pdf
 * Captured: 2026-06-10
 *
 * Contains NEW avis de motion for ONE real zonage change:
 *   - A-2026-17: Règlement 707-164 modifiant le règlement de zonage numéro 707
 *     afin d'y apporter diverses corrections, modifications, ajouts et précisions
 *     d'ordre général, technique ou administratif, dans le but d'en faciliter
 *     la compréhension et l'application.
 *     "Avis de motion est donné par monsieur le conseiller Marc-André Savaria
 *     Qu'à une séance subséquente de ce conseil tenue à un jour ultérieur, il sera
 *     soumis pour adoption le règlement 707-164 modifiant le règlement de zonage
 *     numéro 707 afin d'y apporter diverses corrections, modifications, ajouts et
 *     précisions d'ordre général, technique ou administratif..."
 *
 * NOTE: Items 6 and 7 from the agenda (Règlement 707-163 milieux hydriques) were
 *   withdrawn by the mayor at the start of the session: "Le maire Martin Damphousse
 *   confirme le retrait des sujets ci-après à l'ordre du jour."
 *   No avis de motion for 707-163 was formally given.
 *
 * DETECTION:
 *   - "Avis de motion est donné" present → avisDeMotion=true.
 *   - "règlement de zonage numéro 707" in forward context → changementZonage=true.
 *   - REGLEMENT_NUMBER_RE extracts "707-164" from "règlement 707-164".
 *   - "707" (base bylaw) alone: not matched as a règlement number (no hyphen).
 *   Result: avisDeMotion=true, reglementNumbers=["707-164"], changementZonage=true.
 *   ZERO false positive: 707-164 genuinely modifies the règlement de zonage 707.
 */
export const PV_VARENNES_2026_04_TEXT = `
Procès-verbal de la séance ordinaire du conseil municipal de la Ville de Varennes,
tenue le lundi 13 avril 2026.

Le maire Martin Damphousse confirme le retrait des sujets ci-après à l'ordre du
jour :
6. Avis de motion – Règlement 707 163 modifiant le règlement de zonage
707 afin de mettre à jour certaines normes applicables aux milieux
hydriques sur l'ensemble du territoire de la Ville, conformément au
Règlement sur l'encadrement d'activités sous la responsabilité des
municipalités réalisées dans des milieux hydriques et des ouvrages de
protection contre les inondations
7. Adoption d'un projet de règlement – Règlement 707-163 modifiant le
règlement de zonage 707 afin de mettre à jour certaines normes
applicables aux milieux hydriques sur l'ensemble du territoire de la Ville

A-2026-17

Avis de motion – Règlement 707-164 modifiant le règlement de zonage
numéro 707 afin d'y apporter diverses corrections, modifications, ajouts
et précisions d'ordre général, technique ou administratif, dans le but d'en
faciliter la compréhension et l'application, et ce, sur l'ensemble du
territoire de la Ville
Avis de motion est donné par monsieur le conseiller Marc-André Savaria
Qu'à une séance subséquente de ce conseil tenue à un jour ultérieur, il sera
soumis pour adoption le règlement 707-164 modifiant le règlement de zonage
numéro 707 afin d'y apporter diverses corrections, modifications, ajouts et
précisions d'ordre général, technique ou administratif, dans le but d'en faciliter
la compréhension et l'application, et ce, sur l'ensemble du territoire de la Ville.
Ledit membre du conseil présente et dépose le projet de règlement visé.

2026-102

Adoption d'un premier projet – Règlement 707-164 modifiant le règlement
de zonage numéro 707 afin d'y apporter diverses corrections,
modifications, ajouts et précisions d'ordre général, technique ou
administratif
D'ADOPTER le projet de règlement 707-164 modifiant le règlement de zonage
numéro 707 afin d'y apporter diverses corrections, modifications, ajouts et
précisions d'ordre général, technique ou administratif, dans le but d'en faciliter
la compréhension et l'application, et ce, sur l'ensemble du territoire de la Ville.
`;
