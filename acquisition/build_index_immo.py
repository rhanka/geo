#!/usr/bin/env python3
"""INDEX ZERO-COPIE IMMO — geo province QC, 30 villes z∩m∩p.

Federation-first: l'index NE copie PAS la geometrie. Il reference feature_id (geoId)
+ no_lot pour qu'immo joigne aux PMTiles/cadastre de geo. Il ajoute code_zone
(point-in-polygon centroide sur grille zonage) + attrs batiment (jointure rôle foncier).

Inputs par ville (S3, lecture seule):
  1. normalized/qc-cadastre-lots/<slug>.geojson — features Polygon, props NO_LOT, geoId
  2. registry/role-foncier/<slug>.parquet — NO_LOT + role_* (jointure NO_LOT.replace(" ",""))
  3. normalized/ca-qc-zonage/<grid_slug>.geojson (18/30) — polygones props.zone_code

Sortie: registry/index-immo/<slug>.parquet (par ville) + registry/index-immo/manifest.json

ANTI-INVENTION ABSOLUE: code_zone=null si pas de grille OU centroide hors de tout
polygone; attrs batiment=null si pas de match rôle. Jamais deviner.

Idempotent: progress /tmp/index_progress.json (skip villes faites). Checkpoint par ville.
Foreground robuste, borné par --max-seconds (relancer pour continuer).
"""
import argparse
import io
import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, "/home/antoinefa/src/geo")

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import shape
from shapely.prepared import prep
from shapely.strtree import STRtree

S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
BUCKET = "sentropic-geo"
REGISTRY = "/home/antoinefa/src/_acquisition-shared/acquisition-registry.json"
GRIDS_MAP = "/home/antoinefa/src/_acquisition-shared/grids-slug-map.json"
PROG = "/tmp/index_progress.json"
SNAPSHOT = "2026-06-21"
SOURCE = "geo:cadastre-clip⋈role⋈zonage"

# Colonnes batiment issues du rôle foncier (jointure par no_lot normalisé).
ROLE_COLS = [
    "role_usage_cubf",
    "role_nb_etages_max",
    "role_annee_construction",
    "role_superficie_batiment_m2",
    "role_nb_logements",
    "role_valeur_immeuble",
]

# Schema de sortie (ordre + types pour le manifest).
OUT_SCHEMA = [
    ("feature_id", "string"),
    ("no_lot", "string"),
    ("code_zone", "string"),
    ("role_usage_cubf", "string"),
    ("role_nb_etages_max", "double"),
    ("role_annee_construction", "double"),
    ("role_superficie_batiment_m2", "double"),
    ("role_nb_logements", "double"),
    ("role_valeur_immeuble", "double"),
    ("_source", "string"),
    ("_snapshot", "string"),
]
# Types pyarrow explicites pour garder la stabilité du schéma malgré les colonnes
# entièrement nulles (anti-invention: une ville sans aucun match ne doit pas casser).
PA_FIELDS = [
    ("feature_id", pa.string()),
    ("no_lot", pa.string()),
    ("code_zone", pa.string()),
    ("role_usage_cubf", pa.string()),
    ("role_nb_etages_max", pa.float64()),
    ("role_annee_construction", pa.float64()),
    ("role_superficie_batiment_m2", pa.float64()),
    ("role_nb_logements", pa.float64()),
    ("role_valeur_immeuble", pa.float64()),
    ("_source", pa.string()),
    ("_snapshot", pa.string()),
]


def s3_client():
    env = {}
    with open(S3ENV) as f:
        for ln in f:
            ln = ln.strip()
            if "=" in ln and not ln.startswith("#"):
                k, v = ln.split("=", 1)
                env[k.strip()] = v.strip()
    return boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env.get("S3_REGION", "fr-par"),
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
    )


def get_bytes(s3, key):
    return s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def exists(s3, key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception:
        return False


def load_prog():
    try:
        return json.load(open(PROG))
    except Exception:
        return {"done": {}}


def save_prog(prog):
    json.dump(prog, open(PROG, "w"), indent=2, ensure_ascii=False)


def build_zone_index(s3, grid_slug):
    """Charge la grille zonage -> (STRtree des polygones, prepared, codes).

    Ne garde que les polygones avec un zone_code non-null (anti-invention).
    Retourne None si la grille est absente ou vide.
    """
    key = "normalized/ca-qc-zonage/%s.geojson" % grid_slug
    if not exists(s3, key):
        return None
    gj = json.loads(get_bytes(s3, key))
    geoms, codes = [], []
    for f in gj.get("features", []):
        zc = f.get("properties", {}).get("zone_code")
        g = f.get("geometry")
        if zc is None or zc == "" or g is None:
            continue
        try:
            sg = shape(g)
        except Exception:
            continue
        if sg.is_empty:
            continue
        geoms.append(sg)
        codes.append(str(zc))
    if not geoms:
        return None
    tree = STRtree(geoms)
    prepared = [prep(g) for g in geoms]
    return {"tree": tree, "prepared": prepared, "codes": codes, "n": len(geoms)}


def build_role_lookup(s3, slug):
    """Charge le parquet rôle -> dict {no_lot_normalisé: {role_col: val}}.

    Retourne ({}, 0) si le parquet est absent.
    """
    key = "registry/role-foncier/%s.parquet" % slug
    if not exists(s3, key):
        return {}, 0
    df = pq.read_table(io.BytesIO(get_bytes(s3, key))).to_pandas()
    cols = [c for c in ROLE_COLS if c in df.columns]
    df["_k"] = df["NO_LOT"].astype(str).str.replace(" ", "", regex=False)
    lookup = {}
    for rec in df[["_k"] + cols].to_dict("records"):
        k = rec.pop("_k")
        # Première occurrence gagne (clés uniques attendues).
        if k not in lookup:
            lookup[k] = rec
    return lookup, len(df)


def code_zone_for_point(zidx, pt):
    """Point-in-polygon: zone_code du 1er polygone contenant pt, sinon None."""
    if zidx is None:
        return None
    for idx in zidx["tree"].query(pt):
        if zidx["prepared"][idx].contains(pt):
            return zidx["codes"][idx]
    return None


def build_city(s3, slug, grid_slug):
    """Construit les lignes d'index pour une ville. Retourne (rows, stats)."""
    cad_key = "normalized/qc-cadastre-lots/%s.geojson" % slug
    if not exists(s3, cad_key):
        return None, {"error": "cadastre absent"}
    cad = json.loads(get_bytes(s3, cad_key))

    zidx = build_zone_index(s3, grid_slug) if grid_slug else None
    role_lookup, role_rows = build_role_lookup(s3, slug)

    rows = []
    with_zone = 0
    with_attrs = 0
    join_matched = 0
    for f in cad.get("features", []):
        p = f.get("properties", {})
        g = f.get("geometry")
        feature_id = p.get("geoId")
        no_lot = p.get("NO_LOT")
        # code_zone via centroide (representative_point garantit un point INTERNE).
        code_zone = None
        if g is not None:
            try:
                pt = shape(g).representative_point()
                code_zone = code_zone_for_point(zidx, pt)
            except Exception:
                code_zone = None
        if code_zone is not None:
            with_zone += 1
        # attrs batiment via jointure rôle (null si pas de match).
        k = str(no_lot).replace(" ", "") if no_lot is not None else None
        rec = role_lookup.get(k) if k is not None else None
        row = {
            "feature_id": feature_id,
            "no_lot": no_lot,
            "code_zone": code_zone,
            "_source": SOURCE,
            "_snapshot": SNAPSHOT,
        }
        if rec is not None:
            join_matched += 1
            any_attr = False
            for c in ROLE_COLS:
                v = rec.get(c)
                if v is not None and not (isinstance(v, float) and pd.isna(v)):
                    row[c] = v
                    any_attr = True
                else:
                    row[c] = None
            if any_attr:
                with_attrs += 1
        else:
            for c in ROLE_COLS:
                row[c] = None
        rows.append(row)

    n = len(rows)
    stats = {
        "lots": n,
        "with_code_zone": with_zone,
        "with_building_attrs": with_attrs,
        "join_matched": join_matched,
        "code_zone_pct": round(100 * with_zone / n, 2) if n else 0.0,
        "building_pct": round(100 * with_attrs / n, 2) if n else 0.0,
        "join_pct": round(100 * join_matched / n, 2) if n else 0.0,
        "has_grid": bool(zidx),
        "grid_slug": grid_slug,
        "zone_polys": zidx["n"] if zidx else 0,
        "role_rows": role_rows,
    }
    return rows, stats


def write_parquet(rows, path):
    # Normalise les types role_usage_cubf en string (peut être int dans le rôle).
    arrays = {}
    for name, _ in PA_FIELDS:
        arrays[name] = [r.get(name) for r in rows]
    # role_usage_cubf -> string
    arrays["role_usage_cubf"] = [
        None if v is None or (isinstance(v, float) and pd.isna(v)) else str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
        for v in arrays["role_usage_cubf"]
    ]
    schema = pa.schema(PA_FIELDS)
    cols = {}
    for name, typ in PA_FIELDS:
        cols[name] = pa.array(arrays[name], type=typ)
    table = pa.table(cols, schema=schema)
    pq.write_table(table, path, compression="zstd")
    return table.num_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=int, default=540)
    ap.add_argument("--only", help="slug unique (test)")
    ap.add_argument("--no-upload", action="store_true", help="dry-run local, pas d'upload S3")
    ap.add_argument("--force", action="store_true", help="ignore le progress (rebuild)")
    a = ap.parse_args()

    s3 = s3_client()
    registry = json.load(open(REGISTRY))
    grids = json.load(open(GRIDS_MAP))
    cities = list(registry.keys())
    if a.only:
        cities = [c for c in cities if c == a.only]

    prog = load_prog()
    if a.force:
        prog = {"done": {}}
    os.makedirs("/tmp/index_immo", exist_ok=True)
    t0 = time.time()

    for slug in cities:
        if slug in prog["done"] and not a.force:
            print("SKIP(done) %s" % slug)
            continue
        if time.time() - t0 > a.max_seconds:
            print("STOP wall-clock; relancer pour continuer")
            break
        grid_slug = grids.get(slug)
        try:
            rows, stats = build_city(s3, slug, grid_slug)
        except Exception as e:
            print("FAIL-BUILD %-44s %s" % (slug, e))
            time.sleep(1)
            continue
        if rows is None:
            print("FAIL %-44s %s" % (slug, stats.get("error")))
            continue
        path = "/tmp/index_immo/%s.parquet" % slug
        nrows = write_parquet(rows, path)
        if not a.no_upload:
            s3.upload_file(path, BUCKET, "registry/index-immo/%s.parquet" % slug)
        print(
            "OK  %-44s lots=%-6d code_zone=%5.1f%% building=%5.1f%% join=%5.1f%% grid=%s"
            % (slug, nrows, stats["code_zone_pct"], stats["building_pct"], stats["join_pct"], "Y" if stats["has_grid"] else "-")
        )
        prog["done"][slug] = stats
        save_prog(prog)
        time.sleep(0.2)

    print("=== chunk fin (%d/%d done) ===" % (len(prog["done"]), len(registry)))


if __name__ == "__main__":
    main()
