#!/usr/bin/env python3
"""Build registry/qc-zonage-norms/sherbrooke.parquet from the frozen-parser output.

Federation-first PRODUCT writer for the FIRST real qc-zonage-norms grille
extraction (Ville de Sherbrooke, règlement 1200). It is a thin bridge: the
TypeScript adapter (`reglements-zonage-sherbrooke.ts`) runs the FROZEN grille
parser over the live PDF and emits per-zone ZoneNorms as JSON; this script flattens
those records into one row per zone-page and writes Parquet, then uploads to S3.

Anti-invention is inherited WHOLE from the parser: a field's `value` is published
only when the parser already passed every structural guard; otherwise it is null
and the verbatim `raw` is kept. This script NEVER fabricates: it copies value /
raw / unit / confidence verbatim from the JSON the parser produced.

Schema (one row per zone × zone-page):
  zone_code, zone_page, usages,
  <field>_value | <field>_raw | <field>_unit | <field>_confidence  for each of
    densite, hauteur_min, hauteur_max,
    marge_avant_min, marge_laterale_min, marge_arriere_min,
    frontage_min, superficie_min
  _source_url, _reglement ("1200"), _methode, _snapshot ("2026-06-21")

Usage:
  python3 build_zonage_norms_sherbrooke.py /tmp/sherbrooke-grille/zone-norms.json [--s3]
"""

import json
import sys

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
S3_KEY = "registry/qc-zonage-norms/sherbrooke.parquet"
SOURCE_URL = (
    "https://contenu.maruche.ca/Fichiers/3337a882-4a53-e611-80ea-00155d09650f"
    "/Sites/333dd3d3-915d-e611-80ea-00155d09650f/Documents"
    "/Reglements%20municipaux/Urbanisme/Reglement-1200-grilles.pdf"
)
REGLEMENT = "1200"
METHODE = "native-text/header-anchored-cluster"
SNAPSHOT = "2026-06-21"

# The ZoneNorms fields surfaced in the product, mapped from the JSON shape.
# (densite/hauteur_*/frontage/superficie are flat NormField; marges are nested.)
SCALAR_FIELDS = [
    "densite",
    "hauteur_min",
    "hauteur_max",
    "frontage_min",
    "superficie_min",
]
MARGE_FIELDS = ["avant_min", "laterale_min", "arriere_min"]


def field_cols(prefix, nf):
    """Flatten one NormField (or null) into value/raw/unit/confidence columns.

    Verbatim copy — no derivation. A null field (absent column) → all-null cells.
    """
    if nf is None:
        return {
            f"{prefix}_value": None,
            f"{prefix}_raw": None,
            f"{prefix}_unit": None,
            f"{prefix}_confidence": None,
        }
    return {
        f"{prefix}_value": nf.get("value"),
        f"{prefix}_raw": nf.get("raw"),
        f"{prefix}_unit": nf.get("unit"),
        f"{prefix}_confidence": nf.get("confidence"),
    }


def to_rows(zones):
    rows = []
    for z in zones:
        row = {
            "zone_code": z["zone_code"],
            "zone_page": z["zone_page"],
            "usages": ";".join(z.get("usages") or []),
        }
        for fname in SCALAR_FIELDS:
            row.update(field_cols(fname, z.get(fname)))
        marges = z.get("marges") or {}
        for mname in MARGE_FIELDS:
            row.update(field_cols(f"marge_{mname}", marges.get(mname)))
        row["_source_url"] = SOURCE_URL
        row["_reglement"] = REGLEMENT
        row["_methode"] = METHODE
        row["_snapshot"] = SNAPSHOT
        rows.append(row)
    return rows


def build_schema(df):
    """Explicit pyarrow schema: string for codes/raw/unit/provenance, float for
    value/confidence (stable even when a whole column is null — anti-invention:
    an absent column must not silently become 0 or break the schema)."""
    fields = [
        ("zone_code", pa.string()),
        ("zone_page", pa.string()),
        ("usages", pa.string()),
    ]
    field_names = [f"marge_{m}" for m in MARGE_FIELDS] + SCALAR_FIELDS
    for fname in SCALAR_FIELDS + [f"marge_{m}" for m in MARGE_FIELDS]:
        fields.append((f"{fname}_value", pa.float64()))
        fields.append((f"{fname}_raw", pa.string()))
        fields.append((f"{fname}_unit", pa.string()))
        fields.append((f"{fname}_confidence", pa.float64()))
    fields += [
        ("_source_url", pa.string()),
        ("_reglement", pa.string()),
        ("_methode", pa.string()),
        ("_snapshot", pa.string()),
    ]
    _ = field_names
    # Reorder df columns to schema order; only keep declared columns.
    cols = [name for name, _t in fields]
    return pa.schema(fields), df[cols]


def s3_client():
    env = {}
    with open(S3ENV) as f:
        for ln in f:
            ln = ln.strip()
            if "=" in ln and not ln.startswith("#"):
                k, v = ln.split("=", 1)
                env[k.strip()] = v.strip()
    client = boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env.get("S3_REGION", "fr-par"),
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
    )
    return client, env["S3_BUCKET"]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    json_path = sys.argv[1]
    do_s3 = "--s3" in sys.argv[2:]

    payload = json.load(open(json_path))
    zones = payload["zones"]
    stats = payload.get("stats", {})

    rows = to_rows(zones)
    df = pd.DataFrame(rows)
    schema, df = build_schema(df)

    out_path = "/tmp/sherbrooke-grille/sherbrooke.parquet"
    table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
    pq.write_table(table, out_path, compression="zstd")

    # Field-publication coverage (honest reporting; anti-invention metric).
    value_cols = [c for c in df.columns if c.endswith("_value")]
    total = int(df[value_cols].size)
    published = int(df[value_cols].notna().sum().sum())
    print("=== qc-zonage-norms-sherbrooke ===")
    print("input stats:", json.dumps(stats))
    print("rows (zone × zone-page):", len(df))
    print("unique zone_codes:", df["zone_code"].nunique())
    print("value-fields total:", total)
    print(
        "value-fields published (non-null): %d (%.1f%%)"
        % (published, 100.0 * published / total)
    )
    print(
        "value-fields null: %d (%.1f%%)"
        % (total - published, 100.0 * (total - published) / total)
    )
    print("parquet:", out_path)

    if do_s3:
        s3, bucket = s3_client()
        s3.upload_file(out_path, bucket, S3_KEY)
        print("uploaded: s3://%s/%s" % (bucket, S3_KEY))
    else:
        print("(dry-run — pass --s3 to upload to s3://<bucket>/%s)" % S3_KEY)


if __name__ == "__main__":
    main()
