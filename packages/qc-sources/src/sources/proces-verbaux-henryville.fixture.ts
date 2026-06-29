/**
 * Real procès-verbaux fixture data for Henryville
 * (MRC Haut-Richelieu) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML (procès-verbaux page):
 *     https://henryville.ca/conseil-municipal/proces-verbaux/
 *     HTTP 200, public / no login.
 *     robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 *   - PV PDF (January 12, 2026):
 *     http://henryville.ca/wp-content/uploads/2026/03/proces-verbal-20260112.pdf
 *     HTTP 200, text-layer PDF (pdftotext, 6 pages), public / no login.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_HENRYVILLE_INDEX_HTML — verbatim HTML excerpt from the procès-verbaux
 *      page (WordPress with yearly list of PV PDF links).
 *   2. PV_HENRYVILLE_2026_01_TEXT — pdftotext excerpt from the real
 *      January 12, 2026 PV (ordinary session). No zonage change detected:
 *      avis de motion for emprunt (borrowing) only. Honest zero.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://henryville.ca/ → HTTP 200
 *   - https://henryville.ca/robots.txt →
 *       User-agent: * / Disallow: /wp-admin/ / Allow: /wp-admin/admin-ajax.php
 *       → wp-content/uploads is NOT restricted → scraping allowed
 *   - Target page is public → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true (for règlements 238-2026 and 239-2026 — emprunt/borrowing)
 *   - changementZonage: false (HONEST ZERO)
 *     The two avis de motion concern règlements d'emprunt for aqueduc works, NOT
 *     a zonage change. "règlement de zonage" does not appear in the motion context.
 *     ZONAGE_KEYWORDS_RE does not fire → changementZonage remains false.
 *     Only one 2026 PV published in the 6-month window at capture date.
 *
 * NOTE (network context): Only one 2026 PV was available at capture date
 * (2026-06-10). The 2025 PVs within the 6-month window
 * (décembre 2025, novembre 2025) are included in the index below.
 */

/**
 * Real HTML excerpt from the procès-verbaux page of Municipalité de
 * Henryville, captured 2026-06-10 from:
 * https://henryville.ca/conseil-municipal/proces-verbaux/
 *
 * The page uses a WordPress theme with yearly sections and a list of PV links.
 * Links for 2025 are HTTP (not HTTPS) — parsePvIndex resolves them to the
 * base host. 2023 links use HTTPS directly.
 *
 * Direct PDF links found on page (captured 2026-06-10, 2025-2026 section):
 *   2026-01-12: proces-verbal-20260112.pdf ← only 2026 PV
 *   2025-12-01: proces-verbal-20251201.pdf
 *   2025-12-17: proces-verbal-20251217.pdf (extraordinaire)
 *   2025-11-10: proces-verbal-20251011.pdf
 *   2025-09-08: proces-verbal-20250908.pdf
 *   2025-08-04: proces-verbal-20250804.pdf
 *   2025-07-07: proces-verbal-7-juillet-2025.pdf
 */
export const PV_HENRYVILLE_INDEX_HTML = `<h2>2026</h2>
<ul>
  <li><a href="http://henryville.ca/wp-content/uploads/2026/03/proces-verbal-20260112.pdf">12 janvier 2026</a> – Séance régulière</li>
</ul>
<h2>2025</h2>
<ul>
  <li><a href="http://henryville.ca/wp-content/uploads/2026/01/proces-verbal-20251217.pdf">17 décembre 2025</a> – Séance extraordinaire</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2026/01/proces-verbal-20251201.pdf">1er décembre 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2026/01/proces-verbal-20251011.pdf">10 novembre 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2025/09/proces-verbal-20250908.pdf">8 septembre 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2025/09/proces-verbal-20250804.pdf">4 août 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2025/09/proces-verbal-7-juillet-2025.pdf">7 juillet 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2025/09/9-pv-2-juin.pdf">2 juin 2025</a> – Séance régulière</li>
  <li><a href="http://henryville.ca/wp-content/uploads/2025/09/7-pv-5-mai.pdf">5 mai 2025</a> – Séance régulière</li>
</ul>`;

/**
 * Real pdftotext excerpt from the January 12, 2026 ordinary council session PV of
 * Municipalité de Henryville, captured 2026-06-10 from:
 * http://henryville.ca/wp-content/uploads/2026/03/proces-verbal-20260112.pdf
 *
 * This excerpt covers the avis de motion sections — all concerning emprunt
 * (borrowing) for aqueduc works, NOT a zonage change.
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("UN AVIS DE MOTION est donné" pour règl. 238-2026 emprunt)
 *   - changementZonage: false (HONEST ZERO — no zonage keyword in motion context)
 *     "règlement décrétant un emprunt de 95 000$ pour le branchement à l'aqueduc"
 *     "règlement décrétant un emprunt de 152 000$ pour l'ajout de borne fontaine"
 *     Neither context contains "zonage" or "règlement de zonage".
 *     reglementNumbers: [] (empty — no zonage motion)
 */
export const PV_HENRYVILLE_2026_01_TEXT = `CANADA
PROVINCE DE QUÉBEC
MRC DU HAUT RICHELIEU
MUNICIPALITÉ DE HENRYVILLE
Procès-verbal de la séance ordinaire du conseil municipal de Henryville du
lundi 12 janvier 2026, tenue au 110, rue Grégoire, à Henryville

1.7

Avis de motion décrétant un emprunt pour le branchement des propriétés sur le
rang du Bord de l'eau

1.8

Avis de motion décrétant un emprunt pour l'ajout de borne fontaine sur le rang
du Bord de l'eau

1.7

Avis de motion décrétant un emprunt (238-2026) pour le branchement des
propriétés sur le rang du Bord de l'eau
CONSIDÉRANT que le ministère des Affaires municipales a refusé le
règlement d'emprunt numéro 235-2025 concernant les travaux de branchement
au nouveau réseau d'aqueduc & d'ajout de borne fontaine sur le rang du Bord
de l'eau
CONSIDÉRANT que deux types de taxation étaient prévus au règlement, il est
nécessaire de le scinder en deux règlements différents. Un pour les
branchements des résidences à l'aqueduc et un pour l'ajout de bornes fontaines
dans le secteur
UN AVIS DE MOTION est donné par monsieur Michel Lord
QUE LE CONSEIL ADOPTERA a une séance ultérieure un règlement
décrétant un emprunt de 95 000$ pour le branchement à l'aqueduc des propriétés
sur le rang du bord de l'eau
Adopté

1.8

Avis de motion décrétant un emprunt (239-2026) pour l'ajout de borne
fontaine sur le rang du Bord de l'eau
CONSIDÉRANT que le ministère des Affaires municipales a refusé le
règlement d'emprunt numéro 235-2025 concernant les travaux de branchement
au nouveau réseau d'aqueduc & d'ajout de borne fontaine sur le rang du Bord
de l'eau
CONSIDÉRANT que deux types de taxation étaient prévus au règlement il est
nécessaire de le scinder en deux règlements différents. Un pour les
branchements des résidences à l'aqueduc et un pour l'ajout de bornes fontaines
dans le secteur
UN AVIS DE MOTION est donné par madame Annie Gagnon
QUE LE CONSEIL ADOPTERA à une séance ultérieure un règlement
décrétant un emprunt de 152 000$ pour l'ajout de borne fontaine sur le rang du
Bord de l'eau
Adopté`;
