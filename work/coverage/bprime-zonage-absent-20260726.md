# B' — acquisition zonage absente (2026-07-26)

Périmètre strict : `bouchette`, `brome`, `chibougamau`.

## Mesure S3 avant / après

Lecture effectuée avec `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
La collection `qc-zonage-<slug>` est absente des deux layouts servis (plat et
sous-dossier) pour les trois villes. `lot-zone-join-run --verify-only` ne trouve
donc aucun parquet `qc-lot-zonage`.

| ville | zones avant → après | propriétés servies (`qc-lots`) avant → après | lots assignés avant → après | mismatch avant → après | provenance avant → après |
|---|---:|---:|---:|---:|---|
| bouchette | 0 → 0 | 1 726 → 1 726 | 0 → 0 | n/a → n/a | absente → absente |
| brome | 0 → 0 | 299 → 299 | 0 → 0 | n/a → n/a | absente → absente |
| chibougamau | 0 → 0 | 40 → 40 | 0 → 0 | n/a → n/a | absente → absente |

`lot-zone-consistency-audit.ts --slugs bouchette,brome,chibougamau` a bien
retourné `qc-zonage non servi` pour chaque ville. Il imprime mécaniquement 0 %
avec 0 lot assigné : ce n'est pas un résultat de qualité. Son fichier partagé
`work/coverage/lot-zone-consistency.json` a été restauré après lecture et son
SHA-256 est redevenu
`8c28487ec1b7f84e9e79a21673942b24e6dab756286534005619588e072419fc`.

## Bouchette — refus : documents seulement, millésime/couche non prouvés

- État mesuré : 1 726 lots servis, 0 `code_zone`, aucune collection ni parquet
  zonage servi.
- Registres `null-zone-sourcing-20260724.json` et `-part2.json` : aucune entrée
  pour `bouchette`.
- Source officielle trouvée : [règlements municipaux de Bouchette](https://www.bouchette.ca/fr/ma-municipalite/reglements-municipaux/), type HTML + PDF. La
  page publie le règlement 85 en trois parties et les modifications 240 (2018),
  312 (2018) et 332 (2022), mais aucun service vectoriel ni plan géoréférencé.
- Recherche MRC : la [page officielle de la MRC Vallée-de-la-Gatineau](https://www.mrcvg.qc.ca/) décrit une carte interactive ; son contenu est une carte SVG
  des limites municipales, pas une couche de zonage.
- Gates : non passables. Ni polygones, ni codes de zone extractibles, ni
  millésime consolidé explicitement en vigueur. Aucun runner de dépôt, backup
  S3, fold ou re-fold n'a été exécuté.

Besoin pour débloquer : une couche SIG municipale/MRC téléchargeable (WFS,
FeatureServer, GeoJSON ou JMap) associée explicitement au règlement en vigueur.

## Brome — refus : le portail MRC ne renvoie aucun polygone de zonage

- État mesuré : 299 lots servis, 0 `code_zone`, aucune collection ni parquet
  zonage servi.
- Registres `null-zone-sourcing-20260724.json` et `-part2.json` : aucune entrée
  pour `brome`.
- Source officielle trouvée : la [page d'évaluation de Brome](https://bromevillage.ca/evaluation-et-matrice-graphique/) renvoie à la
  [matrice graphique de la MRC Brome-Missisquoi](https://www.mrcbm.qc.ca/matrice-graphique), puis au
  [portail CartoBM de Brome](https://www.cartobm.com/gestion_db/content/public/matrice/index.php?codemun=46070), type Leaflet/JSON.
- Vérification : le portail confirme `codemun=46070`, `abrev=bro` et retourne
  l'emprise municipale Brome. Son endpoint de zonage
  `load_zonage_intersect_safe.php`, interrogé avec cette emprise complète,
  retourne une `FeatureCollection` de **0** feature. Il ne fournit donc ni
  polygone ni code de zonage pour Brome.
- Gates : échec avant dépôt (0 polygone, 0 code, aucun millésime de règlement
  vérifiable). Aucun runner de dépôt, backup S3, fold ou re-fold n'a été
  exécuté.

Besoin pour débloquer : publication par Brome/MRC de la couche zonage elle-même
(et non la seule matrice d'évaluation), avec codes et référence au règlement
actuel.

## Chibougamau — refus : règlement publié, mais pas de géométrie SIG

- État mesuré : 40 lots servis, 0 `code_zone`, aucune collection ni parquet
  zonage servi.
- Registres `null-zone-sourcing-20260724.json` et `-part2.json` : aucune entrée
  pour `chibougamau`.
- Source officielle trouvée : [publication VPlus de la Ville de Chibougamau](https://vplus.modellium.com/api/www.ville.chibougamau.qc.ca/structure/detail/reglements-municipaux-1?inStructure=false&localisation=fr), type API officielle + PDF. Elle publie
  « Règlement de zonage (009-2024) » sous le fichier
  `009-2024_Rglement de zonage_juin2025(1).pdf`; la publication a été modifiée
  le 2026-07-16. La même page distingue un projet `009-2024-01` du règlement
  publié.
- Vérification : l'API fournit un document PDF, pas une couche de polygones ni
  un endpoint SIG avec codes. Sans géométrie géoréférencée, la couverture
  municipale et la jointure lot→zone ne sont pas vérifiables.
- Gates : échec avant dépôt (aucun polygone/codes extractibles ; millésime du
  PDF seul insuffisant pour fabriquer une couche). Aucun runner de dépôt,
  backup S3, fold ou re-fold n'a été exécuté.

Besoin pour débloquer : un export SIG ou une carte officielle géoréférencée du
règlement 009-2024 en vigueur, accompagnée des codes de zone.

## Résultat

- Villes B' gagnant un zonage exploitable : **0 net**.
- Écritures S3 : **aucune** (donc aucun backup de collection ni capture de
  dépôt).
- Fichier à committer : `work/coverage/bprime-zonage-absent-20260726.md`.
