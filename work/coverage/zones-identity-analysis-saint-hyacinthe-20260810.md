# Identity analysis — saint-hyacinthe (zones) — 2026-08-10

**READ-ONLY** (no capture, no deposit, no S3 writes). Decides whether saint-hyacinthe
has a CLEAN path to a v2 replacement deposit from the live AGOL candidate, or must stay **HELD**.

## Decision: **HELD** — G6 wrong-layer / different-taxonomy + different zone universe

Do **not** force the replacement. The live AGOL `Zonage_SHY` is **not** the same layer the
served collection was derived from, and the two do not overlap enough to substitute one for
the other. The served collection is genuinely UNPROVEN, so the replace-policy *precondition*
is met — but the G6 wrong-layer guard overrides it.

---

## 1. Live source candidate (WebFetch)

- URL: `https://services3.arcgis.com/KHxqinF9QiQAuCwv/arcgis/rest/services/Zonage_SHY/FeatureServer/0`
- AGOL org: **mrcdesmaskoutains** (MRC des Maskoutains). Layer `Zonage_SHY`, `esriGeometryPolygon`, objectId `FID`.
- **feature_count = 1066**
- **All fields:** `FID` (OID), `NO_ZONE` (int), `ETQ_ZONE` (str200), `SECTEUR` (int),
  `AFFECTATIO` (str100), `CODE_AFFEC` (str200), `REGLEMENT` (str200), `NOTES` (str254),
  `URL_Grille` (str254), `Shape_Leng`, `Shape_Area`, `Sup_m2`, `Shape__Area`, `Shape__Length` (doubles).
- **No UEV/parcel identifiers** (no `ID_UEV` / `MATRICULE8` / `CODE_UTILI`) → **grain = zone-polygon** (native zone polygons).

### Field characterization — which is the code
- **`ETQ_ZONE` is the authoritative composite zone code**, form `NNNN-L` (e.g. `5048-R`, `5068-H`).
  It is **not** a human prose label — it keys the official city grille
  (`grilles.ville.st-hyacinthe.qc.ca/zone/<ETQ_ZONE>`). `ETQ_ZONE = NO_ZONE + "-" + CODE_AFFEC`.
- **`NO_ZONE`** = the bare integer zone number (e.g. `5048`).
- **`CODE_AFFEC`** = the affectation designation letter(s) — the suffix of `ETQ_ZONE`
  (14 distinct incl. a blank: ` A AA AC AH AHC C H I M P R RA Z ZR`).
- **`AFFECTATIO`** = the long human affectation label.

So `ETQ_ZONE` is the full code; `NO_ZONE` is its numeric part; `CODE_AFFEC` its letter part. `CODE_AFFEC` is **ruled out** as a per-zone code (only ~14 values).

## 2. Currently-served collection (S3, read-only)

- Served object (flat): `normalized/ca-qc-zonage/qc-zonage-saint-hyacinthe.geojson` — **exists**, 1091 features, lm 2026-08-08.
- Nested `.geojson`: **absent** (only a nested `.meta.json`) → geo-api serves the flat object. Single served object.
- **feature_count = 1091**, served code field = **`zone_code`**, **1089 distinct**.
- `zone_code` format `NNNN-L` (e.g. `4052-C`), **derived as `NUM_ZONE + "-" + GROUPE_USAGE_DOM`**
  (feature `source` field: *"arcgis.st-hyacinthe.ca ISOGEO_SigimProd_Features/FeatureServer/13 (NUM_ZONE-GROUPE_USAGE_DOM, Regl.350)"*).

### Provenance — UNPROVEN
| field | value |
|---|---|
| `zone_source_url` | `https://arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13` (real, **not null**) |
| `zone_source_level` | `candidate` (1091/1091) |
| `featureHasV2Proof` | **0 / 1091** |
| feature proof | schema 1.0, `geometry.artifact_uri = s3://…/qc-zonage-saint-hyacinthe.geojson` (**self-referential**), `upstream_uri = null` |
| collection-level proof | absent |

**Verdict: every served code is UNPROVEN.** `url != null` but it is declarative (`candidate`, self-referential
artifact_uri, no upstream capture), and 0/1091 carry a v2 proof (`featureHasV2Proof`).

## 3. Overlap matrix

| candidate field | metric | value |
|---|---|---|
| **ETQ_ZONE (exact `NNNN-L`)** | \|served\|=1089, \|live\|=1066 | intersection **237** |
| | served-only | **852** |
| | live-only | 829 |
| | overlap served→live / live→served | **21.8% / 22.2%** |
| **NO_ZONE (numeric prefix)** | \|served#\|=1087, \|live#\|=1066 | intersection **627** |
| | served-only numbers | **460** |
| | live-only numbers | 439 |
| | overlap served→live / live→served | **57.7% / 58.8%** |
| **CODE_AFFEC** | — | ruled out (≈14 affectation categories, not a zone code) |

### Suffix agreement on the 627 common zone numbers
- same suffix: **236** · different suffix: **391** · agreement **37.6%**.
- Cause: the suffixes are **different attributes** — served `GROUPE_USAGE_DOM` (dominant usage group,
  vocab `A C H I M P R X`) vs live `CODE_AFFEC` (affectation designation, vocab
  `A AA AC AH AHC C H I M P R RA Z ZR`). Disjoint items: served-only `X`; live-only `AA AC AH AHC RA Z ZR`.

## 4. Direct-from-source confirmation (small reliable WebFetch)
- Same number, different suffix (live `ETQ_ZONE` vs served `zone_code`):
  `3002-H`/`3002-A`, `3020-H`/`3020-I`, `4002-I`/`4002-H`, `2016-C`/`2016-H`, `2031-I`/`2031-H`.
- Served-only numbers `IN (10001,10002,10003,4216,4209,4211)` → live **count = 0** (absent upstream).

## 5. Why HELD (policy application)

- **Replace precondition met** (all served codes UNPROVEN) — but that is *necessary, not sufficient*.
- **G6 wrong-layer signal fires**: ~22% exact overlap, ~58% number overlap, 62% suffix disagreement on
  common numbers, disjoint suffix vocabularies, and **different zone universes** (served has a 10000-series
  and 4200s that do not exist upstream; the AGOL has 439 numbers the served lacks).
- Forcing the replace would drop **852** served codes as UNKNOWN and re-key the collection into an
  incompatible taxonomy — the exact forced wrong-layer replacement the policy forbids.
- This is an **ISOGEO-taxonomy (city server) vs source-taxonomy (MRC AGOL) mismatch** → HELD by rule.

### Recommended reconciliation path (NOT an action taken here)
The identity-clean v2 source is the **same layer the served data came from**:
`arcgis.st-hyacinthe.ca/server/rest/services/ISOGEO_SigimProd_Features/FeatureServer/13`
(`NUM_ZONE + GROUPE_USAGE_DOM`). A v2 capture there would upgrade the *same* identity
`candidate → documented` without dropping codes — subject to its own identity + verifiable-complete
check. The AGOL `ETQ_ZONE` layer is a distinct, non-substitutable dataset.

## Cross-references
- Prior HELD: `work/coverage/zones-vnatif-deposit-record-20260810.json` (saint-hyacinthe = SKIP, "852 codes servi absents … HELD, pas de dépôt forcé, à reconcilier cf bernard/jude 20260803"). This analysis independently reproduces the **852** and refines the taxonomy diagnosis.
- Prior discovery: `work/coverage/zones-vnatif-discovery-20260810.json` (VECTEUR_TROUVE, AGOL Zonage_SHY, ETQ_ZONE `5048-R`).

## Caveats
- The full live `ETQ_ZONE` set (1066) was read via WebFetch (summarizing model). The decision is robust
  to minor transcription imperfection: the overlap figures, the 62% suffix disagreement, and the
  different-taxonomy conclusion are corroborated by the served `source` field text, direct single-zone
  AGOL queries, and the prior held's 852 figure.
