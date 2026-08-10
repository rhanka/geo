# Dépôt zones — LOT-B géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **40**
munis géoCentralis suivants (après le pilote + lot-A), réplique EXACTE de la recette
pilote (`05de001a`/`cd363a04`) + lot-A (`656eb46d`). **33 DÉPÔTS EFFECTUÉS**,
readback **VERT sur les 33**. **7 SKIP** (isolation par-muni, jamais forcés).

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731) + `SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` (47fc8104) §12.

Scripts : `acquisition/src/_zones-vnatif-select-geocentralis-lotB-20260810.ts` (sélection +
validation LIVE), `acquisition/src/_zones-vnatif-deposit-geocentralis-lotB-20260810.ts` (dépôt),
`acquisition/src/_zones-vnatif-record-md-geocentralis-lotB-20260810.ts` (ce .md).
Worklist : `work/coverage/zones-vnatif-capture-worklist-geocentralis-lotB-20260810.json` (40 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-geocentralis-lotB-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-geocentralis-lotB-20260810.json`.

## 1. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t160000z` : **Complete 15/15**, run-stamp `20260810T160000Z`, 0 shard en échec.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T160000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T160000Z.json`.

## 2. Couche-identité (source-identity WFS)

Endpoint unique `geoserver.geocentralis.com/geoserver/ows`, GetFeature `outputFormat=application/json`
filtré `CQL_FILTER=id_municipalite=<id>`. Deux couches partagées (identiques au pilote / lot-A) :

- `evb:zonage_municipal`  → champ-code `no_zonage_municipal`
- `evb:siadmin_pzon_99_s` → champ-code `etiquette_1`

`zone_code` = **valeur brute du champ-code WFS** (aucune dérivation synthétique). URL WFS dérivée
du fragment scoping (`#evb:<layer>[id_municipalite=<id>]`) puis **validée LIVE** (`&count=1` →
`numberMatched>0`) avant inclusion (siadmin toujours quoté ; zonage_municipal quoté ssi id à
zéro de tête — règle déduite à 100% de la worklist lot-A, forme retenue = celle qui rend des features).

## 3. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

Sur les 40 : G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, `numberReturned==numberMatched==features` (anti-troncature) ET
énumération LIVE (`&count=1`) == features, 100 % polygonal, grain **zone-polygon** (aucun marqueur
UEV), anti-homonyme `nearest_registre_muni==slug`, overlap source-identity **≥ 90 %**, anti-invention
(aucun feature à `zone_code` vide). **7 gardes déclenchées → 7 SKIP.**

## 4. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 33)

`normalize(feats, <champ-code>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…, {geometryGrain:"zone-polygon"})`.
Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ; codes servi-seulement (divergence) →
**UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup `_replaced/…`.

| # | muni | couche | champ-code | features | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---|---|---|
| 1 | lanoraie | siadmin_pzon_99_s | etiquette_1 | 129 | 100 % | 0 | ec138103 |
| 2 | launay | siadmin_pzon_99_s | etiquette_1 | 34 | 100 % | 0 | ba72f9f0 |
| 3 | lavaltrie | siadmin_pzon_99_s | etiquette_1 | 169 | 100 % | 0 | a7a40092 |
| 4 | mandeville | siadmin_pzon_99_s | etiquette_1 | 37 | 100 % | 0 | 38b9b2d1 |
| 5 | mont-joli | siadmin_pzon_99_s | etiquette_1 | 211 | 100 % | 0 | 7c446421 |
| 6 | montmagny | zonage_municipal | no_zonage_municipal | 490 | 100 % | 0 | e2207e5a |
| 7 | morin-heights | zonage_municipal | no_zonage_municipal | 69 | 100 % | 0 | 542f7290 |
| 8 | notre-dame-des-prairies | siadmin_pzon_99_s | etiquette_1 | 155 | 100 % | 0 | 92c79c0a |
| 9 | piedmont | zonage_municipal | no_zonage_municipal | 157 | 100 % | 0 | 2f9ba832 |
| 10 | pointe-lebel | zonage_municipal | no_zonage_municipal | 72 | 100 % | 0 | 398242aa |
| 11 | price | siadmin_pzon_99_s | etiquette_1 | 45 | 100 % | 0 | a0a2815c |
| 12 | ragueneau | siadmin_pzon_99_s | etiquette_1 | 123 | 100 % | 0 | 7eedf081 |
| 13 | sacre-coeur-de-jesus | zonage_municipal | no_zonage_municipal | 52 | 100 % | 0 | 67118c40 |
| 14 | saint-adolphe-dhoward | zonage_municipal | no_zonage_municipal | 94 | 100 % | 0 | 9c668ec8 |
| 15 | saint-adrien | zonage_municipal | no_zonage_municipal | 56 | 100 % | 0 | c903fd1e |
| 16 | saint-adrien-dirlande | siadmin_pzon_99_s | etiquette_1 | 31 | 100 % | 0 | e0f74449 |
| 17 | saint-alexandre-des-lacs | zonage_municipal | no_zonage_municipal | 49 | 100 % | 0 | 1e8bd5f7 |
| 18 | saint-alfred | siadmin_pzon_99_s | etiquette_1 | 29 | 100 % | 0 | 1b93439d |
| 19 | saint-anicet | zonage_municipal | no_zonage_municipal | 72 | 100 % | 0 | 2313821c |
| 20 | saint-antoine-de-lisle-aux-grues | zonage_municipal | no_zonage_municipal | 23 | 100 % | 0 | 26cce502 |
| 21 | saint-barthelemy | siadmin_pzon_99_s | etiquette_1 | 27 | 100 % | 0 | 4c97d49f |
| 22 | saint-camille | siadmin_pzon_99_s | etiquette_1 | 21 | 100 % | 0 | 6f0c856c |
| 23 | saint-charles-borromee | siadmin_pzon_99_s | etiquette_1 | 136 | 100 % | 0 | f4f4f020 |
| 24 | saint-chrysostome | zonage_municipal | no_zonage_municipal | 78 | 100 % | 0 | 8ff9e076 |
| 25 | saint-cleophas | zonage_municipal | no_zonage_municipal | 41 | 100 % | 0 | 448d1966 |
| 26 | saint-cleophas-de-brandon | siadmin_pzon_99_s | etiquette_1 | 6 | 100 % | 0 | 36bab10b |
| 27 | saint-cuthbert | siadmin_pzon_99_s | etiquette_1 | 35 | 100 % | 0 | 04ff2ea8 |
| 28 | saint-cyrille-de-lessard | siadmin_pzon_99_s | etiquette_1 | 6 | 100 % | 0 | 5ecc43b3 |
| 29 | saint-damase--la-matapedia | zonage_municipal | no_zonage_municipal | 58 | 100 % | 0 | a71a659a |
| 30 | saint-didace | siadmin_pzon_99_s | etiquette_1 | 27 | 100 % | 0 | 6578fb30 |
| 31 | saint-dominique-du-rosaire | siadmin_pzon_99_s | etiquette_1 | 31 | 100 % | 0 | 184072a2 |
| 32 | saint-fabien-de-panet | zonage_municipal | no_zonage_municipal | 72 | 100 % | 0 | 04368eee |
| 33 | saint-fortunat | siadmin_pzon_99_s | etiquette_1 | 31 | 100 % | 0 | fb2d39ad |

**33 munis à overlap 100 % (0 droppé).** Aucun overlap partiel. Total droppés→UNKNOWN : **0**.

## 5. SKIP (7) — isolation par-muni, jamais forcés

| # | muni | raison |
|---|---|---|
| 1 | padoue | 6 feature(s) sans zone_code (champ etiquette_1 vide) — anti-invention |
| 2 | pointe-aux-outardes | anti-homonyme: nearest=chute-aux-outardes != pointe-aux-outardes |
| 3 | saint-anaclet-de-lessard | anti-homonyme: nearest=saint-donat--la-mitis != saint-anaclet-de-lessard |
| 4 | saint-camille-de-lellis | anti-homonyme: nearest=saint-just-de-bretenieres != saint-camille-de-lellis |
| 5 | saint-charles-garnier | 2 feature(s) sans zone_code (champ etiquette_1 vide) — anti-invention |
| 6 | saint-donat--la-mitis | 1 feature(s) sans zone_code (champ etiquette_1 vide) — anti-invention |
| 7 | saint-gabriel | anti-homonyme: nearest=saint-gabriel-de-brandon != saint-gabriel ; 1 feature(s) sans zone_code (champ etiquette_1 vide) — anti-invention |

Chaque SKIP est un garde légitime (anti-homonyme : la géométrie WFS a un centroïde plus proche
d'une AUTRE muni enregistrée ; ou anti-invention : au moins un feature sans `zone_code`). Refus de
déposer une géométrie ambiguë ou incomplète — jamais forcé, jamais inventé.

## 6. Readback (G5) — VERT sur les 33

Chaque muni déposé : `feature_count_matches_capture`, `geometry_digest_byte_exact`,
`zone_code_present_all`, `proof_url == query URL`, `proof_sha256 == capture sha`,
`carries_capture_sha256`, `zone_source_level == documented`, `zone_source_url` uniforme = proof.url,
`geometry_grain == zone-polygon`, backup `_replaced/` présent → tous **true**. `readback_ok = true`,
`statut = DEPOSITED` sur les **33/33**. Enrichissement préservé/re-appliqué dans la même passe.

## 7. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 3 scripts
lot-B n'ajoutent aucune erreur.

## 8. Verdict

Lot-B géoCentralis **CLÔTURÉ : 33/40 DÉPOSÉS, 7 SKIP** (gardes légitimes). Chemin WFS → preuve v2
par source-identity rejoué à l'échelle sur les DEUX couches. Prêt pour re-fold (`col-2` GATÉ sur
autorité zones=final + go S3, cf. mémoire). Codes droppés → **UNKNOWN**, jamais N-A.
