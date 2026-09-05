# Design-doc refresh full-auto — SECTION ACQUISITION (geo)

**Track** : `01M1S25MVCND04YZN76KTVNGAE` (i-cond consolide en doc canonique immo).
**Auteur** : geo-zones. **Sous-domaine** : ACQUISITION (délégué geo-cond [bccb1f]).
**Base** : inventaire committé `work/coverage/acquisition-refresh-pipeline-inventory-20260905.md` (a2ecc538).
**Contrainte owner** : fraîcheur = **juin system-wide** → **RE-SCRAPER** (fetch frais journalisé cluster→S3), PAS re-projeter. Réduit aux **SEULS composants nécessaires**. Capture JAMAIS locale.
**Seam** : geo = **PRODUCTEUR de données**. Le `canonical-graph + atomic-PG-writer` est **IMMO-owned** (i-arch, `graph-store.ts` + projection). Mon acquisition l'ALIMENTE par contrat (cadré i-arch+geo-cond après cet inventaire).

## (i) Reusable / À-créer / Réduire (résumé — détail dans a2ecc538)
- **Reusable** : `acquisition/src/k8s-capture-run.ts` (capture cluster→S3, image geo-capture, proof-v2) ; `k8s-shard-run.ts` + `deploy/acquisition-job/` (fan-out shardé, idempotent HEAD-skip, quota-safe) ; pattern CronJob auto-suspend (`deploy/capture-job/cronjob-capture-refresh.yaml`) ; manifests (CPTAQ / `ca-qc-constraints/{bdzi,grhq}/manifest.ts` / sources zonage) ; deposit+proof-v2 (`putServedZoneGeojson`/`Additive`, `depositCapturedZones` readback G5) ; re-stamp (`zones-*-replace.ts`, `_restamp-served-from-proof.ts`) ; coverage (`scripts/portfolio-city-report.mjs`) ; sourcing (audit 8da8863d, discovery 5de9020f, null-zone-sourcing-20260724, reglement-provenance).
- **À-créer** : acquire-delta BDZI/GRHQ (NOT_ACQUIRED) ; orchestration refresh **unifiée** (câbler capture→acquire→deposit→coverage + généraliser le cron) ; **deposit-JOB on-cluster** (recettes locales → job k8s/CI ; jamais agent local en prod) ; auto-gen worklist (per-muni depuis manifests+directory) ; trigger fraîcheur (proof-v2 retrieved_at) ; périmètre IA nécessaire.
- **Réduire** : consolider one-off `_zones-vnatif-*`/`_*-probe` → lib ; chemin UNIQUE capture/acquire/deposit paramétré par source-type ; retirer proof legacy.

## (ii) Flux full-auto RE-SCRAPE (réduit aux composants nécessaires)
Chaîne re-runnable sur cluster, chaque étape idempotente + journalisée S3 :

1. **Trigger fraîcheur** (À-CRÉER) : détecte stale (proof-v2 `retrieved_at` < seuil ; juin = tout stale) → arme le run. Cron généralisé (pattern auto-suspend réutilisé).
2. **Worklist auto-gen** (À-CRÉER) : depuis les manifests sources + `municipal-directory.qc.json` → worklists bare-array STRICT `{slug,source,urls}` par couche/muni (1106 zonage + constraints). **Régénérée à chaque run** = re-scrape, pas re-project.
3. **CAPTURE = SCRAPE frais** (REUSABLE `k8s-capture-run`/`k8s-shard-run`) : cluster→S3, `capturedFetch` → CAS `raw/…/<sha>.bin` + manifest proof-v2 (`url`, `retrieved_at`, `sha256`, http_status). **Jamais locale.** Owner-gated (design_sha + owner-paste session k8s).
4. **ACQUIRE** (REUSABLE zonage ; À-CRÉER BDZI/GRHQ) : depuis le CAS attesté → extract (GDAL/ogr2ogr, Mistral pour PDF-normes) → reproject WGS84 → normalise `zone_code` **brut verbatim source** (jamais dérivé) + tag constraint.
5. **DEPOSIT on-cluster** (REUSABLE recettes ; À-CRÉER le JOB) : `depositCapturedZones` → serve 2 layouts (flat+nested) + proof-v2 par-feature + re-stamp provenance ; gate identité, backup `_replaced/`, dropped→UNKNOWN, **readback G5**. Prod-write **on-cluster/CI owner-gaté** (jamais agent local).
6. **COVERAGE gate** (REUSABLE `portfolio-city-report`) : mesure présence+provenance+qualité /1106, unknown≠complete → verdict du refresh.

**IA (réduite au nécessaire)** : découverte de source (sous-agent discovery, cf. discovery-217) + extraction PDF→normes/zone_code (Mistral, déjà dans acquisition-job) + classification attribute_map-vs-vrai-code. À trancher (owner/coût) : lesquels sont dans le refresh récurrent vs one-shot.

## (iii) Ce que l'acquisition PRODUIT vers le graphe canonique (ANCRE DU CONTRAT geo→graphe)
Interface = **collections servies S3 `normalized/` + API OGC** (`/collections/<id>/items`). Immo (`graph-store.ts`) projette DEPUIS ça. Outputs produits :

| Output | Collection(s) | Géométrie | Propriétés-clés | Statut RÉEL |
|---|---|---|---|---|
| **Contraintes env — CPTAQ** | `ca-qc-constraints-<slug>` | MultiPolygon WGS84 | `{zonage, date_maj}` ; `constraint.kind=cptaq-zone-agricole` ; `constraint_ref=cptaq-zone-agricole:sha256(RAW géom)` ; meta CC-BY | **SERVI préprod (4 villes** warden/ssk/sutton/coaticook, 6 features agricole-only) |
| **Contraintes env — BDZI** | `qc-bdzi-flood-zones` | Polygon WGS84 | zone inondable (Description, No_rapport) ; proof-v2 ; CC-BY | **NOT_ACQUIRED** (couche 22, 621 poly mesuré) |
| **Contraintes env — GRHQ** | `qc-grhq-waterbodies` / `qc-grhq-network` | Polygon / Polyline WGS84 | hydro (TYPECE, PERENNITE, Strahler) ; proof-v2 ; CC-BY | **NOT_ACQUIRED** (104=3,76M + 101 province-scale) |
| **Vraies zones** | `qc-zonage-<slug>` (2 layouts) | MultiPolygon WGS84 | **`zone_code` = code bylaw RÉEL verbatim source (ex. « H-12 », jamais dérivé H/R)** ; `zone_source_url` ; `zone_source_level` ; grille | **868/1106 servies**, 238 absentes (audit 8da8863d) ; LOT-1=16 prêtes (worklist eaa9c24c byte-frozen 2fd957d1) |
| **Provenance v2** (transverse) | sur chaque collection/feature | — | `proof.geometry_source = {url, retrieved_at, sha256}` ; + provenance règlement (`reglement_numero`/`reglement_url`, lane reglements) | proof-v2 exacte partielle ; re-stamp full-auto = objectif refresh |

**Contrat d'alimentation (à cadrer i-arch+geo-cond)** : geo garantit, par collection servie, géométrie WGS84 + `zone_code`/`constraint.kind` + proof-v2 ; immo projette dans le graphe canonique (atomic-PG-writer) SANS re-dériver la donnée geo. La zone_code réelle (verbatim) est la clé de jointure lot⋈zone (`canonicalizeZoneCodeForJoin`). **geo n'écrit PAS dans le graphe/PG** — il dépose S3+OGC, immo consomme.

## LOT-1 vraies-zones (s'inscrit dedans)
Owner-gate parké valide ; go-line binaire A/B (`d81f5298 @ 81912cdc` OU `ab4f2145 @ 5d257a99`, selon certif k8s runner_git) ; premier fruit du flux (ii) : capture k8s→S3 → deposit on-cluster → 16 `qc-zonage-<slug>` avec `zone_code` réel → alimente le graphe.

## Questions ouvertes (pour la convergence)
- Contrat geo→graphe : format exact de l'item OGC consommé par `graph-store.ts` (champs requis/optionnels) — i-arch cadre.
- Deposit-job : réutilise `geo-s3-credentials` on-cluster (scope write `normalized/`) — confirmer.
- Cron unifié multi-couches vs N crons ; worklist full-1106 vs incrémental-fraîcheur.
- Périmètre IA minimal (owner/coût).
