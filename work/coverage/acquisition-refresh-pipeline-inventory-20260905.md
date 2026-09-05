# Pipeline refresh full-auto — inventaire ACQUISITION (REUSABLE vs À-CRÉER vs RÉDUIRE)

**Sous-domaine** : ACQUISITION (geo), délégué par geo-cond [bccb1f] dans le cadre du top-prio owner
« pipeline refresh 100% automatisé sur k8s cluster-mesh, toutes couches, réduit aux SEULS
composants nécessaires, IA comprise ». Contribution au design-doc commun geo↔immo (track à venir d'i-cond).
**Auteur** : geo-zones. **Date** : 2026-09-05. **Mesuré** (fichiers/commits cités), pas projeté.

## Contrainte owner cardinale
Fraîcheur = **juin system-wide** (818/821 villes scrapées juin) → le full-auto doit **RE-SCRAPER**
(fetch frais journalisé cluster→S3), **PAS juste re-projeter**. Discipline fondatrice : **capture = cluster→S3,
JAMAIS locale** ; deposit prod = on-cluster/CI owner-gaté, jamais agent local.

## Périmètre ACQUISITION (couches)
- **Environnementales (constraints)** : CPTAQ (servi préprod 4 villes ca-qc-constraints-*) ; **BDZI** (couche 22, 621 poly, mesuré) et **GRHQ** (104=3,76M + 101 linéaire) = **NON acquises** (manifestes dormants).
- **Vraies zones (qc-zonage)** : LOT-1 = 16 villes prouvées (worklist eaa9c24c) ; couverture 868/1106 servies, 238 absentes (audit 8da8863d) ; LOT-2 re-stamp null-provenance vérifiés (null-zone-sourcing-20260724) ; LOT-3 discovery-217 (GATÉ Altus 503).

## RÉUTILISABLE (mesuré — existe et prouvé)
| Composant | Réf | Rôle refresh |
|---|---|---|
| Capture-on-cluster | `acquisition/src/k8s-capture-run.ts` (image `geo-capture`, worklist bare-array STRICT `{slug,source,urls}`, cluster→S3 CAS + manifest proof-v2) | le SCRAPE frais journalisé (url+retrieved_at+sha256). Owner-gated (design_sha+owner-paste). |
| **Orchestrateur shardé** | `acquisition/src/k8s-shard-run.ts` + `deploy/acquisition-job/` (image `geo-acquisition:0.1.0`, split N shards, discover+extract, **idempotent HEAD-skip S3**, quota-safe ~2 pods) | fan-out province-wide re-runnable — SOCLE de l'orchestration full-auto (pas from-scratch). |
| **Pattern CronJob auto-suspend** | `deploy/capture-job/cronjob-capture-refresh.yaml` (S3-state, lease-lock, RBAC, quota, self-suspend à l'état terminal ; orchestrateur `pv-capture-backlog-run.ts`) | scaffold cron réutilisable pour le déclenchement périodique (actuellement pv-spécifique → à généraliser). |
| Manifests sources | CPTAQ §9 ; `ca-qc-constraints/{bdzi,grhq}/manifest.ts` ; sources zonage (geocentralis WFS, victoriaville MapServer, ArcGIS/AGOL, Données Québec, MRC Coaticook) via worklists + `null-zone-sourcing-20260724` | déclaratif d'acquisition par couche/ville. |
| Deposit + proof-v2 | `putServedZoneGeojson` (géom neuve, proof-v2 exigée) / `putServedZoneAdditive` ; `depositCapturedZones` (2 layouts, gate identité, backup `_replaced/`, dropped→UNKNOWN, readback G5) | serve + preuve par construction. |
| Recettes deposit par provider | geocentralis lot-D ; `_zones-vnatif-deposit-victoriaville` (couche partagée, résolution champ code-zone overlap≥90%, anti-troncature, anti-homonyme) | normalisation→serve par gisement. |
| Re-stamp provenance | `zones-*-replace.ts` ; `_restamp-served-from-proof.ts` | re-stampe dans la même passe (LOT-2). |
| QC couverture | `scripts/portfolio-city-report.mjs` (déterministe, 0-network, univers 1106, présence+provenance+qualité, unknown≠complete) | gate de complétion du refresh. |
| Artefacts sourcing/assessment | audit 8da8863d, discovery 5de9020f, null-zone-sourcing-20260724, assessment BDZI/GRHQ 38d9f7f4, reglement-provenance.json | connaissance source par ville (0 re-découverte à froid). |
| Refresh CLI / plan | `packages/geo/src/cli/commands/refresh.ts` ; `acquisition/src/norms-manifest-refresh.ts` ; `pv-refresh-plan.ts` | primitives de re-plan (à câbler dans l'orchestration unifiée). |

## À-CRÉER (mesuré — manque)
1. **Acquire-delta BDZI/GRHQ** : manifestes existent, AUCUN code acquire→serve (comme §9 CPTAQ en avait un). BDZI = trivial (621, §7-style). GRHQ = province-scale (3,76M+) → design paging vs **bulk FGDB/GPKG** (reco), routé geo-archi (assessment 38d9f7f4). NOT_ACQUIRED.
2. **Orchestration refresh UNIFIÉE full-auto** : généraliser le pattern cron pv-spécifique à TOUTES les couches + câbler capture→acquire→deposit→coverage en UN pipeline re-runnable ; **re-SCRAPE** (worklist régénérée à chaque run, fetch frais), pas re-projeter. Le socle (k8s-shard-run + cron pattern) existe → c'est du CÂBLAGE+GÉNÉRALISATION, pas from-scratch.
3. **Deposit-JOB on-cluster** : les recettes deposit sont des runners tsx LOCAUX ; le prod-write DOIT passer on-cluster/CI (discipline « jamais agent local en prod »). geo-cond : skeleton/branche préservée → **productionniser le deposit-job** (packager les recettes en job k8s/CI owner-gaté).
4. **Auto-génération de worklist** : les worklists sont hand-authored/committées. Full-auto = générer les URLs de capture par ville depuis les manifests + `municipal-directory.qc.json` (per-muni WFS/MapServer/AGOL) → un re-scrape couvre 1106 sans worklist manuelle.
5. **Déclencheur de fraîcheur** : `updateCadence` (P1Y) est dans les manifests mais AUCUN auto-trigger. Créer le trigger « stale (juin) → re-scrape » (mesure de fraîcheur = proof-v2 retrieved_at, pas coherence_id).
6. **Périmètre IA nécessaire** (owner « partie IA comprise », réduite au nécessaire) : (a) découverte de source (pattern sous-agent discovery, cf. discovery-217) ; (b) extraction zone_code/normes depuis PDF (Mistral vision DÉJÀ dans acquisition-job pour les normes) ; (c) classification attribute_map-vs-vrai-code. À TRANCHER : lesquels sont NÉCESSAIRES au refresh vs droppables.

## RÉDUIRE (owner « seuls composants nécessaires »)
- Consolider les nombreux one-off `acquisition/src/_zones-vnatif-*` / `_*-probe.ts` (sondes de diagnostic) → promouvoir la logique réutilisée dans la lib, retirer les jetables.
- Un SEUL chemin capture (`geo-capture`), un SEUL chemin acquire (`geo-acquisition`), un SEUL deposit-job — dédupliquer les runners par-provider en une recette paramétrée (source-type → champ code-zone).
- Retirer les registres de preuve legacy (proof-legacy/orphan) une fois proof-v2 system-wide.

## Statut acquire par couche (mesuré)
| Couche | Servi ? | Acquire code ? | Effort refresh |
|---|---|---|---|
| CPTAQ | préprod 4 villes | §9 acquire-delta existe | re-run runner (city-agnostic) |
| qc-zonage LOT-1 (16) | non (absentes) | capture+deposit recettes existent | go-line binaire A/B (attente certif k8s runner_git) |
| qc-zonage couverture (868 servies) | oui | re-stamp/replace existe | re-scrape+re-stamp full-auto (LOT-2/3) |
| BDZI | non | **À-CRÉER** (trivial) | 1 job §7-style |
| GRHQ 104/101 | non | **À-CRÉER** (paged/bulk) | job dédié, geo-archi design |

## Questions ouvertes pour le design-doc commun
- Généraliser le CronJob pv → un CronJob refresh multi-couches, ou N CronJobs par couche ?
- Deposit-job : réutiliser `geo-s3-credentials` on-cluster (forme A, reco) — confirmer scope write `normalized/`.
- Régénération worklist : à chaque run (full re-scrape 1106) vs incrémental par fraîcheur ?
- IA : périmètre minimal (découverte + PDF-extraction) vs full — arbitrage owner/coût.
- LOT-1 vraies-zones s'inscrit dedans : la go-line binaire A/B (d81f5298@81912cdc OU ab4f2145@5d257a99) tient, owner-gate parké valide.
