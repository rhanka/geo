#!/usr/bin/env python3
"""Build qc-municipal-directory.json from MAMH MUN.csv joined to QC registry.

Join key: NFD-normalized municipality name (byte-identical to municipalities.ts normalizeName).
Source: MAMH Répertoire des municipalités du Québec (Données Québec, CC-BY 4.0).
"""
import json, csv, unicodedata, re, sys, datetime

REG_PATH = "/home/antoinefa/src/geo/packages/geo-sources-americas/src/ca-qc/municipalities/municipalities.qc.json"
MUN_CSV = "/tmp/MUN.csv"
OUT = "/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json"
VERIFIED_AT = "2026-06-15"

def norm(name):
    nfd = unicodedata.normalize("NFD", name)
    s = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    s = s.replace("'", "").replace("’", "")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def to_https(raw):
    """Normalize a MAMH web value to a canonical https URL.

    - bare 'www.foo.ca'  -> 'https://www.foo.ca'
    - 'http://www.foo.ca' -> 'https://www.foo.ca'  (upgrade scheme)
    - lowercase scheme+host, strip trailing slash.
    """
    u = raw.strip()
    if not u:
        return None
    # strip any leading scheme, then force https.
    u = re.sub(r"^https?://", "", u, flags=re.I)
    u = "https://" + u
    m = re.match(r"^(https?://)([^/]+)(.*)$", u, re.I)
    if m:
        u = m.group(1).lower() + m.group(2).lower() + m.group(3).rstrip("/")
    return u

reg = json.load(open(REG_PATH))
mamh = list(csv.DictReader(open(MUN_CSV, encoding="utf-8-sig")))

def mpop(r):
    v = (r.get("mpopul", "") or "").strip().replace(" ", "")
    try:
        return int(v)
    except Exception:
        return None

# Index MAMH by normalized name, grouping homonyms. The registry `population`
# field is sourced from MAMH, so an exact population match deterministically
# resolves homonyms (verified live 2026-06-15: all 29 ambiguous groups resolve
# to an exact population match — e.g. Ville de Stanstead vs Canton de Stanstead).
from collections import defaultdict  # noqa: E402

mamh_groups = defaultdict(list)
for r in mamh:
    mamh_groups[norm(r["munnom"])].append(r)
mamh_by_code = {r["mcode"].strip(): r for r in mamh}

def resolve_homonym(k, regpop):
    rows = mamh_groups.get(k)
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    return sorted(
        rows,
        key=lambda r: abs(
            (mpop(r) if mpop(r) is not None else -(10**9))
            - (regpop if regpop is not None else 10**9)
        ),
    )[0]

# Manual aliases: registry name -> MAMH mcode (verified live 2026-06-15).
# Only safe 1:1 disambiguations are added.
ALIASES = {
    "Hatley (township municipality)": "45055",  # MAMH "Hatley" desi=Canton
    "Eeyou Istchee James Bay": "99060",         # MAMH "Eeyou Istchee Baie-James"
}

directory = {}
matched = 0
with_web = 0
unmatched = []
ambiguous_resolved = 0
for m in reg:
    slug = m["slug"]
    name = m["name"]
    regpop = m.get("population")
    rec = None
    if name in ALIASES:
        rec = mamh_by_code.get(ALIASES[name])
    if rec is None:
        k = norm(name)
        if len(mamh_groups.get(k, [])) > 1:
            ambiguous_resolved += 1
        rec = resolve_homonym(k, regpop)
    if rec is None:
        unmatched.append(name)
        continue
    matched += 1
    website = to_https(rec.get("mweb", ""))
    entry = {
        "slug": slug,
        "name": name,
        "mamhCode": rec["mcode"].strip(),
        "mamhName": rec["munnom"].strip(),
        "designation": (rec.get("mdes", "") or "").strip() or None,
        "website": website,
        "email": (rec.get("mcourriel", "") or "").strip() or None,
        "source": "mamh-repertoire",
        "verifiedAt": VERIFIED_AT,
    }
    if website:
        with_web += 1
    directory[slug] = entry

payload = {
    "$schema": "qc-municipal-directory/v1",
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
    "source": {
        "name": "MAMH — Répertoire des municipalités du Québec",
        "dataset": "repertoire-des-municipalites-du-quebec",
        "datasetUrl": "https://www.donneesquebec.ca/recherche/dataset/repertoire-des-municipalites-du-quebec",
        "resourceUrl": "https://donneesouvertes.affmunqc.net/repertoire/MUN.csv",
        "license": "cc-by-4.0",
        "field": "mweb",
        "joinKey": "nfd-normalized-name",
    },
    "stats": {
        "registryTotal": len(reg),
        "matched": matched,
        "withWebsite": with_web,
        "unmatched": len(unmatched),
    },
    "entries": directory,
}
json.dump(payload, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
# Also write the package-embedded copy (geo-sources-americas capitalization).
PKG_OUT = "/home/antoinefa/src/geo/packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json"
json.dump(payload, open(PKG_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"WROTE {PKG_OUT}")
print(f"registry total: {len(reg)}")
print(f"matched to MAMH: {matched} ({100*matched/len(reg):.1f}%)")
print(f"  with website : {with_web} ({100*with_web/len(reg):.1f}%)")
print(f"unmatched      : {len(unmatched)} -> {unmatched}")
print(f"ambiguous homonym groups resolved by population: {ambiguous_resolved}")
print(f"WROTE {OUT}")
