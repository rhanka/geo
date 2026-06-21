#!/usr/bin/env python3
"""Batch PROVINCE du rôle foncier — joint la cadastre CLIPPÉE au rôle MAMH, en masse.

Parcourt les cadastres clippés propres normalized/qc-cadastre-lots/*.geojson (~1102
munis QC) et, pour chacun, télécharge + parse le rôle d'évaluation foncière MAMH,
le joint par matricule (= NO_LOT sans espaces) et dépose un parquet enrichi sous
registry/role-foncier/<slug>.parquet.

IDEMPOTENT & RESUMABLE :
  - skip si registry/role-foncier/<slug>.parquet existe déjà (les 30 z∩m∩p inclus)
  - skip si déjà fait dans le checkpoint /tmp/role_province_progress.json
  - borné par --max-seconds ; relancer pour continuer là où on s'est arrêté

RÉSOLUTION code_geo (sans Overpass, comme le clip) :
  slug cadastre (norm NFD, accents décomposés -> lettre de base) ->
    1. index frontières SDA local (MUS_NM_MUN -> MUS_CO_GEO), matching norm()
    2. fallback index rôle MAMH (fetch_index, nom -> code_geo), matching norm()
  ⚠️ On N'UTILISE PAS resolve_muni()/_slugify() du module role_foncier pour la
     résolution NI pour la clé d'upload : son _slugify fait encode('ascii','ignore')
     qui DÉTRUIT les accents ('Montréal'->'montral', "Baie-D'Urfé"->'baie-d-urf'),
     ce qui casse l'alignement avec le slug cadastre. La clé d'upload est TOUJOURS
     le slug cadastre exact, contrôlée nous-mêmes via boto3.

COMMIT (anti-invention) :
  - lots sans matricule au rôle -> champs role_* = null (jamais inventés)
  - upload parquet sous la clé EXACTE registry/role-foncier/<slug>.parquet
  - log le join% (coverage) par muni

Munis sans rôle (code non résolu / XML 404) -> log no_code / no_role et on continue
(normal : tous les territoires QC n'ont pas de rôle ou de code géo résolvable).

Lecture seule hors registry/role-foncier/.

Usage :
  cadastre_role_province.py [--max-seconds 3000] [--chunk N] [--only SLUG] [--dry-run]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/home/antoinefa/src/geo")
from acquisition.cadastre_clip_sda import norm
from acquisition.role_foncier import (
    fetch_index,
    parse_role,
    join_lots_role,
)

S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
BUCKET = "sentropic-geo"
PROG = "/tmp/role_province_progress.json"
WORK = "/tmp/role_province"
BOUNDARIES = WORK + "/qc-municipalites.geojson"

CAD_PREFIX = "normalized/qc-cadastre-lots/"
ROLE_PREFIX = "registry/role-foncier/"
SDA_BOUNDARIES_KEY = "normalized/qc-admin-boundaries/qc-municipalites.geojson"

MILLESIME = 2026

# Alias slug cadastre -> code géo (cas où le nom cadastre diffère de la source)
# Aligné sur cadastre_clip_sda.ALIAS_SLUG_TO_CODE.
ALIAS_SLUG_TO_CODE = {
    "eeyou-istchee-james-bay": "99060",
    "hatley-township-municipality": "45043",
}


# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------

def s3_client():
    import boto3
    env = {}
    with open(S3ENV) as f:
        for ln in f:
            ln = ln.strip()
            if "=" in ln and not ln.startswith("#"):
                k, v = ln.split("=", 1)
                env[k.strip()] = v.strip()
    return boto3.client(
        "s3", endpoint_url=env["S3_ENDPOINT"],
        region_name=env.get("S3_REGION", "fr-par"),
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
    )


def exists(s3, key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception:
        return False


def list_slugs(s3, prefix, suffix):
    out = []
    pg = s3.get_paginator("list_objects_v2")
    for page in pg.paginate(Bucket=BUCKET, Prefix=prefix):
        for o in page.get("Contents", []):
            k = o["Key"]
            if k.endswith(suffix):
                out.append(k[len(prefix):-len(suffix)])
    return out


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------

def load_prog():
    try:
        return json.load(open(PROG))
    except Exception:
        return {"done": {}, "skip_exists": [], "no_code": [],
                "no_role": [], "errors": []}


def save_prog(p):
    tmp = PROG + ".tmp"
    json.dump(p, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, PROG)


# ---------------------------------------------------------------------------
# Résolution code_geo (slug cadastre -> code géographique)
# ---------------------------------------------------------------------------

class CodeResolver:
    """Résout un slug cadastre (norm NFD) -> code_geo, via SDA puis index rôle MAMH."""

    def __init__(self, boundaries_path):
        # 1) index frontières SDA : norm(MUS_NM_MUN) -> MUS_CO_GEO
        self.by_name_sda = {}
        try:
            g = json.load(open(boundaries_path))
            for f in g.get("features", []):
                p = f.get("properties") or {}
                code = (p.get("MUS_CO_GEO") or p.get("code") or "").strip()
                nm = p.get("MUS_NM_MUN") or p.get("name") or ""
                if code and nm:
                    self.by_name_sda.setdefault(norm(nm), code)
        except Exception as e:
            print("WARN SDA boundaries load failed (%s)" % e)
        # 2) index rôle MAMH : norm(nom) -> code_geo  (fallback)
        self.by_name_role = {}
        try:
            idx = fetch_index(MILLESIME)
            for e in idx.values():
                nm = e.get("nom") or ""
                cg = e.get("code_geo") or ""
                if nm and cg:
                    self.by_name_role.setdefault(norm(nm), cg)
        except Exception as e:
            print("WARN role index fetch failed (%s)" % e)

    def resolve(self, slug):
        """Retourne (code_geo, method) ou (None, 'no-match')."""
        s = norm(slug)
        if s in ALIAS_SLUG_TO_CODE:
            return ALIAS_SLUG_TO_CODE[s], "alias"
        if s in self.by_name_sda:
            return self.by_name_sda[s], "sda-name"
        if s in self.by_name_role:
            return self.by_name_role[s], "role-index"
        # strip progressif des suffixes '--<mrc>' / '--2' (homonymes encodent leur MRC)
        segs = [seg for seg in __import__("re").split(r"-{2,}", slug or "")]
        for i in range(len(segs), 0, -1):
            base = norm("-".join(segs[:i]))
            if base in self.by_name_sda:
                return self.by_name_sda[base], "sda-name-prefix"
            if base in self.by_name_role:
                return self.by_name_role[base], "role-index-prefix"
        return None, "no-match"


# ---------------------------------------------------------------------------
# Rôle : fetch XML par code_geo (404 -> None, sans lever)
# ---------------------------------------------------------------------------

XML_URL_TEMPLATE = (
    "https://donneesouvertes.affmunqc.net/role/RL{code_geo}_{millesime}.xml"
)


def fetch_role_bytes(code_geo, millesime=MILLESIME):
    """Télécharge le XML du rôle pour un code_geo. Retourne bytes ou None si 404."""
    url = XML_URL_TEMPLATE.format(code_geo=code_geo, millesime=millesime)
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


# ---------------------------------------------------------------------------
# Parquet : écrit le GeoJSON enrichi en parquet (properties only, schéma 30)
# ---------------------------------------------------------------------------

def write_parquet(enriched_fc, out_path):
    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq
    rows = [f.get("properties") or {} for f in enriched_fc.get("features", [])]
    df = pd.DataFrame(rows)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, out_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=int, default=3000)
    ap.add_argument("--chunk", type=int, default=0,
                    help="limite nb munis traités ce run (0=illimité)")
    ap.add_argument("--only", help="slug unique (test)")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch+join+stats mais aucun upload")
    a = ap.parse_args()

    os.makedirs(WORK, exist_ok=True)
    os.makedirs(WORK + "/lots", exist_ok=True)
    os.makedirs(WORK + "/out", exist_ok=True)

    s3 = s3_client()
    if not os.path.exists(BOUNDARIES):
        s3.download_file(BUCKET, SDA_BOUNDARIES_KEY, BOUNDARIES)

    resolver = CodeResolver(BOUNDARIES)
    print("resolver: %d noms SDA, %d noms rôle"
          % (len(resolver.by_name_sda), len(resolver.by_name_role)))

    prog = load_prog()
    for key in ("done", "skip_exists", "no_code", "no_role", "errors"):
        prog.setdefault(key, {} if key == "done" else [])

    all_slugs = sorted(list_slugs(s3, CAD_PREFIX, ".geojson"))
    role_slugs = set(list_slugs(s3, ROLE_PREFIX, ".parquet"))

    if a.only:
        all_slugs = [s for s in all_slugs if s == a.only]
        if not all_slugs:
            print("ERREUR: slug --only=%s introuvable dans %s" % (a.only, CAD_PREFIX))
            return

    t0 = time.time()
    processed = 0
    for slug in all_slugs:
        if slug in prog["done"]:
            continue
        if slug in role_slugs:
            # parquet déjà déposé (les 30 z∩m∩p + tout commit antérieur de ce batch)
            if slug not in prog["skip_exists"]:
                prog["skip_exists"].append(slug)
            continue
        if time.time() - t0 > a.max_seconds:
            print("STOP wall-clock; relancer pour continuer")
            break
        if a.chunk and processed >= a.chunk:
            print("STOP chunk limit (%d); relancer pour continuer" % a.chunk)
            break
        processed += 1

        # 1) résoudre le code_geo
        code, method = resolver.resolve(slug)
        if code is None:
            print("NO-CODE     %-44s (skip)" % slug)
            if slug not in prog["no_code"]:
                prog["no_code"].append(slug)
            save_prog(prog)
            continue

        # 2) fetch + parse rôle
        try:
            xml = fetch_role_bytes(code, MILLESIME)
        except Exception as e:
            print("FAIL-FETCH  %-44s code=%s %s" % (slug, code, e))
            prog["errors"].append([slug, "fetch:%s" % e])
            save_prog(prog)
            continue
        if xml is None:
            print("NO-ROLE     %-44s code=%s (404, skip)" % (slug, code))
            if slug not in prog["no_role"]:
                prog["no_role"].append(slug)
            save_prog(prog)
            continue
        try:
            lookup = parse_role(xml)
        except Exception as e:
            print("FAIL-PARSE  %-44s code=%s %s" % (slug, code, e))
            prog["errors"].append([slug, "parse:%s" % e])
            save_prog(prog)
            continue

        # 3) charger la cadastre clippée + jointure
        lots = WORK + "/lots/%s.geojson" % slug
        try:
            if not os.path.exists(lots):
                s3.download_file(BUCKET, CAD_PREFIX + "%s.geojson" % slug, lots)
            with open(lots) as fh:
                lots_fc = json.load(fh)
        except Exception as e:
            print("FAIL-DL     %-44s %s" % (slug, e))
            prog["errors"].append([slug, "dl:%s" % e])
            save_prog(prog)
            _cleanup(lots)
            continue

        try:
            enriched_fc, stats = join_lots_role(lots_fc, lookup)
        except Exception as e:
            print("FAIL-JOIN   %-44s %s" % (slug, e))
            prog["errors"].append([slug, "join:%s" % e])
            save_prog(prog)
            _cleanup(lots)
            continue

        n_lots = stats["total_lots_cadastre"]
        n_match = stats["lots_matched_role"]
        join_pct = stats["coverage_pct"]
        n_matricules = len(lookup)
        print("JOIN        %-44s code=%s(%s) lots=%d matricules=%d match=%d join=%.1f%%"
              % (slug, code, method, n_lots, n_matricules, n_match, join_pct))

        if a.dry_run:
            _cleanup(lots)
            continue

        # 4) écrire parquet + upload sous la clé EXACTE slug cadastre
        out = WORK + "/out/%s.parquet" % slug
        try:
            write_parquet(enriched_fc, out)
        except Exception as e:
            print("FAIL-PARQUET %-44s %s" % (slug, e))
            prog["errors"].append([slug, "parquet:%s" % e])
            save_prog(prog)
            _cleanup(lots, out)
            continue

        upload_key = ROLE_PREFIX + "%s.parquet" % slug  # clé contrôlée, jamais _slugify
        try:
            s3.upload_file(out, BUCKET, upload_key)
        except Exception as e:
            print("FAIL-UPLOAD %-44s %s" % (slug, e))
            prog["errors"].append([slug, "upload:%s" % e])
            save_prog(prog)
            _cleanup(lots, out)
            continue

        prog["done"][slug] = {"code_geo": code, "method": method,
                              "lots": n_lots, "matricules": n_matricules,
                              "matched": n_match, "join_pct": join_pct,
                              "key": upload_key}
        save_prog(prog)
        _cleanup(lots, out)

    print("=== chunk fin : done=%d skip_exists=%d no_code=%d no_role=%d errors=%d (sur %d slugs) ==="
          % (len(prog["done"]), len(prog["skip_exists"]), len(prog["no_code"]),
             len(prog["no_role"]), len(prog["errors"]), len(all_slugs)))


def _cleanup(*paths):
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


if __name__ == "__main__":
    main()
