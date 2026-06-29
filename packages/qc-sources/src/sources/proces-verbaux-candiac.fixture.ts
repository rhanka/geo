/**
 * Real procès-verbaux fixture data for Candiac (MRC Roussillon) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://candiac.ca/la-ville/vie-democratique/seances-publiques
 *     HTTP 200, 230 768 bytes, public / no login.
 *     robots.txt: Disallow: /admin, /uploads/carrier — content pages allowed.
 *   - PV PDF (April 20, 2026):
 *     https://candiac.ca/uploads/Documents/Juridiques/2026/2026-04-20/2026-04-20_pv_SIGNE.pdf
 *     HTTP 200, 7 391 807 bytes (PDF), 25 pages.
 *     IMPORTANT: All PDFs are PaperCut-produced scanned images (150 dpi JPEG).
 *     pdftotext → 0 bytes (no embedded text layer).  OCR would be required to extract text.
 *     This is a known limitation: text-based zonage detection is NOT possible for Candiac
 *     without OCR.  The adapter still correctly lists available PV refs from the index.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_CANDIAC_INDEX_HTML — verbatim HTML anchor excerpt from the séances-publiques page
 *      (direct PDF links with title and date labels).
 *   2. PV_CANDIAC_SCANNED_NOTE — text describing the scanned-PDF limitation (not real PV text).
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://candiac.ca/ → HTTP 200
 *   - https://candiac.ca/robots.txt → Disallow: /admin, Disallow: /uploads/carrier
 *     (PV PDFs are under /uploads/Documents/Juridiques/ — NOT restricted)
 *
 * Détection attendue (honest, anti-invention):
 *   - Index parsing: parsePvIndex yields ≥5 PDF refs within the 6-month window
 *   - PV text detection: NOT APPLICABLE (scanned PDFs, no text layer)
 *   - The config is registered to enable future scraping with OCR support
 */

/**
 * Real HTML snippet from the séances-publiques page of Ville de Candiac,
 * captured 2026-06-10 from https://candiac.ca/la-ville/vie-democratique/seances-publiques
 *
 * Key PDF links present (2026):
 *   - 2026-01-19_pv_signe.pdf (19 janvier 2026)
 *   - 2026-03-16_pv_SIGNE.pdf (16 février 2026)
 *   - 2026-03-18_pv_signe.pdf (16 mars 2026)
 *   - 2026-04-20_pv_SIGNE.pdf (20 avril 2026)
 *   - 2026-05-25_pv_NON_APPROUVE.pdf (25 mai 2026 – NON APPROUVÉ)
 *   - 2026-05-25_pv_PQI_NON_APPROUVE.pdf (25 mai 2026 – PQI – NON APPROUVÉ)
 * Key PDF links present (recent 2025):
 *   - 2025-12-08_pv_SIGNE.pdf (8 décembre 2025)
 *   - 2025-11-24_pv_signe.pdf (24 novembre 2025)
 *   - 2025-09-15_pv_SIGNE.pdf (15 septembre 2025)
 */
export const PV_CANDIAC_INDEX_HTML = `
<div class="seances-list">
  <ul class="pv-list">
    <li>
      <a title="2026-01-19_pv_signe.pdf (6.47 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-01-19/2026-01-19_pv_signe.pdf" target="_blank" rel="noopener">19 janvier 2026</a>
    </li>
    <li>
      <a title="2026-03-16_pv_SIGNE.pdf (8.13 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-02-16/2026-03-16_pv_SIGNE.pdf" target="_blank" rel="noopener">16 février 2026</a>
    </li>
    <li>
      <a title="2026-03-18_pv_signe.pdf (6.33 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-03-16/2026-03-18_pv_signe.pdf" target="_blank" rel="noopener">16 mars 2026</a>
    </li>
    <li>
      <a title="2026-04-20_pv_SIGNE.pdf (7.05 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-04-20/2026-04-20_pv_SIGNE.pdf" target="_blank" rel="noopener">20 avril 2026</a>
    </li>
    <li>
      <a title="2026-05-25_pv_NON_APPROUVE.pdf (719 KB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_NON_APPROUVE.pdf" target="_blank" rel="noopener">25 mai 2026 (NON APPROUVÉ)</a>
    </li>
    <li>
      <a title="2026-05-25_pv_PQI_NON_APPROUVE.pdf (217 KB)" href="https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_PQI_NON_APPROUVE.pdf" target="_blank" rel="noopener">25 mai 2026 (PQI) (NON APPROUVÉ)</a>
    </li>
    <li>
      <a title="2025-12-08_pv_SIGNE.pdf (6.75 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2025/2025-12-08/2025-12-08_pv_SIGNE.pdf" target="_blank" rel="noopener">8 décembre 2025 </a>
    </li>
    <li>
      <a title="2025-11-24_pv_signe.pdf (8.52 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2025/2025-11-24/2025-11-24_pv_signe.pdf" target="_blank" rel="noopener">24 novembre 2025</a>
    </li>
    <li>
      <a title="2025-09-15_pv_SIGNE.pdf (5.68 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2025/2025-09-15/2025-09-15_pv_SIGNE.pdf" target="_blank" rel="noopener">15 septembre 2025</a>
    </li>
    <li>
      <a title="2025-08-25_pv_signe.pdf (6.75 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2025/2025-08-25/2025-08-25_pv_signe.pdf" target="_blank" rel="noopener">25 août 2025</a>
    </li>
    <li>
      <a title="2025-07-14_pv_signe.pdf (7.99 MB)" href="https://candiac.ca/uploads/Documents/Juridiques/2025/2025-07-14/2025-07-14_pv_signe.pdf" target="_blank" rel="noopener">14 juillet 2025</a>
    </li>
  </ul>
</div>
`;

/**
 * Honest limitation note for Candiac PV text extraction.
 *
 * Candiac produces all PV PDFs via PaperCut as scanned images (150 dpi JPEG,
 * no embedded text layer). pdftotext returns 0 bytes on all tested PDFs
 * (April 2026, May 2026, May 2025 — all confirmed image-only).
 *
 * Therefore:
 *   - detectZonageChange() on an empty string → avisDeMotion: false,
 *     changementZonage: false, reglementNumbers: [] (honest negative).
 *   - Future integration with OCR (e.g. tesseract / cloud vision) would be
 *     required to detect zonage changes for Candiac.
 *
 * This constant is provided for documentation purposes and to test that the
 * adapter correctly handles image-only PDFs (no text → no false positive).
 */
export const PV_CANDIAC_SCANNED_NOTE =
  "SCANNED_PDF_NO_TEXT_LAYER: Candiac PVs are PaperCut scanned images. " +
  "pdftotext returns empty. OCR required for text extraction.";
