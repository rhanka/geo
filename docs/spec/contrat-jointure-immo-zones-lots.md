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
