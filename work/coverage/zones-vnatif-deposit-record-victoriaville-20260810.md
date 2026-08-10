# Dépôt zones — BATCH VICTORIAVILLE (ArcGIS MapServer PARTAGÉE, filtre Code_mun, f=geojson) — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **12**
munis UPGRADABLE hébergés sur `geo.victoriaville.ca`. **12 DÉPÔTS EFFECTUÉS**, readback
**VERT sur les 12**. **0 SKIP**. Isolation par-muni ; anti-invention ; aucun forçage.

Réplique EXACTE de la recette de dépôt ALTUS (`0b343380`) — G2 byte-exact, anti-homonyme,
gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`, backup `_replaced/`,
dropped→UNKNOWN (jamais N-A), readback G5. La preuve reste **type=arcgis / natif / directe**.
Deux différences avec altus : (1) la source est **UNE couche MapServer PARTAGÉE filtrée
par muni via `Code_mun`** (au lieu d'une couche par muni) ; (2) le champ code-zone
(`Disposition_spéciale`) coexiste avec un champ d'AFFECTATION (`GROUPEUSAGE`) — résolu
sans invention par recouvrement avec le servi.

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` + `SPEC_ZONE_GEOMETRY_GRAIN.md` +
`SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` §12.

Scripts : `acquisition/src/_zones-vnatif-select-victoriaville-20260810.ts` (sélection +
résolution Code_mun par nom + validation LIVE + diagnostic overlap),
`acquisition/src/_zones-vnatif-deposit-victoriaville-20260810.ts` (dépôt).
Worklist : `work/coverage/zones-vnatif-capture-worklist-victoriaville-20260810.json` (12 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-victoriaville-20260810.json`.
Dry-run : `work/coverage/_zones-vnatif-deposit-dryrun-victoriaville-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-victoriaville-20260810.json`.

## 1. Plateforme (couche PARTAGÉE, filtre Code_mun)

Host `geo.victoriaville.ca` — UNE couche ArcGIS MapServer `IntranetMRC/ZonageMunicipal/
MapServer/3` (publique, sans jeton, HONORE `f=geojson`, `maxRecordCount=1000`, polygone).
Les 12 munis du scoping portent le MÊME `zone_source_url` (la couche partagée) ; la valeur
`Code_mun` n'y figure PAS. Elle est **résolue par muni** via le champ `Municipalite` de la
couche, mis en correspondance NORMALISÉE (NFD sans accents, alnum) avec le nom du registre
municipal — correspondance **EXACTE unique** (0 homonyme parmi les 22 munis de la couche).
Forme geojson : `<layer>/query?where=Code_mun='<code>'&outFields=*&f=geojson`. Comptage
LIVE (même filtre) : `<layer>/query?where=Code_mun='<code>'&returnCountOnly=true&f=json`.
Preuve : **type=arcgis, method=natif, reliability=directe**.

Les URLs de la worklist sont canonicalisées via `new URL().toString()` (`'`→`%27`) —
exactement la forme que le chokepoint inscrit au manifeste (`redactUrlForManifest`, aucun
param secret ici) — donc `findLine` (`line.url===url`) est byte-exact par construction.

## 2. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t200000z` : **Complete 12/12 shards**, run-stamp
  `20260810T200000Z`, 0 shard en échec, tous pods `Completed`.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T200000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T200000Z.json`.

## 3. Résolution du champ code-zone (anti-invention, jamais deviné)

La couche partagée porte `Disposition_spéciale` (CODE-ZONE, ex "AF11"/"RU13"/"VILL1") ET
`GROUPEUSAGE` (AFFECTATION, ex "AF"/"R"/"V" — à ÉVITER). Le champ EXACT est résolu **par
muni** : parmi les champs non-techniques, sans valeur vide, ≥3 codes distincts, on retient
celui qui **REPRODUIT ≥90% des codes DÉJÀ SERVIS** (legacy). Le recouvrement avec la
vérité-terrain servie EST le discriminateur — sur les 12 munis :
**`Disposition_spéciale`=100%, `GROUPEUSAGE`=0%, `Type`=vide**. `zone_code` = valeur BRUTE
de `Disposition_spéciale`, aucune dérivation synthétique.

## 4. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, **anti-troncature ArcGIS** (`exceededTransferLimit !== true`
ET `count` LIVE avec filtre Code_mun == features → numberReturned==numberMatched), 100 %
polygonal, grain **zone-polygon** (aucun marqueur UEV), anti-homonyme
`nearest_registre_muni==slug` (centroïdes tous < 2 km du bon muni), champ code-zone résolu
à overlap **≥ 90 %**, anti-invention (aucun feature à `zone_code` vide), servi
non-déjà-prouvé. **0 garde déclenchée : 0 SKIP.**

## 5. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 12)

`normalize(feats, "Disposition_spéciale", url)` → `zone_code` brut ;
`proofFromCaptureEntry(line, {type:"arcgis", method:"natif", reliability:"directe"})` ;
`depositCapturedZones(…, {geometryGrain:"zone-polygon"})`. Gate **PROVENANCE-AWARE** : servi
non-prouvé (legacy-traceable, `zone_source_url` déclaratif) ⇒ upgrade ; codes servi-seulement
(divergence) → **UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup `_replaced/…`.

| # | muni | Code_mun | features | count LIVE | champ | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---:|---:|---|---:|---:|---|
| 1 | chesterville | 39030 | 48 | 48 | Disposition_spéciale | 100 % | 0 | ebe5d75d |
| 2 | ham-nord | 39010 | 46 | 46 | Disposition_spéciale | 100 % | 0 | c96d7346 |
| 3 | kingsey-falls | 39097 | 43 | 43 | Disposition_spéciale | 100 % | 0 | af0be781 |
| 4 | maddington-falls | 39165 | 22 | 22 | Disposition_spéciale | 100 % | 0 | 13c35ada |
| 5 | saint-albert | 39085 | 33 | 33 | Disposition_spéciale | 100 % | 0 | 73e7509c |
| 6 | saint-christophe-darthabaska | 39060 | 75 | 75 | Disposition_spéciale | 100 % | 0 | 4555f4a8 |
| 7 | saint-remi-de-tingwick | 39020 | 26 | 26 | Disposition_spéciale | 100 % | 0 | 4c422bc8 |
| 8 | saint-rosaire | 39145 | 44 | 44 | Disposition_spéciale | 100 % | 0 | 5a2f9b7f |
| 9 | sainte-clotilde-de-horton | 39117 | 66 | 66 | Disposition_spéciale | 100 % | 0 | 9c4a24ff |
| 10 | sainte-elizabeth-de-warwick | 39090 | 14 | 14 | Disposition_spéciale | 100 % | 0 | cf2bb808 |
| 11 | sainte-seraphine | 39105 | 13 | 13 | Disposition_spéciale | 100 % | 0 | 41f94c95 |
| 12 | tingwick | 39025 | 69 | 69 | Disposition_spéciale | 100 % | 0 | 667cdbde |

**12 munis à overlap 100 % (0 droppé).** Total droppés→UNKNOWN : **0**.

## 6. SKIP — aucun

Toutes les gardes vertes sur les 12 munis (Code_mun résolu de façon unique, source
disponible, count complet, byte-exact, anti-homonyme, champ code-zone à 100 % d'overlap).

## 7. Readback (G5) — VERT sur les 12

Chaque muni déposé (layout **flat**) : `feature_count_matches_capture`,
`geometry_digest_byte_exact`, `zone_code_present_all`, `proof_url == query URL`,
`proof_sha256 == capture sha`, `carries_capture_sha256`, `zone_source_level == documented`,
`zone_source_url` uniforme = proof.url, `geometry_grain == zone-polygon`, backup
`_replaced/` présent → tous **true**. `readback_ok = true`, `statut = DEPOSITED` sur les
**12/12**. Enrichissement préservé/re-appliqué dans la même passe.

## 8. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 2
scripts victoriaville n'ajoutent aucune erreur.

## 9. Verdict

Batch victoriaville **CLÔTURÉ : 12/12 DÉPOSÉS, 0 SKIP**. Chemin ArcGIS MapServer PARTAGÉE
`f=geojson` filtrée par `Code_mun` → preuve v2 (type=arcgis) sur une couche à champ
code-zone qui coexiste avec une affectation, résolu sans invention par recouvrement 100 %
avec le servi. Slugs déposés prêts pour re-fold (`col-2` GATÉ sur autorité zones=final +
go S3, cf. mémoire). Codes droppés → **UNKNOWN**, jamais N-A.

### Slugs déposés (pour re-fold)

`chesterville`, `ham-nord`, `kingsey-falls`, `maddington-falls`, `saint-albert`,
`saint-christophe-darthabaska`, `saint-remi-de-tingwick`, `saint-rosaire`,
`sainte-clotilde-de-horton`, `sainte-elizabeth-de-warwick`, `sainte-seraphine`, `tingwick`
