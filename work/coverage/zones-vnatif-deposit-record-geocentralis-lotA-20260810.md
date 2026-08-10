# Dépôt zones — LOT-A géoCentralis WFS — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) de **40 munis**
géoCentralis (réplique EXACTE de la recette pilote `05de001a`/`cd363a04`, cf.
`zones-vnatif-deposit-record-geocentralis-pilot-20260810.md`). Les 40 dépôts sont **EFFECTUÉS**,
readback **VERT sur les 40**. **0 SKIP.**

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731) + `SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` (47fc8104) §12.

Scripts : `acquisition/src/_zones-vnatif-inspect-geocentralis-lotA-20260810.ts` (sonde read-only),
`acquisition/src/_zones-vnatif-deposit-geocentralis-lotA-20260810.ts` (dépôt).
Sonde : `work/coverage/_zones-vnatif-inspect-geocentralis-lotA-20260810.json`.
Worklist : `work/coverage/zones-vnatif-capture-worklist-geocentralis-lotA-20260810.json` (40 munis).
Record machine : `zones-vnatif-deposit-record-geocentralis-lotA-20260810.json`.

## 1. Capture (k8s, cluster OVH) — DÉJÀ FAITE

- Job `geo-capture-zones-20260810t150000z` : **Complete 15/15**, run-stamp `20260810T150000Z`.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T150000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T150000Z.json`.
- Ce lot **ne recapture rien** : il DÉPOSE les captures déjà présentes (le worker précédent avait
  lancé la capture puis s'est terminé sans déposer).

## 2. Couche-identité (source-identity WFS)

Endpoint unique `geoserver.geocentralis.com/geoserver/ows`, GetFeature `outputFormat=application/json`
filtré `CQL_FILTER=id_municipalite=<id>`. Deux couches partagées (les mêmes que le pilote) :

- `evb:zonage_municipal`  → champ-code `no_zonage_municipal`
- `evb:siadmin_pzon_99_s` → champ-code `etiquette_1`

`zone_code` = **valeur brute du champ-code WFS** (aucune dérivation synthétique). Le servi portait
déjà le `zone_source_url` géoCentralis (fragment déclaratif au niveau legacy-traceable, ou URL
query au niveau candidate) **SANS preuve v2** (`featureHasV2Proof=0` sur les 40 → upgrade autorisé).

## 3. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

Sur les 40 : G2 byte-exact **VERT** (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, `numberReturned==numberMatched==features` (anti-troncature) ET
énumération LIVE (`&count=1` → `numberMatched`) == features, 100 % polygonal, grain **zone-polygon**
(aucun marqueur UEV `ID_UEV`/`MATRICULE8`/`CODE_UTILI`), anti-homonyme `nearest_registre_muni==slug`,
overlap source-identity **≥ 90 %**. **0 garde déclenchée → 0 SKIP.**

## 4. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 40)

`normalize(feats, <champ-code>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"wfs", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…, {geometryGrain:"zone-polygon"})`.
Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ; codes servi-seulement (divergence) →
**UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup `_replaced/…__flat.2026-08-10T1548Z.geojson`.

| # | muni | couche | champ-code | features | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---|---|---|
| 1 | albertville | zonage_municipal | no_zonage_municipal | 45 | 100 % | 0 | e24dec5b |
| 2 | amqui | zonage_municipal | no_zonage_municipal | 227 | 100 % | 0 | 95134a93 |
| 3 | baie-trinite | siadmin_pzon_99_s | etiquette_1 | 54 | 100 % | 0 | 50ba549e |
| 4 | barraute | siadmin_pzon_99_s | etiquette_1 | 78 | 100 % | 0 | 9b7376da |
| 5 | beaulac-garthby | siadmin_pzon_99_s | etiquette_1 | 91 | 100 % | 0 | 09939b16 |
| 6 | berry | zonage_municipal | no_zonage_municipal | 34 | 100 % | 0 | f9ad2330 |
| 7 | berthier-sur-mer | zonage_municipal | no_zonage_municipal | 137 | 100 % | 0 | d8600b99 |
| 8 | berthierville | siadmin_pzon_99_s | etiquette_1 | 154 | 100 % | 0 | 4a089fdd |
| 9 | cap-saint-ignace | zonage_municipal | no_zonage_municipal | 77 | 100 % | 0 | 70f9cafa |
| 10 | causapscal | zonage_municipal | no_zonage_municipal | 164 | 100 % | 0 | aaaf76d7 |
| 11 | champneuf | siadmin_pzon_99_s | etiquette_1 | 13 | 100 % | 0 | 56582a13 |
| 12 | **chateauguay** | siadmin_pzon_99_s | etiquette_1 | 319 | **93.2 %** | **9** | ea78f108 |
| 13 | chute-aux-outardes | siadmin_pzon_99_s | etiquette_1 | 79 | 100 % | 0 | 765bc019 |
| 14 | crabtree | siadmin_pzon_99_s | etiquette_1 | 64 | 100 % | 0 | eb4ea10d |
| 15 | danville | zonage_municipal | no_zonage_municipal | 132 | 100 % | 0 | 0ba62b49 |
| 16 | disraeli--les-appalaches--2 | zonage_municipal | no_zonage_municipal | 83 | 100 % | 0 | bc6aaee7 |
| 17 | dundee | siadmin_pzon_99_s | etiquette_1 | 48 | 100 % | 0 | 89364a41 |
| 18 | east-broughton | siadmin_pzon_99_s | etiquette_1 | 78 | 100 % | 0 | 66c871d2 |
| 19 | elgin | zonage_municipal | no_zonage_municipal | 26 | 100 % | 0 | ef7cad64 |
| 20 | esterel | zonage_municipal | no_zonage_municipal | 131 | 100 % | 0 | d2f6eea7 |
| 21 | farnham | siadmin_pzon_99_s | etiquette_1 | 559 | 100 % | 0 | 92e5fe2c |
| 22 | fermont | siadmin_pzon_99_s | etiquette_1 | 80 | 100 % | 0 | ef337975 |
| 23 | franquelin | siadmin_pzon_99_s | etiquette_1 | 36 | 100 % | 0 | 9c07a2f9 |
| 24 | gatineau | siadmin_pzon_99_s | etiquette_1 | 1871 | 100 % | 0 | cd3a9f30 |
| 25 | godmanchester | siadmin_pzon_99_s | etiquette_1 | 36 | 100 % | 0 | 155988f0 |
| 26 | havelock | zonage_municipal | no_zonage_municipal | 11 | 100 % | 0 | 779614dc |
| 27 | hinchinbrooke | zonage_municipal | no_zonage_municipal | 82 | 100 % | 0 | e239c8aa |
| 28 | howick | siadmin_pzon_99_s | etiquette_1 | 43 | 100 % | 0 | aecd9039 |
| 29 | **huntingdon** | zonage_municipal | no_zonage_municipal | 76 | **95.6 %** | **3** | fa69494f |
| 30 | irlande | siadmin_pzon_99_s | etiquette_1 | 51 | 100 % | 0 | 129e20ac |
| 31 | joliette | siadmin_pzon_99_s | etiquette_1 | 364 | 100 % | 0 | 7dabf9b3 |
| 32 | kinnears-mills | siadmin_pzon_99_s | etiquette_1 | 67 | 100 % | 0 | e68a54a7 |
| 33 | la-corne | zonage_municipal | no_zonage_municipal | 57 | 100 % | 0 | 42e6aeba |
| 34 | la-motte | siadmin_pzon_99_s | etiquette_1 | 47 | 100 % | 0 | 579d5114 |
| 35 | la-redemption | siadmin_pzon_99_s | etiquette_1 | 53 | 100 % | 0 | 7f2dd3b5 |
| 36 | la-visitation-de-lile-dupas | siadmin_pzon_99_s | etiquette_1 | 10 | 100 % | 0 | f3539cd2 |
| 37 | lac-au-saumon | zonage_municipal | no_zonage_municipal | 138 | 100 % | 0 | 916579a7 |
| 38 | lac-des-seize-iles | zonage_municipal | no_zonage_municipal | 44 | 100 % | 0 | 854ef8c5 |
| 39 | lac-frontiere | zonage_municipal | no_zonage_municipal | 28 | 100 % | 0 | e6501c95 |
| 40 | landrienne | siadmin_pzon_99_s | etiquette_1 | 41 | 100 % | 0 | 1c2af2d1 |

**38 munis à overlap 100 % (0 droppé).** 2 munis à overlap partiel mais ≥ 90 %, codes
servi-seulement flagués **UNKNOWN** (jamais N-A) par le gate provenance-aware :
**chateauguay** 93.2 % (9 codes→UNKNOWN), **huntingdon** 95.6 % (3 codes→UNKNOWN).

## 5. Readback (G5) — VERT sur les 40

Chaque muni : `feature_count_matches_capture`, `geometry_digest_byte_exact`,
`zone_code_present_all`, `proof_url == query URL`, `proof_sha256 == capture sha`,
`carries_capture_sha256`, `zone_source_level == documented`, `zone_source_url` uniforme = proof.url,
`geometry_grain == zone-polygon`, backup `_replaced/` présent → tous **true**.
`readback_ok = true`, `statut = DEPOSITED` sur les **40/40**. Enrichissement préservé/re-appliqué
dans la même passe (reglement / usage_dominant / effet_densifiant / geometry_status).

## 6. Provenance avant/après (uniforme sur les 40)

| | avant | après |
|---|---|---|
| `zone_source_level` | legacy-traceable (39) / candidate (1: chateauguay) | **documented** |
| `featureHasV2Proof` | 0 / N | **N / N** (v2, sha + retrieved_at) |
| `zone_source_url` | fragment déclaratif / query sans preuve | query URL WFS réelle, hachée dans la preuve |
| `geometry_grain` | (absent) | **zone-polygon** |

## 7. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 2 scripts
lot-A n'ajoutent aucune erreur.

## 8. Verdict

Lot-A géoCentralis **CLÔTURÉ : 40/40 DÉPOSÉS, 0 SKIP.** Chemin WFS → preuve v2 par source-identity
rejoué à l'échelle sur les DEUX couches. Prêt pour re-fold (`col-2` GATÉ sur autorité zones=final
+ go S3, cf. mémoire). Les codes droppés (chateauguay/huntingdon) sont **UNKNOWN**, pas N-A.
