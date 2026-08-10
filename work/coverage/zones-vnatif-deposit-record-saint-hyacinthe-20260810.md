# Dépôt zones — saint-hyacinthe — 2026-08-10

**Décision : CLEAN-UPGRADE** (candidate → documented v2, même couche-identité, `zone_code`
servi reproduit fidèlement à 99.9 %). Dépôt EFFECTUÉ (readback OK).

Politique : `SPEC_ZONE_DEPOSIT_REPLACE_POLICY.md` (64f82eae / 65d4c637) +
`SPEC_ZONE_GEOMETRY_GRAIN.md` (7c7f6731). Analyse préalable read-only :
`zones-identity-analysis-saint-hyacinthe-20260810.{json,md}` (2cfa317d).

Scripts : `acquisition/src/_zones-vnatif-inspect-saint-hyacinthe-20260810.ts` (sonde),
`acquisition/src/_zones-vnatif-deposit-saint-hyacinthe-20260810.ts` (dépôt).
Record machine : `zones-vnatif-deposit-record-saint-hyacinthe-20260810.json`.

## 1. Capture (k8s)

- Job `geo-capture-zones-20260810t130000z` : **Complete 1/1**, pod `-0-jgglp` Completed (exit 0).
- Run-stamp `20260810T130000Z`, run_id `zones-20260810T130000Z-0-564c3c54-…`.
- Worklist : `zones-vnatif-capture-worklist-saint-hyacinthe-20260810.json` (couche ISOGEO/13).

## 2. G2 — byte-exact + vérifiable-complète (VERT)

| contrôle | valeur |
|---|---|
| CAS key | `raw/zones-vnatif/cas/cb322ad8…c93cf.bin` |
| sha256 | `sha256:cb322ad84822ed09d7b95298bffecfb57349d2a94b368b3a6a33d52bb29c93cf` |
| re-hash CAS == manifeste == clé CAS | **true / true** |
| `verifyRawCapturePayload` | **true** |
| FeatureCollection non vide | true, **1091** features, 100 % Polygon |
| `exceededTransferLimit` | **false** |
| énumération source LIVE (`returnCountOnly`) | **1091** |
| complétude | `feature_count(1091) == source_count(1091) && exceeded=false` ✔ |
| `nearest_registre_muni` | **saint-hyacinthe** (0.27 km) — anti-homonyme OK |

**count : 1091 == 1091 == 1091** (capture == servi == source LIVE).

## 3. Identité de couche (G6 satisfait — NON mauvaise-couche)

Même service/couche que le `zone_source_url` du servi :
`arcgis.st-hyacinthe.ca … ISOGEO_SigimProd_Features/FeatureServer/13`
(`layer name = dbo.V_ZON_ZONAGE_S`), champs `NUM_ZONE` / `GROUPE_USAGE_DOM` présents.

| métrique | valeur |
|---|---|
| **overlap NUM_ZONE (nombres nus)** | **1087 / 1087 = 100 %** (servi→capture ET capture→servi, 0 de chaque côté) |
| count | 1091 == 1091 == 1091 |

→ définitivement la MÊME couche. Le HOLD antérieur visait la couche MRC AGOL `Zonage_SHY`
(`ETQ_ZONE`), un dataset RÉELLEMENT différent (~22 % overlap) — sans rapport avec ce dépôt.
Ici la divergence de code n'est PAS un signal de mauvaise-couche : c'est une évolution de
granularité du suffixe sur la MÊME couche. **G6 ne bloque pas.**

## 4. Dérivation `zone_code` (anti-invention, évidence mesurée)

Le servi keye `zone_code = NUM_ZONE + "-" + <classe usage-dominant>` (ex. `4052-C`), la classe
étant le composant de tête de `GROUPE_USAGE_DOM` avant le premier `-`. La source a depuis
**RAFFINÉ** `GROUPE_USAGE_DOM` en `classe-NN` (ex. `C-03`) et expose la grille canonique
`NUM-classe-NN` (`GRILLE_URL` basename + `ETIQUETTE`, ex. `4052-C-03`).

Overlaps mesurés (capture → servi, canon) :

| dérivation | distinct | overlap vs `zone_code` servi |
|---|---|---|
| `NUM_ZONE + "-" + classe` (tête de GROUPE) — **retenue** | 1089 | **99.9 %** (1088/1089) |
| `NUM_ZONE + "-" + GROUPE_USAGE_DOM` (`4052-C-03`) | 1089 | 0 % |
| `ETIQUETTE` (`4052  C03`) | 1089 | 0 % |
| `GRILLE_URL` basename (`4052-C-03`) | 1089 | 0 % |

**Retenue : `NUM_ZONE + "-" + classe`** — reproduit le code servi à 99.9 % (mesuré, pas
supposé). C'est fidèle à la source (la classe est un composant RÉEL de `GROUPE_USAGE_DOM`,
pas une valeur inventée) ET c'est le chemin de réconciliation explicitement recommandé par
l'analyse préalable (« upgrade la même identité candidate→documented SANS dropper de codes »).
Préserve l'enrichissement servi (reglement / usage_dominant, apparié par code) et n'impose
aucune rupture au consommateur.

**Pourquoi PAS EVOLUTION-REPLACE vers `4052-C-03`.** C'est bien la MÊME couche (NUM_ZONE 100 %)
avec suffixe évolué — l'EVOLUTION-REPLACE serait légitime en principe — mais adopter le code
raffiné re-keyerait **~toute** la collection (0 % overlap sur le code entier), droppant ~1089
codes et **vidant l'enrichissement** (reglement/usage_dominant, non appariables). Le gate
anti-appauvrissement de `putServedZoneGeojson` (`assertNoServedPropertyKeysLost`) le refuse à
juste titre : un dépôt géométrie ne doit jamais appauvrir la collection servie. Le raffinement
`-03` disponible en source est **documenté pour un RECALAGE archi séparé** (re-keyage +
re-appariement de l'enrichissement), hors périmètre de ce dépôt.

## 5. Divergence documentée (G3/G4)

- **Codes servi-seulement droppés : 1** → `3083X` (servi `3083-X`).
  Source zone 3083 = `GROUPE_USAGE_DOM "H-16"` ⇒ classe `H` ⇒ `3083-H` ; la valeur `X`
  (hors vocabulaire de classe courant) n'a pas de reproduction amont.
- Statut : **UNKNOWN** (recalage-flagged, **JAMAIS N-A** — le remplacement n'atteste pas
  l'abolition), `zone_source_url=null` sur ce code droppé.
- Distinct codes : servi **1089** → après **1089** (1088 reportés + 1 nouveau `3083-H`).
  Ce n'est PAS une évolution-taxonomie massive : c'est un upgrade 0.1 %-de-perte.

## 6. Readback (G5) — VERT

Servi flat-only (`normalized/ca-qc-zonage/qc-zonage-saint-hyacinthe.geojson` ; pas de
sous-dossier `.geojson`, confirmé). 1091 features.

| contrôle | valeur |
|---|---|
| `feature_count_matches_capture` | true (1091) |
| `geometry_digest_byte_exact` (servi == capture) | **true** |
| `zone_code_present_all` | true |
| `proof_url` == capture query URL | true |
| `proof_sha256` == capture sha | true (`cb322ad8…`) |
| `proof_retrieved_at` | `2026-08-10T13:02:28.279Z` |
| `carries_capture_sha256` (collection + features) | true |
| `zone_source_level` | **documented** (uniforme) |
| `zone_source_url` | = proof.url (uniforme) |
| `geometry_grain` | **zone-polygon** (uniforme) |
| backup `_replaced/` | `_replaced/qc-zonage-saint-hyacinthe__flat.2026-08-10T1318Z.geojson` |
| propriétés peuplées AVANT→APRÈS | 10728 → 16174 (aucune régression) |

`readback_ok = true`, `statut = DEPOSITED`.

## 7. Provenance avant/après

| | avant | après |
|---|---|---|
| `zone_source_level` | candidate (1091/1091) | **documented** |
| `featureHasV2Proof` | 0 / 1091 | **1091 / 1091** (v2, sha+retrieved_at) |
| `zone_source_url` | déclaratif (self-référentiel) | query URL réelle, hachée dans la preuve |
| `geometry_grain` | (absent) | **zone-polygon** |

## 8. Pour lot / archi

- **CLEAN-UPGRADE réussi** : identité inchangée, ~0-perte (1 code UNKNOWN), enrichissement préservé.
- **Raffinement source disponible** : `GROUPE_USAGE_DOM` = `classe-NN` et grille canonique
  `NUM-classe-NN` (`4052-C-03`). Si archi souhaite servir le code raffiné, prévoir un
  **recalage** (re-keyage `zone_code` + ré-appariement reglement/usage_dominant), traité comme
  un chantier distinct (bloqué par le gate anti-appauvrissement en l'état).
