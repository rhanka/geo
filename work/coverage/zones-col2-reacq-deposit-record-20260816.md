# Dépôt v2 RE-ACQUISITION col-2 — beaupré + mille-isles

**Date** : 2026-08-16 · **run-stamp capture** : `20260816T120000Z`
(OVH `poc-ca`/geo, Job `geo-capture-zones-20260816t120000z`, `wait --for=condition=complete` = met, exit 0)
**Triage source** : `work/coverage/zones-col2-source-triage-20260816.json` (commit 2c741540)
**Cibles** : g-cond col-2 résidus de cohérence — beaupre (2929 lots HORS-ZONE) et mille-isles (offset ~1705 m).
**Verdict** : **DEPOSITED 2/2** (readback VERT). Capture sur cluster (mandatoire), dépôt local read→verify→write.

## Méthode (recette lot vnatif, variante ré-acquisition col-2)

1. Sonde read-only pré-capture `_zones-col2-reacq-precount-20260816.ts` : confirme couche/champ/SR,
   `returnCountOnly` (78 / 66) et qu'un échantillon `f=geojson&outSR=4326` rend du WGS84 QC plausible.
2. Worklist `zones-col2-reacq-capture-worklist-20260816.json` (2 munis, `f=geojson&outFields=*&outSR=4326`).
3. Capture CLUSTER (`k8s-capture-run.ts`, 2 shards, image `…@sha256:60f048b5…`), puis `kubectl wait` bloquant.
4. Dépôt v2 depuis le CAS (`_zones-col2-reacq-deposit-20260816.ts`) : G2 byte-exact
   (`verifyRawCapturePayload`), `depositCapturedZones` (2 layouts, backup `_replaced/`, carry props,
   preuve v2 par-feature+collection, re-fold enrichment, re-stamp `documented` + `geometry_grain`).

## Résultat par municipalité

| muni | statut | features déposées | distinct zone_code | sha256 preuve (12) | grain | 2 layouts | backup `_replaced/` | readback |
|---|---|---:|---:|---|---|---|---|---|
| **beaupre** | DEPOSITED | 78 | 78 (77 réels + 1 UNKNOWN) | `014f0d32766d` | zone-polygon | ✓ flat+nested | flat + nested-misdeposit | VERT |
| **mille-isles** | DEPOSITED | 66 | 66 | `e2441fb2cc9c` | zone-polygon | ✓ flat+nested | flat + nested | VERT |

- **Source beaupre** : AGOL `services6.arcgis.com/osUKB2jztkflrQhx` `Zonage/FeatureServer/17`, champ `ZONE_`
  (string), SR native MTM7 (wkt présent → reproject serveur), live 78, `!exceededTransferLimit`,
  preuve = `…/17/query?where=1=1&outFields=*&outSR=4326&f=geojson`.
- **Source mille-isles** : AGOL `services9.arcgis.com/iZcAwIV2GibwcZLe` `Zonage/FeatureServer/0`, champ
  `zone` (string), filtre `co_mun=76030` (co_mun=Integer → sans quotes), SR native 3857, live 66,
  preuve = `…/0/query?where=co_mun=76030&outFields=*&outSR=4326&f=geojson`.
- **Servi AVANT** (les deux, 2 layouts) : `zone_source_level=legacy-traceable`, aucune preuve v2 →
  cibles UNPROUVÉES, éligibles à un v2 frais (ré-acquisition ; overlap RAPPORTÉ, non opposé).
- **Servi APRÈS** : `zone_source_level=documented`, `zone_source_url` = l'URL de preuve, bloc
  `proof.geometry_source` (sha256 + retrieved_at) par-feature ET collection, `geometry_grain=zone-polygon`.

## beaupre — correction du nested-affectation mal-déposé (défaut principal résolu)

- **AVANT** : geo-api servait le NESTED = couche MRC-affectation MAL-DÉPOSÉE (20 polygones,
  `zone_code=null`, 49 clés wrong-layer : Affectatio/Vocation/PU_poly/OBJECTID…) → 2929 lots HORS-ZONE.
  Le vrai zonage n'existait que dans le FLAT (78 zones, non prouvé).
- **Traitement** : le nested wrong-layer a été **sauvegardé octet-pour-octet** sous
  `_replaced/qc-zonage-beaupre__nested-misdeposit.2026-08-16T0441Z.geojson` (audit), **supprimé** (pour
  ne pas opposer le gate anti-perte à des clés qui n'appartiennent pas au zonage), puis **(re)créé =
  contenu final du flat** (vrai zonage v2) via `putServedZoneGeojson`. Le flat a lui aussi été
  sauvegardé (`…__flat.2026-08-16T0441Z.geojson`).
- **APRÈS (vérif read-only indépendante)** : NESTED = FLAT = **78 features, 78 codes distincts, 0 vide**,
  78/78 preuve v2, collection proof 2.0, `documented`, bbox couvre la muni `[-70.955,47.031,-70.861,47.110]`,
  échantillon de codes réels (`68-Ri2, 65-Ri1, 61-H…`). Le nested ne sert PLUS l'affectation-null →
  **les 2929 HORS-ZONE sont résolus par construction**.
- **COVERAGE-GATE OVERRIDE** (décision conducteur) : le garde AGOL « ≥1 zone-code vide → SKIP » est levé ;
  le 1 feature `ZONE_` vide → `zone_code="UNKNOWN"` (JAMAIS N-A). 0 code servi-seulement droppé.

## mille-isles — provenance mise à niveau ; OFFSET NON CLÔTURÉ (finding)

- Re-capture `outSR=4326` déposée byte-exact sur les 2 layouts, `documented` + preuve v2 (66/66).
- **MAIS l'offset ~1705 m N'EST PAS clôturé** : le centroïde/bbox de la nouvelle capture est
  **byte-identique** au servi antérieur (`old_nested_vs_new_capture_centroid_shift_m = 0` ;
  centroïde `[-74.20734, 45.82048]` inchangé). La géométrie servie était **déjà** le reprojection WGS84
  correct de la source AGOL — l'offset n'est donc PAS une erreur de reproject de notre pipeline que la
  re-capture pourrait corriger. Il s'agit d'un **décalage source-vs-cadastre inhérent** à la couche de
  zonage de la MRC d'Argenteuil (triage R=0.89, non parfaitement rigide).
- **On NE DÉCALE PAS la géométrie** (ce serait de la fabrication). Le dépôt reste correct et honnête :
  il PROUVE (byte-exact) que le servi reproduit fidèlement la source autoritaire et le rend
  re-téléchargeable/traçable. **Il n'améliore pas la cohérence col-2 lots↔zones** de mille-isles :
  le mismatch de lots persiste et relève d'un recalage/georéférence futur contre le cadastre (autre
  méthode), pas d'une ré-acquisition vecteur.

## Gardes vérifiées (par muni, isolation stricte)

G2 byte-exact (rehash CAS == manifeste == clé CAS + `verifyRawCapturePayload`) ✓ ; FC non vide ✓ ;
100 % polygonal ✓ ; anti-homonyme `nearest_registre_muni===slug` (beaupre 0,72 km / mille-isles 0,20 km) ✓ ;
grain `zone-polygon` (aucun marqueur UEV) ✓ ; anti-troncature ArcGIS
(`returnCountOnly[MÊME where]==features` & `!exceededTransferLimit` : 78/78, 66/66) ✓ ;
servi ne portait PAS déjà de preuve v2 ✓ ; readback G5 sur les DEUX layouts (géométrie octet-exacte,
`level=documented`, `url=proof.url`, sha==capture, grain uniforme, backup présent) ✓.

## Reproductibilité

- Worklist : `work/coverage/zones-col2-reacq-capture-worklist-20260816.json`
- Sonde pré-capture (read-only public) : `acquisition/src/_zones-col2-reacq-precount-20260816.ts`
- Sonde servi (read-only S3) : `acquisition/src/_zones-col2-reacq-inspect-served-20260816.ts`
- Runner de dépôt (`--dry-run` par défaut, `--commit`, `--only`) : `acquisition/src/_zones-col2-reacq-deposit-20260816.ts`
- Record machine : `work/coverage/zones-col2-reacq-deposit-record-20260816.json`
- Typecheck acquisition : **delta 0** (seules subsistent les 2 erreurs pré-existantes
  `capture-e2e-probe.test.ts` et `zones-vecteur-natif-manifest-run.ts`).
