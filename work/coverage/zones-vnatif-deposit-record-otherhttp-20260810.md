# Dépôt zones — VEINE MARGINALE FINALE « other-http / petit-hôte » (v2-upgrade) — 2026-08-10

**Décision : CLEAN-UPGRADE de la queue résiduelle.** Après les 4 veines-plateforme
traitées (géoCentralis WFS, altusquebec, victoriaville, AGOL `services*.arcgis.com`) et
goAzimut confirmé **MORT**, il restait **16 munis UPGRADABLE** hébergés sur des petits
hôtes hors-veine. Résultat : **3 DÉPÔTS EFFECTUÉS** (readback VERT sur les 3), **13 RIEN**
documentés (raison spécifique par muni). Isolation par-muni ; anti-invention (une vraie
couche de zonage + vrais codes-zone + territoire correct, sinon RIEN) ; **aucun forçage de
capture cassée** (zip / no-geojson → RIEN).

**Aucun des 16 n'est in-cohort** (`in_campaign_set=false` pour les 16 au scoping) — pas de
priorisation 167 applicable dans cette queue.

Réplique EXACTE de la recette de dépôt **victoriaville** (`5564b2f5`) — G2 byte-exact,
anti-homonyme (`nearest==slug`), gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`,
backup `_replaced/`, dropped→UNKNOWN (jamais N-A), anti-troncature ArcGIS
(`returnCountOnly[MÊME where]==features` & `!exceededTransferLimit`), champ code-zone résolu
sans invention par recouvrement ≥90 % avec le servi. Preuve **type=arcgis / natif / directe**.

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` + `SPEC_ZONE_GEOMETRY_GRAIN.md` +
`SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` §12. Capture : `SPEC_CAPTURE_ON_CLUSTER.md`.

Scripts : `acquisition/src/_zones-vnatif-deposit-otherhttp-20260810.ts` (dépôt) ;
sondes de diagnostic `_zones-otherhttp-tail-extract-`, `_zones-otherhttp-webmap-inspect-`,
`_zones-otherhttp-mrcal-codemap-`, `_zones-otherhttp-overlap-precheck-`,
`_zones-otherhttp-record-summary-20260810.ts`.
Worklist : `work/coverage/zones-vnatif-capture-worklist-otherhttp-20260810.json` (4 munis capturés).
Record machine : `work/coverage/zones-vnatif-deposit-record-otherhttp-20260810.json`.

## 1. Périmètre (16 munis, queue hors-veine)

| host | # | classe | verdict |
|---|---:|---|---|
| `sig.mrcal.ca` | 3 | ArcGIS FeatureServer PARTAGÉ (MRC Antoine-Labelle) | **3 DÉPOSÉS** |
| `carte.rouyn-noranda.ca` | 1 | ArcGIS MapServer mono-muni | RIEN (geojson complet non servi) |
| `geo.ville.alma.qc.ca` | 1 | REST custom v2.0 | RIEN (jeton de session requis) |
| `www.arcgis.com` | 2 | portail item = **Web Map** (featureCollection embarquée) | RIEN (pas de service interrogeable) |
| `portneuf.blob.core.windows.net` | 3 | Azure blob `.zip` (shapefile) | RIEN (zip à extraire) |
| `www.chelsea.ca` / `www.villagedehemmingford.ca` / `preissac.com` / `st-amable.qc.ca` / `www.municipalite.saint-armand.qc.ca` / `stepetronille.com` | 6 | PDF (plan de zonage) | RIEN (pdf, georéférence ≠ source-identity) |

## 2. Capture (k8s, cluster OVH — cible SoT `acquisition/config/k8s-target.json`)

- Orchestrateur `acquisition/src/k8s-capture-run.ts --lane zones --run-stamp 20260811T000000Z
  --shards 1 --concurrency 1 --kubeconfig ~/.kube/ovh.conf --namespace geo`.
- Job **`geo-capture-zones-20260811t000000z`** : `kubectl wait --for=condition=complete
  --timeout=900s` → **condition met (exit 0)** en avant-plan (jamais en tâche de fond).
- 4 URLs capturées (les 3 mrcal + rouyn) ; octets bruts + manifeste + logs sur S3 sous
  `capture/_runs/zones-20260811T000000Z-*` ; worklist déposée
  `s3://sentropic-geo/registry/capture-worklists/zones-20260811T000000Z.json`.
- La cible OVH (`hlhedx.c1.bhs5.k8s.ovh.net`) est vérifiée par `assertDeclaredCluster` ; le
  contexte Scaleway par défaut (dual-run interdit) est écarté.

## 3. sig.mrcal.ca — FeatureServer PARTAGÉ, filtre `code`, champ code-zone `zonage` (3 DÉPÔTS)

UNE couche `EVALUATION/sde_zonage_s/FeatureServer/0` (MRC Antoine-Labelle, publique, sans
jeton, HONORE `f=geojson`, `maxRecordCount=2000`, polygone, 1504 features / 18 codes muni).
Le champ `code` porte le **code géographique MAMH** de la muni (filtre per-muni), `zonage`
porte le **code-zone** (ex `VIL-05`, `A-I`). Le `code` par slug est résolu **par géométrie**
(centroïde per-code → plus-proche muni du registre), reproductible et anti-homonyme —
c.-à-d. jamais deviné. Piège d'homonyme écarté : `79037` (Rivière-Rouge, 183 zones) tombe
aussi près de `lascension` ; le vrai L'Ascension est **`79050`** (0,41 km, codes en chiffres
romains, overlap 100 % avec le servi). Forme geojson :
`<layer>/query?where=code='<code>'&outFields=*&f=geojson`.

| # | muni | code (filtre) | features | count LIVE | champ | overlap | droppés→UNKNOWN | sha256 (court) | in-cohort |
|---|---|---|---:|---:|---|---:|---:|---|---|
| 1 | chute-saint-philippe | 79065 | 36 | 36 | zonage | 100 % | 0 | 52875c50 | non |
| 2 | lac-des-ecorces | 79078 | 120 | 120 | zonage | 100 % | 0 | 498930ab | non |
| 3 | lascension | 79050 | 48 | 48 | zonage | 100 % | 0 | a3e775ee | non |

**3 munis à overlap 100 % (0 droppé).** `nearest_registre_muni==slug` sur les 3,
`count_complete=true`, 100 % polygonal (Polygon/MultiPolygon), grain **zone-polygon**.

### Readback (G5) — VERT sur les 3

Chaque muni (layout **flat**) : `feature_count_matches_capture`,
`geometry_digest_byte_exact`, `zone_code_present_all`, `proof_url == query URL`,
`proof_sha256 == capture sha`, `carries_capture_sha256`, `zone_source_level == documented`,
`zone_source_url` uniforme = proof.url, `geometry_grain == zone-polygon`, backup
`_replaced/qc-zonage-<slug>__flat.2026-08-16T0328Z.geojson` présent → tous **true**.
`readback_ok=true`, `statut=DEPOSITED` sur les **3/3**.

## 4. RIEN — 13 munis (raison spécifique, anti-invention)

### 4.1 rouyn-noranda (`carte.rouyn-noranda.ca`) — geojson complet non servi
Couche `Donnees_ouvertes/.../MapServer/5` (« Plan de zonage », Ville de Rouyn-Noranda,
`MUNICIPALITE=86042`, 1058 zones, polygones **très denses ~77 Ko/feature**). `f=geojson`
fonctionne sur des sous-requêtes bornées (`resultRecordCount≤~600` → geojson valide,
`application/geo+json`) mais la requête **pleine étendue `where=1=1` (~48 Mo, ~8-10 s)**
franchit le délai de la passerelle IIS/reverse-proxy en frontal et renvoie une **page HTML
d'application** (HTTP 200 `text/html`) au lieu du geojson. La capture a fidèlement stocké
cette page HTML (`.html`). Une capture complète byte-exact **single-payload** n'est pas
servie de façon fiable ; un pull complet exigerait une **pagination + fusion multi-payload**,
ce qui casse le modèle de preuve v2 à source unique → **hors pipeline standard**. Pas de
forçage. **RIEN-source-request-bounded.**

### 4.2 alma (`geo.ville.alma.qc.ca`) — jeton de session requis
REST custom `/services/rest/v2.0/projects/10/layers/29/elements` répond
`{"message":"Invalid session id.","status":"Unauthorized"}` sur l'URL enregistrée (rejeu
source-identity). Backend session/token-proxifié → **RIEN-token-required.**

### 4.3 havre-saint-pierre & plessisville (`www.arcgis.com`) — Web Map à featureCollection embarquée
Les 2 URLs sont des pages `item.html` de **Web Maps** ArcGIS Online (type=Web Map, `url:null`).
Les couches de zonage sont des **featureCollections esri EMBARQUÉES** dans le JSON du web
map (`/data`), **sans FeatureServer interrogeable** :
- havre-saint-pierre : « Carte de zonage HSP », 2 sous-couches polygone `Zonage_terri` (24) +
  `Zonage_Urb` (70), codes `CODE_AFFEC` (`73 V`, `9 P`) — territoire correct (extent -63.6/50.2).
- plessisville : « PLAN DE ZONAGE ET MATRICE GRAPHIQUE », sous-couche polygone `ZONAGE_0`
  (115), champ `Nom` (`107 R`) — territoire correct (extent -71.78/46.22).
Ce sont de vraies données de zonage, mais en **esri-JSON embarqué (rings projetés)**, pas un
geojson interrogeable ; les servir exigerait une extraction/reprojection bespoke esri→geojson
(+ fusion de 2 couches pour HSP) → **hors capture source-identity standard, pas de forçage.**
**RIEN-embedded-webmap-no-service.**

### 4.4 neuville, saint-gilbert, saint-raymond (`portneuf.blob.core.windows.net`) — zip à extraire
URLs = fichiers `.zip` (shapefiles MTM : `zonage_neu_mtm83-7_s_10-2020.zip`,
`zonage_sg_mtm83-8_s-2023-07.zip`, `zonage_sr_mtm83-7_s-2026-02.zip`). Le pipeline de capture
attend une URL http(s) rendant les octets geojson ; un `.zip` shapefile exige extraction +
conversion + reprojection → non géré par la capture standard.
**RIEN-needs-shapefile-path (zip à extraire).**

### 4.5 six PDF — georéférence ≠ source-identity
`chelsea`, `hemmingford--les-jardins-de-napierville--2`, `preissac`, `saint-amable`,
`saint-armand`, `sainte-petronille` : `zone_source_url` = un **PDF** (plan de zonage). C'est
un plan georéférençable, pas une couche vecteur source-identity. **RIEN-pdf-only.**

## 5. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : le script
de dépôt + les sondes n'ajoutent aucune erreur.

## 6. Verdict — front v2 automatisable CLÔTURÉ

Queue marginale **CLÔTURÉE : 3/16 DÉPOSÉS, 13 RIEN documentés**. Les 13 RIEN sont des
non-automatables réels (geojson complet non servi ×1, jeton ×1, web-map embarqué ×2, zip ×3,
pdf ×6), pas des angles morts. **Le front v2-upgrade automatisable par source-identity est
désormais entièrement fermé** : toutes les veines-plateforme sont traitées, goAzimut est
mort, et cette dernière queue hors-veine ne laisse aucun candidat automatable non déposé.

### Slugs déposés (pour re-fold)

`chute-saint-philippe`, `lac-des-ecorces`, `lascension`
