#!/usr/bin/env python3
"""Gestionnaire de demandes d'acquisition geo (cadre province-wide).
Intake (city, data_types) -> valide périmètre -> état/couverture -> plan -> track -> (escalade).
Ce module = le cœur du cadre ; les orchestrateurs (grid/bylaw/lot-attrs) sont branchés ensuite.
"""
import json, urllib.request, sys, time, os
API="https://api.geo.sent-tech.ca/collections"
REGISTRY="/home/antoinefa/src/_acquisition-shared/acquisition-registry.json"
DATA_TYPES=("zoning_grid","zoning_bylaw","lot_attributes")

def served_ids():
    d=json.load(urllib.request.urlopen(API,timeout=40))
    return set(c["id"] for c in d.get("collections",[]))

def in_scope(slug, annuaire):
    # périmètre geo = municipalité QC connue de l'annuaire
    return slug in annuaire or any(slug==k or slug.startswith(k) for k in annuaire)

def coverage(slug, ids):
    grid = ("qc-zonage-"+slug) in ids
    lots = ("qc-lots-"+slug) in ids
    # bylaw / lot_attributes : registres dédiés (pas encore acquis -> False)
    reg=load_registry().get(slug,{})
    return {
        "zoning_grid": "served" if grid else "missing",
        "lots_geom": "served" if lots else "missing",
        "zoning_bylaw": reg.get("zoning_bylaw","missing"),
        "lot_attributes": reg.get("lot_attributes","missing"),
    }

def load_registry():
    if os.path.exists(REGISTRY):
        try: return json.load(open(REGISTRY))
        except: return {}
    return {}

def save_registry(r): json.dump(r,open(REGISTRY,"w"),ensure_ascii=False,indent=0)

def handle_batch(cities, annuaire):
    ids=served_ids()
    reg=load_registry()
    rows=[]
    for c in cities:
        scope = in_scope(c, annuaire)
        cov = coverage(c, ids) if scope else {"_":"hors-périmètre"}
        reg.setdefault(c,{}).update({"last_seen_coverage":cov,"in_scope":scope})
        rows.append((c,scope,cov))
    save_registry(reg)
    return rows

if __name__=="__main__":
    # annuaire (slugs municipaux QC)
    try:
        ann=json.load(open("/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json"))
        annuaire=set(ann.keys()) if isinstance(ann,dict) else set(x.get("slug") for x in ann if x.get("slug"))
    except: annuaire=set()
    cities=sys.argv[1:] if len(sys.argv)>1 else []
    rows=handle_batch(cities, annuaire)
    print(f"{'VILLE':40} {'scope':6} {'grille':8} {'lots':8} {'règlement':10} {'attr-lot':9}")
    for c,sc,cov in rows:
        print(f"{c:40} {'oui' if sc else 'NON':6} {cov.get('zoning_grid','?'):8} {cov.get('lots_geom','?'):8} {cov.get('zoning_bylaw','?'):10} {cov.get('lot_attributes','?'):9}")
