# Identity analysis — mirabel (zones) — 2026-08-10

**READ-ONLY** (no capture, no deposit, no S3 writes). Decides whether mirabel — the last
held coverage-bound muni, flagged "gros", held earlier for a *composite code
(`contents`+`contents1`)* — has a CLEAN path to a v2 `candidate → documented` deposit from
its OWN identity-clean source, or must stay **HELD**.

## Decision: **ALREADY-DOCUMENTED** — no action, no worklist (HELD branch: served carries real v2 proof)

mirabel is **not** a candidate to upgrade. Its served collection is **already a clean
`documented` v2 deposit** (712/712 `featureHasV2Proof`), captured **2026-08-02** from its
**OWN identity-clean source** — the AGOL `Zonage_s_mirabel` (`Zonage/FeatureServer/0`),
which **IS** the served `zone_source_url`. The replace-policy precondition (*served
UNPROVEN*) is **NOT met**, so no re-deposit is warranted and **no worklist is emitted**.

The prior HOLD on the *composite code* is now **evidentially CLEARED**: the derivation
`contents + "-" + contents1` reproduces **100 %** of the served codes (both are real source
fields — no invention), the source is **verifiable-complete** (712 == 712 == 712), and it is
native zone polygons (no UEV → **zone-polygon** grain).

> Saint-hyacinthe lesson, applied and **inverted**: there, the discovered AGOL was the
> WRONG layer (~22 % overlap) and the identity-clean source was the served's own
> `zone_source_url`. Here the discovered AGOL **is** the served's own `zone_source_url`, and
> the deposit from it **already happened** cleanly — the hold was a false alarm on the code
> shape, not a wrong-layer problem.

---

## 1. Currently-served collection (S3, read-only)

- Served object (flat): `normalized/ca-qc-zonage/qc-zonage-mirabel.geojson` — **exists**.
- Nested `.geojson`: **absent** → geo-api serves the flat object. Single served object.
- **feature_count = 712**, geometry `Polygon` + `MultiPolygon`.
- served code field = **`zone_code`**, **711 distinct**, format **`contents-contents1`**
  (e.g. `H-7-3`, `CO-10-61`, `RU-2-40`, `ZOP-2-27`, `REC-2-36`, `E-2-3`). Feature `num_zone`
  field is `null` — the code lives in `zone_code`.

### Provenance — **PROVEN (documented v2)**
| field | value |
|---|---|
| `zone_source_url` | `https://services9.arcgis.com/y9EASLisYHhvZ7vM/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson` (real, uniform 712/712) |
| `zone_source_level` | **documented** (712/712) |
| `featureHasV2Proof` | **712 / 712** |
| collection-level proof | present — schema 2.0, `geometry_source` {type arcgis, method natif, reliability directe, `retrieved_at 2026-08-02T22:08:23.766Z`, `sha256:48c92b70c21b3030fe8ebdc181cc83de47de4cb5e3f97f16b191cbe8dc7b2e3e`} |
| `geometry_grain` field | absent (optional additive field, never stamped — cosmetic) |

**Verdict: served is UNPROVEN = FALSE.** Every feature carries a real v2 geometry proof
(sha256 + ISO `retrieved_at`), `zone_source_level=documented`, and the collection proof is
present. This is exactly the discipline's "served carries real v2 proof → do NOT emit a
worklist" case.

## 2. Identity-clean source (WebFetch/live read) — == the served's own `zone_source_url`

- URL: `https://services9.arcgis.com/y9EASLisYHhvZ7vM/arcgis/rest/services/Zonage/FeatureServer/0`
- AGOL org **y9EASLisYHhvZ7vM (Geo_ECL)**. Layer **`Zonage_s_mirabel`**, `esriGeometryPolygon`,
  `maxRecordCount 2000`, **public** (fetched without token).
- Fields: `FID`, `FeatId`, **`contents`**, **`contents1`**, `nom`, `Shape__Area`, `Shape__Length`.
- **No UEV/parcel identifiers** (`ID_UEV`/`MATRICULE8`/`CODE_UTILI` absent) → **grain = zone-polygon**.
- `returnCountOnly` = **712**, live `?f=geojson` count = **712**, `exceededTransferLimit=false`.

The discovered AGOL layer (`work/coverage/zones-vnatif-discovery-20260810.json`,
VECTEUR_TROUVE) and the served `zone_source_url` are the **same** service/layer — mirabel's
own identity-clean source.

## 3. Layer-identity + code-derivation overlap matrix

| derivation | distinct | served→deriv | deriv→served | served-only | deriv-only | verdict |
|---|---|---|---|---|---|---|
| **`contents + "-" + contents1`** | 711 | **100 %** | **100 %** | **0** | **0** | **PERFECT** — reproduces every served code |
| `contents` only | 9 | 0 % | — | 711 | 9 | letter prefix only (`H P C CO RU E REC ZOP …`) — not a per-zone code |
| `contents1` only | 687 | 0 % | — | 711 | 687 | numeric part only — not a per-zone code |

Both `contents` and `contents1` are **real source fields**; the served code is their faithful
join. No component is invented. (Note: under case/separator canonicalisation `contents " "
contents1` and `contents "-" contents1` are indistinguishable; the served RAW format is the
**dash** join `H-7-3`.)

## 4. Completeness (verifiable-complete)

| control | value |
|---|---|
| served feature_count | 712 |
| source live `?f=geojson` count | 712 |
| source `returnCountOnly` | 712 |
| `exceededTransferLimit` | false |
| **verifiable_complete** | **true (712 == 712 == 712)** |
| grain | **zone-polygon** (native zone polygons, no UEV) |

## 5. Why no worklist / no re-deposit

- **CAPTURE-READY precondition fails.** CAPTURE-READY requires the served to be UNPROVEN.
  mirabel's served is **documented v2** (712/712 proven) — there is nothing to upgrade.
- The source **would** qualify on overlap (100 %) and completeness (712==712==712) grounds,
  but re-capturing would only replace a sound 2026-08-02 proof with a fresh instant/sha at
  **zero coverage benefit** — a redundant write, out of scope for this read-only pass and
  contrary to anti-invention (don't manufacture churn).
- **Prior HOLD cleared by evidence:** the "composite code (`contents`+`contents1`)" concern
  was a code-shape doubt, not a wrong-layer problem. The composite is 100 % faithful to two
  real source fields, so the code is sound.

### Recommendation to coverage (NOT an action taken here)
Count mirabel as **documented** (it already is). Its held/"gros" flag should be **released**:
the source is identity-clean, public, verifiable-complete, native zone-polygon, and the
served deposit already carries a valid v2 proof from it. Optionally an *additive*
`geometry_grain=zone-polygon` stamp could be folded (cosmetic; not required, and outside this
read-only analysis).

## Cross-references
- Served deposit capture: `zones-v2mass-worklist-capture-20260802T220000Z.json`
  (run 20260802T22, `retrieved_at 2026-08-02T22:08:23.766Z`, `sha256:48c92b70…`).
- Prior discovery: `work/coverage/zones-vnatif-discovery-20260810.json` (mirabel VECTEUR_TROUVE,
  AGOL `Zonage_s_mirabel`, `contents`/`contents1`).
- Method mirror: `work/coverage/zones-identity-analysis-saint-hyacinthe-20260810.md`
  (identity-clean source == served `zone_source_url`).

## Caveats
- The live source read (fields, counts, `contents`/`contents1`) was performed read-only via a
  direct `fetch` of the public AGOL endpoint (same technique as the committed
  saint-hyacinthe inspect sonde) — exact, not summarised. Counts corroborate three ways
  (served 712, live geojson 712, `returnCountOnly` 712).
- The 100 % code overlap is measured on canonicalised codes (case + separators stripped),
  which is the robust identity comparison; the served RAW format is the dash join.
