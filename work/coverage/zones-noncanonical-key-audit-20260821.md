# Audit clés non-canoniques `normalized/ca-qc-zonage/` — 2026-08-21

Sonde LECTURE SEULE (aucune écriture / suppression S3). Finding dé-entropie archi
(Exemplar #4) : le nouveau geo-api indexerait ~762 objets sous des clés non-canoniques
comme des collections DISTINCTES (~3885 → ~4647). But : séparer les **sauvegardes
d'audit** (backup avant écrasement — réversibilité + audit de provenance) de la vraie
**pollution du namespace servi**, mesurer OÙ chaque clé se trouve, et rattacher le chiffre.

**Règle de localisation (mesurée).** Le namespace SERVI est `normalized/ca-qc-zonage/` + son sous-arbre
`qc-zonage-<slug>/`. Tout segment de répertoire commençant par `_` (ex: `_replaced/`,
`_zone-source-fold-backups/<ts>/`) est une zone de BACKUP/annexe HORS du namespace servi.

## Totaux (énumération S3 paginée complète)

- clés listées sous `normalized/ca-qc-zonage/` : **2806**
- slugs canoniques FLAT : **808** · NESTED : **72** · distincts : **873**
- clés non-canoniques totales : **1850**

### Par catégorie

| catégorie | clés |
|-----------|------|
| BACKUP-UNDER-PREFIX | 1165 |
| CANONICAL-FLAT | 808 |
| NONCANONICAL-GEOJSON-IN-NAMESPACE | 433 |
| SIDECAR-IN-NAMESPACE | 250 |
| CANONICAL-NESTED-SIDECAR | 76 |
| CANONICAL-NESTED | 72 |
| OTHER | 2 |

## Split backups vs pollution du namespace (le cœur du finding)

### Backups sous un préfixe `_…/` (backups d'audit propres, HORS namespace servi)

Total : **1165** clés.

| préfixe backup | clés | dont .geojson |
|----------------|------|---------------|
| `_zone-source-fold-backups/` | 895 | 895 |
| `_replaced/` | 270 | 269 |

### Pollution DIRECTEMENT dans le namespace servi

- **.geojson non-canoniques dans le namespace : 433**
  (racine : 396 · dossier nested : 37)
- sidecars .json dans le namespace (racine) : 250
- OTHER : 2

Variantes de la pollution .geojson in-namespace :

| variante | clés |
|----------|------|
| `additive-prebackup` | 425 |
| `` | 5 |
| `contour-auto-preclip` | 3 |

Sidecars in-namespace :

| variante | clés |
|----------|------|
| `stats.json` | 241 |
| `meta.json` | 9 |

## Verdict indexeur geo-api (lecture code, file:line)

geo-api est du **TypeScript custom du dépôt** (pas un serveur OGC tiers). Chaîne :
`GEO_DATA_URI=s3://sentropic-geo/normalized` (deploy/k8s/geo-api-deployment.yaml:45-46)
→ `StoreProvider` sur `S3Store` (make-provider.ts:50-51).

- **(a) RÉCURSE, aucune exclusion.** `S3Store.list()` fait un `ListObjectsV2` **sans
  `Delimiter`** → récursif sur tout le sous-arbre, et pushe chaque `Key` **sans filtre**
  (s3-store.ts:111-129). Le provider ne filtre QUE par `.endsWith(".geojson")`
  (store-provider.ts:96). **Pas de skip `_replaced/`, pas de skip-liste de préfixe.**
- **(b) Le suffixe `__flat.<ts>` est CONSERVÉ comme id de collection.** `stemOf` =
  basename moins `.geojson`, **répertoire ignoré** (store-provider.ts:246-250) ;
  `id = meta?.datasetId ?? stem` (store-provider.ts:231-234). Donc
  `qc-zonage-beaupre__flat.2026-08-16T0441Z.geojson` → collection
  **`qc-zonage-beaupre__flat.2026-08-16T0441Z`** (PAS collapsé en `qc-zonage-beaupre`).
- **(c) Rien n'exclut les clés non-canoniques.** Aucune regex de nom canonique, aucune
  skip-liste, aucun collapse-par-slug. Seule la dédup par **id EXACT**
  (store-provider.ts:101-104) fusionne, et le tie-break flat/nested ne joue qu'en cas de
  collision d'id (store-provider.ts:255-278).

**Conséquence mesurée.** Comme `stemOf` ignore le répertoire, un snapshot single-slug
`_zone-source-fold-backups/<ts>/qc-zonage-<slug>.geojson` a le MÊME id que le canonique
`qc-zonage-<slug>` → déduppé, **PAS** une collection en trop. En revanche chaque
`__flat.<ts>` / `.additive-prebackup` / `.contour-auto-preclip` / double-slug a un
basename distinct → **une collection en trop**.

## Modèle EXACT de collections servies (algorithme geo-api rejoué)

id = stemOf(basename) ; dédup par id exact. Caveat : un sibling `<stem>.meta.json` avec
`datasetId` remapperait l'id (non résolu ici → borne haute sans remap meta).

- collections distinctes modélisées (tous `.geojson`) : **1638**
- collections légitimes (stems canoniques) : **873**
- **collections EN TROP (stems non-canoniques) : 765**
  - dont issues de clés sous préfixe backup : **342**
  - dont issues de pollution in-namespace : **422**
  - mixte/autre : 1
- clés .geojson non-canoniques COLLISIONNANT avec un id canonique (déduppées, PAS en trop) : **829**

### Rattachement du chiffre ~762

- cité (collections en trop) : **762**
- **mesuré (modèle exact) collections en trop : 765**
  (backup=342, in-namespace=422)
- borne haute par clé (avant dédup stem) : 1597

_Note : le +762 cité par archi est probablement un instantané antérieur (avant les
snapshots `_zone-source-fold-backups` du 2026-07-24 ou une passe de backups `_replaced`) ;
la mesure du modèle exact ci-dessus est la valeur courante rejouable._

## Ensemble des tokens de suffixe `__<token>` (mesuré)

| token | sous préfixe backup | dans namespace | total |
|-------|---------------------|----------------|-------|
| `flat` | 234 | 0 | 234 |
| `subdir` | 23 | 0 | 23 |
| `nested` | 9 | 0 | 9 |
| `nested-misdeposit` | 3 | 0 | 3 |
| `pre-712-47-20260715` | 1 | 0 | 1 |

## Correspondance backup/pollution ↔ canonique (TASK 2)

Chaque clé backup/pollution a-t-elle un slug qui possède AUSSI un canonique servi (flat/nested) ?

- clés considérées : **1598**
- avec canonique correspondant : **1598**
- sans canonique correspondant (orphelines) : **0**
- **taux de correspondance : 100%**

Aucune orpheline détectée : chaque backup/pollution correspond à une ville qui a AUSSI un canonique servi.

## Formes OTHER (rien de caché)

| forme (localisation:extension) | clés |
|--------------------------------|------|
| `other:.geojson` | 1 |
| `other:.json` | 1 |

## Échantillons de clés

### CANONICAL-FLAT
- `normalized/ca-qc-zonage/qc-zonage-abercorn.geojson`
- `normalized/ca-qc-zonage/qc-zonage-acton-vale.geojson`
- `normalized/ca-qc-zonage/qc-zonage-adstock.geojson`
- `normalized/ca-qc-zonage/qc-zonage-albanel.geojson`
- `normalized/ca-qc-zonage/qc-zonage-albertville.geojson`
- `normalized/ca-qc-zonage/qc-zonage-alma.geojson`
- `normalized/ca-qc-zonage/qc-zonage-amherst.geojson`
- `normalized/ca-qc-zonage/qc-zonage-amqui.geojson`
- `normalized/ca-qc-zonage/qc-zonage-ange-gardien.geojson`
- `normalized/ca-qc-zonage/qc-zonage-armagh.geojson`
- `normalized/ca-qc-zonage/qc-zonage-arundel.geojson`
- `normalized/ca-qc-zonage/qc-zonage-ascot-corner.geojson`
- `normalized/ca-qc-zonage/qc-zonage-aston-jonction.geojson`
- `normalized/ca-qc-zonage/qc-zonage-auclair.geojson`
- `normalized/ca-qc-zonage/qc-zonage-audet.geojson`

### CANONICAL-NESTED
- `normalized/ca-qc-zonage/qc-zonage-amos/qc-zonage-amos.geojson`
- `normalized/ca-qc-zonage/qc-zonage-barnston-ouest/qc-zonage-barnston-ouest.geojson`
- `normalized/ca-qc-zonage/qc-zonage-beaupre/qc-zonage-beaupre.geojson`
- `normalized/ca-qc-zonage/qc-zonage-brownsburg-chatham/qc-zonage-brownsburg-chatham.geojson`
- `normalized/ca-qc-zonage/qc-zonage-chambly/qc-zonage-chambly.geojson`
- `normalized/ca-qc-zonage/qc-zonage-charlemagne/qc-zonage-charlemagne.geojson`
- `normalized/ca-qc-zonage/qc-zonage-coaticook/qc-zonage-coaticook.geojson`
- `normalized/ca-qc-zonage/qc-zonage-compton/qc-zonage-compton.geojson`
- `normalized/ca-qc-zonage/qc-zonage-contrecoeur/qc-zonage-contrecoeur.geojson`
- `normalized/ca-qc-zonage/qc-zonage-cote-saint-luc/qc-zonage-cote-saint-luc.geojson`
- `normalized/ca-qc-zonage/qc-zonage-dixville/qc-zonage-dixville.geojson`
- `normalized/ca-qc-zonage/qc-zonage-dorval/qc-zonage-dorval.geojson`
- `normalized/ca-qc-zonage/qc-zonage-east-hereford/qc-zonage-east-hereford.geojson`
- `normalized/ca-qc-zonage/qc-zonage-gore/qc-zonage-gore.geojson`
- `normalized/ca-qc-zonage/qc-zonage-grenville-sur-la-rouge/qc-zonage-grenville-sur-la-rouge.geojson`

### CANONICAL-NESTED-SIDECAR
- `normalized/ca-qc-zonage/qc-zonage-armagh/qc-zonage-armagh.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-barnston-ouest/qc-zonage-barnston-ouest.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-beaumont/qc-zonage-beaumont.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-beaupre/qc-zonage-beaupre.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-brownsburg-chatham/qc-zonage-brownsburg-chatham.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-chambly/qc-zonage-chambly.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-charlemagne/qc-zonage-charlemagne.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-chateau-richer/qc-zonage-chateau-richer.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-coaticook/qc-zonage-coaticook.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-compton/qc-zonage-compton.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-cote-saint-luc/qc-zonage-cote-saint-luc.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-dixville/qc-zonage-dixville.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-dorval/qc-zonage-dorval.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-east-hereford/qc-zonage-east-hereford.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-gore/qc-zonage-gore.meta.json`

### BACKUP-UNDER-PREFIX
- `normalized/ca-qc-zonage/_replaced/qc-zonage-adstock__flat.2026-08-10T1521Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-albertville__flat.2026-08-10T1542Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-amqui__flat.2026-08-10T1543Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-armagh__flat.2026-07-26T0159Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-auclair__flat.2026-07-26T1342Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-ayers-cliff__flat.2026-08-03T2011Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-baie-comeau__flat.2026-08-10T1521Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-baie-des-sables__flat.2026-07-26T1045Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-baie-trinite__flat.2026-08-10T1543Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-barnston-ouest__subdir.2026-07-26T0640Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-barraute__flat.2026-08-10T1543Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-beauceville__flat.2026-08-10T1521Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-beaulac-garthby__flat.2026-08-10T1543Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-beaupre__flat.2026-08-16T0441Z.geojson`
- `normalized/ca-qc-zonage/_replaced/qc-zonage-beaupre__nested-misdeposit.2026-08-16T0441Z.geojson`

### NONCANONICAL-GEOJSON-IN-NAMESPACE (vraie pollution servie)
- `normalized/ca-qc-zonage/ca-qc-zonage-sainte-cecile-de-milton-boundary-georef/qc-zonage-sainte-cecile-de-milton.geojson`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-longueuil/qc-zonage-longueuil.geojson`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-rimouski/qc-zonage-rimouski.geojson`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-saguenay/qc-zonage-saguenay.geojson`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-shawinigan/qc-zonage-shawinigan.geojson`
- `normalized/ca-qc-zonage/qc-zonage-adstock.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-albertville.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-alma.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-amherst.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-amos/qc-zonage-amos.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-amqui.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-armagh.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-arundel.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-auclair.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-audet.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-ayers-cliff.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-baie-comeau.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-baie-des-sables.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-baie-trinite.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-barnston-ouest/qc-zonage-barnston-ouest.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-barraute.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-beauceville.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-beaulac-garthby.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-beaupre.additive-prebackup.geojson`
- `normalized/ca-qc-zonage/qc-zonage-berry.additive-prebackup.geojson`

### SIDECAR-IN-NAMESPACE
- `normalized/ca-qc-zonage/ca-qc-zonage-sainte-cecile-de-milton-boundary-georef/qc-zonage-sainte-cecile-de-milton.meta.json`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-longueuil/qc-zonage-longueuil.meta.json`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-rimouski/qc-zonage-rimouski.meta.json`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-saguenay/qc-zonage-saguenay.meta.json`
- `normalized/ca-qc-zonage/normalized/ca-qc-zonage/ca-qc-zonage-shawinigan/qc-zonage-shawinigan.meta.json`
- `normalized/ca-qc-zonage/qc-zonage-abercorn.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-acton-vale.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-amherst.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-ange-gardien.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-arundel.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-ascot-corner.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-barkmere.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-becancour.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-bedford--brome-missisquoi.stats.json`
- `normalized/ca-qc-zonage/qc-zonage-belcourt.stats.json`

### OTHER
- `normalized/ca-qc-zonage/anchors-saint-frederic.geojson`
- `normalized/ca-qc-zonage/ca-qc-zonage-sainte-cecile-de-milton-boundary-georef/boundary_match_diag.json`

## Correctif proposé

1. **Discipline de clé servie canonique dans l'acquisition.** Seuls
   `qc-zonage-<slug>.geojson` (flat) et `qc-zonage-<slug>/qc-zonage-<slug>.geojson` (nested)
   sont des clés SERVIES. Aucune variante horodatée / pré-backup (`.additive-prebackup.geojson`,
   `.contour-auto-preclip.geojson`, `__<token>.<ts>.geojson`) ne doit être écrite DIRECTEMENT
   dans le namespace servi.
2. **Backups relocalisés vers un préfixe EXCLU de l'index (préserver, pas supprimer).** Les
   sauvegardes vivent déjà sous `_replaced/` et `_zone-source-fold-backups/` (préfixes `_…/`,
   hors namespace) ; les pré-backups actuellement DANS le namespace (`.additive-prebackup.geojson`,
   `.contour-auto-preclip.geojson`) doivent y être déplacés (copy vers `_replaced/` puis retrait
   du namespace). Réversibilité + audit préservés, namespace propre.
3. **Ce que geo-api doit exclure.** (a) skipper tout segment de chemin commençant par `_`
   (`_replaced/`, `_zone-source-fold-backups/`…) ; (b) n'accepter comme collection que les clés
   MATCHANT la regex canonique flat/nested (rejette `.additive-prebackup`, `.contour-auto-preclip`,
   `__<token>`, sidecars `.stats.json`/`.meta.json`) ; (c) dédupliquer par slug (last-wins).
