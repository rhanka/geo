/**
 * Recorded REAL HTML excerpt from the live Beauharnois avis-publics page,
 * captured 2026-06-08 from
 * https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics
 * (server-side HTTP GET, HTTP 200, 507 917 bytes, public / no login).
 *
 * Beauharnois runs WordPress (block editor) — a DIFFERENT CMS from Valleyfield
 * (Craft, `icon-block--is-link`). Notices are authored as `<details>` blocks
 * whose `<summary>` carries the full notice title and whose `<p>` body carries
 * descriptive text (bylaw/lot references); each block links its PDF(s) via the
 * WordPress `wp-block-file` block (`<a id="wp-block-file--media-…">`).
 *
 * NOTHING here is fabricated: every `<details>`/`<summary>`/`<p>`/`<a>` below is
 * a faithful verbatim slice of the source document (whitespace preserved). Four
 * genuine current notices (dérogation mineure DM-2026-0037, consultation /
 * projet 701-102, deux entrées en vigueur — règlements 2026-07 et 2026-11). The
 * fixture is the single canonical Beauharnois sample shared by the parser tests,
 * the adapter tests and the avis-enriched ontology seed.
 */
export const AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML = `
<div class="wp-block-group">
<details class="wp-block-details is-layout-flow wp-block-details-is-layout-flow"><summary>Avis public : demande de dérogation mineure DM-2026-0037</summary>
<p class="wp-block-paragraph">Le conseil de la Ville de Beauharnois statuera sur une demande de dérogation mineure au sens des articles 145.1 à 145.8 de la Loi sur l’aménagement et l’urbanisme, relative à l’immeuble suivant :</p>



<p class="wp-block-paragraph">DM-2026-0037 – 309 Principale, lot 4 716 761<br>La demande vise à autoriser la subdivision du lot 4 716 761, créant 2 lots et réduisant le frontage à une largeur de 8.26 m alors que la grille des usages et des normes pour la zone H-30 exige un frontage minimal de 15 m.</p>



<div class="wp-block-file"><a id="wp-block-file--media-0367eae6-3316-481a-98ac-6b38c429eb62" href="https://ville.beauharnois.qc.ca/wp-content/uploads/AP_DM-2026-0037.pdf">AP_DM-2026-0037</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/AP_DM-2026-0037.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-0367eae6-3316-481a-98ac-6b38c429eb62">Télécharger</a></div>
</details>



<details class="wp-block-details is-layout-flow wp-block-details-is-layout-flow"><summary>Assemblée publique de consultation sur le premier projet du règlement 701-102 modifiant le règlement de zonage 701</summary>
<p class="wp-block-paragraph">Le conseil municipal, suite à l’adoption lors de la séance ordinaire du 12 mai 2026, du premier projet de Règlement 701-102 modifiant le Règlement de zonage 701, tiendra une assemblée publique de consultation le mardi 26 mai à partir de 18 h, à la salle du conseil située au 660 rue Ellice à Beauharnois.</p>



<div class="wp-block-file"><a id="wp-block-file--media-59562b0d-2f10-4c01-ac15-11eeb166556d" href="https://ville.beauharnois.qc.ca/wp-content/uploads/PROJETREG-701-102.pdf">PROJETREG 701-102</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/PROJETREG-701-102.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-59562b0d-2f10-4c01-ac15-11eeb166556d">Télécharger</a></div>



<div class="wp-block-file"><a id="wp-block-file--media-26424078-1e55-4e82-b5bd-b763dfa986e3" href="https://ville.beauharnois.qc.ca/wp-content/uploads/AP-assemblee-consultation_701-102.pdf">AP assemblée consultation_701-102</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/AP-assemblee-consultation_701-102.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-26424078-1e55-4e82-b5bd-b763dfa986e3">Télécharger</a></div>
</details>



<details class="wp-block-details is-layout-flow wp-block-details-is-layout-flow"><summary>Avis d’entrée en vigueur : Règlement 2026-11 modifiant le règlement 2022-18</summary>
<p class="wp-block-paragraph">Le conseil de la Ville de Beauharnois a adopté, à sa séance ordinaire du 12 mai 2026, le Règlement 2026-11 modifiant le Règlement 2022-18.</p>



<div class="wp-block-file"><a id="wp-block-file--media-76067270-deb5-4c4b-9c1b-776dfb83e2eb" href="https://ville.beauharnois.qc.ca/wp-content/uploads/REG_2026-11-Modifiant-2022-18.pdf">REG_2026-11- Modifiant 2022-18</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/REG_2026-11-Modifiant-2022-18.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-76067270-deb5-4c4b-9c1b-776dfb83e2eb">Télécharger</a></div>



<div class="wp-block-file"><a id="wp-block-file--media-1e0f743a-0fe0-4b1b-818c-bce9cfcd7139" href="https://ville.beauharnois.qc.ca/wp-content/uploads/AEV_REG_2026-11.pdf">AEV_REG_2026-11</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/AEV_REG_2026-11.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-1e0f743a-0fe0-4b1b-818c-bce9cfcd7139">Télécharger</a></div>
</details>



<details class="wp-block-details is-layout-flow wp-block-details-is-layout-flow"><summary>Avis d’entrée en vigueur : Règlement 2026-07 concernant la prévention en matière de sécurité incendie</summary>
<p class="wp-block-paragraph">Le conseil de la Ville de Beauharnois a adopté, à sa séance ordinaire du 12 mai 2026, le Règlement 2026-07 concernant la prévention en matière de sécurité incendie.</p>



<div class="wp-block-file"><a id="wp-block-file--media-09703310-cc08-4e2d-a5d8-1b7839925b6d" href="https://ville.beauharnois.qc.ca/wp-content/uploads/REG_2026-07-Prevention-incendie.pdf">REG_2026-07 &#8211; Prévention incendie</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/REG_2026-07-Prevention-incendie.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-09703310-cc08-4e2d-a5d8-1b7839925b6d">Télécharger</a></div>



<div class="wp-block-file"><a id="wp-block-file--media-56949c64-fb21-495c-82be-15e1fcbf2142" href="https://ville.beauharnois.qc.ca/wp-content/uploads/AEV_REG_2026-07.pdf">AEV_REG_2026-07</a><a href="https://ville.beauharnois.qc.ca/wp-content/uploads/AEV_REG_2026-07.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-56949c64-fb21-495c-82be-15e1fcbf2142">Télécharger</a></div>
</details>
</div>
`;
