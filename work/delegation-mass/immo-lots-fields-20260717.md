# IMMO LOTS fields — shard 0/1 — 2026-07-17

Audit S3 initial : `2026-07-17T22:07:28.540Z`.

Audit S3 final : `2026-07-17T22:25:20.971Z`.

Le set servi est passé de 851 à 853 villes pendant cette intervention. Les
chiffres ci-dessous sont donc des mesures S3 avant/après, pas une attribution
des écarts globaux à ce shard.

## Avant / après par champ

### `surface_m2`

- Avant : 3 365 896 / 3 365 896 lots, 100 % ; 845 villes à au moins 90 %.
- Après : 3 368 162 / 3 368 162 lots, 100 % ; 847 villes à au moins 90 %.
- Action : aucune cible, le champ était déjà à 100 % dans le shard.

### `adresse`

- Avant : 2 540 332 / 3 365 896 lots, 75,47 % ; 611 villes à au moins 90 %.
- Après : 2 542 382 / 3 368 162 lots, 75,48 % ; 612 villes à au moins 90 %.
- Action : ré-enrichissement avec rôle foncier actif, jamais `--no-role`, pour
  `franquelin`, `remigny`, `saint-eugene-de-ladriere`,
  `saint-felix-de-dalquier`, `saint-gabriel-de-valcartier`,
  `saint-louis-de-gonzague-du-cap-tourmente` et `saint-pierre`.
- Résultat vérifié : ces sept villes restent à 0 % d’adresse. Aucune adresse
  n’a été écrite car le rôle est absent ou ne satisfait pas le garde-fou de
  recouvrement de lots.

### `code_postal`

- Avant : 3 365 895 / 3 365 896 lots, 100 % arrondi ; 845 villes à au moins
  90 %.
- Après : 3 368 161 / 3 368 162 lots, 100 % arrondi ; 847 villes à au moins
  90 %.
- Action : aucune cible à moins de 100 % dans le shard. Les enrichissements
  adresse ont tous conservé l’index FSA actif.

### `folded-normes`

- Avant : 856 226 / 3 365 896 lots, 25,44 % ; 209 villes à au moins 90 %.
- Après : 856 332 / 3 368 162 lots, 25,42 % ; 209 villes à au moins 90 %.
- Actions : jointure lot→zone→normes puis enrichissement avec rôle/FSA actifs
  pour `rimouski`, `berthierville`, `saint-cuthbert`, `mandeville` et
  `saint-alexandre-de-kamouraska`.
- Résultat vérifié : les valeurs par ville sont inchangées après l’audit :
  0,13 %, 3,42 %, 12,70 %, 16,29 % et 14,57 %. Ces taux sont exactement les
  taux de correspondance zone→norme produits par la jointure ; aucune norme
  manquante n’a été complétée par inférence.

### `in_tod`

- Avant : 28 431 / 28 431 lots dans son périmètre TOD, 100 % ; 4 villes à au
  moins 90 %.
- Après : 28 431 / 28 431 lots dans son périmètre TOD, 100 % ; 4 villes à au
  moins 90 %.
- Action : aucune cible, le champ était déjà à 100 % dans son périmètre.

## Villes skippées / résultat non productible

- `franquelin` : meilleur rôle `96015`, 22 lots communs, sous le seuil 30.
- `remigny` : meilleur rôle `85105`, 1 lot commun, sous le seuil 30.
- `saint-eugene-de-ladriere` : meilleur rôle `10075`, 4 lots communs, sous le
  seuil 30.
- `saint-felix-de-dalquier` : aucun candidat `code_geo` pour le rôle.
- `saint-gabriel-de-valcartier` : meilleur rôle `22025`, 21 lots communs, sous
  le seuil 30.
- `saint-louis-de-gonzague-du-cap-tourmente` : meilleur rôle `21015`, 1 lot
  commun, sous le seuil 98.
- `saint-pierre` : meilleur rôle `61020`, 238 lots communs, sous le seuil 639.
- `riviere-du-loup` : jointure lot→zone interrompue après six minutes sans
  résultat ; aucun dépôt enrichi revendiqué.
- `cap-chat` et `sainte-anne-de-bellevue` : zones absentes sous
  `normalized/ca-qc-zonage/`, donc jointure et pliage impossibles sans source.
- `chertsey`, `sainte-julienne`, `mirabel` et `candiac` : non démarrées après
  la timebox de `riviere-du-loup`; elles restent à reprendre dans un lot isolé.

## Preuve

Les audits complets ont été conservés dans
`work/delegation-mass/immo-lots-fields-20260717-before.json` et
`work/delegation-mass/immo-lots-fields-20260717-after.json`. L’audit a été
exécuté sans `--apply-track`.
