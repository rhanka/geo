# Dépôt zones — pilote géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable → documented v2) de **3 munis** couvrant les
**DEUX** couches partagées de `geoserver.geocentralis.com/geoserver/ows`. But : PROUVER le
chemin **WFS → preuve v2 par source-identity de bout en bout** avant tout batch. Les 3 dépôts
sont EFFECTUÉS, readback VERT.

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731) + `SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` (47fc8104) §12.

Scripts : `acquisition/src/_zones-vnatif-inspect-geocentralis-pilot-20260810.ts` (sonde read-only, 05de001a),
`acquisition/src/_zones-vnatif-deposit-geocentralis-pilot-20260810.ts` (dépôt).
Sonde : `work/coverage/_zones-vnatif-inspect-geocentralis-pilot-20260810.json`.
Record machine : `zones-vnatif-deposit-record-geocentralis-pilot-20260810.json`.
Worklist : `zones-vnatif-capture-worklist-geocentralis-pilot-20260810.json`.

## 1. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t140000z` : **Complete 3/3** (19s) — pods `-0-6kqwm`,
  `-1-msr8c`, `-2-9wb4h` tous **Completed** (exit 0).
- Run-stamp `20260810T140000Z`, image `ghcr.io/rhanka/geo-capture@sha256:60f048b5…fa629b`,
  shards=3 concurrency=3.

## 2. Couche-identité (source-identity WFS)

`zone_source_url` servi = fragment déclaratif `…/geoserver/ows#<layer>[id_municipalite=<id>]`
(legacy-traceable, SANS preuve v2). La capture rejoue la MÊME couche/muni en GetFeature JSON.
`zone_code` = **valeur brute du champ-code WFS** (pas de dérivation synthétique) ; overlap
servi→capture **100 %** (0 code servi non couvert) sur les 3 → même identité.

| muni | couche WFS | champ-code | ex. zone_code | id_municipalite |
|---|---|---|---|---|
| adstock | `evb:zonage_municipal` | `no_zonage_municipal` | `M2.3-1` | 31056 |
| baie-comeau | `evb:siadmin_pzon_99_s` | `etiquette_1` | `281 R` | 96020 |
| beauceville | `evb:zonage_municipal` | `no_zonage_municipal` | `310-CN` | 27028 |

## 3. G2 — byte-exact + vérifiable-complète (VERT sur les 3)

| muni | sha256 (court) | rehash==manifeste==clé CAS | verifyRawCapturePayload | count capture==numberMatched==numberReturned==LIVE | grain (UEV?) |
|---|---|---|---|---|---|
| adstock | `7af1b5e9` | true / true | true | 174 == 174 == 174 == 174 | zone-polygon (aucun UEV) |
| baie-comeau | `00dd053f` | true / true | true | 238 == 238 == 238 == 238 | zone-polygon (aucun UEV) |
| beauceville | `542d458a` | true / true | true | 196 == 196 == 196 == 196 | zone-polygon (aucun UEV) |

Complétude WFS = `numberReturned == numberMatched == features.length` (aucune troncature) ET
énumération LIVE (`&count=1` → `numberMatched`) == features. 100 % MultiPolygon. Anti-homonyme
`nearest_registre_muni == slug` (0.97 / 3.13 / 1.57 km).

## 4. Dépôt candidate/legacy-traceable → documented (VERT sur les 3)

`normalize(feats, <champ-code>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…, {geometryGrain:"zone-polygon"})`.
Gate PROVENANCE-AWARE : servi non-prouvé (featureHasV2Proof=0) ⇒ upgrade autorisé.

| muni | overlap | codes droppés→UNKNOWN | backup `_replaced/` |
|---|---|---|---|
| adstock | 100 % | 0 | `qc-zonage-adstock__flat.2026-08-10T1521Z.geojson` |
| baie-comeau | 100 % | 0 | `qc-zonage-baie-comeau__flat.2026-08-10T1521Z.geojson` |
| beauceville | 100 % | 0 | `qc-zonage-beauceville__flat.2026-08-10T1521Z.geojson` |

**0 code droppé** (overlap parfait) — aucun UNKNOWN à flaguer. Enrichissement préservé
(reglement/usage_dominant/effet_densifiant re-appliqués dans la même passe ; propriétés
AVANT→APRÈS sans régression ; ex. baie-comeau 3570→3983, beauceville 2433→3205).

## 5. Readback (G5) — VERT sur les 3

Servi flat-only (pas de sous-dossier). Chaque muni :

| contrôle | adstock | baie-comeau | beauceville |
|---|---|---|---|
| `feature_count_matches_capture` | true (174) | true (238) | true (196) |
| `geometry_digest_byte_exact` | **true** | **true** | **true** |
| `zone_code_present_all` | true | true | true |
| `proof_url` == query URL | true | true | true |
| `proof_sha256` == capture sha | true | true | true |
| `proof_retrieved_at` | 2026-08-10T15:17:31.640Z | 15:17:29.566Z | 15:17:29.520Z |
| `carries_capture_sha256` (collection+features) | true | true | true |
| `zone_source_level` | **documented** | **documented** | **documented** |
| `zone_source_url` uniforme = proof.url | true | true | true |
| `geometry_grain` | **zone-polygon** | zone-polygon | zone-polygon |
| backup `_replaced/` présent | true | true | true |

`readback_ok = true`, `statut = DEPOSITED` sur les 3.

## 6. Provenance avant/après

| | avant | après |
|---|---|---|
| `zone_source_level` | legacy-traceable | **documented** |
| `featureHasV2Proof` | 0 / N | **N / N** (v2, sha+retrieved_at) |
| `zone_source_url` | fragment déclaratif `#<layer>[id_municipalite=…]` | query URL WFS réelle, hachée dans la preuve |
| `geometry_grain` | (absent) | **zone-polygon** |

## 7. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 2 scripts
du pilote n'ajoutent aucune erreur.

## 8. Verdict pour le batch (147 géoCentralis)

**Chemin WFS → v2 PROUVÉ de bout en bout sur les DEUX couches** :
`evb:zonage_municipal` (adstock, beauceville) ET `evb:siadmin_pzon_99_s` (baie-comeau).
Un seul endpoint (`/geoserver/ows`), filtre `CQL_FILTER=id_municipalite=<id>`, `type=wfs`
`natif/directe` (type de preuve EXISTANT, routine — aucun nouveau contrat). G2 byte-exact +
vérifiable-complète, source-identity 100 %, grain zone-polygon uniforme, 0-perte.

→ **Le batch des 147 géoCentralis est FAISABLE** par la même passe. Détails de capture à
soigner au batch : ids `id_municipalite` à **zéro de tête** (ex. 07025) — littéral CQL à
quoter/déquoter selon le type de champ (numérique en `zonage_municipal`, chaîne en
`siadmin_pzon_99_s`) ; vérifier par muni `numberReturned==numberMatched` (anti-troncature)
et l'overlap zone_code ≥ 90 % (SKIP/HOLD si mauvaise-couche/ambigu, jamais N-A sur un code
droppé).
