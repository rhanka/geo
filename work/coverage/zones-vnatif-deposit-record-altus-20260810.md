# Dépôt zones — BATCH ALTUS (ArcGIS MapServer f=geojson) — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des munis
UPGRADABLE hébergés sur `gis.altusquebec.com` (12 au scoping). **10 DÉPÔTS EFFECTUÉS**,
readback **VERT sur les 10**. **2 SKIP** (isolation par-muni, jamais forcés).

Réplique EXACTE de la recette de dépôt géoCentralis lot-D (`f6f44d95`) — G2 byte-exact,
anti-homonyme, gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`, backup
`_replaced/`, dropped→UNKNOWN (jamais N-A), readback G5. La **seule** différence est la
SOURCE de capture (ArcGIS MapServer au lieu du WFS géoCentralis) + le type de preuve.

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` + `SPEC_ZONE_GEOMETRY_GRAIN.md` +
`SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` §12.

Scripts : `acquisition/src/_zones-vnatif-select-altus-20260810.ts` (sélection + validation
LIVE), `acquisition/src/_zones-vnatif-deposit-altus-20260810.ts` (dépôt).
Worklist : `work/coverage/zones-vnatif-capture-worklist-altus-20260810.json` (11 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-altus-20260810.json`.
Dry-run : `work/coverage/_zones-vnatif-deposit-dryrun-altus-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-altus-20260810.json`.

## 1. Plateforme (différente de géoCentralis WFS)

Host `gis.altusquebec.com` — ArcGIS MapServer qui **HONORE `f=geojson`** (vérifié LIVE).
Chaque muni du scoping porte comme `zone_source_url` une couche `.../MapServer/<n>`. Forme
de requête geojson : `<layer>/query?where=1=1&outFields=*&f=geojson`. Comptage source
(numberMatched) : `<layer>/query?where=1=1&returnCountOnly=true&f=json` → `{ count }`.
Preuve : **type=arcgis, method=natif, reliability=directe**.

Les URLs de la worklist sont canonicalisées via `new URL().toString()` — exactement la
forme que le chokepoint inscrit au manifeste (`redactUrlForManifest`) — donc `findLine`
(`line.url===url`) est byte-exact par construction.

## 2. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t190000z` : **Complete 12/12 shards** (11 cibles), run-stamp
  `20260810T190000Z`, 0 shard en échec, tous pods `Completed`.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T190000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T190000Z.json`.

## 3. Résolution du champ code-zone (anti-invention, jamais deviné)

Le champ code-zone **n'est PAS uniforme** sur altus (vérifié LIVE) — et le picker générique
choisirait à tort une étiquette d'affectation (`Type_zone`="Agricole"). Le champ EXACT est
donc résolu **par muni** : parmi les champs non-techniques, sans valeur vide, ≥3 codes
distincts, on retient celui qui **REPRODUIT ≥90% des codes DÉJÀ SERVIS** (legacy). Le
recouvrement avec la vérité-terrain servie EST le discriminateur — `zone_code` = valeur
BRUTE de ce champ, aucune dérivation synthétique. Résultat : `Zone` ("A-123"), `Usage`
("15-RE") ou `Zonage` ("43-I") selon la couche.

## 4. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, **anti-troncature ArcGIS** (`exceededTransferLimit !== true`
ET `count` LIVE (returnCountOnly) == features → numberReturned==numberMatched), 100 %
polygonal, grain **zone-polygon** (aucun marqueur UEV), anti-homonyme
`nearest_registre_muni==slug`, champ code-zone résolu à overlap **≥ 90 %**, anti-invention
(aucun feature à `zone_code` vide), servi non-déjà-prouvé. **1 garde déclenchée au dépôt → 1 SKIP.**

## 5. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 10)

`normalize(feats, <champ résolu>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"arcgis", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…,
{geometryGrain:"zone-polygon"})`. Gate **PROVENANCE-AWARE** : servi non-prouvé ⇒ upgrade ;
codes servi-seulement (divergence) → **UNKNOWN** (recalage-flagged, **JAMAIS N-A**) + backup
`_replaced/…`.

| # | muni | couche MapServer | champ code | features | count LIVE | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---:|---:|---:|---:|---|
| 1 | gaspe | MRC030/03005/20 | Zone | 262 | 262 | 100 % | 0 | b98850ef |
| 2 | hope-town | MRC050/05020/23 | Usage | 17 | 17 | 100 % | 0 | 0f2a73dc |
| 3 | murdochville | MRC030/03025/14 | Zone | 29 | 29 | 100 % | 0 | 3db1990f |
| 4 | paspebiac | MRC050/05032/26 | Usage | 128 | 128 | 100 % | 0 | 25a7c22b |
| 5 | saint-flavien | MRC330/33052/16 | Zonage | 51 | 51 | 100 % | 0 | aaed76a1 |
| 6 | saint-francois-dassise | MRC060/06055/13 | Usage | 45 | 45 | 100 % | 0 | 1c387bd5 |
| 7 | saint-francois-de-lile-dorleans | MRC200/20005/17 | Usage | 48 | 48 | 100 % | 0 | 2c298681 |
| 8 | saint-gabriel-de-valcartier | MRC220/22025/23 | Usage | 62 | 62 | 100 % | 0 | 565e2a3f |
| 9 | saint-janvier-de-joly | MRC330/33065/16 | Zonage | 43 | 43 | 100 % | 0 | f33bbb5e |
| 10 | saint-pierre-de-lile-dorleans | MRC200/20025/17 | Usage | 67 | 67 | 100 % | 0 | 57a3f592 |

**10 munis à overlap 100 % (0 droppé).** Total droppés→UNKNOWN : **0**.

## 6. SKIP (2) — isolation par-muni, jamais forcés

| # | muni | étape | raison |
|---|---|---|---|
| 1 | matapedia | sélection | MapServer `MRC060/06045_Publique` **not started** (HTTP 500 / objet d'erreur ArcGIS) — source indisponible ; exclue de la worklist (jamais capturée) |
| 2 | saint-laurent-de-lile-dorleans | dépôt | meilleur champ `Usage` overlap **78,6 % < 90 %** (NUM_ZONE 0 %) → HOLD divergence, SKIP (mauvaise-couche/ambigu ; le remplacement n'atteste pas l'abolition) |

Chaque SKIP est un garde légitime — refus de déposer une source indisponible ou une
géométrie dont les codes ne reproduisent pas la vérité-terrain servie. Jamais forcé,
jamais inventé.

## 7. Readback (G5) — VERT sur les 10

Chaque muni déposé : `feature_count_matches_capture`, `geometry_digest_byte_exact`,
`zone_code_present_all`, `proof_url == query URL`, `proof_sha256 == capture sha`,
`carries_capture_sha256`, `zone_source_level == documented`, `zone_source_url` uniforme =
proof.url, `geometry_grain == zone-polygon`, backup `_replaced/` présent → tous **true**.
`readback_ok = true`, `statut = DEPOSITED` sur les **10/10**. Enrichissement
préservé/re-appliqué dans la même passe (reglement, usage-dominant, geometry-status,
effet-densifiant scaffold).

## 8. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 2
scripts altus n'ajoutent aucune erreur.

## 9. Verdict

Batch altus **CLÔTURÉ : 10/12 DÉPOSÉS, 2 SKIP** (gardes légitimes). Chemin ArcGIS
MapServer `f=geojson` → preuve v2 (type=arcgis) rejoué à l'échelle sur des couches à champ
code-zone hétérogène, résolu sans invention par recouvrement avec le servi. Slugs déposés
prêts pour re-fold (`col-2` GATÉ sur autorité zones=final + go S3, cf. mémoire). Codes
droppés → **UNKNOWN**, jamais N-A.

### Slugs déposés (pour re-fold)

`gaspe`, `hope-town`, `murdochville`, `paspebiac`, `saint-flavien`,
`saint-francois-dassise`, `saint-francois-de-lile-dorleans`, `saint-gabriel-de-valcartier`,
`saint-janvier-de-joly`, `saint-pierre-de-lile-dorleans`
