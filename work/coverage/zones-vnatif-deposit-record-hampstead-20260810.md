# Dépôt v2 par UPGRADE — hampstead candidate→documented (evaluation-unit, 0 perte) — 2026-08-10

Politique ratifiée **SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md (SHA 65d4c637)**. Le
discriminateur de l'identity gate de `depositCapturedZones` est **raffiné** : « prouvé »
signifie désormais que la feature servie porte une **PREUVE v2 par-feature**
(`proof.geometry_source` avec `sha256` réel ET `retrieved_at`), et **NON** simplement
`zone_source_url !== null`. Une URL http(s) réelle est **NÉCESSAIRE mais NON SUFFISANTE** :
un `candidate` à URL *déclarative* sans capture ne porte **aucun** bloc de preuve → **non
prouvé**. Ce raffinement ne peut rendre que **PLUS** de codes non-prouvés (jamais moins) —
strictement plus sûr. Un servi réellement v2-prouvé (bloc de preuve présent) **bloque
toujours** un drop non justifié.

- Gate (lib) : `acquisition/src/zones-obscura-run.ts` — `depositCapturedZones` + helper
  `featureHasV2Proof(feature)` (teste `proof.geometry_source` : `sha256:<64hex>` +
  `retrieved_at` ISO). Discriminateur `isProven(code)` = au moins une feature du code
  porte un vrai bloc de preuve v2. `isRealGeometryUrl(zone_source_url)` **retiré** du gate.
  - Inchangés : coverage gate, `PropertyRegressionError`, `DroppedServedCode{status:UNKNOWN,
    jamais N-A}`, backup `_replaced/`.
- Worker (upgrade + G2 + grain + record + readback) :
  `acquisition/src/_zones-vnatif-deposit-hampstead-20260810.ts`.

## Résultat : hampstead **DEPOSITED** (candidate→documented v2, 0 perte)

| slug | statut | grain | feat | codes distincts | uncovered | droppés | sha256 (court) | source count (G2) |
|---|---|---|---|---|---|---|---|---|
| hampstead | **DEPOSITED** | evaluation-unit | 1869 | 29 | 0 (overlap 100%) | 0 | `4d1c0a9c` | 1869/1869 (returnCountOnly) |

### Servi AVANT (état candidate déclaratif — la prémisse de l'upgrade)

- `zone_source_level = candidate`, `zone_source_url =` FeatureServer/61 **NON-null mais
  DÉCLARATIVE** (aucune capture rattachée), **aucune preuve v2**
  (`served_has_collection_v2=false`, `served_has_real_v2_proof_block=false`).
- 1869 feat / 29 codes distincts, layout **sous-dossier UNIQUEMENT** (`served_layout=nested`
  — mono-layout, pas de doublon flat à estampiller).
- **0 code servi-seulement** (overlap 100%) → jamais bloqué par le gate (ni ancien ni
  raffiné) ; c'est un **pur upgrade de preuve**, pas un remplacement-avec-perte.

### Capture (G2 — prouvée, vérifiée-complète, identité-de-couche)

- Source AGOL `services1.arcgis.com/IP2j0oTRjMlb9KsM/.../Zonage_Hampstead_S/FeatureServer/61`
  (layer id **61**, nom `Zonage_Hampstead_S`), champ `Zone`, 1869 feat / 29 codes, 100 %
  Polygon. `sha256:4d1c0a9c8385248102691a00086472fca5f9ba838a2c93b9548a214f3074dc20`,
  `retrieved_at=2026-08-10T11:26:59.235Z`.
- Run de capture `zones-20260810T124000Z-0-308101d7-db1b-4e18-b9b6-17fad861db05`
  (run-stamp `20260810T124000Z`), CAS `raw/zones-vnatif/cas/4d1c0a9c…json`, http 200.
- **byte-exact** : `rehash_ok=true`, `cas_key_matches=true`, `raw_capture_verified=true`.
- **complétude (G2)** : `feature_count(1869) == source_count(1869)` via `returnCountOnly`
  LIVE, `exceededTransferLimit=false` → PAS un fetch partiel malgré 1869 features.
- **anti-homonyme** : `nearest_registre_muni=hampstead` (0,21 km).

### Grain — evaluation-unit (trace UEV)

Marqueurs d'unité d'évaluation **présents** dans la couche source :
`ID_UEV`, `MATRICULE8`, `CODE_UTILI` → grain classifié **`evaluation-unit`** (== attendu).
La géométrie servie est le grain UEV natif, servi **verbatim** (aucune dissolution/transform).

### Dépôt (upgrade candidate→documented, 0 perte)

- `depositCapturedZones(s3, "hampstead", norm, proof, { geometryGrain: "evaluation-unit" })` :
  octets de la capture déposés via `putServedZoneGeojson`, `level→documented`,
  `url=proof.url`, `geometry_grain=evaluation-unit` (estampillé additivement dans la même passe).
- **0 code droppé** (`dropped_divergence=[]`) — 100 % des 29 codes servis couverts.
- **backup du candidate antérieur** (capitalisé même sans perte, per archi) :
  `normalized/ca-qc-zonage/_replaced/qc-zonage-hampstead__nested.2026-08-10T1224Z.geojson`.

### Readback indépendant — OK

- `geometry_digest_byte_exact=true` (géométrie servie == octets capture),
  `feature_count_matches_capture=true` (1869).
- `proof_url_matches=true`, `proof_sha_matches_capture=true` (`4d1c0a9c…`),
  `proof_retrieved_at=2026-08-10T11:26:59.235Z`, `carries_capture_sha256=true`.
- `level_documented=true` (zone_source_level uniforme `documented`),
  `url_all_proof=true`, `geometry_grain=[evaluation-unit]` (`grain_uniform_expected=true`).
- backup `_replaced/` présent, `dropped_count=0` → **readback_ok=true**.

### Clé S3 servie (exemple evaluation-unit)

```
normalized/ca-qc-zonage/qc-zonage-hampstead/qc-zonage-hampstead.geojson
```

k8s Job de capture `geo-capture-zones-20260810t124000z` = **Complete** (capture déposée sur
S3, CAS re-hashée byte-exact — la preuve est les octets sur le stockage objet, pas l'état
transitoire du pod).
