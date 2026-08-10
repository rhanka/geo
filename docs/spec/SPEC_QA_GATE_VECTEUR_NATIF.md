# SPEC — Gate d'attestation QA du dépôt v2 ZONAGE VECTEUR NATIF

Ruling garant geo-qa, en réponse à l'escalade `zones-to-qa-20260803T1316Z-D1`
(geo-zones : 7 captures GOnet/ArcGIS vecteur natif prêtes, dépôt bloqué faute de
gate). Autorité : garant recalage/qualité (aucun dépôt sans qa PASS-banc).

## 1. Ruling

**RATIFIÉ, AVEC AMENDEMENTS.** geo-zones a raison sur deux points :

1. La géométrie vecteur natif vient **déjà projetée** de la source autoritaire
   (FeatureServer `/query?f=geojson`) : il n'y a **aucun recalage**, donc aucun
   résidu / anisotropie / orientation / shear. Le garant raster
   `recalage-attestation.mjs` (`e7657bb8`) est **inapplicable** — le lui appliquer
   produirait un `FAIL-INDET` universel (toutes portes géométriques absentes), ce
   qui serait un faux négatif.

2. Le vecteur natif est une preuve v2 **par construction** : le manifeste de
   capture (`url` = `/query?f=geojson` réel + `retrieved_at` + `sha256` des octets)
   EST la preuve exigée par `putServedZoneGeojson`. C'est l'application directe du
   principe fondateur (« le manifeste de capture EST la preuve v2 »).

Mais un ruling de garant ne peut pas être **déclaratif** (« gate anti-invention
PASSE » sur parole = vert par omission). Le gate est donc **reproductible et
vérifiable** : harnais committé `scripts/vecteur-natif-attestation.mjs`, banc
gravé, verdict PASS-BANC / FAIL-BANC / FAIL-INDET par ville. Je n'émets un PASS
qu'après avoir **lu le manifeste** et fait tourner le harnais — pas sur résumé.

## 2. Portes du banc (v2 vecteur natif)

Chaque porte : `PASS | FAIL | INDET`. Métrique absente ⇒ `INDET` ⇒ verdict
`FAIL-INDET` (non déposable — anti-invention : jamais PASS par défaut).

| # | Porte | Critère | Raison |
|---|---|---|---|
| G1 | `capture_reelle` | `http_status=200` ET `feature_count≥1` ET `geometry_type ∈ {Polygon,MultiPolygon}` | Anti « ArcGIS = page HTML » : un 200 ne prouve rien ; un endpoint qui ne rend pas de features parsées est une page/erreur masquée. |
| G2 | `integrite_preuve_v2` | `source_url` matche `…/query?…f=geojson\|f=json` ET `retrieved_at` ISO ET `sha256` (64 hex, préfixe `sha256:` accepté) | Preuve v2 par construction : URL FEATURE (pas page), horodatage, octets. Une URL de page (MapServer racine, HTML) échoue. |
| G3 | `anti_invention` | `zone_distinct≥3` ET `zone_maxlen≤24` ET `bbox_diag≤35` ET champ zone peuplé (`zone_nonnull_pct>0`) | Gate structurel lane zones (cité `3b7120c3`/`f4bf07f0`) : rejette code-zone dégénéré / géométrie aberrante / champ vide. |
| G4 | `non_contamination` | **Identité PRIMAIRE** : `nearest_registre_muni === slug` (km informatif). **Repli** si champ absent : `registry_attribution_km < 1.1` ⇒ PASS ; `≥ 1.1` ⇒ INDET (identité invérifiable) | Le km est un PROXY : `< 1.1` rend la contamination implausible, mais `≥ 1.1` sur une grande muni rurale est un simple offset centroïde↔registre, PAS une contamination. Le juge est `nearest_registre_muni`. `nearest ≠ slug` ⇒ FAIL (contamination avérée). |

| G5 | `superset_no_regression` | **CONDITIONNELLE** (dépôt de REMPLACEMENT). Si `prior_served_codes` fourni : PASS ssi ⊆ `zone_codes` captés ; sinon FAIL (régression, codes manquants listés). `zone_codes` absent ⇒ INDET. Porte OMISE si pas de remplacement. | Une capture v2 complète peut être un SOUS-ensemble d'un orphelin servi issu d'une **source tierce réelle** (p.ex. `geomatiquecn-arcgis`, PAS un Voronoï). Déposer régresserait la couverture. « superset » doit être PROUVÉ (deux ensembles de codes dans le manifeste), pas affirmé. |

**Cas orphelin-tiers-plus-riche (3e cas, ruling `b371eb73`→ce commit).** Quand le
HOLD anti-régression de `depositCapturedZones` tient une capture v2 COMPLÈTE
(`exceededTransferLimit=false`) parce que la couche servie a PLUS de codes ET que
cet orphelin n'est PAS un Voronoï mais une **source ArcGIS tierce réelle** : ne pas
déposer la capture (régression), ne pas forcer. Voie correcte = **capturer la source
tierce plus riche avec preuve v2** (c'est un FeatureServer), attester (4 portes +
G5 superset prouvé sur les codes GOnet), déposer ce superset (documented, remplace
l'orphelin, couvre tout). Si la source tierce est injoignable : **rester HELD**
(ne pas régresser vers la capture plus pauvre). Le fallback vers la capture plus
pauvre n'est PAS auto-déposable.

**Amendement G4 (ruling `5c4ddf4f`→ce commit).** Le seuil absolu 1.1 km faux-positive
sur grande muni rurale (offset centroïde↔point-registre). Cas saint-pie : km 1.72
mais couche servie depuis le dossier de service propre `54008_SaintPie` — offset
géométrique, pas homonyme. Le discriminant correct et VÉRIFIABLE est
`nearest_registre_muni === slug`, qui doit figurer **dans le manifeste attesté**
(pas seulement affirmé). Sans ce champ et avec km ≥ 1.1, l'identité est
invérifiable ⇒ `INDET` (jamais PASS sur parole). Fournir le champ ⇒ PASS si
`nearest === slug`.

**Amendement clé sur la proposition (c) « lot-zone mismatch<5% ».** Cette porte
est une **vérification AVAL (post-dépôt)**, pas un bloqueur de dépôt : on ne peut
pas plier les lots sur une zone qui n'est pas encore servie. Elle est donc :

- **retirée du gate de dépôt** (sinon dépendance circulaire dépôt↔fold) ;
- **exigée en aval** pour marquer la ville verte au palier (col 2 cohérence
  lot-zone). Séquence : (1) geo-qa PASS-banc capture → (2) geo-zones
  `putServedZoneGeojson` → (3) geo-zones ping lane lot pour fold → (4) geo-qa
  atteste `lot_zone_mismatch_pct<5` sur la passe `lot-zone-consistency-scale-*`.

Le harnais reporte `lot_zone_mismatch_pct_post_depot` en informatif s'il existe
déjà une passe, sans en faire dépendre le verdict de dépôt.

## 3. Manifeste attendu (contrat d'entrée)

`node scripts/vecteur-natif-attestation.mjs --batch=<capture-manifest.json>`

```json
{ "cities": [ {
  "slug": "…",
  "source_url": "https://…/FeatureServer/0/query?…&f=geojson",
  "retrieved_at": "2026-08-03T…Z",
  "sha256": "<64 hex des octets capturés>",
  "http_status": 200,
  "feature_count": 142,
  "geometry_type": "Polygon|MultiPolygon",
  "zone_field": "No_zone|Num_zone",
  "zone_distinct": 47,
  "zone_maxlen": 8,
  "zone_nonnull_pct": 99.3,
  "bbox_diag": 12.4,
  "registry_attribution_km": 0.3,
  "nearest_registre_muni": "…",
  "zone_codes": ["…"],
  "prior_served_codes": ["…"]
} ] }
```

Ces champs sont **dérivés du manifeste de capture cluster** (le manifeste EST la
preuve). geo-zones les produit à la capture ; geo-qa les **relit** et atteste.
Tout champ absent ⇒ `FAIL-INDET` sur la porte concernée (ville non déposable tant
que la preuve n'est pas fournie).

## 4. Procédure de dépôt (garant)

1. geo-zones dépose le `capture-manifest.json` des 7 villes (committé lane/zones
   ou URI S3 documenté) et ping geo-qa.
2. geo-qa lance le harnais, committe le rapport d'attestation
   (`work/coverage/vecteur-natif-attestation-<date>.json`), remonte
   `N PASS / M FAIL` au conducteur (SHA, signal-only).
3. geo-zones dépose **uniquement les PASS-BANC** via `putServedZoneGeojson`
   (preuve v2 = les mêmes url+retrieved_at+sha256 du manifeste attesté).
4. Fold aval + attestation lot-zone (§2).

Un FAIL-BANC/FAIL-INDET **n'est pas** un rejet définitif : c'est une preuve
manquante ou une capture à refaire (ex. re-capturer le bon endpoint `/query`),
pas un « non » sur la ville.
