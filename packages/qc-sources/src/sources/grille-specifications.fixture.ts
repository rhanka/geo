/**
 * REAL committed "grille des usages et des normes" fixtures for the
 * grille-specifications parser tests.
 *
 * NOTHING here is fabricated. Each constant is the VERBATIM `pdftotext -layout`
 * output of one real page of the City of Sherbrooke zoning bylaw grille annex:
 *
 *   Règlement numéro 1200 — Zonage et lotissement (Ville de Sherbrooke)
 *   Annexe "Grille des usages et des normes" — version administrative 2025-10-02
 *   PDF: https://contenu.maruche.ca/Fichiers/3337a882-4a53-e611-80ea-00155d09650f
 *        /Sites/333dd3d3-915d-e611-80ea-00155d09650f/Documents
 *        /Reglements%20municipaux/Urbanisme/Reglement-1200-grilles.pdf
 *
 * The grille PDF is an Excel-generated, NATIVE-TEXT document (Producer:
 * "Microsoft® Excel® pour Microsoft 365"): zones are rows, norms are columns,
 * one "No zone" page each. The text below is exactly what poppler emits — the
 * golden anchor against which the parser is held: any served `value` that is
 * NOT a verbatim substring of these bytes is an INVENTION and must hard-fail.
 *
 * Three grille pages are committed:
 *   - GRILLE_SHERBROOKE_H0001 (page 1): zones H-1..H-4. H-3 carries the
 *     ambiguous "Note 5"/"Note 6" reference cells (→ null, never a number).
 *   - GRILLE_SHERBROOKE_P0004 (page 4): zones C-306, H-1, P-104. The page is
 *     INDENTED ~9 chars further than page 1 (longer "No zone P0004" header) —
 *     this is the column-shift trap the anti-décalage guard must survive.
 *     P-104 has EMPTY largeur / superficie / sol-min cells (→ null).
 *   - GRILLE_SHERBROOKE_H0005 (page 5): zones H-1, H-2, H-4.
 *
 * One NON-grille page is committed for the classifier's negative case:
 *   - NON_GRILLE_SHERBROOKE_TITLE: the bylaw title page (no canonical headers).
 *
 * BOOT-SAFETY: these are inline string literals (no filesystem read at import),
 * so importing the barrel performs no I/O.
 */

/** Page 1 of the Sherbrooke 1200 grille annex — zones H-1..H-4. Verbatim. */
export const GRILLE_SHERBROOKE_H0001 = `                                RÈGLEMENT DE ZONAGE ET DE LOTISSEMENT                                                GRILLE DES USAGES ET DES NORMES                                                                                                 No zone H0001
                                NO 1200



                              Usage principal                                                Lotissement                                                   Bâtiment principal                                                             Implantation
   Usage        Nombre min.      Nombre max.    Nombre max.    Nombre max.    Largeur min.     Profondeur       Superficie     % d'occ. au   % d'occ. au    Hauteur     Hauteur     Hauteur     Hauteur      Marge        Marge         Marge          Total        Marge       % espace
  autorisé      de logements     de logements   de chambres    de bâtiments      lot (m)       min. lot (m)    min. lot (m²)    sol min.      sol max.     min. étage   min. (m)   max. étage   max. (m)   avant min.   avant max.   latérale min.    marges     arrière min.   libre min.
                                                en maison de    en rangée                                                                                                                                     (m)          (m)            (m)        latérales        (m)
                                                  chambres                                                                                                                                           min. (m)


    H-1                                                                            15                              415                           35                                    2                      6,0                        1,2           4,8           6,0           40

    H-2                                                                             9                              270                           35                                    2                      6,0                        0,0           3,5           6,0           40

    H-3                                                             3            Note 5                          Note 6                          40                                    2                      6,0                        0,0           3,5           6,0           30

    H-4                                                                            15                              450                           35                                    2                      6,0                        1,2           4,8           6,0           40




                                                                                           Note lotissement                                                    Note bâtiment                                                            Note implantation

Usage spécifiquement permis                                                   Note 5 : 5 m pour les unités du centre et 9 m
                                                                              pour les unités d'extrémité


                                                                              Note 6 : 150 m² pour les unités du centre et
                                                                              270 m² pour les unités d’extrémité
Usage spécifiquement prohibé



                                 Note usage




Amendement :
`;

/**
 * Page 4 (No zone P0004) — zones C-306, H-1, P-104. The WHOLE page is indented
 * ~9 characters more than page 1, so absolute column positions DIFFER from page
 * 1: this is the per-page re-anchoring requirement and the column-shift trap.
 * P-104 has empty largeur / superficie / sol-min cells. Verbatim.
 */
export const GRILLE_SHERBROOKE_P0004 = `                                     RÈGLEMENT DE ZONAGE ET DE LOTISSEMENT                                                   GRILLE DES USAGES ET DES NORMES                                                                                                 No zone P0004
                                     NO 1200



                                 Usage principal                                                       Lotissement                                                 Bâtiment principal                                                             Implantation
    Usage           Nombre min.      Nombre max.       Nombre max.       Nombre max.    Largeur min.    Profondeur      Superficie     % d'occ. au   % d'occ. au    Hauteur     Hauteur     Hauteur     Hauteur      Marge        Marge         Marge          Total        Marge       % espace
   autorisé         de logements     de logements      de chambres       de bâtiments      lot (m)      min. lot (m)   min. lot (m²)    sol min.      sol max.     min. étage   min. (m)   max. étage   max. (m)   avant min.   avant max.   latérale min.    marges     arrière min.   libre min.
                                                       en maison de       en rangée                                                                                                                                   (m)          (m)            (m)        latérales        (m)
                                                         chambres                                                                                                                                            min. (m)


    C-306                                                                                   30              30             900                           40                                    2                     12,0                        5,0           12,0          6,0

      H-1                                                                                   15                             415                           35                                    2                      6,0                        1,2           4,8           6,0           35

    P-104                                                                                                                                                40                                    2                     12,0                        5,0           12,0          6,0




                                                                                                   Note lotissement                                                    Note bâtiment                                                            Note implantation

 Usage spécifiquement permis




Usage spécifiquement prohibé



                                      Note usage

Les bureaux privés tels que définis au chapitre 2 et totalisant 750 m² et plus de
superficie de plancher sont interdits




Amendement :
`;

/** Page 5 (No zone H0005) — zones H-1, H-2, H-4. Verbatim. */
export const GRILLE_SHERBROOKE_H0005 = `                                RÈGLEMENT DE ZONAGE ET DE LOTISSEMENT                                              GRILLE DES USAGES ET DES NORMES                                                                                                 No zone H0005
                                NO 1200



                              Usage principal                                                Lotissement                                                 Bâtiment principal                                                             Implantation
   Usage        Nombre min.      Nombre max.    Nombre max.    Nombre max.    Largeur min.    Profondeur      Superficie     % d'occ. au   % d'occ. au    Hauteur     Hauteur     Hauteur     Hauteur      Marge        Marge         Marge          Total        Marge       % espace
  autorisé      de logements     de logements   de chambres    de bâtiments      lot (m)      min. lot (m)   min. lot (m²)    sol min.      sol max.     min. étage   min. (m)   max. étage   max. (m)   avant min.   avant max.   latérale min.    marges     arrière min.   libre min.
                                                en maison de    en rangée                                                                                                                                   (m)          (m)            (m)        latérales        (m)
                                                  chambres                                                                                                                                         min. (m)


    H-1                                                                           15                             415                           35                                    2                      6,0                        1,2           4,8           6,0           40

    H-2                                                                            9                             270                           35                                    2                      6,0                        0,0           3,5           6,0           40

    H-4                                                                           15                             450                           35                                    2                      6,0                        1,2           4,8           6,0           40




                                                                                         Note lotissement                                                    Note bâtiment                                                            Note implantation

Usage spécifiquement permis




Usage spécifiquement prohibé



                                 Note usage




Amendement :
`;

/** Bylaw title page — NOT a grille (no canonical headers). Classifier negative. */
export const NON_GRILLE_SHERBROOKE_TITLE = `________________________________________________________________________



                                          RÈGLEMENT NUMÉRO 1200

________________________________________________________________________


                                            ZONAGE ET LOTISSEMENT

________________________________________________________________________


                                                VILLE DE SHERBROOKE




                  Version administrative à jour au 02-10-2025
`;

/** Source URL of the grille annex PDF (provenance). */
export const GRILLE_SHERBROOKE_SOURCE_URL =
  "https://contenu.maruche.ca/Fichiers/3337a882-4a53-e611-80ea-00155d09650f/Sites/333dd3d3-915d-e611-80ea-00155d09650f/Documents/Reglements%20municipaux/Urbanisme/Reglement-1200-grilles.pdf";

/** Snapshot label committed with the fixture provenance. */
export const GRILLE_SHERBROOKE_SNAPSHOT = "sherbrooke-1200-grilles-2025-10-02";
