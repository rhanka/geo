# SHARD 0/3 — effet densifiant

Périmètre traité : `alma`, `cowansville`, `mont-saint-hilaire`,
`petite-riviere-saint-francois`, `rimouski`, `saint-charles-borromee`,
`saint-gilbert`, `sainte-catherine`.

## Villes servies

- `cowansville` — 0 zone densifiée. `CBB-1` est servie `stable` (4 → 4)
  pour l'amendement `1841-41-2023`; les deux grilles administratives
  immédiatement avant/après donnent verbatim les classes utilisées pour le
  maximum, et l'API publique expose le diff.

## Villes inconnues sans événement

- Aucune. Chaque ville du shard a soit un événement de zonage détectable,
  soit un projet/document de zonage insuffisant pour le servir.

## Villes bloquées

- `alma` — `485-2026` est bien entré en vigueur, mais ses changements de
  limites prennent des *parties* de zones (par exemple `Rb120` vers `Re45`).
  Un fold sur le polygone entier attribuerait le compteur après à une portion
  non touchée; aucune grille consolidée après cet amendement n'est acquise.
- `mont-saint-hilaire` — l'avis d'entrée en vigueur `1235-34` (18 juin 2026)
  ne donne que le titre « limites de quatre zones »; ni les codes, ni le
  règlement complet/grille après ne sont publiés avec l'avis.
- `petite-riviere-saint-francois` — les avis détectés `776` et `783` sont des
  projets/seconds projets du zonage `603`, sans entrée en vigueur finale; le
  registre de règlement de la grille servie est en outre absent.
- `rimouski` — `R.V.R. 26-019` est promulgué (H7 ajouté en `H-222`). La
  grille actuelle, datée du 23 juin 2026, affiche un maximum `1/2`, mais la
  grille antérieure au certificat de conformité du 11 juin 2026 n'est pas
  acquise : le `1 → 2` apparent ne peut donc pas être servi.
- `saint-charles-borromee` — `2207-4-2023` agrandit `H-28` à même une partie
  de `H-25`. Comme à Alma, le changement ne couvre pas la géométrie entière
  d'une zone servie; aucun delta ne peut être projeté sans découpage après.
- `saint-gilbert` — des avis d'entrée en vigueur de zonage, dont `U-05-2023`,
  existent, mais `reglement-provenance` ne contient aucun règlement/millésime
  servi : la garde AVANT ne peut pas déterminer le sens.
- `sainte-catherine` — `2009-Z-94` est entré en vigueur le 30 juin 2026 mais
  ne modifie que la superficie maximale des bâtiments mixtes; il ne nomme
  aucune zone ni compteur de logements. Les autres avis ciblés sont soit
  non-résidentiels (notamment `2009-Z-92`, I-220), soit hors grille.
