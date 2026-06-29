/**
 * Real procès-verbaux fixture data for Saint-Jacques-le-Mineur
 * (MRC Les Jardins-de-Napierville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (séances page): https://www.saint-jacques-le-mineur.ca/seances-du-conseil/
 *     HTTP 200, public / no login.
 *     robots.txt: Crawl-delay: 10 / User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (February 17, 2026):
 *     https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/02/PV_2026-02-17.pdf
 *     HTTP 200, 57 934 bytes text layer (pdftotext), public / no login.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_JACQUES_LE_MINEUR_INDEX_HTML — verbatim HTML excerpt from
 *      the séances page (custom WordPress theme with avis_public_item cards).
 *   2. PV_SAINT_JACQUES_LE_MINEUR_2026_02_TEXT — pdftotext excerpt from the
 *      real February 17, 2026 PV containing avis de motion + zonage change 1212-2026.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.saint-jacques-le-mineur.ca/ → HTTP 200
 *   - https://www.saint-jacques-le-mineur.ca/robots.txt →
 *       Crawl-delay: 10, Disallow: (empty — no restrictions)
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("donne avis de motion" présent pour 1212-2026)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "Madame Francine Gingras donne avis de motion qu'à une prochaine séance sera
 *     soumis pour adoption le règlement numéro 1212-2026 modifiant le règlement de
 *     zonage numéro 1200-2018 (Zones commerciales)"
 *     REGLEMENT_NUMBER_RE matches "1212-2026" (4+4 digits).
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage numéro 1200-2018".
 *     reglementNumbers: ["1212-2026"] (1200-2018 excluded as modified bylaw)
 */

/**
 * Real HTML excerpt from the séances du conseil page of Municipalité de
 * Saint-Jacques-le-Mineur, captured 2026-06-10 from:
 * https://www.saint-jacques-le-mineur.ca/seances-du-conseil/
 *
 * The page uses a custom WordPress theme with avis_public_carousel structure.
 * Each session is an .avis_public_item with:
 *   - .tag: date text (e.g. "17 mars 2026")
 *   - h3: session type ("Séance ordinaire" / "Séance extraordinaire")
 *   - .downloads_row entries linking to OJ (ordre du jour) and PV PDFs
 *
 * Direct PDF links found on page (captured 2026-06-10):
 *   2026-05-19: PV-POUR-ADOPTION-2026-05-19.pdf (projet)
 *   2026-04-21: PV-2026-04-21.pdf
 *   2026-04-01: PV-SE-2026-04-01-1.pdf (extraordinaire)
 *   2026-03-17: PV_SO-2026-03-17.pdf ← the zonage PV
 *   2026-03-09: PV-SE-2026-03-09.pdf (extraordinaire)
 *   2026-02-17: PV_2026-02-17.pdf
 *   2026-01-20: PV_2026-01-20.pdf
 *   2025-12-09: PV_2025-12-09.pdf + PV_budget_2025-12-09.pdf
 *   2025-11-17: (PV pour adoption)
 */
export const PV_SAINT_JACQUES_LE_MINEUR_INDEX_HTML = `
<div class="avis_public_carousel conseil">
  <div class="avis_public_item item">
    <span class="tag">19 mai 2026</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>ORDRE DU JOUR</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/05/OJ-FINALE-2026-05-19.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
    <div class="downloads_row">
      <div class="title"><p><strong>PROJET DE PROCÈS-VERBAL </strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/05/PV-POUR-ADOPTION-2026-05-19.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">21 avril 2026</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>ORDRE DU JOUR</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/04/OJ-FINAL_-2026-04-21.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL </strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/04/PV-2026-04-21.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">1 avril 2026</span>
    <h3>Séance extraordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/04/PV-SE-2026-04-01-1.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">17 mars 2026</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/03/PV_SO-2026-03-17.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">9 mars 2026</span>
    <h3>Séance extraordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/03/PV-SE-2026-03-09.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">17 février 2026</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/02/PV_2026-02-17.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">20 janvier 2026</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/01/PV_2026-01-20.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
  <div class="avis_public_item item">
    <span class="tag">9 décembre 2025</span>
    <h3>Séance ordinaire</h3>
    <div class="downloads_row">
      <div class="title"><p><strong>PROCÈS-VERBAL</strong></p></div>
      <a href="https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2025/12/PV_2025-12-09.pdf" target="_blank"><img src="/wp-content/uploads/2023/11/download-1.png"/></a>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from the February 17, 2026 ordinary council session PV of
 * Municipalité de Saint-Jacques-le-Mineur, captured 2026-06-10 from:
 * https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/02/PV_2026-02-17.pdf
 *
 * This excerpt covers the AMÉNAGEMENT ET URBANISME section with:
 *   - Resolution 2026-02-031: Avis de motion du règlement numéro 1212-2026
 *     modifiant le règlement de zonage numéro 1200-2018 (Zones commerciales) ← DÉTECTION
 *   - Resolution 2026-02-032: Projet de règlement numéro 1212-2026 (deuxième dépôt)
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("donne avis de motion" présent — Francine Gingras)
 *   - changementZonage: true (DÉTECTION RÉELLE)
 *     "Madame Francine Gingras donne avis de motion qu'à une prochaine séance sera
 *     soumis pour adoption le règlement numéro 1212-2026 modifiant le règlement de
 *     zonage numéro 1200-2018 (Zones commerciales)"
 *     REGLEMENT_NUMBER_RE matches "1212-2026" (4+4 digits format).
 *     ZONAGE_KEYWORDS_RE fires on "règlement de zonage numéro 1200-2018".
 *     "1200-2018" excluded as modified bylaw by filterNewReglements logic.
 *     reglementNumbers: ["1212-2026"]
 */
export const PV_SAINT_JACQUES_LE_MINEUR_2026_02_TEXT = `AMÉNAGEMENT ET URBANISME

6600

17 FÉVRIER 2026

2026-02-031

3.7.

Avis de motion du règlement numéro 1212-2026 modifiant
le règlement de zonage numéro 1200-2018 (Zones
commerciales)

Madame Francine Gingras donne avis de motion qu'à une prochaine
séance sera soumis pour adoption le règlement numéro 1212-2026
modifiant le règlement de zonage numéro 1200-2018 (Zones
commerciales).
L'objet de ce règlement est d'assurer la concordance au règlement
numéro URB-205-19-2025 modifiant le Schéma d'aménagement et de
développement révisé de la MRC des Jardins-de-Napierville et relatif à
la création d'une aire d'affectation autoroutière.
 ADOPTÉE
Afin de préciser la portée du présent avis de motion et de dispenser le
conseil de la lecture dudit règlement lors de son adoption, une copie du
projet de règlement est remise aux membres du conseil présents et des
copies supplémentaires seront disponibles pour les membres absents.

2026-02-032

3.8.

Projet de règlement numéro 1212-2026 modifiant le
règlement de zonage numéro 1200-2018 (Zones
commerciales)

CONSIDÉRANT le règlement de zonage numéro 1200-2018 entré en
vigueur le 29 août 2018 et visant à gérer les usages et l'aménagement
du territoire de la municipalité de Saint-Jacques-le-Mineur;
CONSIDÉRANT QU'il y a lieu de modifier le règlement de zonage afin
d'assurer la concordance au Schéma d'aménagement et de
développement révisé de la MRC des Jardins-de-Napierville suite à
l'entrée en vigueur du règlement d'amendement numéro URB-205-19-2025;
CONSIDÉRANT QUE le Conseil tiendra le mardi 17 mars 2026, une
assemblée de consultation afin d'entendre les avis des personnes et
organismes intéressés;
CONSÉQUEMMENT, il est proposé par madame Francine Gingras et
résolu UNANIMEMENT par les membres du conseil présents, d'adopter
le projet de règlement numéro 1212-2026 intitulé « Règlement
amendant le règlement de zonage numéro 1200-2018 (Zones
commerciales) ».
 ADOPTÉE
`;
