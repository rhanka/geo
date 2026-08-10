# Dépôt zones — LOT-D géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **24**
munis géoCentralis RESTANTS (après le pilote + lot-A + lot-B + lot-C), réplique EXACTE de la recette
pilote (`05de001a`/`cd363a04`) + lot-A (`656eb46d`) + lot-B (`dd7e4cf9`) + lot-C (`bf4afa98`). **23 DÉPÔTS EFFECTUÉS**,
readback **VERT sur les 23**. **1 SKIP** (isolation par-muni, jamais forcés).

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731) + `SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` (47fc8104) §12.

Scripts : `acquisition/src/_zones-vnatif-select-geocentralis-lotD-20260810.ts` (sélection +
validation LIVE), `acquisition/src/_zones-vnatif-deposit-geocentralis-lotD-20260810.ts` (dépôt),
`acquisition/src/_zones-vnatif-record-md-geocentralis-lotD-20260810.ts` (ce .md).
Worklist : `work/coverage/zones-vnatif-capture-worklist-geocentralis-lotD-20260810.json` (24 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-geocentralis-lotD-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-geocentralis-lotD-20260810.json`.

## 1. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t180000z` : **Complete 12/12**, run-stamp `20260810T180000Z`, 0 shard en échec.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T180000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T180000Z.json`.

## 2. Couche-identité (source-identity WFS)

Endpoint unique `geoserver.geocentralis.com/geoserver/ows`, GetFeature `outputFormat=application/json`
filtré `CQL_FILTER=id_municipalite=<id>`. Deux couches partagées (identiques au pilote / lot-A/B/C) :

- `evb:zonage_municipal`  → champ-code `no_zonage_municipal`
- `evb:siadmin_pzon_99_s` → champ-code `etiquette_1`

`zone_code` = **valeur brute du champ-code WFS** (aucune dérivation synthétique). URL WFS dérivée
du fragment scoping (`#evb:<layer>[id_municipalite=<id>]`) puis **validée LIVE** (`&count=1` →
`numberMatched>0`) avant inclusion (siadmin toujours quoté ; zonage_municipal quoté ssi id à
zéro de tête — règle déduite à 100% des worklists lot-A/B/C, forme retenue = celle qui rend des features).

## 3. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

Sur les 24 : G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, `numberReturned==numberMatched==features` (anti-troncature) ET
énumération LIVE (`&count=1`) == features, 100 % polygonal, grain **zone-polygon** (aucun marqueur
UEV), anti-homonyme `nearest_registre_muni==slug`, overlap source-identity **≥ 90 %**, anti-invention
(aucun feature à `zone_code` vide). **1 gardes déclenchées → 1 SKIP.**

## 4. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 23)

`normalize(feats, <champ-code>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…, {geometryGrain:"zone-polygon"})`.
Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ; codes servi-seulement (divergence) →
**UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup `_replaced/…`.

| # | muni | couche | champ-code | features | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---|---|---|
| 1 | saint-denis-sur-richelieu | siadmin_pzon_99_s | etiquette_1 | 70 | 98.6 % | 1 | a99b1b16 |
| 2 | sainte-gertrude-manneville | siadmin_pzon_99_s | etiquette_1 | 30 | 100 % | 0 | 95385f09 |
| 3 | sainte-irene | zonage_municipal | no_zonage_municipal | 72 | 100 % | 0 | 7ca7ed64 |
| 4 | sainte-luce | siadmin_pzon_99_s | etiquette_1 | 104 | 100 % | 0 | ca821e19 |
| 5 | sainte-lucie-de-beauregard | zonage_municipal | no_zonage_municipal | 41 | 100 % | 0 | c1c8abcd |
| 6 | sainte-marguerite-du-lac-masson | zonage_municipal | no_zonage_municipal | 66 | 100 % | 0 | a76649f6 |
| 7 | sainte-marguerite-marie | zonage_municipal | no_zonage_municipal | 35 | 100 % | 0 | 5be2d978 |
| 8 | sainte-melanie | siadmin_pzon_99_s | etiquette_1 | 74 | 100 % | 0 | 7513c555 |
| 9 | sainte-praxede | zonage_municipal | no_zonage_municipal | 42 | 100 % | 0 | 3be0af9a |
| 10 | schefferville | siadmin_pzon_99_s | etiquette_1 | 56 | 100 % | 0 | 097bee71 |
| 11 | senneterre--la-vallee-de-lor | siadmin_pzon_99_s | etiquette_1 | 124 | 100 % | 0 | b671170d |
| 12 | sept-iles | zonage_municipal | no_zonage_municipal | 670 | 100 % | 0 | 1da08cce |
| 13 | sorel-tracy | siadmin_pzon_99_s | etiquette_1 | 728 | 100 % | 0 | 4d483257 |
| 14 | thetford-mines | siadmin_pzon_99_s | etiquette_1 | 543 | 100 % | 0 | 0826272f |
| 15 | trecesson | siadmin_pzon_99_s | etiquette_1 | 63 | 100 % | 0 | 1ea8439f |
| 16 | tres-saint-sacrement | siadmin_pzon_99_s | etiquette_1 | 33 | 100 % | 0 | ac2c876e |
| 17 | tring-jonction | siadmin_pzon_99_s | etiquette_1 | 46 | 100 % | 0 | 9be25dae |
| 18 | val-brillant | zonage_municipal | no_zonage_municipal | 90 | 100 % | 0 | 6d490254 |
| 19 | val-des-sources | zonage_municipal | no_zonage_municipal | 154 | 100 % | 0 | 0f997eb8 |
| 20 | vaudreuil-dorion | siadmin_pzon_99_s | etiquette_1 | 279 | 100 % | 0 | 8b222da0 |
| 21 | warwick | siadmin_pzon_99_s | etiquette_1 | 123 | 100 % | 0 | d3d70a54 |
| 22 | wentworth-nord | zonage_municipal | no_zonage_municipal | 145 | 100 % | 0 | 9ef285cd |
| 23 | wotton | zonage_municipal | no_zonage_municipal | 58 | 100 % | 0 | 9c5e4af6 |

**22 munis à overlap 100 % (0 droppé).** 1 muni(s) à overlap partiel mais ≥ 90 %, codes servi-seulement flagués **UNKNOWN** (jamais N-A). Total droppés→UNKNOWN : **1**.

## 5. SKIP (1) — isolation par-muni, jamais forcés

| # | muni | raison |
|---|---|---|
| 1 | otterburn-park | source-identity overlap 86.7% < 90% → SKIP (HOLD, mauvaise-couche/ambigu) |

Chaque SKIP est un garde légitime (anti-homonyme : la géométrie WFS a un centroïde plus proche
d'une AUTRE muni enregistrée ; ou anti-invention : au moins un feature sans `zone_code`). Refus de
déposer une géométrie ambiguë ou incomplète — jamais forcé, jamais inventé.

## 6. Readback (G5) — VERT sur les 23

Chaque muni déposé : `feature_count_matches_capture`, `geometry_digest_byte_exact`,
`zone_code_present_all`, `proof_url == query URL`, `proof_sha256 == capture sha`,
`carries_capture_sha256`, `zone_source_level == documented`, `zone_source_url` uniforme = proof.url,
`geometry_grain == zone-polygon`, backup `_replaced/` présent → tous **true**. `readback_ok = true`,
`statut = DEPOSITED` sur les **23/23**. Enrichissement préservé/re-appliqué dans la même passe.

## 7. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 3 scripts
lot-D n'ajoutent aucune erreur.

## 8. Verdict

Lot-D géoCentralis **CLÔTURÉ : 23/24 DÉPOSÉS, 1 SKIP** (gardes légitimes). Chemin WFS → preuve v2
par source-identity rejoué à l'échelle sur les DEUX couches. Tous les munis géoCentralis
upgradables ont désormais été ATTEMPTED (pilote + lot-A/B/C/D). Prêt pour re-fold (`col-2` GATÉ sur
autorité zones=final + go S3, cf. mémoire). Codes droppés → **UNKNOWN**, jamais N-A.
