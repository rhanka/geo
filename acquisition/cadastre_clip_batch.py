#!/usr/bin/env python3
"""Batch clip-fix des cadastres sur-capturés (30 z∩m∩p, villes join<75%).

Pipeline par ville (anti-invention, non-destructif, idempotent):
  1. clip cadastre à la frontière muni (cadastre_clip.clip)
  2. GATE: ne commit que si join_after>=75 ET matched_coverage>=90 ET after>0
  3. backup S3 de l'original -> qc-cadastre-lots-preclip/<slug>.geojson (si absent)
  4. upload geojson clippé -> qc-cadastre-lots/<slug>.geojson
  5. recompute parquet rôle (role_foncier CLI --output) -> registry/role-foncier/<slug>.parquet
  6. MAJ progress /tmp/clip_progress.json
Borné par --max-seconds pour rester en foreground robuste; relancer pour continuer.
"""
import json, os, sys, time, io, subprocess, argparse
sys.path.insert(0, "/home/antoinefa/src/geo")
from acquisition.cadastre_clip import clip

S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env"
BUCKET = "sentropic-geo"
PROG = "/tmp/clip_progress.json"

# slug | code géo | nom OSM (accents corrects)
CITIES = [
    ("saint-mathieu-de-beloeil", "57045", "Saint-Mathieu-de-Beloeil"),
    ("rosemere", "73020", "Rosemère"),
    ("sainte-catherine", "67030", "Sainte-Catherine"),
    ("saint-gilbert", "34060", "Saint-Gilbert"),
    ("saint-charles-borromee", "61035", "Saint-Charles-Borromée"),
    ("sainte-cecile-de-milton", "47055", "Sainte-Cécile-de-Milton"),
    ("mont-saint-hilaire", "57035", "Mont-Saint-Hilaire"),
    ("saint-frederic", "27065", "Saint-Frédéric"),
    ("plaisance", "80045", "Plaisance"),
    ("neuville", "34007", "Neuville"),
    ("notre-dame-de-lourdes--lerable", "32080", "Notre-Dame-de-Lourdes"),
    ("saint-stanislas-de-kostka", "70040", "Saint-Stanislas-de-Kostka"),
    ("champlain", "37220", "Champlain"),
    ("hemmingford--les-jardins-de-napierville--2", "68015", "Hemmingford"),
    ("saint-boniface", "51085", "Saint-Boniface"),
    ("saint-amable", "59015", "Saint-Amable"),
    ("cowansville", "46080", "Cowansville"),
    ("saint-raphael", "19082", "Saint-Raphaël"),
    ("chelsea", "82025", "Chelsea"),
]


def s3_client():
    import boto3
    env = {}
    with open(S3ENV) as f:
        for ln in f:
            ln = ln.strip()
            if "=" in ln and not ln.startswith("#"):
                k, v = ln.split("=", 1); env[k.strip()] = v.strip()
    return boto3.client("s3", endpoint_url=env["S3_ENDPOINT"], region_name=env.get("S3_REGION", "fr-par"),
                        aws_access_key_id=env["S3_ACCESS_KEY"], aws_secret_access_key=env["S3_SECRET_KEY"])


def exists(s3, key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key); return True
    except Exception:
        return False


def load_prog():
    try:
        return json.load(open(PROG))
    except Exception:
        return {"done": {}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=int, default=540)
    ap.add_argument("--only", help="slug unique (test)")
    a = ap.parse_args()
    s3 = s3_client()
    prog = load_prog()
    t0 = time.time()
    cities = [c for c in CITIES if (not a.only or c[0] == a.only)]
    os.makedirs("/tmp/lots", exist_ok=True)
    os.makedirs("/tmp/clipped_parquet", exist_ok=True)
    for slug, code, nom in cities:
        if slug in prog["done"]:
            print("SKIP(done) %s" % slug); continue
        if time.time() - t0 > a.max_seconds:
            print("STOP wall-clock; relancer pour continuer"); break
        lots = "/tmp/lots/%s.geojson" % slug
        if not os.path.exists(lots):
            try:
                s3.download_file(BUCKET, "normalized/qc-cadastre-lots/%s.geojson" % slug, lots)
            except Exception as e:
                print("FAIL-DL %s %s" % (slug, e)); continue
        try:
            r = clip(slug, nom)
        except Exception as e:
            print("FAIL-CLIP %s %s" % (slug, e)); time.sleep(2); continue
        ja = r.get("join_after", -1); mc = r.get("matched_coverage", -1); after = r.get("after", 0)
        ok = (ja >= 75) and (mc >= 90) and (after > 0)
        print("%-44s before=%d after=%d join %s->%s cov=%s gate=%s" % (
            slug, r["before"], after, r.get("join_before"), ja, mc, "PASS" if ok else "FAIL"))
        if not ok:
            print("  -> SKIP commit (gate non passé)"); time.sleep(2); continue
        # 3) backup original (si absent)
        pre = "normalized/qc-cadastre-lots-preclip/%s.geojson" % slug
        if not exists(s3, pre):
            s3.copy_object(Bucket=BUCKET, CopySource={"Bucket": BUCKET, "Key": "normalized/qc-cadastre-lots/%s.geojson" % slug}, Key=pre)
        # 4) upload clippé
        s3.upload_file(r["out"], BUCKET, "normalized/qc-cadastre-lots/%s.geojson" % slug)
        # 5) recompute parquet
        pq_out = "/tmp/clipped_parquet/%s.parquet" % slug
        cp = subprocess.run([sys.executable, "acquisition/role_foncier.py", code, "--lots", r["out"], "--output", pq_out],
                            cwd="/home/antoinefa/src/geo", capture_output=True, text=True, timeout=200)
        if os.path.exists(pq_out):
            s3.upload_file(pq_out, BUCKET, "registry/role-foncier/%s.parquet" % slug)
            print("  -> COMMIT geojson+parquet OK")
            prog["done"][slug] = {"after": after, "join_after": ja}
            json.dump(prog, open(PROG, "w"), indent=2)
        else:
            print("  -> WARN parquet recompute échec, geojson clippé déjà uploadé. stderr: %s" % cp.stderr[-200:])
        time.sleep(2)
    print("=== batch chunk fin (%d done total) ===" % len(prog["done"]))


if __name__ == "__main__":
    main()
