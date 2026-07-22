# Contrat de jointure geo → immo : ZONES ↔ LOTS ↔ SIGNAUX

**Statut** : contrat de fédération (geo POSSÈDE la donnée, immo CONSOMME).
**Date** : 2026-06-21. **Snapshot données** : `2026-06-21`.
**Public** : tenant `radar-immobilier` (immo). geo ne modifie pas le code immo ; immo n'a qu'à suivre ce contrat.

---

## 1. Problème observé (diagnostic end-to-end)

Immo « ne réussit pas à mapper zones et signaux ». Tracé du pipeline immo :

- UI immo `ui/src/lib/maps/signaux-map-geo.ts` joint un SIGNAL à une ZONE/LOT **par clé textuelle** :
  - lot : `noLot` normalisé (espaces retirés) ;
  - zone : `code` de zone normalisé.
- La projection « inherited » (signal de zone → lots de la zone) exige que chaque zone porte `properties.lots[] = [{noLot}]`.
- Cette liste est construite côté backend immo par `groupLotsByZone` (`api/src/services/geo/zones.ts`) à partir du **`zoneCode` de chaque lot**.
- **MAIS** : pour les villes réelles `donnees-quebec`, le service lot immo (`api/src/services/geo/lots.ts`) émet `{noLot, citySlug}` **sans code de zone**, et la route `api/src/routes/geo-zones.ts` pose donc `zoneCode: null`. Résultat : `zone.properties.lots[]` est **vide**, et aucun lot ne peut être rattaché à une zone → aucun signal de zone ne se projette.

La cause est un **lien lot↔zone manquant** dans ce que geo expose actuellement via l'API OGC :

- `GET https://api.geo.sent-tech.ca/collections/qc-lots-<slug>/items` ne porte que
  `NO_LOT, noLot, geoId, name, code, level, country` — **pas de `code_zone`**.
- Les zones (`qc-zonage-<slug>`) et les lots (`qc-lots-<slug>`) sont **deux collections séparées** ;
  geo ne fait pas la jointure spatiale lot↔zone dans la réponse OGC.

geo PRODUIT pourtant déjà ce lien, hors API OGC : l'**index zéro-copie immo**
(`registry/index-immo/<slug>.parquet`) contient `no_lot → code_zone` par lot.

---

## 2. Produits geo disponibles (S3 `sentropic-geo`, snapshot 2026-06-21)

| Produit | Clé S3 | Contenu | Couverture |
|---|---|---|---|
| Cadastre clippé | `normalized/qc-cadastre-lots/<slug>.geojson` | Polygones, props `NO_LOT`, `geoId` (=`feature_id`) | **1102 munis** |
| Zonage normalisé | `normalized/ca-qc-zonage/<grid_slug>.geojson` | Polygones, prop `zone_code` (ou `NO_ZONAGE`…) | ~214 grilles, **~15 munis avec `zone_code` exploitable** |
| **Index immo (zéro-copie)** | `registry/index-immo/<slug>.parquet` | `feature_id`, `no_lot`, `code_zone`, `role_*` | **30 munis** (z∩m∩p) |
| Rôle foncier | `registry/role-foncier/<slug>.parquet` | attrs bâtiment par `NO_LOT` | 1095 munis |
| **Limites RTA/FSA** | `normalized/qc-admin-boundaries/qc-fsa.geojson` | Polygones RTA (3 car. du code postal), Recensement 2021 StatCan | **414 RTA (Québec)** |
| PMTiles zones | `pmtiles/qc-zones.pmtiles` | couche province | — |
| PMTiles lots | `pmtiles/qc-lots.pmtiles` | couche province | — |

L'API OGC live (`https://api.geo.sent-tech.ca`) sert **le cadastre clippé à jour**
(comptes identiques au S3 normalisé : rimouski 9704, chelsea 4907, alma 11838) et
1102 `qc-lots-*` + 329 `qc-zonage-*`. **Elle n'expose PAS `registry/index-immo`** ni
`code_zone` sur les features lots.

---

## 3. Contrat de jointure (à suivre par immo)

### Clés canoniques

| Côté | Clé | Normalisation |
|---|---|---|
| Lot | `no_lot` | retirer **tous les espaces** : `"3 029 807" → "3029807"` |
| Lot (stable) | `feature_id` = `geoId` | verbatim, ex. `ca/qc/lot/3-029-807` |
| Zone | `code_zone` | code verbatim de la grille, ex. `PAR-9`, `AN-649` |

`join_keys` officiels de l'index : **`["feature_id", "no_lot"]`** (cf. `registry/index-immo/manifest.json`).

### Schéma `registry/index-immo/<slug>.parquet`

```
feature_id                 string   # = geoId du lot dans qc-lots-<slug> / PMTiles lots
no_lot                     string   # NO_LOT verbatim (avec espaces)
code_zone                  string   # code de zone (point-in-polygon centroïde) — null si hors grille
role_usage_cubf            string
role_nb_etages_max         double
role_annee_construction    double
role_superficie_batiment_m2 double
role_nb_logements          double
role_valeur_immeuble       double
_source                    string   # "geo:cadastre-clip⋈role⋈zonage"
_snapshot                  string   # "2026-06-21"
```

`code_zone = null` quand la ville n'a pas de grille zonage exploitable OU que le centroïde
du lot tombe hors de tout polygone (anti-invention : jamais deviner).

---

## 4. Fix recommandé pour immo (le bon produit = l'index immo)

Le service lot immo (`api/src/services/geo/lots.ts`) et le pull (`api/src/services/geo/ogc-pull.ts`)
**ne câblent pas** l'index immo. C'est la cause directe de `zoneCode: null` sur les lots.

**Action immo** : pour les villes couvertes par l'index, peupler le `code_zone` de chaque lot
depuis `registry/index-immo/<slug>.parquet`, joint par `no_lot` normalisé (ou `feature_id`).

1. Lire `registry/index-immo/<slug>.parquet` (S3 `sentropic-geo`, lecture seule).
2. Indexer `{ normalize(no_lot) → code_zone }` (et `role_*` si besoin pour le scoring).
3. Dans `lots.ts`, poser `zoneCode = lookup[normalize(noLot)] ?? null`.
4. Dès lors `groupLotsByZone` remplit `zone.properties.lots[]` et la projection
   « inherited » des signaux fonctionne pour les villes de l'index.

Alternative (plus simple, lecture seule, pas de pull S3) : si geo expose `code_zone` sur les
features `qc-lots-<slug>/items` (cf. §5), immo n'a qu'à lire `properties.code_zone` dans
`ogc-pull.ts` / `lots.ts` — aucune dépendance parquet côté immo.

**Limite de couverture honnête** : `code_zone` n'existe que là où une grille zonage ouverte
existe (~15 munis avec grille exploitable sur les 30 de l'index ; 32,99 % des lots de l'index
ont un `code_zone`). Hors de ces munis, **aucun** `code_zone` n'est possible — c'est le plafond
réel du zonage ouvert au QC, pas un bug. Pour ces villes, immo doit garder le fallback
`geometryStatus: missing` / `lot-union-fallback`.

> Note : ce contrat ne résout QUE le lien lot↔zone (Failure 2 du diagnostic). La projection des
> SIGNAUX reste bloquée tant que graphify ne peuple pas `zone_ref` / `no_lot` sur les nœuds
> Signal/DesignationEvent (Failure 1, côté immo/graphify — 1×/0× sur 7781 nœuds). Le présent
> contrat fournit la donnée nécessaire ; il ne remplace pas l'extraction des refs côté immo.

---

## 5. Décision côté geo (à trancher par l'équipe geo)

Deux options, federation-first :

- **(A) Enrichir l'API OGC** : ajouter `code_zone` (+ optionnellement `role_*`) aux props des
  features `qc-lots-<slug>` servies, par jointure de `registry/index-immo/<slug>.parquet` au
  moment du `writeNormalized` / build du snapshot lots. immo lit alors `properties.code_zone`
  sans dépendance parquet. **Recommandé** (zéro changement de schéma de transport, immo lit déjà
  `zone_code`/`code_zone` dans `ogc-pull.ts ZONE_CODE_ATTRS`).
- **(B) Publier l'index tel quel** et documenter sa consommation directe (le présent contrat).
  C'est déjà le cas : l'index + manifest sont sur S3.

L'option (A) est non implémentée ici car l'index immo province est en cours d'enrichissement
séparé (ne pas écrire S3 cadastre/role/zonage pendant ce process). Ce document est le livrable
de contrat ; l'exposition `code_zone` sur l'API OGC sera faite avec le rebuild du snapshot lots.

---

## 6. Champs additifs servis sur `qc-lots-<slug>/items` (MàJ 2026-07-05)

L'option (A) a été RÉALISÉE : le produit enrichi `normalized/qc-lots/qc-lots-<slug>.geojson`
(bâti par `acquisition/src/lots-enriched-run.ts`) est servi tel quel par l'API OGC pour les
municipalités couvertes. Chaque feature lot porte, en plus de l'identité cadastrale
(`NO_LOT`, `noLot`, `geoId`, `lot_id`…), ces champs additifs **rétro-compatibles** (valeur
réelle ou `null`, jamais devinée) :

| Champ | Type | Source | Sens |
|---|---|---|---|
| `zone_code` / `code_zone` | string\|null | grille zonage (point-in-polygon) | code de zone (alias identiques) |
| `dominant_fraction`, `multi_zone`, `zone_codes`, `assignment_method` | | jointure zonage | méta-jointure lot↔zone |
| *(normes aplaties)* `hauteur_max_value`, `densite_value`, `marge_avant_min_value`, … | | extraction normes | valeurs réglementaires par zone |
| `surface_m2` | number\|null | géométrie (aire reprojetée MTM/UTM) | superficie réelle du lot (m²) |
| `adresse` | string\|null | rôle foncier MAMH (jointure `NO_LOT`) | adresse civique verbatim |
| **`code_postal`** | string\|null | **RTA/FSA StatCan 2021** (géocodage inverse du centroïde) | **3 premiers caractères du code postal** (ex. `J4P`) |
| **`code_postal_precision`** | `"fsa3"`\|null | idem | drapeau de précision (honnêteté) |
| `in_tod`, `tod_id`, `tod_nom`, … | | aires TOD PMAD | proximité transport structurant |

### `code_postal` — précision RTA/FSA (limite ouverte honnête)

- `code_postal` est la **RTA (Région de Tri d'Acheminement)** = **3 premiers caractères** du
  code postal canadien, obtenue par **point-in-polygon du centroïde du lot** dans les limites
  RTA du Recensement 2021 (Statistique Canada, licence ouverte). **Ce n'est PAS le code postal
  complet à 6 caractères** — celui-ci est la propriété de Postes Canada et n'existe dans
  **aucune source ouverte joignable en bulk** au Québec. La RTA est donc le plafond ouvert.
- `code_postal_precision = "fsa3"` quand résolu ; `code_postal = null` (et precision `null`)
  quand le centroïde ne tombe dans aucune RTA (anti-invention : jamais fabriqué).
- Couverture observée : ~**99–100 %** des lots par muni (une RTA couvre tout territoire habité).
- Le rôle foncier NE porte PAS le code postal de l'immeuble (seulement l'adresse postale du
  propriétaire, hors-sujet) — d'où le géocodage inverse spatial.
- Staging de la source : `acquisition/src/fsa-boundaries-prep.ts` →
  `normalized/qc-admin-boundaries/qc-fsa.geojson` (+ `.stats.json`, provenance/licence).

immo consomme `properties.code_postal` en passthrough (chaîne 3 car.) et peut afficher/agréger
au niveau RTA ; ne PAS présenter la valeur comme un code postal complet.

---

## 7. Preuve uniforme par feature (MàJ 2026-07-22)

Chaque feature servie par les collections `qc-lots-<slug>` et
`qc-zonage-<slug>` porte désormais le champ additif `properties.proof`, contrat
`immo-feature-proof/v1`. Il est conservé tel quel par un consommateur OGC :

```ts
interface FeatureProofV1 {
  schema_version: "1.0";
  status: "complete" | "partial"; // partial est une lacune déclarée, jamais une preuve inventée
  sources: {
    geometry: { status: "available" | "unavailable"; artifact_uri: string | null; upstream_uri: string | null };
    regulation: { status: "available" | "unavailable"; artifact_uri: string | null; upstream_uri: string | null };
  };
  // null pour une zone; pour un lot, lien précis par code unique dans la couche zone.
  zone: { collection: string | null; zone_code: string | null; feature_ref: string | null; assignment_method: string | null } | null;
  gaps: string[];
}
```

- Une **zone** fournit son artefact géométrique servi et, quand le registre
  `reglement-provenance` l'atteste, l'URL réglementaire. L'absence est explicite
  dans `gaps` (`regulation_source_unavailable`).
- Un **lot** fournit son artefact, `qc-zonage-<slug>`, son `zone_code`, la
  référence stable `collection#zone_code=<code>` de la zone exacte quand le code est unique,
  et la méthode d'assignation existante. Les cas non assignés, code ambigu ou
  méthode non matérialisée restent explicitement null/`gaps`.

### Diagnostic v1 historique

```bash
cd acquisition && npm run proof:backfill -- --all --out ../work/coverage/immo-proof-coverage.json
```

Cette commande reste un diagnostic v1 **strictement audit-only**. Son ancien mode
`--upload` est retiré : une URL exacte et un hash v2 ne peuvent pas être déduits
d'un artefact S3 ou d'un champ générique. Le recensement normatif courant est le
registre v2 décrit ci-dessous.

### API / déploiement

Ce dépôt ne contient pas l'implémentation de `geo-api`: la seule référence est
le manifeste `deploy/k8s/geo-api-deployment.yaml`, qui tire l'image externe
`rg.fr-par.scw.cloud/sentropic-geo/geo-api:0.1.4`; aucune source de route OGC,
Dockerfile ou hook de build API n'est versionné ici. La preuve est un champ de
propriété GeoJSON, donc l'API OGC qui sert déjà les objets
`normalized/qc-lots`/`normalized/ca-qc-zonage` l'expose sans nouveau mapping.
Un propriétaire externe doit seulement publier l'image/configuration API si
celle-ci filtre les propriétés, puis faire le déploiement Kubernetes; aucune
publication S3 ni opération Kubernetes n'est faite par cette évolution.

---

## 8. Admission des zones par source géométrique (normatif)

Une zone n'est servie à Immo que si sa géométrie porte une source d'acquisition
réelle, non nulle. Le règlement reste une provenance distincte et ne peut jamais
remplacer cette source.

```json
{
  "proof": {
    "schema_version": "2.0",
    "geometry_source": {
      "url": "https://source-reelle.example/zonage.geojson",
      "type": "geonet | arcgis | agol | wfs | jmap | pdf-zonage | geojson-officiel",
      "method": "natif | georeference",
      "reliability": "directe | georeferencee",
      "retrieved_at": "2026-07-22T00:00:00Z",
      "sha256": "sha256:..."
    }
  }
}
```

- `geometry_source.url` est une URL HTTP(S) de l'artefact ou endpoint ayant
  produit les polygones : elle est obligatoire, jamais `null`.
- Le record est défini dans un registre revu par collection `qc-zonage-<slug>`;
  toutes les features de cette collection reçoivent le même record. Aucune
  heuristique par feature ne peut inventer une URL.
- S3, un chemin local, `t2-gcp3`, un libellé de pipeline, une page d'accueil et
  un PDF de règlement ne satisfont pas cette règle à moins que le PDF soit bien
  l'artefact géométrique exact qui a été géoréférencé.
- Une collection sans record exact est hors du catalogue public; ses lots peuvent
  rester cadastraux mais ne présentent ni zone ni norme dérivée.
- Toute acquisition nouvelle doit enregistrer cette preuve au moment du fetch,
  avant tout dépôt servi.

### Audit global v2, sans écriture S3

```bash
cd acquisition
npm run proof:audit -- \
  --out ../work/coverage/served-proof-registry.json \
  --summary-out ../work/coverage/served-proof-summary.json
```

L'audit énumère et lit les deux layouts canoniques, plat et imbriqué. Il publie
séparément l'audit de toutes les clés physiques et la vue logique effectivement
servie (priorité au plat). Le registre de sources n'admet que les preuves v2
exactes et éligibles. L'ancien champ explicitement géométrique
`proof.sources.geometry.upstream_uri` peut classer une feature comme
**recoverable**, mais n'entre jamais au registre sans récupération et hash v2.
Les champs génériques `url`/`source`, pages d'accueil, règlements et clés S3 sont
exclus. Toute erreur List/Get reste une erreur comptabilisée et rend la commande
non-zéro.

Le helper S3 générique refuse toute écriture ou copie directe vers une clé
canonique `qc-zonage`. Le seul chemin d'écriture est
`putServedZoneGeojson`, qui exige une collection non vide, une preuve v2 valide
et exactement la même preuve sur chaque feature avant d'envoyer l'objet.
