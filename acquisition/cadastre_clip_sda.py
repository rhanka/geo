#!/usr/bin/env python3
"""Clip d'un cadastre sur-capturé à la frontière municipale — source SDA EN MASSE.

Différence avec cadastre_clip.py (Overpass, 1 appel/ville) : la frontière vient
d'un INDEX LOCAL des municipalités SDA officielles (MRNF, 1/20k, EPSG:4326),
construit une seule fois pour toute la province. Aucun appel réseau par ville.

Résolution slug -> polygone SDA (slug = nom muni normalisé NFD sans accents/tirets) :
  1. norm(slug) == norm(MUS_NM_MUN) (exact)
  2. strip progressif des suffixes '--<mrc>' / '--2' (homonymes encodent leur MRC)
  3. homonymes -> désambiguïsation par MRC dans le suffixe, sinon par proximité
     spatiale (polygone SDA le plus proche du centroïde du cadastre)
  4. fallback index rôle MAMH (code géo) + petites alias connues
Clip par centroïde (representative_point + prep), anti-invention (suppression seule).

Usage module :
  from acquisition.cadastre_clip_sda import SDAIndex, clip_slug
  idx = SDAIndex("/path/qc-municipalites.geojson")           # + idx.attach_role_index()
  res = clip_slug(idx, slug, in_path, out_path, role_path)   # dict stats

Usage CLI :
  cadastre_clip_sda.py <slug> --boundaries qc-municipalites.geojson \
      [--in GEOJSON] [--out GEOJSON] [--role PARQUET]
"""
import json
import os
import re
import sys
import unicodedata
import argparse
from typing import Dict, List, Optional, Tuple

from shapely.geometry import shape, Point
from shapely.prepared import prep


# ---------------------------------------------------------------------------
# Normalisation slug (alignée sur la convention cadastre : apostrophes SUPPRIMÉES)
# ---------------------------------------------------------------------------

def norm(name: str) -> str:
    """Slug canonique : NFD sans accents, minuscule, apostrophes supprimées,
    tout non-alphanum -> tiret unique. 'Baie-D'Urfé' -> 'baie-durfe'."""
    nfd = unicodedata.normalize("NFD", name or "")
    a = "".join(c for c in nfd if unicodedata.category(c) != "Mn").lower()
    a = a.replace("'", "").replace("’", "").replace("`", "")
    a = re.sub(r"[^a-z0-9]+", "-", a)
    a = re.sub(r"-+", "-", a).strip("-")
    return a


# Alias slug cadastre -> code géo SDA (cas où le nom cadastre diffère du nom SDA)
ALIAS_SLUG_TO_CODE = {
    "eeyou-istchee-james-bay": "99060",      # Eeyou Istchee Baie-James (EN->FR)
    "hatley-township-municipality": "45043",  # Hatley (municipalité de canton)
}


# ---------------------------------------------------------------------------
# Index SDA
# ---------------------------------------------------------------------------

class SDAIndex:
    """Index municipalités SDA : norm(nom) -> [(code, nom, mrc_norm, geom, prep)]."""

    def __init__(self, boundaries_path: str):
        g = json.load(open(boundaries_path))
        self.by_name: Dict[str, List[dict]] = {}
        self.by_code: Dict[str, dict] = {}
        for f in g["features"]:
            p = f.get("properties") or {}
            code = (p.get("MUS_CO_GEO") or p.get("code") or "").strip()
            nm = p.get("MUS_NM_MUN") or p.get("name") or ""
            mrc = p.get("MUS_NM_MRC") or ""
            geom_dict = f.get("geometry")
            if not code or not nm or not geom_dict:
                continue
            try:
                geom = shape(geom_dict)
            except Exception:
                continue
            entry = {"code": code, "nom": nm, "mrc_norm": norm(mrc), "geom": geom}
            self.by_name.setdefault(norm(nm), []).append(entry)
            # by_code : si plusieurs polygones pour un code (territoires nordiques),
            # on fusionne en union pour avoir une frontière unique.
            if code in self.by_code:
                prev = self.by_code[code]
                try:
                    prev["geom"] = prev["geom"].union(geom)
                except Exception:
                    pass
            else:
                self.by_code[code] = dict(entry)
        self.role_index: Dict[str, Tuple[str, str]] = {}

    def attach_role_index(self, role_index_json: Optional[str] = None,
                          fetch: bool = False) -> int:
        """Charge un index rôle {norm(nom): (code, nom)} pour le fallback code.
        role_index_json : JSON pré-fetché ; fetch=True télécharge l'index MAMH."""
        if role_index_json and os.path.exists(role_index_json):
            raw = json.load(open(role_index_json))
            self.role_index = {k: tuple(v) for k, v in raw.items()}
        elif fetch:
            import urllib.request
            import csv as _csv
            import io as _io
            url = "https://donneesouvertes.affmunqc.net/role/indexRole2026.csv"
            content = urllib.request.urlopen(url, timeout=40).read().decode("utf-8-sig")
            reader = _csv.DictReader(_io.StringIO(content))
            for r in reader:
                cg = (r.get("code géographique") or "").strip()
                nm = (r.get("nom du territoire") or "").strip()
                if cg:
                    self.role_index[norm(nm)] = (cg, nm)
        return len(self.role_index)


# ---------------------------------------------------------------------------
# Résolution slug -> entrée(s) candidate(s)
# ---------------------------------------------------------------------------

def _split_slug(slug: str) -> List[str]:
    """Découpe un slug brut sur le séparateur '--' (avant normalisation, qui
    écraserait '--' en '-') et norme chaque segment. Le 1er segment = nom muni,
    les suivants = MRC / compteur ('2')."""
    raw = slug or ""
    segs = [seg for seg in re.split(r"-{2,}", raw)]
    return [norm(seg) for seg in segs]


def _candidates_for(idx: SDAIndex, slug: str) -> List[dict]:
    """Liste des entrées SDA candidates pour un slug (peut être >1 si homonyme)."""
    s = norm(slug)
    if s in idx.by_name:
        return idx.by_name[s]
    segs = _split_slug(slug)
    # essaie le 1er segment (nom muni) seul, puis des préfixes décroissants
    for i in range(len(segs), 0, -1):
        base = norm("-".join(segs[:i]))
        if base in idx.by_name:
            return idx.by_name[base]
    return []


def resolve_boundary(idx: SDAIndex, slug: str,
                     near: Optional[Tuple[float, float]] = None
                     ) -> Tuple[Optional[dict], str]:
    """Résout un slug cadastre vers UNE entrée SDA (geom). Retourne (entry, method).
    entry=None si aucun match. `near`=(lon,lat) centroïde cadastre pour
    désambiguïser les homonymes par proximité spatiale."""
    s = norm(slug)

    # 0) alias explicite
    if s in ALIAS_SLUG_TO_CODE:
        e = idx.by_code.get(ALIAS_SLUG_TO_CODE[s])
        if e:
            return e, "alias"

    cands = _candidates_for(idx, slug)

    if len(cands) == 1:
        return cands[0], "name"

    if len(cands) > 1:
        # désambig par MRC encodée dans le suffixe '--<mrc>'
        segs = _split_slug(slug)
        suffix_norm = norm("-".join(segs[1:])) if len(segs) > 1 else ""
        if suffix_norm:
            for c in cands:
                if c["mrc_norm"] and (c["mrc_norm"] == suffix_norm
                                      or c["mrc_norm"] in suffix_norm
                                      or suffix_norm in c["mrc_norm"]):
                    return c, "name+mrc"
        # sinon proximité spatiale
        if near is not None:
            pt = Point(near)
            cands = sorted(cands, key=lambda c: c["geom"].distance(pt))
            return cands[0], "name+proximity"
        return cands[0], "name+firstambig"

    # fallback index rôle (code géo) -> geom SDA
    if idx.role_index:
        ri = idx.role_index.get(s)
        if not ri:
            segs = _split_slug(slug)
            for i in range(len(segs), 0, -1):
                base = norm("-".join(segs[:i]))
                if base in idx.role_index:
                    ri = idx.role_index[base]
                    break
        if ri:
            e = idx.by_code.get(ri[0])
            if e:
                return e, "role-index"

    return None, "no-match"


# ---------------------------------------------------------------------------
# Clip
# ---------------------------------------------------------------------------

def clip_slug(idx: SDAIndex, slug: str, in_path: str, out_path: str,
              role_path: Optional[str] = None) -> dict:
    """Clippe le cadastre `slug` à sa frontière SDA. Retourne stats + diagnostic.
    Anti-invention : ne retient QUE les lots dont le centroïde tombe dans la
    frontière muni ; geom inchangée ; aucun ajout."""
    g = json.load(open(in_path))
    feats = g.get("features", [])
    n = len(feats)

    # centroïdes (representative_point) + centroïde global pour désambiguïsation
    cents: List[Optional[Point]] = []
    xs: List[float] = []
    ys: List[float] = []
    for f in feats:
        geom = f.get("geometry")
        if not geom:
            cents.append(None)
            continue
        try:
            c = shape(geom).representative_point()
        except Exception:
            cents.append(None)
            continue
        cents.append(c)
        xs.append(c.x)
        ys.append(c.y)
    near = (sum(xs) / len(xs), sum(ys) / len(ys)) if xs else None

    entry, method = resolve_boundary(idx, slug, near=near)
    if entry is None:
        return {"slug": slug, "before": n, "after": 0, "retained_pct": 0.0,
                "boundary_match": False, "resolve_method": method,
                "out": None}

    muni = entry["geom"]
    pm = prep(muni)
    kept = []
    kept_nolots = set()
    for f, c in zip(feats, cents):
        if c is not None and pm.contains(c):
            kept.append(f)
            nl = str((f.get("properties") or {}).get("NO_LOT") or "").replace(" ", "")
            if nl:
                kept_nolots.add(nl)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": kept}, fh)

    res = {
        "slug": slug,
        "before": n,
        "after": len(kept),
        "retained_pct": round(100 * len(kept) / n, 1) if n else 0.0,
        "boundary_match": True,
        "resolve_method": method,
        "sda_code": entry["code"],
        "sda_nom": entry["nom"],
        "muni_area_deg2": round(muni.area, 5),
        "out": out_path,
    }

    if role_path and os.path.exists(role_path):
        import pyarrow.parquet as pq
        t = pq.read_table(role_path)
        cols = set(t.column_names)
        if "NO_LOT" in cols and "role_usage_cubf" in cols:
            NO = t.column("NO_LOT").to_pylist()
            CU = t.column("role_usage_cubf").to_pylist()
            matched = set((NO[i] or "").replace(" ", "")
                          for i in range(len(NO)) if CU[i] is not None)
            inter = kept_nolots & matched
            res["join_before"] = round(100 * len(matched) / n, 1) if n else 0.0
            res["join_after"] = round(100 * len(inter) / len(kept), 1) if kept else 0.0
            res["matched_coverage"] = (round(100 * len(inter) / len(matched), 1)
                                       if matched else 0.0)
    return res


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--boundaries", required=True,
                    help="GeoJSON municipalités SDA (EPSG:4326)")
    ap.add_argument("--role-index", help="JSON index rôle {norm:(code,nom)} (fallback)")
    ap.add_argument("--fetch-role-index", action="store_true")
    ap.add_argument("--in", dest="in_path")
    ap.add_argument("--out", dest="out_path")
    ap.add_argument("--role", dest="role_path")
    a = ap.parse_args()
    idx = SDAIndex(a.boundaries)
    if a.role_index or a.fetch_role_index:
        idx.attach_role_index(a.role_index, fetch=a.fetch_role_index)
    in_path = a.in_path or "/tmp/lots/%s.geojson" % a.slug
    out_path = a.out_path or "/tmp/clipped/%s.geojson" % a.slug
    r = clip_slug(idx, a.slug, in_path, out_path, a.role_path)
    print(json.dumps(r, ensure_ascii=False))
