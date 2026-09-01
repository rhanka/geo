# §9 acquire-delta — CPTAQ (artefact d'assignation + base build-brief Codex)

> **Statut** : bout `acquire` **ASSIGNÉ à geo-zones** (geo-cond, 2026-08-31). Content-spec
> **RATIFIÉ** par geo-archi (WP6, contrat owner §9). Assemblage runner → geo-cond **arbitre**
> (geo-archi l'a routé comme « wp7 socle BUILD »). **Capture = cluster→S3, JAMAIS local**
> (principe fondateur — la vitesse vient du petit scope, pas du contournement).
>
> Sources de vérité : `docs/spec/SPEC_GEO_ENV_CONSTRAINTS_S9.md` (contrat ConstraintHit 3-états)
> + `docs/spec/AUDIT_D07_SOURCES_ENV_CONSTRAINTS.md` (@789a51c3, axes par source).
> Byte-validation source : commit `d469ba3b`.

## 1. Objet + re-scope owner (2 phases)

Servir la vraie couche env **CPTAQ zone-agricole** captée cluster→S3 **préprod**, clippée à
quelques villes prioritaires, en famille `ca-qc-constraints-<slug>`, pour que la lib §9 **G02**
(geo-archi, constraint-spatial-join EXACT_GEOM) la rende sur la carte préprod.

- **Phase 1 (FAST, cible ~heures→~1j)** : CPTAQ clippé à un petit set de villes prioritaires Steve.
- **Phase 2 (plus tard)** : pleine-échelle + BDZI + GRHQ + audit complet (G02/Porte2).

## 2. Source byte-validée (`d469ba3b`, réseau dispo, 0 shell)

- Dataset CKAN = **`zone-agricole-transposee`** (org CPTAQ, uuid `27ad6922-03a9-42ca-b11d-eef63537cc5a`).
  ⚠ **PAS `zone-agricole-du-quebec`** (= HTTP 404 — correction measure>infer).
- Resource géométrie VALID = **SHP zip** `https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip`
  (HEAD 200 `application/zip`, **36,5 Mo**, ranged GET 206, magic `504b0304`/PK = vrai SHP).
- Couche = **`zone_agricole_s`** (POLYGON ; `zone_agricole_l` = ligne cartographique, EXCLUE).
- Licence = **CC-BY-4.0** (déclarée-rediffusable → licence validée archi, `SPEC_WORKPACKAGES §3`).
- **Pas de WFS/GeoJSON** (SHP = seul producteur vecteur ; WMS documenté en PDF only).
- **CRS source** = dans le `.prj` interne → **lu à l'extraction GDAL (tier-2)**, jamais inventé.

## 3. Le delta runner (6 points — pourquoi `geo-fetch` n'est PAS §9-conformant)

Mesuré @origin/main (`deploy/k8s/job-fetch.yaml`, `packages/geo/src/acquire/acquire.ts`) :

1. **Bucket PROD** (`--out s3://sentropic-geo/normalized`) → §9 exige préprod.
2. **Aucun gate owner-go** (tourne sur `kubectl apply`).
3. **Pas de proof-v2 brut** (`acquire.ts` émet un `.meta.json` = checksum du NORMALISÉ, pas le
   manifeste octets-bruts `url/retrieved_at/sha256/statut → capture/_runs` exigé §5.2).
4. **Layout `<sourceSlug>/<datasetId>`** ≠ `ca-qc-constraints-<slug>` (clip per-city manquant).
5. **SDA-only** (ne fetch pas les constraint sources).
6. **Simplify** `0.0005` en unités-SRS-**source** (amplitude inconnue, CRS non lu) → risque EXACT_GEOM.

## 4. Split (geo-cond) + réutilisation §6 (levier WHEN)

- **Points 1/2/3 (prod-bucket, owner-go-gate, proof-v2-brut) = RÉUTILISER le pipeline §6 gaté de
  pv** (`k8s-capture-run` : design_sha + owner-paste + proof-v2 + préprod-bucket). **NE PAS rebuild.**
  ✅ **CONFIRMÉ pv (preuve code `packages/qc-sources/src/capture/capturedFetch.ts` @37c9ce49)** : le §6
  gère le fetch **BINAIRE 36,5 Mo `application/zip`** SANS adaptateur — binary-safe (Uint8Array, jamais
  décodé texte), content-type agnostic (aucune allowlist), **chemin STREAMING dédié gros-objet**
  (`retainBody:false` → spool S3 haché chunk-par-chunk), `max_bytes` défaut 100 Mio (36,5 << 100).
  Émet proof-v2 brut (sha256 octets → `capture/_runs/<run>/manifest.jsonl` + CAS `raw/<source>/cas/<sha>.zip`
  + sidecar). ⟹ **raw-capture CPTAQ = §6 gaté direct, ZÉRO delta binaire.**
- **Acquire (points 4/6 + clip) = geo-zones (MOI)** : geo-lib (`packages/`, avec test), build **Codex**
  (je spec+vérifie), design/spec = moi + contrat geo-archi.
- **Gate/bucket/job k8s** = k8s/§6. **Contrat serving + G02 render + ratification** = geo-archi.
- **Assemblage runner dédié G02** = geo-cond arbitre (geo-archi : « wp7 socle »).

## 5. Mon acquire-delta (le BUILD — base build-brief Codex)

Module geo-lib enrichissant `acquireRawViaGdal` (l'extract SHP→GeoJSON existe déjà). **Input = le raw
CAS déposé par §6** (`raw/cptaq/cas/<sha>.zip` sur S3 préprod, proof-v2-vérifié ; `source="cptaq"` = id
CAS, pas ville-slug) — mon acquire LIT ce raw, il ne re-fetch pas :

1. **GDAL extract** `zone_agricole_s` → GeoJSON : **lire le `.prj` → enregistrer le CRS SOURCE en
   provenance** ; reprojeter WGS84/EPSG:4326.
2. ⚠ **simplify = NONE** (geo-archi : §9 §2 `EXACT_GEOM` jamais fuzzy). Si nécessaire (36,5 Mo),
   **tolérance en CRS MÉTRIQUE + tracée en provenance, JAMAIS en degrés** (un `0.0005`-en-degrés
   casserait l'EXACT_GEOM).
3. **Clip province→per-city** : intersect les polygones CPTAQ avec les limites ville
   (`qc-municipalites` servi S3 ; `@turf/intersect` déjà en lib) → un GeoJSON par ville.
4. **Layout** `ca-qc-constraints-<slug>` (slug=ville) sur **les 2 layouts** (plat + sous-dossier),
   WGS84, **MultiPolygon**, prop `constraint.kind = cptaq-zone-agricole`.
5. **attrs whitelist** `{Mrc, Date_maj, Zonage}` (D07 provisoire) → **garde au dépôt qui REJETTE
   toute prop non-whitelistée** (no-PII par construction, §6 ; rejet déclarant/propriétaire).
   **FINALISER au tier-2** depuis l'inventaire d'attributs COMPLET + le D07.
6. **Provenance stamp** : `source{dataset:"zone-agricole-transposee", version, artifact_uri:<S3 raw>,
   upstream_uri:ZA_transposee.zip}` + **proof-v2-ref** + **caveat « transposée ≠ plan légal officiel »**
   (D07 ; ⚠ **confirmer que la transposée-au-cadastre est la source AUTORISÉE §9** vs plan légal) +
   **emprise réelle** (bbox/polygon du dataset) servie + versionnée → garde couverture 3-états
   (`hit` / `no-hit-covered` / `not-covered-by-source`).

**Tests** (discipline geo-lib) : fixtures locales, 0 réseau en test ; injecter le runner GDAL.

## 6. Tier-2 (établi À LA CAPTURE — non-inventable read-only, D07 §4)

CRS source du `.prj` · emprise réelle bbox/polygon · inventaire d'attributs COMPLET → whitelist
finale · feature counts + proof-v2. Le manifeste de capture EST la preuve (CLAUDE.md).

## 7. Scope Phase 1 + liste villes (source-gap, PAS inventée)

- Villes = **warden** (ancre G02 reproductible) + **quelques villes prioritaires Steve**.
- ⚠ **La liste top-priorité Steve** (opportunités <6mo / WP B) = **immo / opportunity-scoring
  (i-cond/i-arch)** — **SOURCE-GAP, jamais inventée**. Stopgap possible : **warden + saint-stanislas**
  (ancres démo §9 ratifiées, `no-hit-covered`/`not-covered` visibles) jusqu'à la vraie liste immo.

## 8. WHEN réaliste (minimal few-city, §6 réutilisé)

DESIGN (fait) → **Codex build+test acquire-delta (~heures)** → revue → capture raw §6 + owner-paste
+ fire cluster (**minutes**) → clip+serve. ⟹ **~heures à ~1 jour** pour le 1er CPTAQ clippé sur
quelques villes, **dominé par le build acquire-delta, PAS la data**. « Jours-semaines » = Phase 2.

## 9. Items ouverts (coordination)

- ✅ **pv** : réutilisabilité binaire §6 = **CONFIRMÉE** (ready-now, 0 adaptateur, preuve code). Split fixé.
- ✅ **geo-cond** : stopgap **warden + saint-stanislas = GO** (villes ratifiées, runner city-agnostic →
  1er visible réel, re-run sur la liste Steve après). Runner-assemblage = **Codex** (geo-cond coordonne
  le lancement du brief consolidé : acquire=moi + serving=geo-archi + gate/job=k8s/§6).
- **geo-archi** : confirmer transposée = source AUTORISÉE §9 (vs plan légal, D07) — non-bloquant.
- **immo / i-cond** : liste villes top-priorité Steve (source-gap ; stopgap ratifié entre-temps).

Anti-invention : chaque fait de source (CRS, emprise, whitelist, villes) vient de D07/byte-validation
ou est explicitement **différé au tier-2 / source-gap** — jamais gravé comme acquis.
