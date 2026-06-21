#!/usr/bin/env python3
"""
batch_role_foncier_30.py — Batch rôle foncier MAMH pour les 30 villes z∩m∩p d'immo.

Traite 29 villes (saint-raymond déjà fait), produit un parquet par ville sur S3.
Écrit les résultats au fur et à mesure dans /tmp/role-batch-30-results.json.
"""

import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, "/home/antoinefa/src/geo")

from acquisition.role_foncier import (
    fetch_index,
    fetch_role,
    parse_role,
    join_lots_role,
    upload_parquet_s3,
    _slugify,
)

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import io
import json as _json

S3_ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
RESULTS_FILE = "/tmp/role-batch-30-results.json"
CACHE_DIR = Path("/tmp/role-xml-cache")
CACHE_DIR.mkdir(exist_ok=True)

TARGETS = [
    "mont-tremblant",
    "saint-frederic",
    "rimouski",
    "preissac",
    "saint-raphael",
    "sainte-cecile-de-milton",
    "chelsea",
    "saint-amable",
    "saint-stanislas-de-kostka",
    "cowansville",
    "champlain",
    "saint-charles-borromee",
    "saint-come-liniere",
    "saint-mathieu-de-beloeil",
    "coaticook",
    "saint-gilbert",
    "rosemere",
    "stratford",
    "plaisance",
    "notre-dame-de-lourdes--lerable",
    "neuville",
    "petite-riviere-saint-francois",
    "hemmingford--les-jardins-de-napierville--2",
    "la-sarre",
    "saint-boniface",
    "mont-saint-hilaire",
    "alma",
    "sutton",
    "sainte-catherine",
]

# Overrides manuels : slug → code_geo (quand l'index CKAN ne matche pas directement
# à cause de caractères accentués non-ASCII dans le slug normalisé)
CODE_GEO_OVERRIDES = {
    "saint-frederic":               "27065",  # Saint-Frédéric (index: 'saint-frdric')
    "saint-raphael":                "19082",  # Saint-Raphaël (index: 'saint-raphal')
    "sainte-cecile-de-milton":      "47055",  # Sainte-Cécile-de-Milton (index: 'sainte-ccile-de-milton')
    "saint-come-liniere":           "29057",  # Saint-Côme--Linière (index: 'saint-cme--linire')
    "rosemere":                     "73020",  # Rosemère (index: 'rosemre')
    "petite-riviere-saint-francois":"16005",  # Petite-Rivière-Saint-François (index: 'petite-rivire-saint-franois')
    "notre-dame-de-lourdes--lerable": "61045", # NDL MRC L'Érable (lon -71.82 = L'Érable, PAS Drummond 32080)
}

# saint-raymond already done, add it as pre-filled
PRE_DONE = {
    "saint-raymond": {
        "slug": "saint-raymond",
        "code_geo": "34128",
        "nom_officiel": "Saint-Raymond",
        "n_lots": 1314,
        "n_matched": 1236,
        "coverage_pct": 94.1,
        "status": "OK",
        "s3_key": "registry/role-foncier/saint-raymond.parquet",
        "note": "Pilote déjà fait",
    }
}


def load_s3_client():
    env = {}
    with open(S3_ENV) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v
    s3 = boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env["S3_REGION"],
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
    )
    return s3, env["S3_BUCKET"]


def fetch_lots_geojson(slug, s3, bucket):
    """Fetch lots GeoJSON from S3 normalized/qc-cadastre-lots/<slug>.geojson"""
    key = f"normalized/qc-cadastre-lots/{slug}.geojson"
    buf = io.BytesIO()
    s3.download_fileobj(bucket, key, buf)
    buf.seek(0)
    return _json.loads(buf.read().decode("utf-8"))


def upload_parquet(enriched_fc, slug, s3, bucket):
    """Export enriched GeoJSON to parquet and upload to S3."""
    rows = []
    for feat in enriched_fc["features"]:
        row = dict(feat.get("properties") or {})
        geom = feat.get("geometry")
        if geom:
            row["_geom_type"] = geom.get("type")
            row["_geometry_json"] = _json.dumps(geom)
        rows.append(row)
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, buf)
    buf.seek(0)
    s3_key = f"registry/role-foncier/{slug}.parquet"
    s3.upload_fileobj(buf, bucket, s3_key)
    return s3_key


def save_results(results):
    with open(RESULTS_FILE, "w") as f:
        _json.dump(results, f, ensure_ascii=False, indent=2)


def process_city(slug, index, s3, bucket):
    """Process one city. Returns a result dict."""
    print(f"\n{'='*60}")
    print(f"Processing: {slug}")

    # 1. Resolve code_geo
    slug_normalized = _slugify(slug)
    entry = None
    matched_by = None

    # Check manual override first (needed for accented names)
    if slug in CODE_GEO_OVERRIDES:
        override_code = CODE_GEO_OVERRIDES[slug]
        if override_code in index:
            entry = index[override_code]
            matched_by = f"override:{override_code}"

    if entry is None:
        # Try direct slug match, then slugify variation, then dedash
        for key in [slug, slug_normalized, slug.replace("--", "-")]:
            if key in index:
                entry = index[key]
                matched_by = f"key:{key}"
                break

    if entry is None:
        # Try partial match (hemmingford, etc.)
        for idx_key, idx_val in index.items():
            if slug_normalized in idx_key or idx_key in slug_normalized:
                if len(idx_key) > 5:  # avoid short spurious matches
                    entry = idx_val
                    matched_by = f"partial:{idx_key}"
                    break

    if entry is None:
        return {
            "slug": slug,
            "code_geo": None,
            "nom_officiel": None,
            "n_lots": None,
            "n_matched": None,
            "coverage_pct": None,
            "status": "ERREUR",
            "s3_key": None,
            "note": f"code_geo introuvable dans index CKAN pour slug '{slug}'",
        }

    code_geo = entry["code_geo"]
    nom_officiel = entry["nom"]
    print(f"  → code_geo={code_geo}, nom='{nom_officiel}' (via {matched_by})")

    # 2. Download XML (with cache)
    cache_path = CACHE_DIR / f"RL{code_geo}_2026.xml"
    try:
        print(f"  → Téléchargement XML...")
        t0 = time.time()
        xml_bytes = fetch_role(code_geo, millesime=2026, cache_path=cache_path)
        elapsed = time.time() - t0
        xml_mb = len(xml_bytes) / 1024 / 1024
        print(f"  → XML {xml_mb:.2f} MB en {elapsed:.1f}s")
    except Exception as e:
        return {
            "slug": slug,
            "code_geo": code_geo,
            "nom_officiel": nom_officiel,
            "n_lots": None,
            "n_matched": None,
            "coverage_pct": None,
            "status": "ERREUR",
            "s3_key": None,
            "note": f"Erreur téléchargement XML: {e}",
        }

    # 3. Parse XML
    try:
        print(f"  → Parsing XML...")
        t0 = time.time()
        lookup = parse_role(xml_bytes)
        elapsed = time.time() - t0
        print(f"  → {len(lookup)} matricules uniques en {elapsed:.1f}s")
    except Exception as e:
        return {
            "slug": slug,
            "code_geo": code_geo,
            "nom_officiel": nom_officiel,
            "n_lots": None,
            "n_matched": None,
            "coverage_pct": None,
            "status": "ERREUR",
            "s3_key": None,
            "note": f"Erreur parsing XML: {e}",
        }

    # 4. Load lots GeoJSON from S3
    try:
        print(f"  → Chargement lots S3...")
        lots_fc = fetch_lots_geojson(slug, s3, bucket)
        n_lots = len(lots_fc.get("features", []))
        print(f"  → {n_lots} lots chargés")
    except Exception as e:
        return {
            "slug": slug,
            "code_geo": code_geo,
            "nom_officiel": nom_officiel,
            "n_lots": None,
            "n_matched": None,
            "coverage_pct": None,
            "status": "ERREUR",
            "s3_key": None,
            "note": f"Erreur chargement lots S3: {e}",
        }

    # 5. Join
    try:
        print(f"  → Jointure lots ↔ rôle...")
        enriched_fc, stats = join_lots_role(lots_fc, lookup)
        n_matched = stats["lots_matched_role"]
        coverage = stats["coverage_pct"]
        print(f"  → {n_matched}/{n_lots} = {coverage}% match")
    except Exception as e:
        return {
            "slug": slug,
            "code_geo": code_geo,
            "nom_officiel": nom_officiel,
            "n_lots": n_lots,
            "n_matched": None,
            "coverage_pct": None,
            "status": "ERREUR",
            "s3_key": None,
            "note": f"Erreur jointure: {e}",
        }

    # 6. Upload parquet to S3
    try:
        print(f"  → Upload S3...")
        s3_key = upload_parquet(enriched_fc, slug, s3, bucket)
        print(f"  → Déposé: s3://sentropic-geo/{s3_key}")
    except Exception as e:
        return {
            "slug": slug,
            "code_geo": code_geo,
            "nom_officiel": nom_officiel,
            "n_lots": n_lots,
            "n_matched": n_matched,
            "coverage_pct": coverage,
            "status": "ERREUR-UPLOAD",
            "s3_key": None,
            "note": f"Jointure OK mais erreur upload S3: {e}",
        }

    return {
        "slug": slug,
        "code_geo": code_geo,
        "nom_officiel": nom_officiel,
        "n_lots": n_lots,
        "n_matched": n_matched,
        "coverage_pct": coverage,
        "status": "OK",
        "s3_key": s3_key,
        "note": f"XML {xml_mb:.1f}MB · {len(lookup)} matricules rôle",
    }


def main():
    print("=== BATCH RÔLE FONCIER — 30 villes z∩m∩p ===")
    print(f"Résultats en temps réel: {RESULTS_FILE}")

    # Initialize results with pre-done
    results = dict(PRE_DONE)
    save_results(results)

    # Load index once
    print("\nChargement index CKAN...")
    try:
        index = fetch_index(millesime=2026)
        print(f"Index chargé: {len(index)} entrées")
    except Exception as e:
        print(f"ERREUR chargement index: {e}")
        sys.exit(1)

    # Load S3 client
    s3, bucket = load_s3_client()

    # Process each city
    for i, slug in enumerate(TARGETS):
        print(f"\n[{i+1}/{len(TARGETS)}] {slug}")
        try:
            result = process_city(slug, index, s3, bucket)
        except Exception as e:
            result = {
                "slug": slug,
                "code_geo": None,
                "nom_officiel": None,
                "n_lots": None,
                "n_matched": None,
                "coverage_pct": None,
                "status": "ERREUR",
                "s3_key": None,
                "note": f"Exception inattendue: {traceback.format_exc()}",
            }
        results[slug] = result
        save_results(results)  # Write after each city
        print(f"  Statut: {result['status']} — sauvegardé.")

    print("\n=== BILAN FINAL ===")
    ok = [r for r in results.values() if r["status"] == "OK"]
    err = [r for r in results.values() if r["status"] != "OK"]
    print(f"OK: {len(ok)}/30")
    print(f"Erreurs: {len(err)}/30")
    if err:
        for r in err:
            print(f"  ERREUR {r['slug']}: {r['note']}")

    coverages = [r["coverage_pct"] for r in ok if r["coverage_pct"] is not None]
    if coverages:
        print(f"Coverage moyenne: {sum(coverages)/len(coverages):.1f}%")

    return results


if __name__ == "__main__":
    main()
