#!/usr/bin/env python3
"""Clip d'un cadastre sur-capturé à la frontière municipale (fix defect over-capture).

Source frontière : OSM admin_level=8 (Overpass), contrainte au Québec, désambiguïsée
par proximité à l'emprise du cadastre. Clip par centroïde (representative_point).

Usage:
    cadastre_clip.py <slug> <name OSM> [--in GEOJSON] [--out GEOJSON] [--role PARQUET]
Sans --in, lit /tmp/lots/<slug>.geojson. Écrit le clip dans --out (déf /tmp/clipped/<slug>.geojson)
et imprime un récap before/after + recompute join si --role (déf /tmp/role/<slug>.parquet).
Anti-invention : ne supprime QUE des lots hors frontière (geom inchangée), aucun ajout.
"""
import json, os, sys, argparse, urllib.parse, urllib.request, time
from shapely.geometry import shape, LineString
from shapely.ops import polygonize, unary_union
from shapely.prepared import prep

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "geo-quebec-cadastre-clip/1.0 (reliability fix)"


def fetch_boundary(name, near=None, retries=3):
    """Polygone muni (admin_level=8) au QC. `near`=(lon,lat) pour désambiguïser les homonymes."""
    q = ('[out:json][timeout:60];area["name"="Québec"]["admin_level"="4"]->.qc;'
         'relation["boundary"="administrative"]["admin_level"="8"]["name"="%s"](area.qc);out geom;' % name)
    url = OVERPASS + "?" + urllib.parse.urlencode({"data": q})
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            d = json.load(urllib.request.urlopen(req, timeout=70))
            break
        except Exception as e:
            last = e; time.sleep(3 * (i + 1))
    else:
        raise RuntimeError("Overpass échec: %s" % last)
    rels = [e for e in d["elements"] if e["type"] == "relation"]
    if not rels:
        raise RuntimeError("aucune relation admin_level=8 '%s' au QC" % name)
    polys = []
    for r in rels:
        lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                 for m in r.get("members", []) if m.get("type") == "way" and m.get("geometry") and len(m["geometry"]) >= 2]
        pp = list(polygonize(unary_union(lines)))
        if pp:
            polys.append((unary_union(pp), r.get("id")))
    if not polys:
        raise RuntimeError("polygonize vide pour '%s'" % name)
    if len(polys) > 1 and near is not None:
        from shapely.geometry import Point
        pt = Point(near)
        polys.sort(key=lambda mp: mp[0].distance(pt))
    return polys[0][0]


def clip(slug, name, in_path=None, out_path=None, role_path=None):
    in_path = in_path or "/tmp/lots/%s.geojson" % slug
    out_path = out_path or "/tmp/clipped/%s.geojson" % slug
    role_path = role_path or "/tmp/role/%s.parquet" % slug
    g = json.load(open(in_path))
    feats = g["features"]; n = len(feats)
    # centroïde global du cadastre pour désambiguïsation
    xs = []; ys = []
    cents = []
    for f in feats:
        geom = f.get("geometry")
        if not geom:
            cents.append(None); continue
        try:
            c = shape(geom).representative_point()
        except Exception:
            cents.append(None); continue
        cents.append(c); xs.append(c.x); ys.append(c.y)
    near = (sum(xs) / len(xs), sum(ys) / len(ys)) if xs else None
    muni = fetch_boundary(name, near=near)
    pm = prep(muni)
    kept = []; kept_nolots = set()
    for f, c in zip(feats, cents):
        if c is not None and pm.contains(c):
            kept.append(f)
            nl = (f.get("properties", {}).get("NO_LOT") or "").replace(" ", "")
            if nl:
                kept_nolots.add(nl)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump({"type": "FeatureCollection", "features": kept}, open(out_path, "w"))
    res = {"slug": slug, "before": n, "after": len(kept),
           "retained_pct": round(100 * len(kept) / n, 1) if n else 0,
           "muni_area_deg2": round(muni.area, 5), "out": out_path}
    # recompute join si parquet rôle dispo
    if os.path.exists(role_path):
        import pyarrow.parquet as pq
        t = pq.read_table(role_path)
        NO = t.column("NO_LOT").to_pylist(); CU = t.column("role_usage_cubf").to_pylist()
        matched = set((NO[i] or "").replace(" ", "") for i in range(len(NO)) if CU[i] is not None)
        inter = kept_nolots & matched
        res["join_before"] = round(100 * len(matched) / n, 1) if n else 0
        res["join_after"] = round(100 * len(inter) / len(kept), 1) if kept else 0
        res["matched_coverage"] = round(100 * len(inter) / len(matched), 1) if matched else 0
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("name")
    ap.add_argument("--in", dest="in_path"); ap.add_argument("--out", dest="out_path")
    ap.add_argument("--role", dest="role_path")
    a = ap.parse_args()
    r = clip(a.slug, a.name, a.in_path, a.out_path, a.role_path)
    print(json.dumps(r, ensure_ascii=False))
