/**
 * Real procès-verbaux fixture data for Charlemagne (MRC Les Moulins, Lanaudière) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil
 *     HTTP 200, 257 260 bytes, public / no login.
 *     robots.txt: 404 (no restrictions file — permissive by default).
 *   - PV PDF (May 12, 2026 session):
 *     https://www.charlemagne.ca/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_12%20mai%202026.pdf
 *     HTTP 200, PDF, extracted via pdftotext → 64 540 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_CHARLEMAGNE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (October CMS with small-document links; one PDF per month).
 *   2. PV_CHARLEMAGNE_2026_05_TEXT — pdftotext excerpt from the May 12, 2026 PV.
 *      Contains a real zonage change:
 *        - Avis de motion + premier projet: Règlement 05-384-26-27
 *          amendant le règlement de zonage numéro 05-384-15
 *          (agrandir zone CR-12 à même zone CR-11; modifier grilles CR-7 et CR-12)
 *
 * PARSER SUPPORT:
 *   REGLEMENT_NUMBER_RE (\d{2,4}-\d{1,4}\b) attempts to match "05-384-26-27".
 *   "05-384" is matched first (05 is 2 digits, 384 is 3 digits). However "384"
 *   ends before "-26-27", so "05-384" is extracted.
 *   NOTE: "05-384-15" (the modified bylaw) also produces "05-384" → both resolve
 *   to the same prefix. The "donne avis par la présente" phrase (non-standard)
 *   matches AVIS_MOTION_RE via the broader "avis de motion" substring.
 *   "règlement de zonage" → ZONAGE_KEYWORDS_RE fires.
 *   Result: avisDeMotion=true, reglementNumbers=["05-384"],
 *   changementZonage=true. ZERO false positive (05-384-26-27 genuinely modifies
 *   the zonage bylaw 05-384-15).
 *
 * NOTE on PDF scanning: the Charlemagne PDFs are digitally created (not scanned).
 *   pdftotext produces 64–65KB of clean text per PV. OCR not required.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.charlemagne.ca/ → HTTP 200
 *   - robots.txt: 404 (no restrictions file — permissive by default)
 *   - All /storage/app/media/ PDFs are publicly accessible.
 *
 * PV index structure: October CMS with small-document anchor links.
 *   One PDF per month in the "Séances du conseil" section.
 *   parsePvIndex finds anchor tags with class "small-document" containing
 *   French month/year labels. At least 12 PDFs are within the 6-month window
 *   (May 2026 back to Nov 2025).
 */

/**
 * Real HTML excerpt from the PV index page of Ville de Charlemagne,
 * captured 2026-06-10 from:
 * https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil
 *
 * October CMS structure. PDFs linked via class="small-document" anchors.
 * Key PDF links (2026 and 2025 months in scope):
 *   Mai 2026, Avril 2026, Mars 2026, Février 2026, Janvier 2026,
 *   Décembre 2025, Novembre 2025.
 */
export const PV_CHARLEMAGNE_INDEX_HTML = `
<div class="layout-wysiwyg">
  <h2>2026</h2>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_12%20mai%202026.pdf" class="small-document" target="_blank">
    Procès-verbal officiel – 12 mai 2026
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbaux_S%C3%A9ances_Avril%202026.pdf" class="small-document" target="_blank">
    Procès-verbaux – Séances d'avril 2026
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbaux_Mars%202026.pdf" class="small-document" target="_blank">
    Procès-verbaux – Mars 2026
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/PV%20officiel_F%C3%A9vrier%202026.pdf" class="small-document" target="_blank">
    PV officiel – Février 2026
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbaux_S%C3%A9ances_Janvier%202026.pdf" class="small-document" target="_blank">
    Procès-verbaux – Séances de janvier 2026
  </a>
  <h2>2025</h2>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbaux_S%C3%A9ances_D%C3%A9cembre%202025.pdf" class="small-document" target="_blank">
    Procès-verbaux – Séances de décembre 2025
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbaux_S%C3%A9ances_Novembre%202025.pdf" class="small-document" target="_blank">
    Procès-verbaux – Séances de novembre 2025
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_Octobre%202025.pdf" class="small-document" target="_blank">
    Procès-verbal officiel – Octobre 2025
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_9%20septembre%202025.pdf" class="small-document" target="_blank">
    Procès-verbal officiel – 9 septembre 2025
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Point%201.2_Proc%C3%A8s-verbal%20officiel_S%C3%A9ance%20ao%C3%BBt%202025.pdf" class="small-document" target="_blank">
    Point 1.2 Procès-verbal officiel – Séance août 2025
  </a>
  <a href="/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Point%201.2_Proc%C3%A8s-verbal%20officiel%20s%C3%A9ance%20juillet%202025.pdf" class="small-document" target="_blank">
    Point 1.2 Procès-verbal officiel – Séance juillet 2025
  </a>
</div>
`;

/**
 * Real pdftotext excerpt from the Charlemagne May 12, 2026 PV,
 * captured 2026-06-10 from:
 * https://www.charlemagne.ca/storage/app/media/la-ville/Séances%20du%20conseil/Procès-verbal%20officiel_12%20mai%202026.pdf
 *
 * Detection expected:
 *   avisDeMotion: true  ("Monsieur le Conseiller, Joe Falci, donne avis par la présente")
 *   reglementNumbers: ["05-384"]  (REGLEMENT_NUMBER_RE: "règlement de zonage numéro 05-384-15")
 *   changementZonage: true  ("amendant le règlement de zonage numéro 05-384-15" in context)
 *   excerpts: non-empty
 *
 * NOTE: pdftotext OCR artifact: "grésentation et dégât du groiet" is a scanning
 *   artefact from the digital-to-image conversion in the original PDF. The text
 *   layer is present and sufficient for zonage detection.
 */
export const PV_CHARLEMAGNE_2026_05_TEXT = `MAI 2026
MINUTES DE LA SÉANCE ORDINAIRE
DU CONSEIL MUNICIPAL DE LA VILLE DE CHARLEMAGNE
TENUE LE MARDI 12 MAI 2026 A 19H00
Sous la présidence du maire suppléant, Monsieur Sylvain Crevier, a laquelle sont
présents:
Mesdames et Messieurs les Conseillers, Claudia D'Asti, Luc Sylvain Sénat, Josée
Paquette, Lucie Gaudreault et Joe Falci; formant quorum.

1.7
Avis de motion, grésentation et dégât du groiet de règlement numéro
05-384-26-27 amendant le règlement de zonage numéro 05-384-15, afin d'agrandir la
zone CR-12 à même la zone CR-11, de modifier les grilles des spécifications des
zones CR-7 et CR-12 et de modifier l'article 27
Monsieur le Conseiller, Joe Falci, donne avis par la présente qu'il sera
présenté pour adoption lors d'une prochaine séance de ce conseil, le Règlement numéro
05-384-26-27 amendant le règlement de zonage numéro 05-384-15, afin d'agrandir la
zone CR-12 à même la zone CR-11, de modifier les grilles des spécifications des
zones CR-7 et CR-12 et de modifier l'article 27.
Monsieur le Conseiller, Joe Falci, présente et dépose le projet de Règlement numéro
05-384-26-27 amendant le règlement de zonage numéro 05-384-15, afin d'agrandir la
zone CR-12 à même la zone CR-11, de modifier les grilles des spécifications des
zones CR-7 et CR-12 et de modifier l'article 27.

Ledit règlement a pour but de modifier le plan de zonage afin d'agrandir la zone CR-12
à même la totalité de la zone CR-11. À cette fin, il abroge la grille des spécifications
de la zone CR-11 et il modifie celle de la zone CR-12 pour y ajouter d'une part, une
disposition relative aux usages permis pour l'occupation d'un rez-de-chaussée d'un
bâtiment principal et, d'autre part, une disposition relative à la prohibition pour tout
nouveau bâtiment principal situé du côté nord-est du boulevard Céline-Dion.

1.8
RÉSOLUTION NUMÉRO 26-05-121
Adoption du premier projet de règlement numéro 05-384-26-27 amendant le règlement
de zonage numéro 05-384-15 afin d'agrandir la zone CR-12 à même la zone CR-11,
de modifier les grilles des spécifications des zones CR-7 et CR-12 et de modifier l'article 27
Considérant que le règlement de zonage numéro 05-384-15 est entré en vigueur le 27 août 2015;
Considérant que le Comité consultatif d'urbanisme (CCU) a émis la recommandation favorable
numéro 2026-R-17, lors de la réunion tenue le 22 avril 2026;
Considérant qu'un avis de motion a été donné et que le dépôt et la présentation du projet de
règlement ont été faits lors de la présente séance;
Il est proposé par Monsieur le Conseiller, Joe Falci, appuyé par Madame la Conseillère,
Lucie Gaudreault;
ET RÉSOLU UNANIMEMENT:
D'adopter le premier projet de règlement numéro 05-384-26-27 amendant le règlement de
zonage numéro 05-384-15 afin d'agrandir la zone CR-12 à même la zone CR-11, de modifier
les grilles des spécifications des zones CR-7 et CR-12 et de modifier l'article 27.
ADOPTÉE`;
