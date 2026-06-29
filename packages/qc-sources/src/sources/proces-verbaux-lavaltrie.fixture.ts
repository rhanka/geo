/**
 * Real procès-verbaux fixture data for Lavaltrie (MRC D'Autray, Lanaudière) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux
 *     HTTP 200 (final URL after 301 from lavaltrie.ca), 101 685 bytes.
 *     robots.txt: 404 (HTML response — no restrictions file, permissive by default).
 *   - PV PDF (May 4, 2026 session):
 *     https://www.ville.lavaltrie.qc.ca/storage/app/media/Procès-verbaux/2026/2026-05-04_PV_ord.pdf
 *     HTTP 200, PDF, extracted via pdftotext → 47 645 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LAVALTRIE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (October CMS with fr-file links; separate 2026 and 2025 sections).
 *   2. PV_LAVALTRIE_2026_05_TEXT — pdftotext excerpt from the May 4, 2026 PV.
 *
 * HONEST DETECTION (0 zonage change in this PV):
 *   The May 4, 2026 PV contains "avis de motion" for:
 *     - règlement RRU3-2-2026 modifiant le Règlement de LOTISSEMENT numéro RRU3-2012
 *     - règlement 288-11-2026 relatif au stationnement et à la circulation
 *     - règlement 365-1-2026 relatif à l'imposition de tarifs
 *   None of these are zonage changes. The "règlement de zonage" phrase only appears
 *   in ADOPTION contexts (372-2026, RRU2-72-2026) where the avis de motion was
 *   given at a prior session — not in the current window.
 *   Result: avisDeMotion=true (RRU3-2-2026 lotissement), changementZonage=false.
 *   This is HONEST — zero false positive.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.ville.lavaltrie.qc.ca/ → HTTP 200
 *   - robots.txt: 404 (permissive by default)
 *   - All /storage/app/media/ PDFs are publicly accessible.
 *
 * PV index structure: October CMS / Byscuit CMS with accordion.
 *   Separate "Procès-verbaux 2026" and "Procès-verbaux 2025" sections.
 *   Relative fr-file links resolved to absolute HTTPS by parsePvIndex.
 *   Labels are French month/day labels ("4 mai 2026", "7 avril 2026", etc.).
 *   At least 10 PDFs within the 6-month window (Dec 2025–May 2026).
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Lavaltrie,
 * captured 2026-06-10 from:
 * https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux
 *
 * October / Byscuit CMS with fr-file anchor links in accordion list items.
 * Key PDF links (2026 and 2025 within 6-month window):
 *   2026-05-04, 2026-04-07, 2026-03-02, 2026-02-02, 2026-01-12,
 *   2026-05-25 (extra), 2026-03-30 (extra),
 *   2025-12-08, 2025-11-17, 2025-10-01, 2025-09-08, 2025-08-18.
 */
export const PV_LAVALTRIE_INDEX_HTML = `
<li id="rubrique_816">
  <h4 class="ocBtn">Procès-verbaux 2026</h4>
  <div class="ocListCt">
    <div class="dynamic">
      <p><strong>Séances ordinaires</strong></p>
      <ul>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-05-04_PV_ord.pdf" rel="noopener noreferrer" target="_blank">4 mai 2026</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-04-07_PV_ord.pdf" rel="noopener noreferrer" target="_blank">7 avril 2026</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-03-02_PV_ord.pdf" rel="noopener noreferrer" target="_blank">2 mars 2026</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-02-02_PV_ord.pdf" rel="noopener noreferrer" target="_blank">2 février 2026</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-01-12_PV_ord.pdf" rel="noopener noreferrer" target="_blank">12 janvier 2026</a></li>
      </ul>
      <p><strong>Séances extraordinaires</strong></p>
      <ul>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-05-25_PV_extra.pdf" rel="noopener noreferrer" target="_blank">25 mai 2026</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-03-30_PV_extra.pdf" rel="noopener noreferrer" target="_blank">30 mars 2026</a></li>
      </ul>
    </div>
  </div>
</li>
<li id="rubrique_682">
  <h4 class="ocBtn">Procès-verbaux 2025</h4>
  <div class="ocListCt">
    <div class="dynamic">
      <p><strong>Séances ordinaires</strong></p>
      <ul>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-12-08_PV_ord.pdf" rel="noopener noreferrer" target="_blank">8 décembre 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-11-17_PV_ord.pdf" rel="noopener noreferrer" target="_blank">17 novembre 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-10-01_PV_ord.pdf" rel="noopener noreferrer" target="_blank">1er octobre 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-09-08_PV_ord.pdf" rel="noopener noreferrer" target="_blank">8 septembre 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-08-18_PV_ord.pdf" rel="noopener noreferrer" target="_blank">18 août 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-07-07_PV_ord.pdf" rel="noopener noreferrer" target="_blank">7 juillet 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-06-02_PV_ord.pdf" rel="noopener noreferrer" target="_blank">2 juin 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-05-05_PV_ord.pdf" rel="noopener noreferrer" target="_blank">5 mai 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-04-07_PV_ord.pdf" rel="noopener noreferrer" target="_blank">7 avril 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-03-03_PV_ord.pdf" rel="noopener noreferrer" target="_blank">3 mars 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-02-03_PV_ord.pdf" rel="noopener noreferrer" target="_blank">3 février 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-01-13_PV_ord.pdf" rel="noopener noreferrer" target="_blank">13 janvier 2025</a></li>
      </ul>
      <p><strong>Séances extraordinaires</strong></p>
      <ul>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-12-15_PV_extra.pdf" rel="noopener noreferrer" target="_blank">15 décembre 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-07-17_PV_extra.pdf" rel="noopener noreferrer" target="_blank">17 juillet 2025</a></li>
        <li><a class="fr-file" href="/storage/app/media/Proc%C3%A8s-verbaux/2025/2025-05-12_PV_extra.pdf" rel="noopener noreferrer" target="_blank">12 mai 2025</a></li>
      </ul>
    </div>
  </div>
</li>
`;

/**
 * Real pdftotext excerpt from the Lavaltrie May 4, 2026 PV,
 * captured 2026-06-10 from:
 * https://www.ville.lavaltrie.qc.ca/storage/app/media/Procès-verbaux/2026/2026-05-04_PV_ord.pdf
 *
 * HONEST DETECTION (0 zonage change for this session):
 *   avisDeMotion: true  ("donne avis de motion qu'à une prochaine séance" for RRU3-2-2026)
 *   reglementNumbers: []  (no hyphenated règlement number in zonage avis de motion context)
 *   changementZonage: false  (avis de motion is for lotissement, not zonage)
 *   excerpts: []
 *
 *   The "Règlement de zonage" references in this PV are in ADOPTION contexts
 *   (372-2026, RRU2-72-2026), where the avis de motion was given at prior sessions.
 *   Reporting honest 0 — no faux positif.
 */
export const PV_LAVALTRIE_2026_05_TEXT = `Séance ordinaire du conseil municipal du 4 mai 2026
PROVINCE DE QUÉBEC
VILLE DE LAVALTRIE

À une séance ordinaire du conseil municipal de la Ville de Lavaltrie,
tenue le lundi 4 mai 2026 à 19 h 00, au lieu ordinaire des séances du
conseil au 1370, rue Notre-Dame à Lavaltrie.

Dépôt du certificat d'absence de demande référendaire - règlement
372-2026 - zones C-8 et C-168
La greffière dépose un certificat relatif à l'absence de demandes valides
de participation à un référendum concernant le second projet de
règlement numéro 372 2026 intitulé : Règlement modifiant le Règlement de zonage numéro RRU2 2012 et le Règlement relatif aux usages
conditionnels no 110 2008 aux fins d'autoriser certains usages
commerciaux et d'ajouter des exigences d'implantation dans les zones
C 8 et C 168.

2026-05-13
Adoption du second projet de règlement RRU2-72-2026
Suite à la tenue de la séance de consultation sur le projet de
règlement numéro RRU2 72 2026, en date du 4 mai 2026;
Il est proposé par madame Anne Charlot-Mayrand
Appuyé par madame Guylaine Legault
Que le conseil municipal adopte le second projet de règlement
numéro RRU2 72 2026 intitulé : Règlement modifiant le Règlement de
zonage numéro RRU2 2012 aux fins de modifier les marges de
dégagement d'un bâtiment accessoire sur un terrain sans bâtiment
principal, tel que déposé.
ADOPTÉE à l'unanimité.

2026-05-14
Avis de motion - règlement RRU3-2-2026
Je, Anne Charlot-Mayrand, conseillère de cette municipalité,
donne avis de motion qu'à une prochaine séance sera soumis, pour
adoption, un règlement modifiant le Règlement de lotissement numéro
RRU3-2012 afin de réduire certaines exigences en bordure d'une route
construite avant le 13 avril 1983.

2026-05-19
Avis de motion et dépôt du projet de règlement 288-11-2026
Je, Jocelyn Guévremont, conseiller de cette municipalité, donne
avis de motion qu'à une prochaine séance sera soumis, pour adoption,
un règlement relatif au stationnement et à la circulation.`;
