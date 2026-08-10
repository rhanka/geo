# Dépôt v2 par REMPLACEMENT — servi NON-PROUVÉ (url=null) → capture vecteur natif (2026-08-10)

Politique ratifiée **SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md (SHA 64f82eae)**. L'identity
gate de `depositCapturedZones` est rendu **PROVENANCE-AWARE** : un servi NON-PROUVÉ
(`zone_source_url === null`) ne bloque plus une capture v2 vérifiée-complète ; les codes
servi-seulement non-prouvés passent en **divergence documentée** (G3/G4) au lieu de
`throw`. Un servi **PROUVÉ** (au moins un code servi-seulement porté par une feature à
`zone_source_url` http(s) live) **bloque toujours** (superset strict maintenu).

- Gate (lib) : `acquisition/src/zones-obscura-run.ts` — `depositCapturedZones`.
  - **Ancien** : `uncovered.length > 0` → throw (tous codes servis intouchables, prouvés ou non).
  - **Nouveau** : `throw` **uniquement** si ≥1 code `uncovered` est **PROUVÉ**
    (`isRealGeometryUrl(zone_source_url)`). Les `uncovered` non-prouvés → `droppedDivergence[]`
    (code + `prior_levels` + `zone_source_url:null` + `status:UNKNOWN` + raison), et le servi
    antérieur est sauvegardé octet-pour-octet sous `_replaced/` (mécanisme existant).
  - **Inchangés** : coverage gate (`norm.length < maxServedFeatures` → throw), `PropertyRegressionError`,
    tous les autres gardes. `geometry_grain` estampillé additivement dans la MÊME passe
    (`opts.geometryGrain`, allowedProps whitelisté) — géométrie byte-exact prouvée.
- Worker (dépôt + G2–G6 + record + readback) : `acquisition/src/_zones-vnatif-deposit-replace-20260810.ts`.
- Preuve v2 = `{url, retrieved_at, sha256}` des octets CAS (re-hash CAS == manifeste == clé CAS
  + `verifyRawCapturePayload`), `type=arcgis method=natif reliability=directe`, `level→documented`.

## Résultat : 4 DÉPOSÉ, 1 SKIP

| slug | statut | grain | feat | codes droppés | overlap | sha256 (court) | source count (G2) |
|---|---|---|---|---|---|---|---|
| saint-lin-laurentides | **DEPOSITED** | zone-polygon | 139 | C4,H148,H149,H150,H210,P13 (6) | 94.8% | `1277ed3a` | 139/139 (returnCountOnly) |
| saint-hippolyte | **DEPOSITED** | zone-polygon | 112 | REC612 (1) | 98.9% | `543f88a1` | 112/112 (returnCountOnly) |
| saint-colomban | **DEPOSITED** | zone-polygon | 199 | C176,C177,C3093,H1161,P170,P175 (6) | 96.3% | `c11db367` | 199/199 (returnCountOnly) |
| sainte-sophie | **DEPOSITED** | zone-polygon | 105 | V80,V804,V805 (3) | 95.3% | `ef559183` | 105/105 (returnCountOnly) |
| hampstead | **SKIP** | (evaluation-unit) | 1869 | 0 (aucun uncovered) | 100% | `4d1c0a9c` | 1869/1869 (returnCountOnly) |

Tous les DEPOSITED : `count == source` (returnCountOnly LIVE) ET `exceededTransferLimit=false`
(complet, non partiel — G2) ; byte-exact prouvé (rehash CAS == sha manifeste == clé CAS +
`verifyRawCapturePayload`) ; `nearest_registre_muni == slug` (anti-homonyme) ; grain classifié
par **nature de couche** (aucun marqueur UEV ⇒ zone-polygon) ; readback indépendant OK
(geometry digest byte-exact, `proof.url==source`, `level=documented`, grain uniforme, backup `_replaced/` présent).

---

## saint-lin-laurentides — REMPLACEMENT, divergence complète (G1–G6)

**Servi AVANT** : `orphan`, `zone_source_url=null`, **aucune preuve v2** (`served_has_v2_proof=false`),
139 feat / 115 codes distincts, layout **sous-dossier** (`normalized/ca-qc-zonage/qc-zonage-saint-lin-laurentides/qc-zonage-saint-lin-laurentides.geojson`),
géométrie geometry-suspect (~10,74 % des lots hors zones servies — motif du remplacement).

**Capture** : AGOL `services8.arcgis.com/PF86XLgxesdAEe8M/.../Zonage/FeatureServer/0`
(layer id 0, nom `Zonage`), champ `CodeZone`, 139 feat / 139 codes, 100 % Polygon,
`sha256:1277ed3a3692691436b1d086b78e0969b563107efca1084d4ec7abfab81de1fc`,
`retrieved_at=2026-08-10T11:21:13.965Z`, run `zones-20260810T121500Z-1-c33e2339-9a25-442f-a750-87c33e15019d`.

- **G1** (servi non-prouvé par code) : les 6 codes servi-seulement sont TOUS `zone_source_url=null`
  (level `orphan`) — aucun code prouvé → le gate provenance-aware n'a rien bloqué.
- **G2** (capture prouvée, vérifiée-complète, identité-de-couche) : `feature_count(139) == source_count(139)`
  via `returnCountOnly` LIVE `…/FeatureServer/0/query?where=1=1&returnCountOnly=true&f=json`,
  `exceededTransferLimit=false` ; byte-exact (`rehash_ok`, `cas_key_matches`, `raw_capture_verified`) ;
  couche = `Zonage`/0, `nearest=saint-lin-laurentides` (3,52 km).
- **grain** : `zone-polygon` — aucun marqueur UEV (`ID_UEV/MATRICULE8/CODE_UTILI` absents).
- **G3** (perte documentée + backup) : 6 codes droppés, backup octet-pour-octet
  `normalized/ca-qc-zonage/_replaced/qc-zonage-saint-lin-laurentides__nested.2026-08-10T1202Z.geojson`.
- **G4** : chaque code droppé = **UNKNOWN** (recalage-flagged), **JAMAIS N-A**.
- **G5** : servi après = octets EXACTS de la capture (geometry digest byte-exact), `level=documented`,
  `url=proof.url` ; aucun code legacy réinjecté (139 feat = capture).
- **G6** : overlap **109/115 = 94,8 %** — comparable aux cas connus, pas un outlier ; couche confirmée.

Bloc de divergence (record JSON verbatim) :

```json
"dropped_divergence": [
 { "code": "C4",   "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN",
   "reason": "présent dans un servi NON-PROUVÉ (zone_source_url=null), absent d'une capture v2 vérifiée-complète (count==source); divergence documentée + backup _replaced/; recalage-flagged; NON N-A (le remplacement n'atteste pas l'abolition)" },
 { "code": "H148", "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN", "reason": "…idem…" },
 { "code": "H149", "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN", "reason": "…idem…" },
 { "code": "H150", "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN", "reason": "…idem…" },
 { "code": "H210", "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN", "reason": "…idem…" },
 { "code": "P13",  "prior_levels": ["orphan"], "zone_source_url": null, "status": "UNKNOWN", "reason": "…idem…" }
]
```

Readback : `geometry_digest_byte_exact=true`, `proof_url_matches=true`,
`proof_sha_matches_capture=true`, `proof_retrieved_at=2026-08-10T11:21:13.965Z`,
`level_documented=true`, `url_all_proof=true`, `geometry_grain=[zone-polygon]`,
backup `_replaced/` présent → **readback_ok=true**. `dropped_matches_record=true`
(vs lot3 `{C4,H148,H149,H150,H210,P13}`).

---

## saint-hippolyte — REMPLACEMENT (G1–G6)

Servi AVANT `legacy-traceable`, url=null, sans preuve v2, 93 feat / 93 codes, layout **flat**.
Capture LBP `arcgis.lbpevaluateurs.ca/.../75045_PUBLIC/MapServer/142` (nom `Zonage municipal (sans valeur légale)`),
champ `REGLEMENT_`, 112 feat, `sha256:543f88a1…`, `retrieved_at=2026-08-10T11:21:17.445Z`.
G2 : 112/112 (returnCountOnly), `exceededTransferLimit=false`, byte-exact, nearest=saint-hippolyte (0,75 km).
grain=zone-polygon (aucun UEV). **1 code droppé : REC612** (prior `legacy-traceable`, url=null, UNKNOWN, jamais N-A).
Backup `…/_replaced/qc-zonage-saint-hippolyte__flat.2026-08-10T1202Z.geojson`. overlap 92/93 = 98,9 %.
Readback OK (byte-exact, documented, url=proof.url, grain=zone-polygon). `dropped_matches_record=true`.

## saint-colomban — REMPLACEMENT (G1–G6)

Servi AVANT `legacy-traceable`, url=null, sans preuve v2, 161 feat / 161 codes, layout **flat**.
Capture LBP `…/75005_PUBLIC/MapServer/140`, champ `COMBINE`, 199 feat, `sha256:c11db367…`,
`retrieved_at=2026-08-10T10:49:30.796Z`. G2 : 199/199 (returnCountOnly), `exceededTransferLimit=false`,
byte-exact, nearest=saint-colomban (0,55 km). grain=zone-polygon (aucun UEV).
**6 codes droppés : C176,C177,C3093,H1161,P170,P175** (prior `legacy-traceable`, url=null, UNKNOWN, jamais N-A).
Backup `…/_replaced/qc-zonage-saint-colomban__flat.2026-08-10T1202Z.geojson`. overlap 155/161 = 96,3 %.
Readback OK. `dropped_matches_record=true`.

## sainte-sophie — REMPLACEMENT (G1–G6)

Servi AVANT `legacy-traceable`, url=null, sans preuve v2, 64 feat / 64 codes, layout **flat**.
Capture LBP `…/75028_PUBLIC/MapServer/140`, champ `Numero`, 105 feat, `sha256:ef559183…`,
`retrieved_at=2026-08-10T10:49:30.745Z`. G2 : 105/105 (returnCountOnly), `exceededTransferLimit=false`,
byte-exact, nearest=sainte-sophie (0,57 km). grain=zone-polygon (aucun UEV).
**3 codes droppés : V80,V804,V805** (prior `legacy-traceable`, url=null, UNKNOWN, jamais N-A).
Backup `…/_replaced/qc-zonage-sainte-sophie__flat.2026-08-10T1203Z.geojson`. overlap 61/64 = 95,3 %.
Readback OK. `dropped_matches_record=true`.

---

## hampstead — SKIP (prémisse violée : servi NON url=null ; à arbitrer par archi)

La capture est **réelle, complète et de la bonne couche** : `Zonage_Hampstead_S/FeatureServer/61`,
1869 feat = `source_count` 1869 (returnCountOnly), `exceededTransferLimit=false` (donc PAS un
fetch partiel malgré 1869 features — G2 satisfait), byte-exact `sha256:4d1c0a9c…`,
`retrieved_at=2026-08-10T11:26:59.235Z`, nearest=hampstead (0,21 km), marqueurs UEV
`ID_UEV/MATRICULE8/CODE_UTILI` présents ⇒ grain classifié **evaluation-unit** (conforme).
k8s Job `geo-capture-zones-20260810t124000z` = **Complete** (pod `-0-rjf4n` **Succeeded**).

**Mais le servi actuel n'est PAS url=null** — contrairement à la prémisse du mandat :
- `zone_source_level = candidate`, `zone_source_url = <la MÊME URL FeatureServer/61>` (NON-null),
  MAIS **aucune preuve v2** (`top_proof=null`, feature `proof=null`, `geometry_grain=null`) —
  une **URL déclarative sans capture**, état non anticipé par la SPEC §1 (« un servi passé par v2
  porte TOUJOURS url=proof.url ; un orphan/legacy porte url=null »).
- 1869 feat / 29 codes, layout sous-dossier ; **0 code uncovered** (overlap 100 %) — donc il n'a
  **jamais** été bloqué par l'identity gate (ni l'ancien ni le nouveau).

La politique ratifiée (§2/§6) couvre **exclusivement** le servi `url=null` ; un servi à
`zone_source_url` NON-null relève de §4 (superset strict, déjà satisfait ici). Le discriminateur
littéral du gate (`isRealGeometryUrl(zone_source_url)`) traiterait ce servi comme **prouvé** alors
qu'il ne porte **aucune** preuve v2. Déposer hampstead serait un **upgrade légitime**
(candidate déclaratif → documented v2 + `geometry_grain=evaluation-unit`, 0 perte) MAIS **hors du
périmètre arbitré**, et l'état anormal (`url != null` sans proof) doit être tranché par archi
avant tout dépôt. **SKIP** — pas de dépôt forcé, S3 hampstead intact.

**Point d'attention pour archi** : l'existence de servis `zone_source_url != null` SANS preuve v2
(hampstead, level=candidate) casse l'hypothèse SPEC §1 sur laquelle repose le discriminateur
`url === null`. À arbitrer : soit (a) autoriser explicitement l'upgrade candidate→documented v2 de
ces servis (sûr, 0 perte), soit (b) nettoyer d'abord l'URL déclarative (la remettre à null) pour
recouvrer l'invariant.
