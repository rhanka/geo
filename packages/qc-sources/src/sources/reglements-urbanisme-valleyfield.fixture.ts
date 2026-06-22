/* eslint-disable no-irregular-whitespace -- the committed text is the VERBATIM
   pdftotext output of the real bylaw PDFs; it intentionally preserves the U+000C
   form-feed page-break characters poppler emits between pages (anti-invention:
   the bytes are not edited). */
/**
 * Recorded REAL extracted text from two public Salaberry-de-Valleyfield
 * "Règlements d'urbanisme" PDFs (WP4 Source #5). The bytes were fetched live
 * from the public CloudFront CDN on 2026-06-09 and converted to text with
 * `pdftotext` (poppler 24.02.0); the VERBATIM extracted text is committed here
 * so the parser + mention tests run deterministically WITHOUT the network. We do
 * NOT commit the source PDFs (~447 KB / 136 KB binaries) — only the small real
 * text. NOTHING is fabricated: every bylaw number and zone code below is present
 * verbatim in the source document.
 *
 *   - REGLEMENT_450_02_TEXT — the plan-d'urbanisme amendment named in the WP4
 *     brief (public URL .../reglements/Reglement-450-02.pdf, HTTP 200,
 *     446 881 bytes, md5 e9882af5f0e69b806d9ceb0cccfd2f16). It is a SHORT
 *     amending bylaw about protecting wooded areas: it carries bylaw numbers
 *     450-02 and 450 but NO zone codes (honest — a plan d'urbanisme amendment
 *     is not a zoning grid). This exercises the Bylaw-only path.
 *   - REGLEMENT_150_51_TEXT — the ZONING amendment (public URL
 *     .../reglements/Reglement-150-51-zonage.pdf, HTTP 200, 135 866 bytes, md5
 *     00784f32548c756c8fa6be033b7f71fd). It modifies the zoning grid and names
 *     thirteen REAL zone codes (H-334, U-521 -> H-521, H-535, C-566, H-627-2,
 *     C-627-3, H-801, I-918, H-561, C-534, P-571, C-627, plus REC-137) and the
 *     bylaw numbers 150-51 / 150. This exercises the Bylaw + Zone path.
 */
export const REGLEMENT_450_02_TEXT = `PROVINCE DE QUÉBEC
VILLE DE SALABERRY-DE-VALLEYFIELD

RÈGLEMENT 450-02

Règlement modifiant le Règlement 450
concernant le plan d’urbanisme

ATTENDU QUE le conseil de la Ville de Salaberry-de-Valleyfield a adopté le Règlement
450 concernant le plan d’urbanisme, le 12 novembre 2024;
ATTENDU QUE le conseil municipal juge opportun de procéder à des modifications du
Règlement 450 concernant le plan d’urbanisme;
LE CONSEIL MUNICIPAL DÉCRÈTE CE QUI SUIT :
Article 1
L’article 5.1 du Règlement 450 concernant le plan d’urbanisme, intitulé « Introduction au
plan d’action », est modifié dans la section « Planification territoriale » à l’objectif 1.3 «
Protéger et mettre en valeur les boisés et milieux naturels d’intérêt », par l’ajout des moyens
de mise en œuvre suivants, avec un échéancier à court et moyen terme :
-

« S’assurer que résilience et adaptation aux changements climatiques guident la
planification et la réalisation des projets de développement et de requalification
urbaine en préservant autant que possible l’intégrité des milieux naturels et la trame
urbaine construite à proximité de ces milieux, dont les bois et boisés;

-

Repenser l’ouverture de nouvelles rues ou leur prolongement pour tenir compte de
ce qui précède et s’assurer d’un développement durable du territoire qui tient
compte de la présence de milieux naturels. »

Article 2
Le plan 4 intitulé « Plan relatif aux milieux naturels reconnus et contraintes
anthropiques », de l’annexe C dudit Règlement 450, « Plans d’analyse et de référence »,
est modifié par l’ajout de l’illustration de trois boisés à protéger, le tout tel qu’illustré aux
plans datés de juillet 2025 joints au présent règlement comme annexe « a ». Une référence
est aussi ajoutée dans la légende dudit plan 4.

Article 3
Le présent règlement entre en vigueur conformément à la loi.

Miguel Lemieux, maire

Valérie Tremblay, greffière

2

`;

export const REGLEMENT_150_51_TEXT = `PROVINCE DE QUÉBEC
VILLE DE SALABERRY-DE-VALLEYFIELD

RÈGLEMENT 150-51
Règlement modifiant le Règlement 150
concernant le zonage afin de modifier
certaines zones et normes

ATTENDU QUE le conseil de la Ville de Salaberry-de-Valleyfield a adopté le Règlement
150 concernant le zonage, le 17 juin 2008;
ATTENDU QUE le conseil municipal juge opportun de procéder à des modifications du
Règlement 150 concernant le zonage;
LE CONSEIL MUNICIPAL DÉCRÈTE CE QUI SUIT :
Article 1
L’article 8.1 du Règlement 150 concernant le zonage, intitulé « MATÉRIAUX DE
REVÊTEMENTS EXTÉRIEURS MURAUX PROHIBÉS » est modifié, au paragraphe m),
par l’ajout, après les mots « sauf sur les bâtiments de ferme », des mots suivants :
« et les bâtiments à structure ouverte pour un usage i4b et i4c ».
Article 2
L’article 8.3 dudit Règlement 150, intitulé « MATÉRIAUX DE REVÊTEMENT DE TOIT
AUTORISÉS » est modifié, au paragraphe h), par l’ajout, après les mots « Pour les
bâtiments de ferme sur des terres en culture », des mots suivants :
« et des bâtiments à structure ouverte pour un usage i4b et i4c ».
Article 3
L’article 8.10 dudit Règlement 150, intitulé « HAUTEUR MAXIMUM DES BÂTIMENTS »
est modifié, au premier alinéa, par le remplacement du mot « résidence » par les mots
suivants :
« habitation unifamiliale, bi, tri ou quadrifamiliale, ».
Article 4
L’article 8.17 dudit Règlement 150, intitulé « ENTRÉE ÉLECTRIQUE » est abrogé.

1

Article 5
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone REC-137, celle-ci est jointe au présent règlement comme
annexe « a » pour en faire partie intégrante.
Article 6
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone H-334, celle-ci est jointe au présent règlement comme annexe
« b » pour en faire partie intégrante.
Article 7
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone U-521 par la grille de la nouvelle zone H-521, celle-ci est
jointe au présent règlement comme annexe « c » pour en faire partie intégrante.
Article 8
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone H-535, celle-ci est jointe au présent règlement comme annexe
« d » pour en faire partie intégrante.
Article 9
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone C-566, celle-ci est jointe au présent règlement comme annexe
« e » pour en faire partie intégrante.
Article 10
L’annexe « A » dudit Règlement 150 est modifiée par l’ajout de la grille des usages et
normes de la nouvelle zone H-627-2, celle-ci est jointe au présent règlement comme
annexe « f » pour en faire partie intégrante.
Article 11
L’annexe « A » dudit Règlement 150 est modifiée par l’ajout de la grille des usages et
normes de la nouvelle zone C-627-3, celle-ci est jointe au présent règlement comme
annexe « g » pour en faire partie intégrante.
Article 12
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone H-801, celle-ci est jointe au présent règlement comme annexe
« h » pour en faire partie intégrante.
Article 13
L’annexe « A » dudit Règlement 150 est modifiée par le remplacement de la grille des
usages et normes de la zone I-918, celle-ci est jointe au présent règlement comme annexe
« i » pour en faire partie intégrante.

2

Article 14
L’annexe « B » dudit Règlement 150 est modifiée par le remplacement de la désignation
de la zone U-521, par la désignation H-521, en conservant les mêmes limites, tel qu’illustré
au plan 150-51, lequel plan est joint au présent règlement comme annexe « A » pour en
faire partie intégrante.
Article 15
L’annexe « B » dudit Règlement 150 est modifiée par l’agrandissement de la zone H-535 à
même une partie de la zone C-534, tel qu’illustré au plan 150-51, lequel plan est joint au
présent règlement comme annexe « B » pour en faire partie intégrante.
Article 16
L’annexe « B » dudit Règlement 150 est modifiée par l’agrandissement de la zone H-561 à
même une partie de la zone P-571, tel qu’illustré au plan 150-51, lequel plan est joint au
présent règlement comme annexe « C » pour en faire partie intégrante.
Article 17
L’annexe « B » dudit Règlement 150 est modifiée par la création des nouvelles zones
H-627-2 et C-627-3, à même une partie de la zone C-627, tel qu’illustré au plan 150-51,
lequel plan est joint au présent règlement comme annexe « D » pour en faire partie
intégrante.
Article 18
Le présent règlement entre en vigueur conformément à la loi.

Miguel Lemieux, maire

Valérie Tremblay, greffière

3

`;
