/**
 * Real procès-verbaux fixture data for Saint-Eustache (Basses-Laurentides) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil
 *     HTTP 200, 195 321 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: /administration, /administration/backend — PV pages allowed.
 *   - PV PDF (2026 compiled, updated through May 2026):
 *     https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2026PV_internet.pdf
 *     HTTP 200, 1 591 967 bytes (PDF), extracted via pdftotext → 6355 lines.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * IMPORTANT: Saint-Eustache publishes PV as yearly COMPILED documents (2026PV_internet.pdf,
 * 2025PV_internet.pdf, etc.) — one file per year, not per session. The parsePvIndex will find
 * the PDF link but cannot extract individual session dates from the compiled document filenames.
 * Each year link has no date in the URL → parsePvIndex returns PV_NON_DISPONIBLE for date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINT_EUSTACHE_INDEX_HTML — verbatim HTML excerpt from the seances page
 *      (c-small-document-card links, annual compiled PDFs, same CMS as Sainte-Thérèse).
 *   2. PV_SAINT_EUSTACHE_2026_02_TEXT — pdftotext excerpt from the February 16, 2026
 *      session inside the 2026 compiled PV.
 *      Contains: Section 4.3.4 — Avis de motion et adoption du projet de règlement 1998
 *      intitulé « Règlement de zonage » visant à remplacer le règlement numéro 1675 en vigueur.
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://www.saint-eustache.ca/ → HTTP 200
 *   - https://www.saint-eustache.ca/robots.txt → Disallow: /administration, /administration/backend
 *   - Target page is NOT under /administration → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true ("Monsieur le maire Marc Lamarre donne avis de motion" présent)
 *   - changementZonage: true (règlement 1998 + "règlement de zonage" in context)
 *   - reglementNumbers: ["1998"] (REGLEMENT_NUMBER_RE: "règlement numéro 1998" → "1998"
 *     doesn't match \d{2,4}-\d{1,4} because "1998" has no hyphen)
 *     BUT: in the context window the text says "remplacer le règlement numéro 1675 en vigueur
 *     concernant le règlement de zonage" → 1675 is the modified bylaw (MODIFIANT_REGLEMENT_RE
 *     would match "règlement numéro 1675... concernant le règlement de zonage")
 *     Honest: no hyphenated règlement numbers extracted; plain "1998" and "1675" have no hyphens.
 *   - NOTE: "1998" alone (no hyphen) does NOT match REGLEMENT_NUMBER_RE \d{2,4}-\d{1,4}
 *     → reglementNumbers will be [] (empty, honest).
 *     changementZonage=true because ZONAGE_KEYWORDS_RE fires + "donne avis de motion" present.
 */

/**
 * Real HTML snippet from the seances page of Ville de Saint-Eustache,
 * captured 2026-06-10 from https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil
 *
 * Saint-Eustache uses annual compiled PDFs (one file per year).
 * Key links (confirmed HTTP 200):
 *   - 2026PV_internet.pdf (Procès-verbaux 2026 — compiled, updated through May 2026)
 *   - 2025PV_internet.pdf (Procès-verbaux 2025 — compiled full year)
 *   - 2024PV_internet.pdf (Procès-verbaux 2024 — compiled full year)
 *   - 2023PV_internet.pdf
 *   - 2022PV_internet.pdf
 */
export const PV_SAINT_EUSTACHE_INDEX_HTML = `
<div class="c-rubric-card || js-accordion" id="accordion-proces-verbaux-2026">
    <div class="c-rubric-card__header || js-accordion-toggle">
        <h2 class="c-rubric-card__title">Procès-verbaux</h2>
    </div>
    <div class="c-rubric-card__content || js-accordion-content" id="accordion-content-proces-verbaux-2026">
        <a class="c-small-document-card" href="https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2026PV_internet.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procès-verbaux 2026</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2025PV_internet.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procès-verbaux 2025</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2024PV_internet.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procès-verbaux 2024</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2023PV_internet.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procès-verbaux 2023</h2>
            </div>
        </a>
        <a class="c-small-document-card" href="https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2022PV_internet.pdf" target="_blank">
            <div class="c-small-document-card__content">
                <h2 class="c-small-document-card__title">Procès-verbaux 2022</h2>
            </div>
        </a>
    </div>
</div>
`;

/**
 * Real pdftotext excerpt from the February 16, 2026 session inside the 2026 compiled PV of
 * Ville de Saint-Eustache, captured 2026-06-10 from:
 * https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2026PV_internet.pdf
 *
 * Key section: 4.3.4 — Avis de motion et adoption du projet de règlement 1998
 * intitulé « Règlement de zonage » visant à remplacer le règlement numéro 1675 en vigueur.
 *
 * Détection honnête:
 *   - avisDeMotion: true ("Monsieur le maire Marc Lamarre donne avis de motion")
 *   - changementZonage: true (ZONAGE_KEYWORDS_RE: "règlement de zonage" in context)
 *   - reglementNumbers: [] ("1998" and "1675" have no hyphens → no match for \d{2,4}-\d{1,4})
 *   Honest: municipality uses non-hyphenated sequential numbering.
 */
export const PV_SAINT_EUSTACHE_2026_02_TEXT = `
Séance ordinaire du conseil municipal de la Ville de Saint-Eustache tenue le 16 février
2026 à 19 heures.
Sont présents(-es) le maire, monsieur Marc Lamarre, les conseillers et conseillères :
Michèle Labelle, Guillaume Lalonde, Sylvie St-Amour, Iann-Carlos Armijo, Karl Béliveau,
Pierre-François Hervieux, Isabelle Lefebvre, Thomas Lebeau, Sylvie Mallette et Yves
Roy, formant le conseil municipal sous la présidence du maire, ainsi que
monsieur François Bélanger, directeur général, et maître Fanny Pineault, assistante-greffière.

4.3.

Avis de motion et adoption de projets de règlements
4.3.1. Règlement numéro 1865-003 intitulé « Règlement abrogeant le règlement 1865
sur les plans d'aménagement d'ensemble »
4.3.2. Règlement numéro 1953-005 intitulé « Règlement modifiant le règlement 1953
visant à assujettir l'émission d'un permis de construction au paiement d'une
contribution »
4.3.3. Règlement numéro 1997 intitulé « Règlement sur le plan d'urbanisme »
4.3.4. Règlement numéro 1998 intitulé « Règlement de zonage »
4.3.5. Règlement numéro 1999 intitulé « Règlement de lotissement »
4.3.6. Règlement numéro 2000 intitulé « Règlement de construction »

-----------------------------------------------------------------------------------4.3.4. Avis de motion
Règlement numéro 1998 intitulé « Règlement de zonage »
À la demande du maire, la directrice du Service de l'urbanisme présente le projet de
règlement portant le numéro 1998 intitulé « Règlement de zonage » visant à remplacer
le règlement numéro 1675 en vigueur.
AVIS DE MOTION
Monsieur le maire Marc Lamarre donne avis de motion, qu'à la prochaine séance ou à
une séance subséquente, un règlement sera présenté visant à remplacer le règlement
numéro 1675 en vigueur concernant le règlement de zonage.
Résolution 2026-02-036
Adoption d'un projet de règlement
Sur proposition de Michèle Labelle, appuyée par Iann-Carlos Armijo il est à l'unanimité
des voix exprimées résolu d'adopter le projet de règlement numéro 1998 intitulé
« Règlement de zonage » et de fixer l'assemblée publique au 10 mars, à 19h, à la
Maison du citoyen.
-----------------------------------------------------------------------------------4.3.5. Avis de motion
Règlement numéro 1999 intitulé « Règlement de lotissement »
À la demande du maire, la directrice du Service de l'urbanisme présente le projet de
règlement portant le numéro 1999 intitulé « Règlement de lotissement » visant à
remplacer le règlement numéro 1673 en vigueur.
AVIS DE MOTION
Monsieur le maire Marc Lamarre donne avis de motion, qu'à la prochaine séance ou à
une séance subséquente, un règlement sera présenté visant à remplacer le règlement
numéro 1673 en vigueur concernant le règlement de lotissement.
Résolution 2026-02-037
Adoption d'un projet de règlement
Sur proposition de Michèle Labelle, appuyée par Iann-Carlos Armijo il est à l'unanimité
des voix exprimées résolu d'adopter le projet de règlement numéro 1999 intitulé
« Règlement de lotissement » et de fixer l'assemblée publique au 10 mars, à 19h, à la
Maison du citoyen.
`;
