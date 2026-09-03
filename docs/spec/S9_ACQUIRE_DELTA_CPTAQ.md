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
5. **attrs whitelist — MESURÉE 2026-09-02** (k8s `ogrinfo -so` + dry-serve sur le raw capté préprod,
   layer `zone_agricole_s` ; measure>infer, **fin du provisoire**) → **garde au dépôt qui REJETTE
   toute prop non-whitelistée** (no-PII par construction, §6 ; rejet déclarant/propriétaire) :
   - Champs `.dbf` = **MINUSCULE verbatim** : `id`(Integer), `mrc`(String), `zonage`(String),
     `date_maj`(Date). ⚠ L'ancien `{Mrc,Date_maj,Zonage}` (uppercase-first) était **PROVISOIRE/FAUX**
     → les 2 gardes (`assertCptaqSourceProperties` transform + `assertCptaqDepositGuard` dépôt) keyant
     sur les noms exacts droppaient/rejetaient les props (bug latent). Whitelist servie =
     **`{mrc, zonage, date_maj}`** (casse verbatim) ; **drop `id`** (Integer volatile, hors servi+hash).
   - Faits mesurés : `mrc = null` sur les **1446** features ; `zonage ∈ {"Zone agricole":510,
     "Zone non agricole":936}` ; géométries **100% Polygon** → promues MultiPolygon post-clip.
   - ⏳ 2 décisions geo-archi pending : `mrc`=null → serve-null vs drop ; `constraint_ref` (voir §6).
6. **Provenance stamp** : `source{dataset:"zone-agricole-transposee", version, artifact_uri:<S3 raw>,
   upstream_uri:ZA_transposee.zip}` + **proof-v2-ref** + **caveat « transposée ≠ plan légal officiel »**
   (D07 ; ⚠ **confirmer que la transposée-au-cadastre est la source AUTORISÉE §9** vs plan légal) +
   **emprise réelle** (bbox/polygon du dataset) servie + versionnée → garde couverture 3-états
   (`hit` / `no-hit-covered` / `not-covered-by-source`).

**Tests** (discipline geo-lib) : fixtures locales, 0 réseau en test ; injecter le runner GDAL.

## 6. Tier-2 — MESURÉ 2026-09-02 (k8s `ogrinfo -so` + dry-serve sur le raw capté ; fin du provisoire)

Mesure indépendante de k8s (préprod+gdal ; schéma OBJECTIF, distinct du seal d'intégrité qui reste
sur cred RO) ; réconciliée + engravée par geo-zones (runner-owner) ; ratifiée par geo-archi (G02).

- **Schéma `.dbf`** (verbatim minuscule) : `id`(Integer) / `mrc`(String) / `zonage`(String) /
  `date_maj`(Date). Whitelist finale SERVIE = `{mrc, zonage, date_maj}` (casse verbatim) ; **drop `id`**.
- **Attributs mesurés** : `mrc = null` ×1446 ; `zonage ∈ {"Zone agricole":510, "Zone non agricole":936}` ;
  géométries **100% Polygon** (→ MultiPolygon post-clip, contrat servi).
- **G02 ruling (a) — RATIFIÉ geo-archi** : features servies = **`zonage == "Zone agricole"`** (510) ;
  **emprise = dataset COMPLET (1446, les 2 classes)** → couverture 3-états `no-hit-covered` prouvée par
  l'emprise (PAS par des features non-agricole servies, qui seraient trompeuses sous `cptaq-zone-agricole`).
  `date_maj` + `mrc` = **servis métadonnée, HORS hash**.
- **constraint_ref** = `sha256(géométrie RAW canonique [+ zonage])` — ⏳ zonage-in-hash **REDONDANT**
  sous agricole-only (zonage constant) → résolution geo-archi pending : `sha256(géométrie)` seule
  (reco geo-zones, cohérent mrc-out) vs zonage-tag-constant explicite.
- ⏳ pending geo-archi : `mrc`=null → serve-null (fidèle-schéma) vs drop-du-servi.
- **Sémantique zonage** : « Zone agricole » = DANS la zone protégée LPTAA (la contrainte) ;
  « Zone non agricole » = HORS/non-protégé (inférence domaine geo-zones ; sens EXACT — zone blanche vs
  îlots déstructurés — dans `A_Lire_zone_agricole_transposee.pdf`, NON-LU : préprod AccessDenied + pas de
  re-scrape local, règle cluster). Ruling (a) robuste quel que soit le sens exact.
- CRS source du `.prj` + feature counts finaux (agricole-only/ville) + proof-v2 = mesurés à la capture ;
  le manifeste de capture EST la preuve (CLAUDE.md). **Counts servis (a) NON canoniques avant le seal
  OGC read-only de geo-zones** (aucun compte CPTAQ annoncé avant scellage).

## 7. Scope Phase 1 + liste villes (SOURCÉE — contrat committé, PAS inventée)

- **Liste top-priorité Steve = RÉSOLUE** (i-arch ; source = contrat committé+testé
  `api/src/services/graph/bprime-recette.fixture.ts:139-170` `BPRIME_STEVE30_CONTRACT_CITIES` —
  anti-invention, pas dérivé/deviné). Steve ≥6/10, slugs **EXACTS** :
  `saint-stanislas-de-kostka`(10) · `sutton`(10) · `saint-raphael`(10) · `saint-raymond`(9) ·
  `saint-boniface`(8) · `coaticook`(8) · `saint-mathieu-de-beloeil`(7) · `saint-amable`(7) ·
  `mont-saint-hilaire`(7) · `saint-gilbert`(6).
- ⚠ **CORRECTION slug (i-arch)** : le Steve-10 = **`saint-stanislas-de-kostka` EXACT**, **PAS
  `saint-stanislas`** bare (= une AUTRE ville). 4 slugs distincts (`saint-stanislas` /
  `saint-stanislas-de-kostka` / `saint-stanislas--des-chenaux` / `saint-stanislas--maria-chapdelaine`) ;
  cross-check oracle-72 `bylaw-saint-stanislas-de-kostka-451-2025`.
- **Ordre 1er livrable (le plus SOLIDE, i-arch)** : (1) **warden** (pilote env-layer désigné par Steve,
  raw meeting l.95) → (2) **sutton + coaticook** (offline-PROUVÉS = nœuds réels committés) →
  (3) **saint-stanislas-de-kostka + saint-raphael** (Steve-10) → (4) saint-raymond / saint-boniface /
  saint-mathieu-de-beloeil / saint-amable / mont-saint-hilaire / saint-gilbert. Runner **city-agnostic**
  → re-run sur la liste. (Priorité DOCUMENTÉE Steve = la recette, pas le live-scoring `opportunites.ts` —
  i-cond le redemande si l'owner veut le live-computed <6-mois.)

## 8. WHEN réaliste (minimal few-city, §6 réutilisé)

DESIGN (fait) → **Codex build+test acquire-delta (~heures)** → revue → capture raw §6 + owner-paste
+ fire cluster (**minutes**) → clip+serve. ⟹ **~heures à ~1 jour** pour le 1er CPTAQ clippé sur
quelques villes, **dominé par le build acquire-delta, PAS la data**. « Jours-semaines » = Phase 2.

## 9. Items ouverts (coordination)

- ✅ **pv** : réutilisabilité binaire §6 = **CONFIRMÉE** (ready-now, 0 adaptateur, preuve code). Split fixé.
- ✅ **geo-cond** : stopgap **warden + saint-stanislas = GO** (villes ratifiées, runner city-agnostic →
  1er visible réel, re-run sur la liste Steve après). Runner-assemblage = **Codex** (geo-cond coordonne
  le lancement du brief consolidé : acquire=moi + serving=geo-archi + gate/job=k8s/§6).
- ✅ **geo-archi** : **served-family/taxonomie `ca-qc-constraints` CONFIRMÉE** (distincte de `qc-zonage` ;
  mon acquire la produit) + **transposée = source §9 AUTORISÉE CONFIRMÉE** (seul vecteur dispo + produit
  officiel CPTAQ + cadastre-alignée → join EXACT_GEOM plus propre ; caveat servi). ⚠ Contingence : usage
  **légal-autorité** ultérieur = plan décrété = **source SÉPARÉE** (hors §9-coverage) Phase-later.
- ✅ **CAPTURE-lane = `constraints` APPROUVÉ (geo-cond)** : le runner déployé @37c9ce49 n'avait PAS
  `constraints` dans `CAPTURE_LANES` (pv) → **Codex l'AJOUTE à l'enum** (coût mineur deploy accepté vs le
  `zones`-ready-now, pour la propreté + future-proof BDZI/GRHQ). ⟹ **nouveau `runner_git`** post-enum-add
  + deploy → **le design_sha pv se RECOMPUTE** pour `lane=constraints` (le candidat `7a3c9374` calculé pour
  `lane=zones` est SUPERSEDÉ). La capture séquence **après** le build+deploy Codex (qui ajoute la lane).
  CAS source-keyed `raw/cptaq/…` ; served-taxonomie `ca-qc-constraints` (mon acquire) inchangée.
- ⚠ **Worklist RUNNER = bare-array `[{slug,source,urls}]` STRICT** (pv, `parseCaptureWorklist` =
  `z.array(TargetSchema.strict())`) : métadonnées (license/caveat/byte-validation/…) → **sidecar**, PAS
  dans le worklist runner. Fichier runner = `work/coverage/cptaq-capture-worklist-runner-20260831.json` ;
  sidecar riche = `cptaq-capture-worklist-20260831.json`.
- **immo / i-cond** : liste villes top-priorité Steve (source-gap ; stopgap warden+saint-stanislas ratifié entre-temps).

Anti-invention : chaque fait de source (CRS, emprise, whitelist, villes) vient de D07/byte-validation
ou est explicitement **différé au tier-2 / source-gap** — jamais gravé comme acquis.
