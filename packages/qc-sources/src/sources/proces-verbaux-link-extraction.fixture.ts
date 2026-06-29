/**
 * Real PV-index fixtures for the link-extraction families the pilot found EMPTY.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * Every HTML excerpt below is copied verbatim from the PUBLIC index page of a
 * real Québec municipality, fetched 2026-06-11. Only the relevant region of the
 * page (the PV list / document-app mount) is kept; navigation chrome is trimmed
 * but the surviving markup is byte-faithful. Nothing is fabricated.
 *
 * Three NEW structural families, each at 0 extracted links with the original
 * `parsePvIndex`:
 *
 *   1. flat-html-list-relative — barnston-ouest (.php static list)
 *      The PV PDFs are linked with `../../upload/...` RELATIVE hrefs and labels
 *      that are month+year only ("Mars 2025"), no "procès-verbal" keyword and
 *      no day. The original parser only resolved `^/` absolute-path hrefs, so
 *      EVERY link was dropped → index page only.
 *      Source: https://www.barnston-ouest.ca/fr/municipalite/proces-verbaux.php
 *
 *   2. gestionweblex-doc-list — courcelles-saint-evariste (muncste.ca SaaS)
 *      The document list is rendered CLIENT-SIDE by the gestionweblex `doc-list`
 *      app (`apps.gestionweblex.ca//doc-list/assets/list.ashx?listid=…`). The
 *      server HTML carries ZERO PV document links — only the JS mount. Scraping
 *      the static HTML can only ever capture sibling navigation pages, never the
 *      PVs. This family REQUIRES a headless browser (obscura).
 *      Source: https://www.muncste.ca/pages/proces-verbaux-secteur-courcelles
 *
 *   3. asp-net-postback — gatineau (default.aspx portal)
 *      An ASP.NET portal whose body anchors are injected by `scripts.js` after
 *      load; the served HTML has a `<base href>` pointing at a /docs/ path and
 *      NO PV anchors in the body. Following links naively captured the wrong
 *      target (sto.ca) at the pilot. This family REQUIRES a headless browser.
 *      Source: https://www.gatineau.ca/portail/default.aspx?p=publications_cartes_statistiques_donnees_ouvertes/proces_verbaux
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. flat-html-list-relative — barnston-ouest (relative ../../ PDF links)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verbatim PV-list region from barnston-ouest's proces-verbaux.php.
 * Index URL: https://www.barnston-ouest.ca/fr/municipalite/proces-verbaux.php
 * → relative links resolve against that .php path's directory.
 */
export const PV_BARNSTON_OUEST_INDEX_HTML = `<div class="container">
<div class="row">
<h1>Procès-verbaux</h1>
<h2>2026</h2>
<ul>
<li><a href="../../upload/documents/Proces-verbaux/pv-2026-01.pdf" target="_blank" rel="noopener noreferrer">Janvier 2026</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2026-02.pdf" target="_blank" rel="noopener noreferrer">Février 2026</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2026-03.pdf" target="_blank" rel="noopener noreferrer">Mars 2026</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2026-04.pdf" target="_blank" rel="noopener noreferrer">Avril 2026</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2026-05-2.pdf" target="_blank" rel="noopener noreferrer">Mai 2026</a></li>
</ul>
<h2>2025</h2>
<ul>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-01.pdf" target="_blank" rel="noopener noreferrer">Janvier 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-02.pdf" target="_blank" rel="noopener noreferrer">Février 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-03.pdf" target="_blank" rel="noopener noreferrer">Mars 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-04.pdf" target="_blank" rel="noopener noreferrer">Avril 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-05.pdf" target="_blank" rel="noopener noreferrer">Mai 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-06.pdf" target="_blank" rel="noopener noreferrer">Juin 2025</a></li>
<li><a href="../../upload/documents/Proces-verbaux/pv-2025-12-Budget-2.pdf" target="_blank" rel="noopener noreferrer">Décembre 2025-Budget</a></li>
</ul>
</div>
</div>`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. gestionweblex-doc-list — courcelles (client-side rendered, obscura needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verbatim head/mount region from muncste.ca (gestionweblex SaaS). The PV list
 * is loaded by the `doc-list` app at runtime — the served HTML has NO document
 * link. The only "PV" anchors present are sibling navigation pages (the hub
 * links between sectors), which must NOT be mistaken for PV documents.
 * Index URL: https://www.muncste.ca/pages/proces-verbaux-secteur-courcelles
 */
export const PV_GESTIONWEBLEX_INDEX_HTML = `<!doctype html>
<html lang="fr-CA">
<head>
<base href="https://www.muncste.ca/" />
<link rel="StyleSheet" type="text/css" href="https://apps.gestionweblex.ca/doc-list/assets/styles.css" />
<script src="https://apps.gestionweblex.ca//doc-list/assets/scripts.js" type="text/javascript"></script>
</head>
<body>
<nav class="menu">
<a href='https://www.muncste.ca/pages/conseil-municipal'>Conseil municipal</a>
<a href='https://www.muncste.ca/pages/seances-du-conseil'>Calendrier des séances</a>
<a href='https://www.muncste.ca/pages/proces-verbaux-regroupement'>Procès-verbaux (regroupement)</a>
<a href='https://www.muncste.ca/pages/proces-verbaux-secteur-courcelles'>Procès-verbaux (secteur Courcelles)</a>
</nav>
<main>
<h1>Procès-verbaux (secteur Courcelles)</h1>
<div class="doc-list-app" data-app="doc-list"></div>
<script src="https://apps.gestionweblex.ca//doc-list/assets/list.ashx?listid=31c09254-b045-4865-94d7-afe3359ea23f&amp;culture=fr-CA" type="text/javascript"></script>
</main>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// 3. asp-net-postback — gatineau (JS-injected body, <base href>, obscura needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verbatim head + (empty) body region from gatineau's default.aspx PV portal.
 * The body anchors are injected by `scripts.js` after load — the served HTML has
 * a `<base href>` to a /docs/ path and NO PV anchors. Naively following links
 * here captured sto.ca at the pilot.
 * Index URL: https://www.gatineau.ca/portail/default.aspx?p=publications_cartes_statistiques_donnees_ouvertes/proces_verbaux
 */
export const PV_ASPNET_GATINEAU_INDEX_HTML = `<!doctype html>
<html lang="fr-CA">
<head>
<base href="https://www.gatineau.ca/docs/publications_cartes_statistiques_donnees_ouvertes/proces_verbaux/" />
<title>Procès-verbaux - Ville de Gatineau</title>
<script src="/portail/sites/commun/modele/scripts/scripts.js?2026061115"></script>
<script src="/portail/sites/ville/modele/scripts/scripts.js?2026061115"></script>
</head>
<body class="aspnet-portail">
<header>
<a href="/portail/default.aspx?p=accueil">Accueil</a>
<a href="https://www.sto.ca/">Société de transport de l'Outaouais</a>
</header>
<main id="contenu">
<h1>Procès-verbaux</h1>
<div id="liste-documents"><!-- rempli par scripts.js --></div>
</main>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// 4. download-endpoint CMS — municipalityshigawake.com (real PV via /download/)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real excerpt from the procès-verbaux page of the Municipality of Shigawake
 * (Gaspésie), captured 2026-06-27 from:
 *   https://municipalityshigawake.com/fr/documentation/proces-verbaux/
 *   HTTP 200, public / no login. robots.txt: no Disallow on the path.
 *
 * The CMS serves every PV through an extension-less DOWNLOAD ENDPOINT
 * (`/download/<cat>/<slug>/<id>/<file-slug>`), NOT a `.pdf` href. The static
 * link extractor must treat these as documents (looksLikeDocumentHref matches
 * the `/download/` path segment). The page lists 40+ such PVs; this excerpt
 * keeps three verbatim anchors plus a sibling navigation link.
 */
export const PV_SHIGAWAKE_DOWNLOAD_INDEX_HTML = `<!doctype html>
<html lang="fr-CA"><head><title>Procès-verbaux</title></head><body>
<nav><a href="https://municipalityshigawake.com/fr/documentation/reglements/" class="elementor-sub-item">Règlements</a></nav>
<main><h1>Procès-verbaux</h1>
<ul>
<li><a href="https://municipalityshigawake.com/download/230/proces-verbaux-2026/3434/pv-reunion-extraordinaire-26-mai-2026">PV réunion extraordinaire 26 mai 2026</a></li>
<li><a href="https://municipalityshigawake.com/download/230/proces-verbaux-2026/3436/pv-12-mai-2026">PV 12 mai 2026</a></li>
<li><a href="https://municipalityshigawake.com/download/220/proces-verbaux/3281/pv-reunion-reguliere-du-05-mai-2025">Procès-verbal réunion régulière 5 mai 2025</a></li>
</ul>
</main></body></html>`;
