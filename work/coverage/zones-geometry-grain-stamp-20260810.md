# Estampille `geometry_grain` additive — record (2026-08-10)

Ajout du grain de géométrie **`geometry_grain="zone-polygon"`** (frère additif de
`zone_source_url` / `zone_source_level`) sur **4 collections zones servies** dont la
géométrie est une couche de **polygones de zonage NATIFS** (prouvées v2 `documented`,
cf `zones-vnatif-deposit-record-20260810` lot1 + `-lot2`).

Spec ratifiée archi : **SPEC_ZONE_GEOMETRY_GRAIN.md §2 (SHA 7c7f6731)**. Vocabulaire
FERMÉ à 3 valeurs `{zone-polygon | evaluation-unit | dissolved-zone}`. Cette passe
n'estampille que `zone-polygon` ; `dissolved-zone` est RÉSERVÉ (hors contrat courant)
et n'est apposé sur RIEN.

## Chemin ADDITIF (géométrie octet-pour-octet inchangée)

`putServedZoneAdditive(key, fc, { allowedProps: ["geometry_grain"] })` — la lib
PROUVE chaque géométrie byte-identique au servi (même count, même ordre, `jsonEqual`
par feature) et REFUSE toute autre altération : `proof`, `zone_code`, `zone_source_url`
et `zone_source_level` restent inchangés. Le stamp est apposé sur CHAQUE feature (comme
les deux estampilles de source dont il est le frère), valeur uniforme `zone-polygon`.

En plus du garde de la lib, le runner recalcule un **digest SHA-256 des géométries**
AVANT et APRÈS (relecture indépendante) et échoue si l'un diffère.

### Diff lib (capitalisée, `acquisition/src/lib/zonage-proof.ts`)

- Ajout à `PROVENANCE_PROP_WHITELIST` de la ligne : **`"geometry_grain",`** (plafond
  additif ; c'est la seule clé nouvelle autorisée sur ce chemin).
- Ajout du vocabulaire typé, frère de `ZONE_SOURCE_LEVELS` : `export type GeometryGrain`,
  `export const GEOMETRY_GRAINS` (Set fermé des 3 valeurs), `export const GEOMETRY_GRAIN_FIELD = "geometry_grain"`.
- La garantie byte-exact de `putServedZoneAdditive` n'est PAS touchée.

## Classification (autorité = NATURE de la couche source)

Marqueur d'unité d'évaluation (`ID_UEV` / `MATRICULE8` / `CODE_UTILI`) inspecté sur
l'union des champs de chaque collection : **absent partout** ⇒ couche de polygones de
zonage native ⇒ `zone-polygon`. Le ratio features/`zone_code` (~1) n'est qu'un
corroborant. Aucune des 4 n'est une matrice graphique.

## Résultat : 4/4 STAMPED, géométrie byte-exact préservée (readback VERIFIED)

| slug | layout | key servie | feat | champ zone | ratio | UEV ? | sha256 géométrie avant==après | geometry_grain | readback |
|---|---|---|---:|---|---:|---|---|---|---|
| longueuil | nested | `…/qc-zonage-longueuil/qc-zonage-longueuil.geojson` | 1927 | `Zonage` | 1.000 | non | `103bbc2a…` == `103bbc2a…` | zone-polygon | OK |
| salaberry-de-valleyfield | nested | `…/qc-zonage-salaberry-de-valleyfield/…geojson` | 645 | `ZONE`/`num_zone` | 1.008 | non | `a5431131…` == `a5431131…` | zone-polygon | OK |
| westmount | nested | `…/qc-zonage-westmount/qc-zonage-westmount.geojson` | 159 | `ZoneNumber` | 1.000 | non | `533bb573…` == `533bb573…` | zone-polygon | OK |
| lassomption | flat | `…/qc-zonage-lassomption.geojson` | 359 | `Zonage` (couche sœur) | 1.000 | non | `63868f78…` == `63868f78…` | zone-polygon | OK |

Digests SHA-256 complets et union des champs par collection : voir
`zones-geometry-grain-stamp-20260810.json`.

### Preuve de source (couche amont) par collection
- **longueuil** : `DO_Zonage/FeatureServer/0` (services2.arcgis.com/h4XWvDXfYYyD6jNu).
- **salaberry-de-valleyfield** : `SdV__Zonage_Reglement150/FeatureServer/0` (services5.arcgis.com/8TXm0JD0A0eOyxy5).
- **westmount** : `Zonage_/FeatureServer/0` (cartes.westmount.org).
- **lassomption** : `URB_MAJZonageJuillet2021/FeatureServer/0` (services9.arcgis.com/hcaJWZHFtN5aFHXa ; couche sœur déjà prouvée v2 documented).

## Layouts

Chaque slug n'expose qu'UN layout servi (pas de coexistence flat+nested) : longueuil /
salaberry / westmount en sous-dossier, lassomption en plat. Le runner sonde les DEUX
candidats et n'estampille que ceux qui existent — les deux auraient été stampés si
présents.

## Hors scope (non touchés cette passe)

`saint-hippolyte`, `saint-lin-laurentides`, `hampstead` : gelés sur un arbitrage de
politique de dépôt séparé. Non estampillés ici.

## Typecheck

`tsc --noEmit -p acquisition/tsconfig.json` : 2 erreurs PRÉEXISTANTES inchangées
(`src/lib/capture-e2e-probe.test.ts` TS2305, `src/zones-vecteur-natif-manifest-run.ts:165` TS2322).
La lib + le runner n'ajoutent **aucune** nouvelle erreur (delta = 0).
