# col-2 source triage (read-only) — amherst / beaupre / boischatel / mille-isles

**Mode**: READ-ONLY. Served state read from S3 (probe `_zones-col2-source-triage-20260816.ts`,
EXIT 0, 4/4 slugs OK). Source identity discovered by public web probe (ArcGIS `?f=json` +
`/query returnCountOnly`). NO capture / NO deposit / NO S3 write / NO cluster.

**Anti-invention**: every source URL below was live-probed this pass (HTTP 200; field list +
count read off the endpoint). Un-fetched plan internals => `tier_confidence=estimated`. Yields `est`.

## Classification table

| slug | problem | served (what geo-api serves) | class | source / plan | covers? | tier |
| --- | --- | --- | --- | --- | --- | --- |
| **beaupre** | 2929 lots HORS-ZONE | NESTED = 20 MRC-affectation polys, `zone_code=null` (real zoning only in FLAT: 78 zones) | **RE-ACQUERABLE-VECTOR** | `services6.arcgis.com/osUKB2jztkflrQhx/.../Zonage/FeatureServer/17` — "Zonage municipal de la Ville de Beaupre", field `ZONE_`, live 78 (1 empty), MTM zone 7 | **yes** | — |
| **mille-isles** | 488 lots, ~1705 m uniform offset, R=0.89 | NESTED = 66 zones from MRC d'Argenteuil arcgis, shifted ~1.7 km | **OFFSET-REPROJECT** | `services9.arcgis.com/iZcAwIV2GibwcZLe/.../Zonage/FeatureServer/0` — owner `mahurtubise_mrcargenteuil`, field `zone`, `co_mun=76030`, live 66, **EPSG:3857** | **yes** | — |
| **boischatel** | 4072 lots HORS-ZONE | NESTED = 17 MRC-affectation polys, `zone_code=null` (real zoning only in FLAT: 55 georeferenced zones) | **PDF-RECALAGE-T3** (est) — but primary lever is layout reconciliation | plan = `boischatel.blob.core.windows.net/media/1230/rg-zonage.pdf` (Annexe I) | no (PDF) | T3 (est) |
| **amherst** | 1749 lots: 1132 CONTENU (re-fold) + 617 HORS-ZONE | FLAT-only, 43 zones, vision-GCP georeferenced | **jointures re-fold** (1132) + **PDF-RECALAGE-T3** (617, est) | no vector (MRC Laurentides = JPCadrin proprietary); plan = `.../352-02-Zonage-revise-2017.pdf` | partial | T3 (est) |

## Per-city detail

### beaupre — RE-ACQUERABLE-VECTOR
- Live vector zoning source confirmed and **identity-clean**: serviceDescription "Zonage municipal
  de la Ville de Beaupre", single layer 17 "Zonage", zone-code field **`ZONE_`**, live count **78**,
  exactly **1 empty `ZONE_`** feature (matches the served flat 77 codes + 1 empty). CRS = NAD83 MTM
  zone 7 (central meridian -70.5, false easting 304800).
- Root cause of the 2929 HORS-ZONE: geo-api serves the **NESTED** layer, which is a mis-deposited
  MRC schema-d'amenagement **affectation** layer (20 polys, `zone_code=null`), not the zoning.
- **Coverage-gate**: the 1 empty-code feature => `UNKNOWN` on deposit (never N-A). This is exactly
  the documented "beaupre empty-code" AGOL SKIP; the blocker is anti-loss/anti-invention, not a
  missing source. Re-acquire FS/17 (v2, MTM7->4326) and deposit on **both** layouts.

### mille-isles — OFFSET-REPROJECT
- Live source confirmed and **identity-clean**: `Zonage/FeatureServer/0` on org `iZcAwIV2GibwcZLe`,
  owner **`mahurtubise_mrcargenteuil`** (= the served source slug `mahurtubise-mrcargenteuil`),
  fields `zone/vocation/info/co_mun/Shape__Area/Shape__Length` identical to the served nested,
  `co_mun=76030` live count **66** (== served nested 66). **CRS = EPSG:3857 (Web Mercator)**.
- Anti-homonyme: NOT the France "Argenteuil geo open data" hub (PLU) — that was rejected.
- Suspected mismatch: the ~1705 m uniform offset (R=0.89) was introduced during the original
  disaggregation/reprojection (a 3857->4326 parameter error — too large for a NAD83<->WGS84 datum
  shift, too small for a wrong MTM zone). **Fix = re-capture authoritative bytes (`co_mun=76030`)
  + reproject 3857->4326 correctly; never shift the served geometry.** R<1.0 => verify at re-capture
  that the correction fully closes the 1.7 km (residual may be source-digitization imprecision).

### boischatel — PDF-RECALAGE-T3 (est) + LAYOUT reconciliation (capture-free lever)
- No live vector zoning source (MRC Cote-de-Beaupre publishes none per-municipality; Beaupre's org
  is Beaupre-only). Plan = by-law 2014-976 Annexe I (`.../media/1230/rg-zonage.pdf`).
- **CRITICAL**: a georeferenced **55-zone** layer ALREADY EXISTS in the FLAT layout (`t2-gcp3`,
  contour-manual-gcp) but geo-api serves the mis-deposited NESTED affectation (17 polys, no codes)
  — the direct cause of the 4072 HORS-ZONE. The fastest fix is **capture-free**: reconcile the
  served authority (serve the flat georeferenced zones on both layouts / remove the nested
  affectation). PDF-recalage of Annexe I only improves registration beyond the existing t2-gcp3.

### amherst — jointures re-fold (1132) + PDF-RECALAGE-T3 (617, est)
- FLAT-only, 43 georeferenced zones (`t2-vision-gcp`), bbox ~46.0N/-74.7W (correct territory).
- No live vector source: MRC des Laurentides serves zoning only via the proprietary JPCadrin viewer
  (matrice graphique) — no FeatureServer/WFS/geojson. Plan sheets are annexed to by-law 352-02.
- The 1132 CONTENU is a **jointures re-fold** (not a source class, primary lever — see gate). Only
  the 617 HORS-ZONE is a source-recovery item, and it has no vector option (=> PDF-recalage, T3 est).

## AMHERST GATE — nested-FINAL verdict

**Question**: can jointures safely re-fold the 1132 CONTENU lots (containment) against the current
served geometry NOW?

- amherst is **FLAT-only** — there is **NO nested layout**. geo-api serves the flat collection
  (the sole layout). The flat 43-zone `t2-vision-gcp` collection **IS** the standing served authority.
- The "nested-FINAL" gate is **vacuously satisfied**: with no nested, there is no stale-flat-vs-fresh-
  nested divergence possible.
- amherst is **NOT** in the recalage worklist and **NOT** in any pending deposit (campaign closed)
  => no in-flight zones change touches it => the current served flat is the standing authority.

**Verdict: nested-FINAL = YES (resolves to flat-FINAL). GO — re-fold the 1132 CONTENU now.**

**Caveat**: the 617 HORS-ZONE makes amherst a re-acquisition/recalage candidate (no covering vector
source; only a PDF plan). If a covering source is later obtained, a future re-acquisition would
change the geometry and jointures would re-fold again — containment is idempotent, so the 1132
re-fold done now stays correct.

## Recommendation per city

1. **beaupre** — schedule a v2 re-acquisition of `Zonage/FeatureServer/17` (MTM7->4326), deposit on
   both layouts; accept the 1 empty-code feature as `UNKNOWN`. Resolves 2929 HORS-ZONE by construction (est).
2. **mille-isles** — re-capture `Zonage/FeatureServer/0` `co_mun=76030` (66 feats) and reproject
   3857->4326 correctly; deposit v2 on both layouts. Resolves the 1.7 km offset (verify residual).
3. **boischatel** — capture-free first: reconcile served authority so the existing flat 55-zone
   georeferenced layer is served (stop serving the nested affectation). PDF-recalage (T3) only to
   improve registration.
4. **amherst** — jointures re-folds the 1132 CONTENU now (gate = GO). The 617 hors-zone is a later
   PDF-recalage (T3 est); no vector source exists.
