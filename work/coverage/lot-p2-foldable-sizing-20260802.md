# Dimensionnement P2 — foldable vs trou de couverture zones

Scan S3 lecture seule complet pour Montréal, Laval et Saguenay. La sonde choisit le layout servi (`nested` avant `flat`) séparément pour les lots et le zonage. Les 931 087 lots sans `code_zone` réellement scannés représentent 83,130244 % des 1 120 034 de la matrice.

## A — FOLDABLE, cibles L2 re-fold

Trié par `inside_served`; aucun volume matériel ne justifie un axe L2 sur ce scan.

1. Laval — 92 / 261 800 sans-code dans une zone servie (0,035141 %); lots/zonage `flat`.
2. Montréal — 34 / 669 287 sans-code dans une zone servie (0,005080 %); lots/zonage `flat`.

## B — COVERAGE-GAP, à escalader à zones

Trié par `outside_all`.

1. Montréal — 669 253 / 669 287 hors de toute zone servie (99,994920 %); lots/zonage `flat`.
2. Laval — 261 708 / 261 800 hors de toute zone servie (99,964859 %); lots/zonage `flat`.

Saguenay est réconciliée au layout servi `flat` : 19 135 lots traités, 0 sans `code_zone`.
