#!/usr/bin/env python3
"""
lot_attrs_geom.py — Calcul des attributs géométriques de lots cadastraux.

Pour un GeoJSON de lots WGS84 (EPSG:4326), calcule par lot :
  - superficie_m2   : aire en m²  (reprojeté MTM/UTM)
  - perimetre_m     : périmètre en m
  - frontage_m      : estimation du frontage (côté le plus court du rectangle
                      orienté minimal — heuristique sans voirie)
  - profondeur_m    : côté le plus long du rectangle orienté minimal

Contrainte anti-invention :
  Si un attribut n'est pas calculable de façon fiable, on retourne null.
  On ne génère JAMAIS de valeur inventée.

Projection :
  On choisit la projection métrique locale optimale selon la longitude centroïde :
    MTM Zone 7  (EPSG:32187) : lon < -70.5°  (Québec centre/ouest)
    MTM Zone 8  (EPSG:32188) : lon >= -70.5° (Québec est)
  Fallback : UTM Zone 18N (EPSG:32618) si MTM hors plage.

Frontage — note de fiabilité :
  L'heuristique « côté court du rectangle orienté minimal » est une ESTIMATION.
  Elle suppose que le lot est globalement rectangulaire et que la rue est du
  côté court. Cette hypothèse tient bien pour les lots urbains et de banlieue
  QC (bandes longues perpendiculaires à la rue). Elle est moins fiable pour :
    - lots de coin (2 façades)
    - lots irréguliers / ruraux larges
    - lots en drapeau
  Pour le frontage EXACT, il faudrait croiser avec AQréseau (réseau routier
  officiel MTQ) : segment de rue adjacent au lot, longueur de l'intersection.
  → Recommandation : acquérir AQréseau pour le frontage exact (cf. rapport).

Usage CLI :
  python lot_attrs_geom.py <input.geojson> <output.geojson>
  python lot_attrs_geom.py <input.geojson> <output.parquet>   # si pyarrow dispo

Usage module :
  from acquisition.lot_attrs_geom import compute_lot_attrs_geojson
  result_fc, stats = compute_lot_attrs_geojson(feature_collection)
"""

import json
import math
import sys
from typing import Any

from pyproj import Transformer, CRS
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform


# ---------------------------------------------------------------------------
# Projection helpers
# ---------------------------------------------------------------------------

def _choose_epsg(lon: float) -> int:
    """Choisit l'EPSG métrique local selon la longitude centroïde.

    MTM zones QC (meridiens centraux) :
      Zone 10 (EPSG:32190) : CM -79.5°, couvre ~-78° à -81°
      Zone 9  (EPSG:32189) : CM -76.5°, couvre ~-75° à -78°
      Zone 8  (EPSG:32188) : CM -73.5°, couvre ~-72° à -75°
      Zone 7  (EPSG:32187) : CM -70.5°, couvre ~-69° à -72°
    On choisit la zone dont le méridien central est le plus proche de la longitude.
    Hors plage MTM (<-81° ou >-67.5°) : fallback UTM.
    """
    if lon < -79.5:
        # Zone 10 ou UTM 17N si encore plus à l'ouest
        if lon < -82.5:
            return 32617  # UTM 17N
        return 32190  # MTM Zone 10
    elif lon < -76.5:
        return 32189  # MTM Zone 9  (CM -76.5)
    elif lon < -73.5:
        return 32188  # MTM Zone 8  (CM -73.5, couvre -72 à -75)
    elif lon < -70.5:
        return 32187  # MTM Zone 7  (CM -70.5, couvre -69 à -72)
    else:
        return 32619  # UTM 19N (extrême est QC / Gaspésie)


_transformer_cache: dict[int, Transformer] = {}


def _make_transformer(epsg_target: int) -> Transformer:
    """Retourne un Transformer WGS84 → cible (always_xy). Cache par EPSG."""
    if epsg_target not in _transformer_cache:
        _transformer_cache[epsg_target] = Transformer.from_crs(
            "EPSG:4326", f"EPSG:{epsg_target}", always_xy=True
        )
    return _transformer_cache[epsg_target]


def _reproject_geom(geom, transformer: Transformer):
    """Reprojette une géométrie shapely via un Transformer pyproj."""
    return shapely_transform(transformer.transform, geom)


# ---------------------------------------------------------------------------
# Geometric attributes for a single lot
# ---------------------------------------------------------------------------

def _lot_centroid_lon(geom) -> float:
    """Longitude du centroïde d'une géométrie WGS84."""
    c = geom.centroid
    return c.x  # always_xy → x = longitude


def _oriented_bbox_sides(geom_m) -> tuple[float | None, float | None]:
    """
    Retourne (frontage_m, profondeur_m) depuis le rectangle orienté minimal.

    frontage  = côté le plus COURT (hypothèse : face à la rue)
    profondeur = côté le plus LONG

    Retourne (None, None) si le calcul échoue.
    """
    try:
        mrr = geom_m.minimum_rotated_rectangle
        coords = list(mrr.exterior.coords)
        # 5 coords (ring fermé) → 4 côtés
        sides = []
        for i in range(len(coords) - 1):
            dx = coords[i + 1][0] - coords[i][0]
            dy = coords[i + 1][1] - coords[i][1]
            sides.append(math.sqrt(dx * dx + dy * dy))
        if not sides:
            return None, None
        s_min = round(min(sides), 2)
        s_max = round(max(sides), 2)
        return s_min, s_max
    except Exception:
        return None, None


def compute_lot_attrs(feature: dict) -> dict:
    """
    Calcule les attributs géométriques d'un feature GeoJSON (lot cadastral).

    Retourne un dict avec les clés :
      no_lot, superficie_m2, perimetre_m, frontage_m, profondeur_m,
      _epsg_used, _geom_type
    Les valeurs null indiquent un attribut non calculable.
    """
    props = feature.get("properties") or {}
    no_lot = (
        props.get("NO_LOT")
        or props.get("noLot")
        or props.get("no_lot")
        or props.get("NOLOT")
        or props.get("id")
    )

    geom_raw = feature.get("geometry")
    if geom_raw is None:
        return {
            "no_lot": no_lot,
            "superficie_m2": None,
            "perimetre_m": None,
            "frontage_m": None,
            "profondeur_m": None,
            "_epsg_used": None,
            "_geom_type": None,
        }

    try:
        geom_wgs84 = shape(geom_raw)
    except Exception:
        return {
            "no_lot": no_lot,
            "superficie_m2": None,
            "perimetre_m": None,
            "frontage_m": None,
            "profondeur_m": None,
            "_epsg_used": None,
            "_geom_type": "parse_error",
        }

    if geom_wgs84.is_empty or not geom_wgs84.is_valid:
        # Tenter un buffer(0) pour réparer les auto-intersections légères
        try:
            geom_wgs84 = geom_wgs84.buffer(0)
        except Exception:
            pass
        if geom_wgs84.is_empty or not geom_wgs84.is_valid:
            return {
                "no_lot": no_lot,
                "superficie_m2": None,
                "perimetre_m": None,
                "frontage_m": None,
                "profondeur_m": None,
                "_epsg_used": None,
                "_geom_type": "invalid",
            }

    lon = _lot_centroid_lon(geom_wgs84)
    epsg = _choose_epsg(lon)
    transformer = _make_transformer(epsg)

    try:
        geom_m = _reproject_geom(geom_wgs84, transformer)
    except Exception:
        return {
            "no_lot": no_lot,
            "superficie_m2": None,
            "perimetre_m": None,
            "frontage_m": None,
            "profondeur_m": None,
            "_epsg_used": epsg,
            "_geom_type": geom_raw.get("type"),
        }

    superficie = round(geom_m.area, 2) if geom_m.area > 0 else None
    perimetre = round(geom_m.length, 2) if geom_m.length > 0 else None
    frontage, profondeur = _oriented_bbox_sides(geom_m)

    return {
        "no_lot": no_lot,
        "superficie_m2": superficie,
        "perimetre_m": perimetre,
        "frontage_m": frontage,
        "profondeur_m": profondeur,
        "_epsg_used": epsg,
        "_geom_type": geom_raw.get("type"),
    }


# ---------------------------------------------------------------------------
# Batch: FeatureCollection
# ---------------------------------------------------------------------------

def compute_lot_attrs_geojson(
    fc: dict,
    include_geom: bool = True,
) -> tuple[dict, dict]:
    """
    Calcule les attributs géométriques pour tous les lots d'un FeatureCollection.

    Paramètres :
      fc          : FeatureCollection GeoJSON
      include_geom: si True, les géométries originales sont conservées dans
                    le GeoJSON de sortie

    Retourne :
      (output_fc, stats) où output_fc est un FeatureCollection enrichi et
      stats est un dict de couverture/métriques.
    """
    features_in = fc.get("features", [])
    features_out = []
    n_total = len(features_in)
    n_superficie = 0
    n_perimetre = 0
    n_frontage = 0
    n_profondeur = 0
    n_null_geom = 0

    for feat in features_in:
        attrs = compute_lot_attrs(feat)

        # Nouvelles propriétés enrichies
        new_props = dict(feat.get("properties") or {})
        new_props["superficie_m2"] = attrs["superficie_m2"]
        new_props["perimetre_m"] = attrs["perimetre_m"]
        new_props["frontage_m"] = attrs["frontage_m"]
        new_props["profondeur_m"] = attrs["profondeur_m"]
        new_props["_epsg_used"] = attrs["_epsg_used"]

        new_feat: dict[str, Any] = {
            "type": "Feature",
            "properties": new_props,
        }
        if include_geom:
            new_feat["geometry"] = feat.get("geometry")
        else:
            new_feat["geometry"] = None

        features_out.append(new_feat)

        # Compteurs couverture
        if attrs["superficie_m2"] is not None:
            n_superficie += 1
        if attrs["perimetre_m"] is not None:
            n_perimetre += 1
        if attrs["frontage_m"] is not None:
            n_frontage += 1
        if attrs["profondeur_m"] is not None:
            n_profondeur += 1
        if feat.get("geometry") is None:
            n_null_geom += 1

    output_fc = {
        "type": "FeatureCollection",
        "crs": fc.get("crs"),
        "features": features_out,
    }

    def pct(n: int) -> str:
        return f"{100 * n / n_total:.1f}%" if n_total > 0 else "N/A"

    stats = {
        "n_total": n_total,
        "n_null_geom": n_null_geom,
        "n_superficie": n_superficie,
        "n_perimetre": n_perimetre,
        "n_frontage": n_frontage,
        "n_profondeur": n_profondeur,
        "pct_superficie": pct(n_superficie),
        "pct_perimetre": pct(n_perimetre),
        "pct_frontage": pct(n_frontage),
        "pct_profondeur": pct(n_profondeur),
    }

    return output_fc, stats


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print(
            "Usage: python lot_attrs_geom.py <input.geojson> <output.geojson|output.parquet>",
            file=sys.stderr,
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    print(f"[lot_attrs_geom] Lecture : {input_path}", file=sys.stderr)
    with open(input_path, encoding="utf-8") as f:
        fc = json.load(f)

    print(f"[lot_attrs_geom] Calcul attributs géométriques…", file=sys.stderr)
    output_fc, stats = compute_lot_attrs_geojson(fc, include_geom=True)

    print("[lot_attrs_geom] Couverture :", file=sys.stderr)
    for k, v in stats.items():
        print(f"  {k}: {v}", file=sys.stderr)

    if output_path.endswith(".parquet"):
        try:
            import pandas as pd
            import pyarrow as pa
            import pyarrow.parquet as pq

            rows = []
            for feat in output_fc["features"]:
                p = feat.get("properties") or {}
                rows.append(
                    {
                        "no_lot": p.get("no_lot") or p.get("NO_LOT"),
                        "superficie_m2": p.get("superficie_m2"),
                        "perimetre_m": p.get("perimetre_m"),
                        "frontage_m": p.get("frontage_m"),
                        "profondeur_m": p.get("profondeur_m"),
                    }
                )
            df = pd.DataFrame(rows)
            table = pa.Table.from_pandas(df)
            pq.write_table(table, output_path)
            print(f"[lot_attrs_geom] Parquet écrit : {output_path}", file=sys.stderr)
        except ImportError:
            print(
                "[lot_attrs_geom] pyarrow non disponible, écriture GeoJSON à la place.",
                file=sys.stderr,
            )
            output_path = output_path.replace(".parquet", ".geojson")
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(output_fc, f, ensure_ascii=False)
            print(f"[lot_attrs_geom] GeoJSON écrit : {output_path}", file=sys.stderr)
    else:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output_fc, f, ensure_ascii=False)
        print(f"[lot_attrs_geom] GeoJSON écrit : {output_path}", file=sys.stderr)

    print("[lot_attrs_geom] Terminé.", file=sys.stderr)


if __name__ == "__main__":
    main()
