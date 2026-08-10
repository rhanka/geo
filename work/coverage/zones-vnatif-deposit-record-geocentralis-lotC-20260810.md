# Dépôt zones — LOT-C géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **40**
munis géoCentralis suivants (après le pilote + lot-A + lot-B), réplique EXACTE de la recette
pilote (`05de001a`/`cd363a04`) + lot-A (`656eb46d`) + lot-B (`dd7e4cf9`). **36 DÉPÔTS EFFECTUÉS**,
readback **VERT sur les 36**. **4 SKIP** (isolation par-muni, jamais forcés).

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731) + `SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` (47fc8104) §12.

Scripts : `acquisition/src/_zones-vnatif-select-geocentralis-lotC-20260810.ts` (sélection +
validation LIVE), `acquisition/src/_zones-vnatif-deposit-geocentralis-lotC-20260810.ts` (dépôt),
`acquisition/src/_zones-vnatif-record-md-geocentralis-lotC-20260810.ts` (ce .md).
Worklist : `work/coverage/zones-vnatif-capture-worklist-geocentralis-lotC-20260810.json` (40 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-geocentralis-lotC-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-geocentralis-lotC-20260810.json`.

## 1. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t170000z` : **Complete 15/15**, run-stamp `20260810T170000Z`, 0 shard en échec.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T170000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T170000Z.json`.

## 2. Couche-identité (source-identity WFS)

Endpoint unique `geoserver.geocentralis.com/geoserver/ows`, GetFeature `outputFormat=application/json`
filtré `CQL_FILTER=id_municipalite=<id>`. Deux couches partagées (identiques au pilote / lot-A / lot-B) :

- `evb:zonage_municipal`  → champ-code `no_zonage_municipal`
- `evb:siadmin_pzon_99_s` → champ-code `etiquette_1`

`zone_code` = **valeur brute du champ-code WFS** (aucune dérivation synthétique). URL WFS dérivée
du fragment scoping (`#evb:<layer>[id_municipalite=<id>]`) puis **validée LIVE** (`&count=1` →
`numberMatched>0`) avant inclusion (siadmin toujours quoté ; zonage_municipal quoté ssi id à
zéro de tête — règle déduite à 100% des worklists lot-A/B, forme retenue = celle qui rend des features).

## 3. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

Sur les 40 : G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, `numberReturned==numberMatched==features` (anti-troncature) ET
énumération LIVE (`&count=1`) == features, 100 % polygonal, grain **zone-polygon** (aucun marqueur
UEV), anti-homonyme `nearest_registre_muni==slug`, overlap source-identity **≥ 90 %**, anti-invention
(aucun feature à `zone_code` vide). **4 gardes déclenchées → 4 SKIP.**

## 4. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 36)

`normalize(feats, <champ-code>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…, {geometryGrain:"zone-polygon"})`.
Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ; codes servi-seulement (divergence) →
**UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup `_replaced/…`.

| # | muni | couche | champ-code | features | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---|---|---|
| 1 | saint-gabriel-de-brandon | siadmin_pzon_99_s | etiquette_1 | 84 | 100 % | 0 | 455bc082 |
| 2 | saint-gabriel-de-rimouski | siadmin_pzon_99_s | etiquette_1 | 66 | 100 % | 0 | 1191fbf6 |
| 3 | saint-georges | zonage_municipal | no_zonage_municipal | 583 | 100 % | 0 | 60d61ab6 |
| 4 | saint-georges-de-windsor | siadmin_pzon_99_s | etiquette_1 | 41 | 100 % | 0 | 29d6c780 |
| 5 | saint-jacques-de-leeds | siadmin_pzon_99_s | etiquette_1 | 45 | 100 % | 0 | 25658f19 |
| 6 | saint-jacques-le-majeur-de-wolfestown | siadmin_pzon_99_s | etiquette_1 | 29 | 100 % | 0 | b9609d5e |
| 7 | saint-jean-de-brebeuf | siadmin_pzon_99_s | etiquette_1 | 32 | 100 % | 0 | ede796cd |
| 8 | saint-joseph-de-beauce | zonage_municipal | no_zonage_municipal | 154 | 100 % | 0 | b8422e33 |
| 9 | saint-joseph-de-coleraine | siadmin_pzon_99_s | etiquette_1 | 103 | 100 % | 0 | 6c8204db |
| 10 | saint-joseph-des-erables | siadmin_pzon_99_s | etiquette_1 | 5 | 100 % | 0 | 9ba45397 |
| 11 | saint-jules | siadmin_pzon_99_s | etiquette_1 | 30 | 100 % | 0 | 975dd4f6 |
| 12 | saint-julien | siadmin_pzon_99_s | etiquette_1 | 34 | 100 % | 0 | 80c2071d |
| 13 | saint-just-de-bretenieres | zonage_municipal | no_zonage_municipal | 44 | 100 % | 0 | bdfeb311 |
| 14 | saint-leon-le-grand--la-matapedia | zonage_municipal | no_zonage_municipal | 70 | 100 % | 0 | c28e8433 |
| 15 | saint-marc-de-figuery | siadmin_pzon_99_s | etiquette_1 | 47 | 100 % | 0 | 0fb65f98 |
| 16 | saint-mathieu-dharricana | siadmin_pzon_99_s | etiquette_1 | 47 | 100 % | 0 | eed88b2e |
| 17 | saint-moise | zonage_municipal | no_zonage_municipal | 51 | 100 % | 0 | 64e800a7 |
| 18 | saint-noel | zonage_municipal | no_zonage_municipal | 53 | 100 % | 0 | b3e57093 |
| 19 | saint-octave-de-metis | siadmin_pzon_99_s | etiquette_1 | 33 | 100 % | 0 | f5ad75d3 |
| 20 | saint-paul | siadmin_pzon_99_s | etiquette_1 | 90 | 100 % | 0 | 3378b70e |
| 21 | saint-pierre | siadmin_pzon_99_s | etiquette_1 | 11 | 100 % | 0 | ab627c78 |
| 22 | saint-pierre-de-broughton | siadmin_pzon_99_s | etiquette_1 | 92 | 100 % | 0 | 9324c254 |
| 23 | saint-pierre-de-la-riviere-du-sud | zonage_municipal | no_zonage_municipal | 65 | 100 % | 0 | a9c62c25 |
| 24 | saint-severin--beauce-centre | siadmin_pzon_99_s | etiquette_1 | 29 | 100 % | 0 | 81b160aa |
| 25 | saint-tharcisius | zonage_municipal | no_zonage_municipal | 49 | 100 % | 0 | 48782fbe |
| 26 | saint-vianney | zonage_municipal | no_zonage_municipal | 56 | 100 % | 0 | 97cce304 |
| 27 | saint-zenon-du-lac-humqui | zonage_municipal | no_zonage_municipal | 43 | 100 % | 0 | 52e04dd0 |
| 28 | sainte-angele-de-merici | siadmin_pzon_99_s | etiquette_1 | 76 | 100 % | 0 | 2a1c53b6 |
| 29 | sainte-anne-des-lacs | zonage_municipal | no_zonage_municipal | 36 | 100 % | 0 | caad20c1 |
| 30 | sainte-apolline-de-patton | zonage_municipal | no_zonage_municipal | 53 | 100 % | 0 | 4449422e |
| 31 | sainte-barbe | zonage_municipal | no_zonage_municipal | 48 | 100 % | 0 | 8cf9ac83 |
| 32 | sainte-clotilde-de-beauce | siadmin_pzon_99_s | etiquette_1 | 37 | 100 % | 0 | b4a5753e |
| 33 | sainte-euphemie-sur-riviere-du-sud | zonage_municipal | no_zonage_municipal | 38 | 100 % | 0 | 0642600b |
| 34 | sainte-flavie | siadmin_pzon_99_s | etiquette_1 | 46 | 100 % | 0 | 9575f4a5 |
| 35 | sainte-florence | zonage_municipal | no_zonage_municipal | 66 | 100 % | 0 | d47613d1 |
| 36 | sainte-genevieve-de-berthier | siadmin_pzon_99_s | etiquette_1 | 30 | 100 % | 0 | c35a353a |

**36 munis à overlap 100 % (0 droppé).** Aucun overlap partiel. Total droppés→UNKNOWN : **0**.

## 5. SKIP (4) — isolation par-muni, jamais forcés

| # | muni | raison |
|---|---|---|
| 1 | saint-ignace-de-loyola | anti-homonyme: nearest=la-visitation-de-lile-dupas != saint-ignace-de-loyola |
| 2 | saint-joseph-de-lepage | 17 feature(s) sans zone_code (champ etiquette_1 vide) — anti-invention |
| 3 | saint-marcel | anti-homonyme: nearest=sainte-apolline-de-patton != saint-marcel |
| 4 | saint-marcellin | anti-homonyme: nearest=saint-gabriel-de-rimouski != saint-marcellin |

Chaque SKIP est un garde légitime (anti-homonyme : la géométrie WFS a un centroïde plus proche
d'une AUTRE muni enregistrée ; ou anti-invention : au moins un feature sans `zone_code`). Refus de
déposer une géométrie ambiguë ou incomplète — jamais forcé, jamais inventé.

## 6. Readback (G5) — VERT sur les 36

Chaque muni déposé : `feature_count_matches_capture`, `geometry_digest_byte_exact`,
`zone_code_present_all`, `proof_url == query URL`, `proof_sha256 == capture sha`,
`carries_capture_sha256`, `zone_source_level == documented`, `zone_source_url` uniforme = proof.url,
`geometry_grain == zone-polygon`, backup `_replaced/` présent → tous **true**. `readback_ok = true`,
`statut = DEPOSITED` sur les **36/36**. Enrichissement préservé/re-appliqué dans la même passe.

## 7. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 3 scripts
lot-C n'ajoutent aucune erreur.

## 8. Verdict

Lot-C géoCentralis **CLÔTURÉ : 36/40 DÉPOSÉS, 4 SKIP** (gardes légitimes). Chemin WFS → preuve v2
par source-identity rejoué à l'échelle sur les DEUX couches. Prêt pour re-fold (`col-2` GATÉ sur
autorité zones=final + go S3, cf. mémoire). Codes droppés → **UNKNOWN**, jamais N-A.
