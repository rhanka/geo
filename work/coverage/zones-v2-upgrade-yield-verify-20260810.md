# Zones v2 upgrade — REAL-YIELD verification (goAzimut / geoCentralis clusters)

**Date:** 2026-08-10 · **Mode:** READ-ONLY (WebFetch only; no capture, no deposit; one committed record)
**Input:** `work/coverage/zones-v2-upgrade-scoping-20260810.json` (commit 570ee0d7), 388-entry `upgradable_list`.

## Question

The scoping put UPGRADABLE at **388**, with a **376 upper bound** for source-identity capture
(= all geoserver-wfs 147 + all arcgis-rest 229). That number counts the *presence* of a real
`zone_source_url`, **not** verified liveness. This record tests whether the recorded per-muni URLs
actually serve **queryable per-muni zone GeoJSON with a real zone-code field**.

## Method

For 3–5 sample slugs per cluster, WebFetch the **actual recorded `zone_source_url`**:

- **ArcGIS:** `…/query?where=1=1&outFields=*&resultRecordCount=3&f=geojson`
- **GeoServer WFS:** `/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=<layer>&outputFormat=application/json&count=3&CQL_FILTER=id_municipalite=<id>`

A cluster is **AUTOMATABLE only if a live sample actually returned** a Polygon/MultiPolygon
FeatureCollection with a real zone-code attribute.

## Results per cluster

| Cluster | Host | Size | Liveness | GeoJSON | Zone-code field | Verdict | Est. yield |
|---|---|---:|---|---|---|---|---:|
| **geoCentralis WFS** | geoserver.geocentralis.com | 147 | 200 OK | **yes** | `no_zonage_municipal` / `etiquette_1` | **AUTOMATABLE** | **147** |
| **goAzimut MapServer** | www.goazimut.com | 184 | 302→www2→**404 / marketing SPA** | **no** | — | **NOT-AUTOMATABLE** | **0** |
| **altusquebec** | gis.altusquebec.com | 12 | 200 OK | **yes** | `Zone` (`A-123`) | **AUTOMATABLE** | **12** |
| **victoriaville (shared MRC)** | geo.victoriaville.ca | 12 | 200 OK (no token) | **yes** | `Disposition_spéciale` (`AF8`) | **AUTOMATABLE** | **12** |
| **AGOL FeatureServers** | services*.arcgis.com | 19 | 200 OK | **yes** (5/5) | `ZONE_`/`Sect`/`NO_ZONE`/`NUM_ZONE` | **AUTOMATABLE** | **19** |

### geoCentralis WFS — AUTOMATABLE (147)

One shared endpoint (`/geoserver/ows`), **two** shared layers, each filtered by `id_municipalite`:

- `evb:zonage_municipal` — **adstock** (31056): 200 OK, MultiPolygon, **174 features**, zone code
  `no_zonage_municipal` = `M2.3-1`, plus `description` (Agroforestier de type 1) and a real
  reglement PDF anchor.
- `evb:siadmin_pzon_99_s` — **baie-comeau** (96020): 200 OK, MultiPolygon, **238 features**, zone
  code `etiquette_1` = `281 R`, `etiquette_2` = `Résidentiel`.

All 147 batch-capturable from one endpoint. *Caveat:* leading-zero ids (e.g. albertville 07025)
— `id_municipalite` is numeric in `zonage_municipal` but string in `siadmin_pzon_99_s`, so the CQL
literal may need quoting on one layer (trivial at capture time).

### goAzimut MapServer — NOT-AUTOMATABLE (0 of 184)

Tested 3 distinct instances — **gis109-04 (albanel)**, **gis109-02 (baie-saint-paul)**,
**gis109-10 (bedford)** — all fail identically:

- `www.goazimut.com/<path>` → **302** to `https://www2.goazimut.com//<path>` (literal double-slash).
- www2 **double-slash** path → the goAzimut **marketing homepage** (SPA fallthrough), not ArcGIS.
- www2 **single-slash** deep paths (service root, layer, `/query`) → **404 Not Found**.

There is **no publicly reachable ArcGIS REST** at the recorded `zone_source_url`; `f=geojson`
support is moot. The GIS is fronted by the goAzimut viewer app, not direct REST. Reaching it would
require **re-discovering** a (likely token/session-proxied) live endpoint — that is source
re-discovery, **not** source-identity replay of the recorded URL, so it is outside the method.
**This single cluster (184 = 47% of the pool) drives the entire yield collapse.**

### altusquebec — AUTOMATABLE (12)

`MRC030/03005_Publique/MapServer/20`: 200 OK, Polygon, zone code `Zone` = `A-123`
(`No_zone`=123, `Nom_zone`=A, `Type_zone`=Agricole). MapServer honours `f=geojson`. 1 sample; the
`_Publique` pattern is consistent across the 12 (medium-high confidence).

### victoriaville — AUTOMATABLE (12)

All 12 share ONE URL `IntranetMRC/ZonageMunicipal/MapServer/3`, filtered per-muni by `Code_mun`.
200 OK **without a token** (despite "Intranet"): Polygon, zone code `Disposition_spéciale` = `AF8`,
`GROUPEUSAGE`=AF, `Code_mun`=39015 (Notre-Dame-de-Ham). Confirm `Disposition_spéciale` is the zone
identifier vs a special-disposition flag at capture time.

### AGOL services*.arcgis.com — AUTOMATABLE (19)

**5/5** hosted feature services returned public GeoJSON with a zone code:

- services6 osUKB2 (beaupre) `Zonage/FS/17` → `ZONE_`=`68-Ri2`
- services aaWqU4 (Témiscouata shared) `FS/0` → `ZONE`=`EAA-3`, `CODE_MUN` filter
- services8 RT1Bki **Intranet_Municipal** `FS/8` → `Sect`=`R-4` (**no token**)
- services8 GbbSw `Limite_du_zonage/FS/4` → `NUM_ZONE`=`403`/`M-403`
- services6 qVhfI6 (shared) `Zonage/FS/5` → `NO_ZONE`=`A-19`, Lambton

`f=geojson` is native to Esri hosted feature layers. Covers services(7)/6(6)/8(3)/9(1)/www.arcgis(2);
the 2 www.arcgis.com are portal item URLs needing one item→service resolution step.

## Untested small hosts (14) — excluded from the confirmed floor

sig.mrcal.ca (3, likely arcgis), portneuf.blob (3, static file?), geo.ville.alma (1, custom REST),
carte.rouyn-noranda (1), www.chelsea (1), hemmingford (1), preissac (1), st-amable (1),
saint-armand (1), stepetronille (1). Some overlap the 6 pdf-plan (georeference, not source-identity).
Yield uncertain; only partially credited in the upper bound.

## Consolidated real yield

| | Count |
|---|---:|
| Scoping upper bound (source-identity) | **376** |
| **Confirmed AUTOMATABLE floor (sampled)** | **190** |
| — geoCentralis WFS | 147 |
| — altusquebec | 12 |
| — victoriaville | 12 |
| — AGOL services* | 19 |
| **Confirmed NOT-AUTOMATABLE (goAzimut)** | **184** |
| Untested small hosts (partial credit) | ~14 |

**Realistic yield range: ~185–205** (point estimate ~195) — roughly **half** the 376 upper bound.

The 376 upper bound overstates the real source-identity yield by ~2× because it credits goAzimut's
184 arcgis-rest URLs, which do **not** resolve to a live queryable service. Everything else tested
is capturable; geoCentralis WFS (147) and the AGOL/altus/victoriaville clusters are clean wins.

## Discipline / caveats

- READ-ONLY WebFetch (not a full browser). goAzimut verdict is for the recorded URL replayed as-is;
  a browser/app-proxied backend was not probed and would be re-discovery, not source-identity.
- Single-sample clusters (altusquebec, victoriaville) = medium-high confidence via consistent pattern.
- `exceededTransferLimit=true` on 3-row samples is expected; full capture uses paging.
