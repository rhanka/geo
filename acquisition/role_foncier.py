#!/usr/bin/env python3
"""
role_foncier.py — Parse du Rôle d'évaluation foncière du Québec (MAMH).

Source : Données Québec / MAMH, « Rôles d'évaluation foncière du Québec »
URL index : https://donneesouvertes.affmunqc.net/role/indexRole2026.csv
Format : XML par municipalité (RL{code_geo}_{millesime}.xml)
Version répertoire supportée : 2.5 / 2.8

Ce module :
  1. Télécharge l'index CSV (liste des 1134 municipalités + URL XML)
  2. Pour une municipalité donnée (code géo ou slug), télécharge le fichier XML
  3. Parse les unités d'évaluation → attributs bâtiment normalisés
  4. Produit un dict { matricule → attrs } + un GeoJSON/Parquet de jointure

Champs bâtiment extraits (anti-invention : null si absent dans la source) :
  - usage_cubf         : RL0105A — Code d'utilisation prédominante (CUBF)
  - nb_etages_max      : RL0306A — Nombre maximal d'étages des bâtiments
  - annee_construction : RL0307A — Millésime année construction originelle
  - annee_est_reelle   : RL0307B — 'R' (réelle) ou 'E' (estimée)
  - superficie_batiment_m2 : RL0308A — Aire d'étages du bâtiment principal
  - nb_logements       : RL0311A — Nombre total de logements de l'unité
  - nb_locaux_non_resid: RL0313A — Nombre total de locaux non résidentiels
  - superficie_terrain_m2  : RL0302A — Superficie du terrain portée au rôle
  - frontage_role_m    : RL0301A — Dimension linéaire du terrain en front
  - valeur_terrain     : RL0402A — Valeur du terrain inscrite au rôle
  - valeur_batiment    : RL0403A — Valeur du ou des bâtiments inscrite au rôle
  - valeur_immeuble    : RL0404A — Valeur de l'immeuble inscrite au rôle

Clé de liaison cadastre ↔ rôle :
  RL0103Ax = matricule cadastral = NO_LOT (sans espaces, format numérique 7 chiffres)
  Jointure : NO_LOT.replace(' ', '') == RL0103Ax

Granularité :
  1 fichier XML par municipalité (1134 munis en 2026).
  Une unité d'évaluation peut référencer N lots (RL0103Ax × N).
  Un lot peut apparaître dans plusieurs unités (ex. condo), on prend la première
  avec bâtiment si possible (heuristique).

Usage CLI :
  python role_foncier.py <code_geo> [--millesime 2026] [--output /tmp/out.parquet]
  python role_foncier.py saint-raymond --lots /path/lots.geojson --output out.parquet

Usage module :
  from acquisition.role_foncier import fetch_role, parse_role, join_lots_role
  role_data = fetch_role('34128', millesime=2026)
  lookup = parse_role(role_data)
  enriched_fc, stats = join_lots_role(lots_fc, lookup)
"""

import csv
import io
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

INDEX_URL_TEMPLATE = (
    "https://donneesouvertes.affmunqc.net/role/indexRole{millesime}.csv"
)
XML_URL_TEMPLATE = (
    "https://donneesouvertes.affmunqc.net/role/RL{code_geo}_{millesime}.xml"
)
DEFAULT_MILLESIME = 2026

# Source metadata pour traçabilité
SOURCE_ID = "mamh-role-foncier"
SOURCE_URL = "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec"
LICENSE = "CC BY 4.0"  # Licence ouverte, source MAMH / Données Québec


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

def fetch_index(millesime: int = DEFAULT_MILLESIME) -> Dict[str, Dict]:
    """
    Télécharge l'index CSV et retourne un dict :
      { nom_normalise → {code_geo, nom, url} }
      { code_geo      → {code_geo, nom, url} }

    Exemple d'accès :
      index['saint-raymond'] → {'code_geo': '34128', 'nom': 'Saint-Raymond', 'url': ...}
      index['34128']         → idem
    """
    url = INDEX_URL_TEMPLATE.format(millesime=millesime)
    with urllib.request.urlopen(url, timeout=30) as r:
        content = r.read().decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(content))
    result = {}
    for row in reader:
        code_geo = row.get("code géographique", "").strip()
        nom = row.get("nom du territoire", "").strip()
        lien = row.get("lien", "").strip()
        if not code_geo:
            continue
        entry = {"code_geo": code_geo, "nom": nom, "url": lien}
        result[code_geo] = entry
        slug = _slugify(nom)
        result[slug] = entry

    return result


def _slugify(name: str) -> str:
    """Normalise un nom de municipalité en slug lowercase sans accents."""
    import unicodedata
    nfc = unicodedata.normalize("NFC", name)
    ascii_name = nfc.encode("ascii", "ignore").decode("ascii")
    return ascii_name.lower().replace(" ", "-").replace("'", "-").replace("'", "-")


def resolve_muni(key: str, millesime: int = DEFAULT_MILLESIME) -> Dict:
    """
    Résout un code_geo numérique ou un slug vers l'entrée de l'index.
    Lève ValueError si non trouvé.
    """
    index = fetch_index(millesime)
    if key in index:
        return index[key]
    # Essai slug normalisé
    slug = _slugify(key)
    if slug in index:
        return index[slug]
    raise ValueError(
        f"Municipalité '{key}' non trouvée dans l'index {millesime}. "
        f"Vérifier le code géo (ex. '34128') ou le nom (ex. 'Saint-Raymond')."
    )


# ---------------------------------------------------------------------------
# Téléchargement XML
# ---------------------------------------------------------------------------

def fetch_role(
    code_geo: str,
    millesime: int = DEFAULT_MILLESIME,
    cache_path: Optional[Path] = None,
) -> bytes:
    """
    Télécharge le fichier XML du rôle pour une municipalité.
    Si cache_path est fourni et existe, relit depuis le cache.

    Args:
        code_geo   : code géographique ISQ de la municipalité (ex. '34128')
        millesime  : année du rôle (2024, 2025, 2026)
        cache_path : chemin local où cacher le XML téléchargé

    Returns:
        Contenu XML brut (bytes)
    """
    if cache_path and Path(cache_path).exists():
        with open(cache_path, "rb") as f:
            return f.read()

    url = XML_URL_TEMPLATE.format(code_geo=code_geo, millesime=millesime)
    with urllib.request.urlopen(url, timeout=120) as r:
        content = r.read()

    if cache_path:
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "wb") as f:
            f.write(content)

    return content


# ---------------------------------------------------------------------------
# Parsing XML → lookup matricule
# ---------------------------------------------------------------------------

def _safe_int(val: Optional[str]) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _safe_float(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def parse_role(xml_bytes: bytes) -> Dict[str, Dict]:
    """
    Parse un fichier XML de rôle foncier MAMH.

    Retourne un dict { matricule → attrs_batiment }.
    Les attributs absents sont None (jamais inventés).

    Structure XML :
      <RL>
        <VERSION>2.8</VERSION>
        <RLM01A>34128</RLM01A>  ← code_geo
        <RLM02A>2025</RLM02A>   ← millésime
        <RLUEx>                  ← unité d'évaluation (répété N fois)
          <RL0103><RL0103x><RL0103Ax>4623401</RL0103Ax>...</RL0103x></RL0103>
          <RL0105A>1000</RL0105A>       ← CUBF
          <RL0306A>1</RL0306A>           ← nb étages max
          <RL0307A>1983</RL0307A>        ← année construction
          <RL0307B>R</RL0307B>           ← R=réelle, E=estimée
          <RL0308A>182.3</RL0308A>       ← superficie bâtiment m²
          <RL0311A>1</RL0311A>           ← nb logements
          <RL0313A>1</RL0313A>           ← nb locaux non résidentiels
          <RL0302A>90538.70</RL0302A>    ← superficie terrain m²
          <RL0301A>290.16</RL0301A>      ← frontage (rôle)
          <RL0402A>83700</RL0402A>       ← valeur terrain
          <RL0403A>201800</RL0403A>      ← valeur bâtiment
          <RL0404A>285500</RL0404A>      ← valeur immeuble
        </RLUEx>
        ...
      </RL>
    """
    root = ET.fromstring(xml_bytes)

    code_geo = root.findtext("RLM01A") or ""
    millesime = root.findtext("RLM02A") or ""

    lookup: Dict[str, Dict] = {}

    for unit in root.findall("RLUEx"):
        # Matricules (peut en avoir plusieurs par unité)
        rl0103 = unit.find("RL0103")
        matricules: List[str] = []
        if rl0103 is not None:
            for x in rl0103.findall("RL0103x"):
                ax = x.find("RL0103Ax")
                if ax is not None and ax.text:
                    matricules.append(ax.text.strip())

        if not matricules:
            continue

        # Attributs bâtiment — verbatim depuis la source, null si absent
        attrs: Dict[str, Any] = {
            # Identification
            "usage_cubf":              unit.findtext("RL0105A"),
            # Bâtiment
            "nb_etages_max":           _safe_int(unit.findtext("RL0306A")),
            "annee_construction":      _safe_int(unit.findtext("RL0307A")),
            "annee_est_reelle":        unit.findtext("RL0307B"),   # 'R' ou 'E'
            "superficie_batiment_m2":  _safe_float(unit.findtext("RL0308A")),
            "nb_logements":            _safe_int(unit.findtext("RL0311A")),
            "nb_locaux_non_resid":     _safe_int(unit.findtext("RL0313A")),
            # Terrain (rôle — peut différer du cadastre)
            "superficie_terrain_m2_role": _safe_float(unit.findtext("RL0302A")),
            "frontage_role_m":         _safe_float(unit.findtext("RL0301A")),
            # Valeurs au rôle
            "valeur_terrain":          _safe_float(unit.findtext("RL0402A")),
            "valeur_batiment":         _safe_float(unit.findtext("RL0403A")),
            "valeur_immeuble":         _safe_float(unit.findtext("RL0404A")),
            # Provenance
            "_source":                 SOURCE_ID,
            "_source_code_geo":        code_geo,
            "_source_millesime":       millesime,
        }

        for matricule in matricules:
            if matricule not in lookup:
                lookup[matricule] = attrs
            elif (
                attrs["superficie_batiment_m2"] is not None
                and lookup[matricule]["superficie_batiment_m2"] is None
            ):
                # Prioritise l'entrée avec données bâtiment
                lookup[matricule] = attrs

    return lookup


# ---------------------------------------------------------------------------
# Jointure lots cadastraux ↔ rôle
# ---------------------------------------------------------------------------

def join_lots_role(
    lots_fc: Dict,
    role_lookup: Dict[str, Dict],
    lot_id_field: str = "NO_LOT",
) -> Tuple[Dict, Dict]:
    """
    Joint un GeoJSON de lots cadastraux (WGS84) avec le lookup du rôle.

    Le NO_LOT dans le cadastre QC utilise des espaces comme séparateurs
    de milliers (ex. '4 623 401'). Le matricule dans le rôle n'en a pas
    ('4623401'). On normalise en supprimant les espaces avant la jointure.

    Args:
        lots_fc      : GeoJSON FeatureCollection de lots cadastraux
        role_lookup  : dict retourné par parse_role()
        lot_id_field : nom du champ identifiant le lot (défaut: 'NO_LOT')

    Returns:
        (enriched_fc, stats) où :
          enriched_fc : FeatureCollection avec attributs bâtiment ajoutés
          stats       : dict de métriques (total, matched, coverage_pct, ...)
    """
    features_out = []
    total = len(lots_fc.get("features", []))
    matched = 0
    with_batiment = 0
    with_etages = 0
    with_annee = 0
    with_cubf = 0

    for feat in lots_fc.get("features", []):
        props = dict(feat.get("properties") or {})
        no_lot_raw = str(props.get(lot_id_field, "")).replace(" ", "")

        role_attrs = role_lookup.get(no_lot_raw)
        if role_attrs:
            matched += 1
            # Ajoute les attributs rôle (préfixe role_ pour éviter collisions)
            props["role_usage_cubf"]              = role_attrs["usage_cubf"]
            props["role_nb_etages_max"]           = role_attrs["nb_etages_max"]
            props["role_annee_construction"]      = role_attrs["annee_construction"]
            props["role_annee_est_reelle"]        = role_attrs["annee_est_reelle"]
            props["role_superficie_batiment_m2"]  = role_attrs["superficie_batiment_m2"]
            props["role_nb_logements"]            = role_attrs["nb_logements"]
            props["role_nb_locaux_non_resid"]     = role_attrs["nb_locaux_non_resid"]
            props["role_superficie_terrain_m2"]   = role_attrs["superficie_terrain_m2_role"]
            props["role_frontage_m"]              = role_attrs["frontage_role_m"]
            props["role_valeur_terrain"]          = role_attrs["valeur_terrain"]
            props["role_valeur_batiment"]         = role_attrs["valeur_batiment"]
            props["role_valeur_immeuble"]         = role_attrs["valeur_immeuble"]
            props["_role_source"]                 = role_attrs["_source"]
            props["_role_millesime"]              = role_attrs["_source_millesime"]

            if role_attrs["superficie_batiment_m2"] is not None:
                with_batiment += 1
            if role_attrs["nb_etages_max"] is not None:
                with_etages += 1
            if role_attrs["annee_construction"] is not None:
                with_annee += 1
            if role_attrs["usage_cubf"] is not None:
                with_cubf += 1
        else:
            # Lot non trouvé dans le rôle — attributs null
            props["role_usage_cubf"]              = None
            props["role_nb_etages_max"]           = None
            props["role_annee_construction"]      = None
            props["role_annee_est_reelle"]        = None
            props["role_superficie_batiment_m2"]  = None
            props["role_nb_logements"]            = None
            props["role_nb_locaux_non_resid"]     = None
            props["role_superficie_terrain_m2"]   = None
            props["role_frontage_m"]              = None
            props["role_valeur_terrain"]          = None
            props["role_valeur_batiment"]         = None
            props["role_valeur_immeuble"]         = None
            props["_role_source"]                 = SOURCE_ID
            props["_role_millesime"]              = None

        features_out.append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": props,
        })

    enriched_fc = {
        "type": "FeatureCollection",
        "features": features_out,
    }

    stats = {
        "total_lots_cadastre": total,
        "lots_matched_role": matched,
        "lots_unmatched": total - matched,
        "coverage_pct": round(matched / total * 100, 1) if total else 0,
        "with_superficie_batiment": with_batiment,
        "with_nb_etages": with_etages,
        "with_annee_construction": with_annee,
        "with_usage_cubf": with_cubf,
        "batiment_coverage_pct": round(with_batiment / matched * 100, 1) if matched else 0,
        "source": SOURCE_ID,
        "source_url": SOURCE_URL,
        "license": LICENSE,
    }

    return enriched_fc, stats


# ---------------------------------------------------------------------------
# Upload S3
# ---------------------------------------------------------------------------

def upload_parquet_s3(
    df_or_fc,
    s3_key: str,
    s3_env_path: str = "/home/antoinefa/src/_acquisition-shared/s3.env",
) -> str:
    """
    Exporte un GeoJSON (dict) ou DataFrame vers Parquet et uploade sur S3.

    Returns:
        URL s3:// complète du fichier uploadé
    """
    import boto3
    import io as _io

    # Parse creds
    env = {}
    with open(s3_env_path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v

    # Convertir GeoJSON en parquet via pandas/pyarrow
    try:
        import pandas as pd
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        raise ImportError(
            "pandas et pyarrow sont requis pour l'export Parquet. "
            "pip install pandas pyarrow"
        )

    if isinstance(df_or_fc, dict) and df_or_fc.get("type") == "FeatureCollection":
        rows = []
        for feat in df_or_fc["features"]:
            row = dict(feat.get("properties") or {})
            geom = feat.get("geometry")
            if geom:
                row["_geom_type"] = geom.get("type")
                coords = geom.get("coordinates")
                if coords:
                    # Store geometry as WKT-like JSON string for Parquet
                    row["_geometry_json"] = json.dumps(geom)
            rows.append(row)
        df = pd.DataFrame(rows)
    else:
        df = df_or_fc  # assume DataFrame

    buf = _io.BytesIO()
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, buf)
    buf.seek(0)

    s3 = boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env["S3_REGION"],
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
    )
    bucket = env["S3_BUCKET"]
    s3.upload_fileobj(buf, bucket, s3_key)

    return f"s3://{bucket}/{s3_key}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Pilote rôle foncier MAMH : parse + jointure lots cadastraux."
    )
    parser.add_argument(
        "muni",
        help="Code géographique (ex: '34128') ou nom/slug (ex: 'saint-raymond')",
    )
    parser.add_argument(
        "--millesime",
        type=int,
        default=DEFAULT_MILLESIME,
        help=f"Année du rôle (défaut: {DEFAULT_MILLESIME})",
    )
    parser.add_argument(
        "--lots",
        metavar="GEOJSON",
        help="GeoJSON de lots cadastraux à enrichir (ex: qc-lots-saint-raymond.geojson)",
    )
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Fichier de sortie (.geojson ou .parquet)",
    )
    parser.add_argument(
        "--s3",
        action="store_true",
        help="Uploader le parquet sur S3 (bucket sentropic-geo)",
    )
    parser.add_argument(
        "--cache-xml",
        metavar="FILE",
        help="Chemin de cache local pour le XML (évite re-téléchargement)",
    )
    parser.add_argument(
        "--xml-only",
        action="store_true",
        help="Télécharge et parse le XML sans jointure lots (affiche les stats)",
    )
    args = parser.parse_args()

    # Résolution municipalité
    try:
        muni_entry = resolve_muni(args.muni, args.millesime)
    except ValueError as e:
        print(f"ERREUR: {e}", file=sys.stderr)
        sys.exit(1)

    code_geo = muni_entry["code_geo"]
    nom = muni_entry["nom"]
    slug = _slugify(nom)
    print(f"Municipalité : {nom} (code {code_geo}, slug: {slug})")

    # Téléchargement XML
    cache_path = Path(args.cache_xml) if args.cache_xml else None
    print(f"Téléchargement rôle {args.millesime}...")
    xml_bytes = fetch_role(code_geo, millesime=args.millesime, cache_path=cache_path)
    print(f"  XML {len(xml_bytes)/1024/1024:.2f} MB")

    # Parsing
    print("Parsing XML...")
    lookup = parse_role(xml_bytes)
    print(f"  {len(lookup)} matricules uniques extraits")

    if args.xml_only or not args.lots:
        print("Stats rôle (sans jointure lots) :")
        with_bat = sum(1 for v in lookup.values() if v["superficie_batiment_m2"])
        with_etg = sum(1 for v in lookup.values() if v["nb_etages_max"])
        with_yr  = sum(1 for v in lookup.values() if v["annee_construction"])
        n = len(lookup)
        print(f"  superficie_batiment_m2  : {with_bat}/{n} = {with_bat/n*100:.1f}%")
        print(f"  nb_etages_max           : {with_etg}/{n} = {with_etg/n*100:.1f}%")
        print(f"  annee_construction      : {with_yr}/{n}  = {with_yr/n*100:.1f}%")
        return

    # Jointure avec lots
    lots_path = Path(args.lots)
    print(f"Chargement lots : {lots_path}")
    with open(lots_path) as f:
        lots_fc = json.load(f)

    print("Jointure lots ↔ rôle...")
    enriched_fc, stats = join_lots_role(lots_fc, lookup)

    print("Résultats :")
    for k, v in stats.items():
        if k not in ("source", "source_url", "license"):
            print(f"  {k}: {v}")

    # Sortie fichier
    output_path = args.output
    if output_path:
        out = Path(output_path)
        if out.suffix == ".geojson":
            out.parent.mkdir(parents=True, exist_ok=True)
            with open(out, "w") as f:
                json.dump(enriched_fc, f)
            print(f"GeoJSON écrit : {out}")
        elif out.suffix == ".parquet":
            out.parent.mkdir(parents=True, exist_ok=True)
            import pandas as pd
            import pyarrow as pa
            import pyarrow.parquet as pq
            rows = [f["properties"] for f in enriched_fc["features"]]
            df = pd.DataFrame(rows)
            table = pa.Table.from_pandas(df, preserve_index=False)
            pq.write_table(table, out)
            print(f"Parquet écrit : {out}")
        else:
            print(f"Format inconnu pour : {out}. Utiliser .geojson ou .parquet")

    # Upload S3
    if args.s3:
        s3_key = f"registry/role-foncier/{slug}.parquet"
        print(f"Upload S3 → {s3_key}...")
        if output_path and Path(output_path).suffix == ".parquet":
            # Upload depuis le fichier local
            import boto3, io as _io
            env = {}
            with open("/home/antoinefa/src/_acquisition-shared/s3.env") as f2:
                for line in f2:
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
            s3.upload_file(output_path, env["S3_BUCKET"], s3_key)
            s3_url = f"s3://{env['S3_BUCKET']}/{s3_key}"
        else:
            s3_url = upload_parquet_s3(enriched_fc, s3_key)
        print(f"  Uploadé : {s3_url}")


if __name__ == "__main__":
    main()
