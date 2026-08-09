# Sourcing des zones `zone_source_url: null` (hors focus-30) — 2026-07-24

Lane de **diagnostic pur** (zéro écriture S3 : pas de fold, pas de `putServedZone*`,
pas de mirror). But : proposer un registre de VRAIES sources géométriques
publiques pour les collections `qc-zonage` servies avec `zone_source_url: null`
("null honnête" — pas une erreur, juste une provenance non conservée), en
dehors des 30 slugs focus immo. Anti-invention strict : chaque URL a été
récupérée (GET réel) et, quand c'est indiqué, recoupée avec quelques codes de
zone réellement servis.

## Périmètre

- Univers de départ : audit readback committé
  `work/coverage/zone-source-readback-audit-20260724.json` (HEAD, snapshot
  14:54 UTC) — 341 collections `stamped_null`.
- Exclusion focus-30 (`acquisition/src/focus30-status.ts`) → **321 slugs**
  dans le périmètre de cette lane.
- ⚠️ Le fichier `work/coverage/zone-source-readback-audit-20260724.json` en
  arbre de travail était, pendant cette session, **réécrit en continu par une
  autre lane** (runs `--slugs coaticook,mont-saint-hilaire,saint-raphael,…`
  visibles dans le diff local — ces 4 slugs sont hors périmètre, cf.
  consigne). Cette lane a donc travaillé sur un **snapshot figé** du commit
  HEAD (`git show HEAD:…`), jamais sur l'arbre de travail mouvant, pour ne
  jamais entrer en collision avec ce runner.

## Couverture ce tour

**26 / 321 slugs examinés** (le reste — 295 — est journalisé `not-examined`
dans le registre JSON, PAS omis silencieusement) :

| Verdict | Nombre |
|---|---|
| `candidate-real-source` | **21** |
| `orphan` (recherché, rien de concluant) | 5 |
| `not-examined` (laissé pour un prochain tour) | 295 |

Les 21 candidats couvrent à eux seuls **≈ 11 500 polygones de zone déjà
servis** (sur un total encore plus grand pour les 321 slugs null, dominé par
de très nombreuses petites municipalités rurales à <100 zones) — dont le plus
gros slug null de tout le dépôt (**Québec, 4785 zones**).

## Méthode

Script committé **`acquisition/src/_null-zone-source-probe.ts`** (lecture
seule ; aucun appel `PutObject`/`putServedZone*`) :

- `--list` : worklist (audit statique − focus-30), zéro réseau.
- `--probe --slug X` : 1 GET S3 en lecture seule de la collection SERVIE
  actuelle (détecte un `already-has-source` apparu depuis le snapshot audit),
  échantillon de codes `zone_code`.
- `--fields --url U` : reconnaissance d'un candidat (clés de propriété + 1
  feature), sans jugement.
- `--verify --slug X --url U --field F [--type arcgis|geojson]` : fetch du
  candidat SEUL (GET), recoupement canonique (`canonicalizeZoneCodeForJoin`,
  même fonction que la jointure runtime lot⋈zone) entre les codes candidats
  et les codes RÉELLEMENT servis (relus en direct, pas depuis l'audit figé).
- `--mamh-match --codes c1,c2,…` : résout des codes géographiques MAMH
  (`id_municipalite`) en noms de municipalité (répertoire officiel MAMH,
  `donneesouvertes.affmunqc.net/repertoire/MUN.csv`) et les croise avec le
  worklist — a servi à trouver, EN UNE PASSE, tous les slugs null couverts par
  le gisement WFS `geocentralis` déjà utilisé ailleurs dans ce dépôt.
- `--emit-registry-base` / `--validate-registry` : génère puis valide le
  scaffold JSON complet des 321 slugs (`not-examined` par défaut), patché à la
  main pour les 26 slugs réellement recherchés.

Gisements exploités :

1. **Données Québec** (`donneesquebec.ca`, portail CKAN officiel) : recherche
   par organisation municipale (`ville-de-<slug>`) et par mot-clé `zonage` —
   a donné Québec, Longueuil, Sherbrooke, Saint-Hyacinthe, Shawinigan.
2. **MRC de Coaticook** — portail géomatique ArcGIS propre à la MRC
   (org `Kmm9fZ2zYEgElBCy`, service `SiteWeb_AmenagementUrbanisme`,
   *le même service* qui sert déjà la ville de Coaticook dans ce dépôt, mais
   qui couvre EN RÉALITÉ toute la MRC en une seule couche avec un champ
   `MUNI`/`MuniTopo`). 11 des 12 municipalités membres (hors Coaticook)
   étaient dans le worklist null → 11 candidats d'un coup.
3. **geocentralis** (`geoserver.geocentralis.com`, WFS PG Solutions, couche
   `evb:siadmin_pzon_99_s`) — gisement DÉJÀ intégré dans ce dépôt (scripts
   `zones-geocentralis-replace.ts`, `_ud-geocentralis-etiquette*.ts`, lane
   `geocentralis-zonage-municipal-lane`). Le service liste ~86 codes
   `id_municipalite` ; `--mamh-match` en a résolu 5 dans le worklist null :
   La Prairie, Otterburn Park, Varennes, Châteauguay, Ormstown.

## Top candidats (URL prête à ré-acquérir via `zones-arcgis-serve.ts` /
`zones-geocentralis-replace.ts` / équivalent, après revue)

| Slug | Servi | Source | Type | Recoupement |
|---|---:|---|---|---|
| `quebec` | 4785 | [Données Québec — Zonage municipal, Ville de Québec](https://www.donneesquebec.ca/recherche/dataset/a56dfef1-ad07-4b21-9ef7-24a0c553a085/resource/8108e324-503f-4a10-9107-ea556fdc883d/download/vdq-zonagemunicipalzones.geojson) | geojson-officiel | **4785/4785** (parfait), champ `ID` |
| `sherbrooke` | 1904 | [ArcGIS FeatureServer, Ville de Sherbrooke](https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer/0) | arcgis | **1904/1904** (parfait), champ `NO_ZONE` |
| `shawinigan` | 678 | [ArcGIS FeatureServer, Ville de Shawinigan](https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0) | arcgis | **678/678** (parfait), champ `zone_` |
| `longueuil` | 1927 | [Données Québec — Zonage, Ville de Longueuil](https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/fafe8962-b38d-4a98-ad93-25ac8950b8c8/download/zonage.json) | geojson-officiel | 19/2085 (même muni confirmée, format de code à réexaminer) |
| `saint-hyacinthe` | ~1089 | [ArcGIS FeatureServer, Ville de Saint-Hyacinthe](https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13) | arcgis | count quasi identique (1091 vs 1089), champ code à reconstruire (`NUM_ZONE`+suffixe usage) |
| `la-prairie` | 263 | [WFS geocentralis, id_municipalite=67015](https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=67015) | wfs | **263/263** (parfait), champ `etiquette_1` |
| `chateauguay` | 133 | [WFS geocentralis, id_municipalite=67050](https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=67050) | wfs | 124/133, champ `etiquette_1` |
| `ormstown` | 102 | [WFS geocentralis, id_municipalite=69037](https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=69037) | wfs | **102/102** (parfait), champ `etiquette_1` |
| `otterburn-park` | 98 | [WFS geocentralis, id_municipalite=57030](https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=57030) | wfs | 85/98, champ `etiquette_1` |
| `varennes` | 16 | [WFS geocentralis, id_municipalite=59020](https://geoserver.geocentralis.com/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s&outputFormat=application/json&CQL_FILTER=id_municipalite=59020) | wfs | **16/16** (parfait — servi actuel très partiel, candidat 15× plus riche) |
| `waterville` + 10 munis MRC Coaticook (`compton`, `dixville`, `barnston-ouest`, `east-hereford`, `martinville`, `sainte-edwidge-de-clifton`, `saint-hermenegilde`, `saint-malo`, `saint-venant-de-paquette`, `stanstead-est`) | 16–92 chacun | [ArcGIS FeatureServer, MRC de Coaticook](https://services3.arcgis.com/Kmm9fZ2zYEgElBCy/arcgis/rest/services/SiteWeb_AmenagementUrbanisme/FeatureServer/0) | arcgis | Waterville vérifié **83/83** ; les 10 autres confirmés par le champ `MUNI`/`MuniTopo` (municipalité nommée explicitement dans le service) — **filtrer par `MUNI=<code>` avant toute ré-acquisition**, les codes `ETIQUETTE` (ex. `A-1`) sont réutilisés d'une municipalité à l'autre dans ce service partagé |

## Orphelines réelles (recherchées, rien de concluant ce tour)

- **`granby`** (762 zones, gros lot) — org ArcGIS `granby.maps.arcgis.com`
  repérée mais noyée sous des homonymes (Granby CT/MA), page carte
  interactive bloque le fetch (403). À reprendre en priorité vu la taille.
- **`saint-jerome`** (502 zones, gros lot) — carte interactive JS non
  inspectable en fetch statique. À reprendre avec inspection réseau/JS.
- **`salaberry-de-valleyfield`** (645 zones, gros lot) — org Données Québec
  existe mais 0 dataset publié ; seuls des PDF (règlement 150-47 codifié)
  trouvés.
- **`boucherville`** (386 zones) — règlement 2018-290 documenté en PDF
  seulement, pas de FeatureServer/GeoJSON trouvé, absente de Données Québec.
- **`saint-andre-dargenteuil`** (138 zones) — MRC d'Argenteuil annonce des
  « grilles de zonage à même la cartographie » mais la couche zonage
  n'apparaît pas dans la config de la webapp trouvée ; le serveur ArcGIS
  propre à la MRC (`sig.argenteuil.qc.ca`) exige un token non public.

## Ce qui reste (295 slugs `not-examined`, journalisé dans le JSON)

Le registre complet liste les 295 slugs non recherchés ce tour (nom, MRC,
nombre de zones servies, verdict `not-examined`) pour reprise directe sans
re-scanner S3. Pistes à prioriser pour un prochain tour (jamais vérifiées,
juste repérées en passant) :
- **Communauté métropolitaine de Montréal / agglomération de Longueuil** :
  `boucherville`, `brossard`, `saint-bruno-de-montarville` (déjà `longueuil`
  trouvé — même agglomération, portail CMM sondé sans résultat direct).
  Candiac, Chambly, Carignan, Contrecoeur, Sainte-Julie, Vercheres partagent
  la même MRC Marguerite-D'Youville / La Vallée-du-Richelieu que
  Varennes/Chambly (déjà positif via geocentralis) — le gisement geocentralis
  n'a PAS matché ces slugs (absents des ~86 codes id_municipalite couverts
  aujourd'hui), donc probablement un autre fournisseur SIG.
- **MRC restant à sonder par le pattern « ArcGIS org unique par MRC »**
  (comme Coaticook) : Bellechasse (17 munis null, org
  `mrcbellechasse.maps.arcgis.com` repérée, couche non localisée — token/app
  non public dans le temps imparti), Portneuf (14 munis, seul un dataset
  orthophoto trouvé sur Données Québec, pas de zonage), Les Laurentides,
  Papineau, Argenteuil, Les Maskoutains, Matawinie, Témiscamingue,
  Brome-Missisquoi, Le Haut-Saint-François, Vaudreuil-Soulanges (portail
  MRC trouvé mais sans dataset téléchargeable identifié).
- **Villes liées de l'agglomération de Montréal** (`dorval`, `kirkland`,
  `dollard-des-ormeaux`, `pointe-claire`, `westmount`, `cote-saint-luc`,
  `mont-royal`, `montreal-est`, `montreal-ouest`) : le dataset zonage de
  Ville de Montréal trouvé sur Données Québec (PUM 2050, PPU) ne couvre QUE
  les 19 arrondissements de Montréal, PAS les villes liées — chacune a
  probablement son propre portail à sonder individuellement.
- Le gisement **geocentralis** continue de croître (PG Solutions onboarde de
  nouveaux clients) : reréexécuter `--mamh-match` avec la liste à jour de
  codes `id_municipalite` de `evb:siadmin_pzon_99_s` pourrait révéler de
  nouveaux matches sans repartir de zéro.

## Fichiers

- `work/coverage/null-zone-sourcing-20260724.json` — registre (321 entrées :
  `{slug, verdict, url, type, features, codes_recoupes, note}`).
- `work/coverage/null-zone-sourcing-20260724.md` — cette synthèse.
- `acquisition/src/_null-zone-source-probe.ts` — outil de diagnostic committé
  (read-only ; `--list`, `--probe`, `--fields`, `--verify`, `--mamh-match`,
  `--emit-registry-base`, `--validate-registry`).

**Aucune écriture S3 effectuée. Rien commité par cet agent.**
