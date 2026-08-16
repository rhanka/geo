# Scan autorité-layout servi (zones) — 2026-08-16

**Bug quantifié.** Le geo-api sert le layout NICHÉ quand un slug possède À LA FOIS un
objet plat (`qc-zonage-<slug>.geojson`) et un objet niché
(`qc-zonage-<slug>/qc-zonage-<slug>.geojson`). Quand le niché est une couche
d'affectation MRC mal-déposée (zone_code vide) alors que le vrai zonage municipal
est dans le plat, geo-api sert la mauvaise couche → lots hors-zone.

## Totaux (énumération S3, lecture seule)

- clés listées sous `normalized/ca-qc-zonage/` : **2799**
- slugs PLAT : **808**
- slugs NICHÉS : **73**
- **flat-only : 800**
- **nested-only : 65**
- **BOTH (candidats deep-read) : 8**

## Résultat headline

**2 municipalité(s) MISDEPOSIT-SUSPECT** (niché vide-code servi à la place du vrai zonage plat).
0 INVERSE-SUSPECT (plat vide / niché vrai zonage — geo-api sert alors le bon).

## MISDEPOSIT-SUSPECT — geo-api sert un niché vide-code

| slug | flat_feat | flat_codes | nested_feat | nested_null_frac | nested_codes | affectation |
|------|-----------|-----------|-------------|------------------|--------------|-------------|
| beaupre | 78 | 77 | 20 | 1 | 0 | oui |
| boischatel | 55 | 55 | 17 | 1 | 0 | oui |


## Méthode (lecture seule, anti-invention)

1. `listObjectEntries` sur `normalized/ca-qc-zonage/` → ensembles slugs plat / niché ; totaux.
2. Deep-read (`getGeoJsonFeatureCollection`) UNIQUEMENT des slugs BOTH (borne le coût).
3. Par layout : feature_count, distinct zone_code non vide, fraction null/empty,
   échantillon, champs d'affectation détectés (vocabulaire MRC).
4. MISDEPOSIT-SUSPECT ⟺ niché{null_frac≥0.5 ou distinct=0} ET plat{distinct≥3, null_frac<0.5}.
   INVERSE-SUSPECT = symétrique. Numéros MESURÉS ; un slug illisible est noté, jamais deviné.

## Erreurs de lecture

aucune.

