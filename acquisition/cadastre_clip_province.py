#!/usr/bin/env python3
"""Batch PROVINCE du clip-fix cadastre via frontières SDA (en masse, sans Overpass).

Parcourt normalized/qc-cadastre-lots/*.geojson (~1102 munis QC) et clippe chacun
à sa frontière municipale SDA officielle (index local, 0 appel réseau/ville).

IDEMPOTENT & RESUMABLE :
  - skip si normalized/qc-cadastre-lots-preclip/<slug>.geojson existe (déjà clippé)
  - skip si déjà fait dans le checkpoint /tmp/clip_province_progress.json
  - borné par --max-seconds ; relancer pour continuer là où on s'est arrêté

GATE (commit seulement si) :
  - un polygone SDA a matché le slug (boundary_match)
  - retained_pct sain : > MIN_RETAINED (%) et <= 100  (un ~0% = mauvais polygone -> skip+log)
  - si un parquet rôle existe (les ~30 z∩m∩p) : join_after >= MIN_JOIN

COMMIT (non-destructif, anti-invention) :
  1. backup original -> qc-cadastre-lots-preclip/<slug>.geojson (copy_object si absent)
  2. upload clippé -> qc-cadastre-lots/<slug>.geojson (canonical)
  (pas de recompute parquet ici : pas de rôle partout en province ; les 30 sont déjà faits)

Lecture seule hors qc-cadastre-lots/ + qc-cadastre-lots-preclip/ + qc-admin-boundaries/.

Usage :
  cadastre_clip_province.py [--max-seconds 540] [--chunk N] [--only SLUG] [--dry-run]
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, "/home/antoinefa/src/geo")
from acquisition.cadastre_clip_sda import SDAIndex, clip_slug

S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
BUCKET = "sentropic-geo"
PROG = "/tmp/clip_province_progress.json"
WORK = "/tmp/clip_province"
BOUNDARIES = WORK + "/qc-municipalites.geojson"
ROLE_INDEX = WORK + "/role_index.json"

CAD_PREFIX = "normalized/qc-cadastre-lots/"
PRECLIP_PREFIX = "normalized/qc-cadastre-lots-preclip/"
ROLE_PREFIX = "registry/role-foncier/"

MIN_RETAINED = 2.0    # % — en deçà = polygone douteux -> skip
MIN_JOIN = 75.0       # % — exigé uniquement si parquet rôle dispo


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


def load_prog():
    try:
        return json.load(open(PROG))
    except Exception:
        return {"done": {}, "skip_preclip": [], "no_boundary": [],
                "gate_fail": [], "errors": []}


def save_prog(p):
    tmp = PROG + ".tmp"
    json.dump(p, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, PROG)


def ensure_inputs(s3):
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(BOUNDARIES):
        s3.download_file(BUCKET, "normalized/qc-admin-boundaries/qc-municipalites.geojson", BOUNDARIES)
    if not os.path.exists(ROLE_INDEX):
        # fetch role index for code fallback (best effort)
        try:
            import urllib.request
            import csv as _csv
            import io as _io
            import unicodedata
            import re
            url = "https://donneesouvertes.affmunqc.net/role/indexRole2026.csv"
            content = urllib.request.urlopen(url, timeout=40).read().decode("utf-8-sig")

            def _norm(name):
                nfd = unicodedata.normalize("NFD", name or "")
                a = "".join(c for c in nfd if unicodedata.category(c) != "Mn").lower()
                a = a.replace("'", "").replace("’", "").replace("`", "")
                a = re.sub(r"[^a-z0-9]+", "-", a)
                return re.sub(r"-+", "-", a).strip("-")
            ri = {}
            for r in _csv.DictReader(_io.StringIO(content)):
                cg = (r.get("code géographique") or "").strip()
                nm = (r.get("nom du territoire") or "").strip()
                if cg:
                    ri[_norm(nm)] = [cg, nm]
            json.dump(ri, open(ROLE_INDEX, "w"))
        except Exception as e:
            print("WARN role index fetch failed (%s) — fallback désactivé" % e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=int, default=3000)
    ap.add_argument("--chunk", type=int, default=0, help="limite nb munis traités ce run (0=illimité)")
    ap.add_argument("--only", help="slug unique (test)")
    ap.add_argument("--dry-run", action="store_true", help="clip + gate mais aucun upload/backup")
    a = ap.parse_args()

    s3 = s3_client()
    ensure_inputs(s3)
    idx = SDAIndex(BOUNDARIES)
    if os.path.exists(ROLE_INDEX):
        idx.attach_role_index(ROLE_INDEX)

    prog = load_prog()
    for key in ("done", "skip_preclip", "no_boundary", "gate_fail", "errors"):
        prog.setdefault(key, {} if key == "done" else [])

    all_slugs = sorted(list_slugs(s3, CAD_PREFIX, ".geojson"))
    role_slugs = set(list_slugs(s3, ROLE_PREFIX, ".parquet"))
    preclip_slugs = set(list_slugs(s3, PRECLIP_PREFIX, ".geojson"))

    if a.only:
        all_slugs = [s for s in all_slugs if s == a.only]

    os.makedirs(WORK + "/lots", exist_ok=True)
    os.makedirs(WORK + "/clipped", exist_ok=True)
    os.makedirs(WORK + "/role", exist_ok=True)

    t0 = time.time()
    processed = 0
    for slug in all_slugs:
        if slug in prog["done"]:
            continue
        if slug in preclip_slugs:
            # déjà clippé (les 19 z∩m∩p + tout commit antérieur de ce batch)
            if slug not in prog["skip_preclip"]:
                prog["skip_preclip"].append(slug)
            continue
        if time.time() - t0 > a.max_seconds:
            print("STOP wall-clock; relancer pour continuer")
            break
        if a.chunk and processed >= a.chunk:
            print("STOP chunk limit (%d); relancer pour continuer" % a.chunk)
            break
        processed += 1

        lots = WORK + "/lots/%s.geojson" % slug
        try:
            if not os.path.exists(lots):
                s3.download_file(BUCKET, CAD_PREFIX + "%s.geojson" % slug, lots)
        except Exception as e:
            print("FAIL-DL %-44s %s" % (slug, e))
            prog["errors"].append([slug, "dl:%s" % e])
            save_prog(prog)
            continue

        role_path = None
        if slug in role_slugs:
            role_path = WORK + "/role/%s.parquet" % slug
            if not os.path.exists(role_path):
                try:
                    s3.download_file(BUCKET, ROLE_PREFIX + "%s.parquet" % slug, role_path)
                except Exception:
                    role_path = None

        out = WORK + "/clipped/%s.geojson" % slug
        try:
            r = clip_slug(idx, slug, lots, out, role_path)
        except Exception as e:
            print("FAIL-CLIP %-44s %s" % (slug, e))
            prog["errors"].append([slug, "clip:%s" % e])
            save_prog(prog)
            _cleanup(lots, out)
            continue

        if not r.get("boundary_match"):
            print("NO-BOUNDARY %-44s before=%d (skip)" % (slug, r["before"]))
            if slug not in prog["no_boundary"]:
                prog["no_boundary"].append(slug)
            save_prog(prog)
            _cleanup(lots, out)
            continue

        retained = r["retained_pct"]
        ja = r.get("join_after")
        gate = (retained > MIN_RETAINED) and (retained <= 100.0)
        if ja is not None:
            gate = gate and (ja >= MIN_JOIN)

        msg = ("%-44s code=%s before=%d after=%d ret=%.1f%% method=%s"
               % (slug, r.get("sda_code"), r["before"], r["after"], retained, r.get("resolve_method")))
        if ja is not None:
            msg += " join %s->%s cov=%s" % (r.get("join_before"), ja, r.get("matched_coverage"))
        msg += "  gate=%s" % ("PASS" if gate else "FAIL")
        print(msg)

        if not gate:
            prog["gate_fail"].append({"slug": slug, "before": r["before"], "after": r["after"],
                                      "ret": retained, "join_after": ja, "method": r.get("resolve_method")})
            save_prog(prog)
            _cleanup(lots, out)
            continue

        if a.dry_run:
            _cleanup(lots, out)
            continue

        # COMMIT — backup original (si absent) puis upload clippé
        pre = PRECLIP_PREFIX + "%s.geojson" % slug
        try:
            if not exists(s3, pre):
                s3.copy_object(Bucket=BUCKET,
                               CopySource={"Bucket": BUCKET, "Key": CAD_PREFIX + "%s.geojson" % slug},
                               Key=pre)
            s3.upload_file(out, BUCKET, CAD_PREFIX + "%s.geojson" % slug)
        except Exception as e:
            print("FAIL-UPLOAD %-44s %s" % (slug, e))
            prog["errors"].append([slug, "upload:%s" % e])
            save_prog(prog)
            _cleanup(lots, out)
            continue

        prog["done"][slug] = {"sda_code": r.get("sda_code"), "before": r["before"],
                              "after": r["after"], "ret": retained, "join_after": ja,
                              "method": r.get("resolve_method")}
        save_prog(prog)
        _cleanup(lots, out)

    print("=== chunk fin : done=%d skip_preclip=%d no_boundary=%d gate_fail=%d errors=%d (sur %d slugs) ==="
          % (len(prog["done"]), len(prog["skip_preclip"]), len(prog["no_boundary"]),
             len(prog["gate_fail"]), len(prog["errors"]), len(all_slugs)))


def _cleanup(*paths):
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


if __name__ == "__main__":
    main()
