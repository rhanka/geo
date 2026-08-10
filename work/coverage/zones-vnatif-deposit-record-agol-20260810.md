# Dépôt zones — BATCH AGOL (ArcGIS Online hosted FeatureServer, f=geojson) — 2026-08-10

**Décision : CLEAN-UPGRADE** (legacy-traceable / candidate → documented v2) des **19**
munis UPGRADABLE hébergés sur `services*.arcgis.com` (+ items portal `www.arcgis.com`).
**14 DÉPÔTS EFFECTUÉS**, readback **VERT sur les 14**. **5 SKIP** (isolation par-muni,
jamais forcés). C'est la **DERNIÈRE veine plateforme** de la campagne vecteur-natif.

Réplique EXACTE de la recette de dépôt VICTORIAVILLE (`5564b2f5`) / ALTUS (`0b343380`) —
G2 byte-exact, anti-homonyme, gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`,
backup `_replaced/`, dropped→UNKNOWN (jamais N-A), readback G5. **Seules différences** :
(1) preuve **type=agol** ; (2) topologie MIXTE (couche per-muni `where=1=1` OU couche MRC
PARTAGÉE filtrée par muni `where=<F>=<v>`) ; (3) champ code-zone hétérogène par org.

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` + `SPEC_ZONE_GEOMETRY_GRAIN.md` +
`SPEC_ACQUISITION_METHODES_PAR_SOURCE.md` §12.

Scripts : `acquisition/src/_zones-vnatif-probe-agol-20260810.ts` (sonde structure LIVE),
`acquisition/src/_zones-vnatif-select-agol-20260810.ts` (sélection + résolution filtre-muni
+ validation LIVE), `acquisition/src/_zones-vnatif-deposit-agol-20260810.ts` (dépôt),
`acquisition/src/_zones-vnatif-diag-agol-holds-20260810.ts` (diagnostic des 3 HOLD).
Worklist : `work/coverage/zones-vnatif-capture-worklist-agol-20260810.json` (14 munis).
Diagnostic sélection : `work/coverage/_zones-vnatif-select-agol-20260810.json`.
Sonde structure : `work/coverage/_zones-vnatif-probe-agol-20260810.json`.
Dry-run : `work/coverage/_zones-vnatif-deposit-dryrun-agol-20260810.json`.
Record machine : `work/coverage/zones-vnatif-deposit-record-agol-20260810.json`.

## 1. Plateforme AGOL (topologie MIXTE)

Host `services\d*.arcgis.com` = FeatureServers hébergés ArcGIS Online (une org/couche par
muni OU une couche MRC partagée). Requête geojson :
`<layer>/query?where=<filtre>&outFields=*&f=geojson`. Deux topologies coexistent :

- **(A) Couche PER-MUNI** (un seul slug, aucun champ /mun|nom/ multi-valué) → `where=1=1`.
  Munis : `saint-jean-de-lile-dorleans` (Limite_du_zonage/4).
- **(B) Couche MRC PARTAGÉE** (plusieurs munis) → filtre par muni `where=<F>=<v>`, F/v
  RÉSOLUS sans invention : match de NOM (registre) quand F est un champ-nom string,
  sinon (champ-code entier, ex `CODE_MUN`) par **anti-homonyme nearest(grp)==slug** (lat/lon
  registre) ET **recouvrement ≥90%** des codes servis. Couches : `Zonage_MRC_Témiscouata_vue/0`
  (F=`CODE_MUN`, 7 munis), `Zonage/FeatureServer/5` MRC du Granit (F=`MUNI`, 4 munis),
  `Intranet_Municipal/8` (F=`MUN`, 2 munis).

Preuve : **type=agol, method=natif, reliability=directe**. Les URLs de la worklist sont
canonicalisées via `new URL().toString()` (= forme inscrite au manifeste par
`redactUrlForManifest`) → `findLine(line.url===url)` byte-exact par construction.

## 2. Capture (k8s, cluster OVH)

- Job `geo-capture-zones-20260810t210000z` : **Complete 12/12 shards** (14 cibles), run-stamp
  `20260810T210000Z`, 0 shard en échec, 12 pods `Completed`.
- Octets bruts + manifeste + logs sur S3 sous `capture/_runs/zones-20260810T210000Z-*`.
- Worklist déposée : `s3://sentropic-geo/registry/capture-worklists/zones-20260810T210000Z.json`.

## 3. Résolution du champ code-zone (anti-invention, jamais deviné)

Champ code-zone hétérogène par org (`ZONE_`, `ZONE`, `Sect`, `Sect_label`, `NUM_ZONE`,
`NO_ZONE`, `Usage`…). RÉSOLU **par muni** : parmi les champs non-techniques (muni-partition
`MUN/MUNI/CODE_MUN/co_mun/Nom_Mun_View` et aires/audit exclus), sans valeur vide, ≥3 codes
distincts, on retient celui qui **REPRODUIT ≥90% des codes DÉJÀ SERVIS** (legacy). Le
recouvrement avec la vérité-terrain servie EST le discriminateur ; les champs d'affectation
(`TYPE_ZONE`, `vocation`, `LéGENDE`…) n'atteignent jamais 90% et sont écartés. `zone_code` =
valeur BRUTE du champ résolu, aucune dérivation synthétique. **Overlap = 100% sur les 14.**

## 4. Gardes par muni (isolation stricte, un KO = SKIP jamais abort)

G2 byte-exact (re-hash CAS == manifeste == clé CAS + `verifyRawCapturePayload`),
FeatureCollection non-vide, **anti-troncature ArcGIS** (`exceededTransferLimit !== true` ET
`count` LIVE avec **LE MÊME `where`** == features → numberReturned==numberMatched), 100 %
polygonal, grain **zone-polygon** (aucun marqueur UEV), anti-homonyme
`nearest_registre_muni==slug`, champ code-zone résolu à overlap **≥ 90 %**, anti-invention
(aucun feature à `zone_code` vide), servi non-déjà-prouvé. **0 garde déclenchée au dépôt : 0 SKIP au dépôt.**

## 5. Dépôt candidate/legacy-traceable → documented v2 (VERT sur les 14)

`normalize(feats, <champ résolu>, url)` → `zone_code` brut ; `proofFromCaptureEntry(line,
{type:"agol", method:"natif", reliability:"directe"})` ; `depositCapturedZones(…,
{geometryGrain:"zone-polygon"})`. Gate **PROVENANCE-AWARE** : servi non-prouvé
(legacy-traceable) ⇒ upgrade ; codes servi-seulement → **UNKNOWN** (jamais N-A) + backup
`_replaced/…`.

| # | muni | couche AGOL | filtre | champ code | features | count LIVE | overlap | droppés→UNKNOWN | sha256 (court) |
|---|---|---|---|---|---:|---:|---:|---:|---|
| 1 | saint-francois-xavier-de-brompton | Intranet_Municipal/8 | MUN='Saint-François-Xavier-de-Brompton' | Sect | 114 | 114 | 100 % | 0 | 441c7e9c |
| 2 | saint-honore-de-temiscouata | Témiscouata_vue/0 | CODE_MUN=13090 | ZONE | 50 | 50 | 100 % | 0 | bf2c05af |
| 3 | saint-jean-de-la-lande | Témiscouata_vue/0 | CODE_MUN=13010 | ZONE | 22 | 22 | 100 % | 0 | a692d83e |
| 4 | saint-jean-de-lile-dorleans | Limite_du_zonage/4 | 1=1 | Usage | 62 | 62 | 100 % | 0 | db4080ed |
| 5 | saint-juste-du-lac | Témiscouata_vue/0 | CODE_MUN=13040 | ZONE | 34 | 34 | 100 % | 0 | d09e263a |
| 6 | saint-louis-du-ha-ha | Témiscouata_vue/0 | CODE_MUN=13080 | ZONE | 68 | 68 | 100 % | 0 | 5448fec8 |
| 7 | saint-marc-du-lac-long | Témiscouata_vue/0 | CODE_MUN=13020 | ZONE | 49 | 49 | 100 % | 0 | c78fd760 |
| 8 | saint-michel-du-squatec | Témiscouata_vue/0 | CODE_MUN=13065 | ZONE | 84 | 84 | 100 % | 0 | 5fa809f1 |
| 9 | saint-pierre-de-lamy | Témiscouata_vue/0 | CODE_MUN=13075 | ZONE | 17 | 17 | 100 % | 0 | cb315c2c |
| 10 | saint-romain | Zonage/5 (Granit) | MUNI='Saint-Romain' | NO_ZONE | 100 | 100 | 100 % | 0 | ee15614d |
| 11 | saint-sebastien--le-granit | Zonage/5 (Granit) | MUNI='Saint-Sébastien' | NO_ZONE | 44 | 44 | 100 % | 0 | f2abb9c6 |
| 12 | stornoway | Zonage/5 (Granit) | MUNI='Stornoway' | NO_ZONE | 63 | 63 | 100 % | 0 | 2ff1e4dd |
| 13 | ulverton | Intranet_Municipal/8 | MUN='Ulverton' | Sect | 56 | 56 | 100 % | 0 | c2311918 |
| 14 | val-racine | Zonage/5 (Granit) | MUNI='Val-Racine' | NO_ZONE | 36 | 36 | 100 % | 0 | 587319a9 |

**14 munis à overlap 100 % (0 droppé).** Total droppés→UNKNOWN : **0**.

## 6. SKIP (5) — isolation par-muni, jamais forcés

| # | muni | étape | raison |
|---|---|---|---|
| 1 | havre-saint-pierre | sélection (portal) | Item `www.arcgis.com` = **Web Map** (« Carte de zonage HSP ») ; couche opérationnelle `HSP_Ligne` = featureCollection EMBARQUÉE (aucune URL FeatureServer re-téléchargeable, `url`/`itemId` nuls) ET géométrie **LIGNE** (pas des polygones de zone). Non résolvable en une étape → SKIP |
| 2 | plessisville | sélection (portal) | Item `www.arcgis.com` = **Web Map** (« PLAN DE ZONAGE ET MATRICE GRAPHIQUE ») ; couches (`ZONAGE`, `UNITÉ D'ÉVALUATION`, cadastre) = featureCollections EMBARQUÉES (aucune URL FeatureServer, `url`/`itemId` nuls). Non résolvable → SKIP |
| 3 | beaupre | dépôt | `ZONE_` overlap 100% MAIS **1/78 features à code VIDE** → anti-invention (« SKIP empty code » : aucun feature servi ne peut manquer de `zone_code`) |
| 4 | gore | sélection | Couche partagée `services9/Zonage/0` (10 munis via `co_mun`) : les **840** codes servis de gore ne reproduisent AUCUNE partition `co_mun` (co_mun=76025 nearest-gore : 7,1 % ; max 28 % ailleurs) → source-identity < 90 %, l'URL du scoping n'est pas la source des codes servis (déclaratif/mauvaise-couche) → SKIP |
| 5 | saint-ludger | sélection | Couche partagée Granit `Zonage/5` : `MUNI='Saint-Ludger'` overlap **100 %** ET match de nom exact, MAIS **anti-homonyme nearest=saint-robert-bellarmin (5,8 km) != saint-ludger** (faux-négatif du centroïde-bbox sur muni rural adjacent). SKIP par respect de la garde `nearest==slug` — **HOLD** candidat fort pour une anti-homonymie affinée |

Chaque SKIP est un garde légitime — refus de déposer une source non résolvable, une source
dont les codes ne reproduisent pas la vérité-terrain servie, un feature sans code, ou une
géométrie qui échoue l'anti-homonyme. Jamais forcé, jamais inventé.

## 7. Readback (G5) — VERT sur les 14

Chaque muni déposé (layout **flat**) : `feature_count_matches_capture`,
`geometry_digest_byte_exact`, `zone_code_present_all`, `proof_url == query URL`,
`proof_sha256 == capture sha`, `carries_capture_sha256`, `zone_source_level == documented`,
`zone_source_url` uniforme = proof.url, `geometry_grain == zone-polygon`, backup `_replaced/`
présent → tous **true**. `readback_ok = true`, `statut = DEPOSITED` sur les **14/14**.
Enrichissement préservé/re-appliqué dans la même passe (reglement, norms, usage-dominant,
geometry-status, effet-densifiant scaffold).

## 8. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ;
`acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322). **Delta = 0** : les 4
scripts AGOL n'ajoutent aucune erreur.

## 9. Verdict — DERNIÈRE VEINE PLATEFORME

Batch AGOL **CLÔTURÉ : 14/19 DÉPOSÉS, 5 SKIP** (gardes légitimes). Chemin ArcGIS Online
hosted FeatureServer `f=geojson` → preuve v2 (type=agol) rejoué à topologie MIXTE : couches
per-muni ET couches MRC partagées filtrées par muni, filtre + champ code-zone résolus sans
invention par nom + recouvrement ≥90% + anti-homonyme. Slugs déposés prêts pour re-fold
(`col-2` GATÉ sur autorité zones=final + go S3, cf. mémoire). Codes droppés → **UNKNOWN**,
jamais N-A.

**Backlog résiduel de cette veine (SKIP)** : `havre-saint-pierre`, `plessisville`
(items portal Web Map à featureCollection embarquée — hors chemin FeatureServer), `beaupre`
(1 code vide à trancher amont), `gore` (source-identity : re-sourcer la vraie couche gore),
`saint-ludger` (anti-homonymie centroïde à affiner — candidat fort, name+overlap 100%).

### Slugs déposés (pour re-fold)

`saint-francois-xavier-de-brompton`, `saint-honore-de-temiscouata`, `saint-jean-de-la-lande`,
`saint-jean-de-lile-dorleans`, `saint-juste-du-lac`, `saint-louis-du-ha-ha`,
`saint-marc-du-lac-long`, `saint-michel-du-squatec`, `saint-pierre-de-lamy`, `saint-romain`,
`saint-sebastien--le-granit`, `stornoway`, `ulverton`, `val-racine`
