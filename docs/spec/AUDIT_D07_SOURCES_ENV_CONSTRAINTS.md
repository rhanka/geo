# AUDIT D07 — sources environnementales (BDZI / GRHQ / CPTAQ)

> **Statut : audit §5.0 PRODUIT (tier-1 établi read-only) — prérequis ORDONNÉ au serving §9.**
> Livre l'audit exigé par `SPEC_GEO_ENV_CONSTRAINTS_S9.md §5.0` (revue fable B4) et par le
> verdict `REVUE_D06_D07_GEO_2026-08-15.md:42` (« D07 = AUDIT À PRODUIRE »). Périmètre WP6,
> **analyse read-only** (aucune capture ; l'acquisition cluster→S3 reste à faire, G02).
> Auteur : geo-archi. Owner : §9 RATIFIÉ **audit-first** (geo-cond, 2026-08-30) — cet audit
> précède le serving. Revue : agy gemini 3.7 high (fallback fable-5 si saturé).

## 0. Constat central — `NOT_ACQUIRED` (état DONNÉE) ; mais une voie générique EXISTE (câblage)

[FAIT] Les trois sources existent en **CODE capitalisé** (manifest + normalizer, spikes immo
ADR-0013 / P-immo Lot 3). ⚠ **Correction (revue fable — leçon mesurer>inférer)** : une **voie
d'acquisition GÉNÉRIQUE existe et les câble DÉJÀ** — mon grep symbolique `registerSources`
hors-package = vide était **AVEUGLE au câblage dynamique-par-NOM-de-package** :

- `geo fetch <sourceId> [datasetId] [--out s3://…]`
  (`packages/geo/src/cli/commands/fetch.ts:90-96` → `loadDefaultRegistry`) charge les continents
  par **import dynamique par nom** (`packages/geo/src/cli/continents.ts:19-22,44` →
  `@sentropic/geo-sources-americas`), dont le barrel inclut les 3 manifests constraints. Formats
  `arcgis-rest` + `shp`/GDAL supportés, **sortie S3 possible** (`--out s3://…`, ADR-0012).
- Ce qui MANQUE n'est donc PAS le câblage mais : **(i) un runner DÉDIÉ conforme G02**
  (capture-proof-v2 cluster→S3 : octets bruts + manifeste `url`/`retrieved_at`/`sha256`) —
  `CADRE_2_REACQUISITION_PAR_CODE.md:110` « runner **dédié** non implémenté », « Script :
  **Absent** », Tier T1 ; **(ii) tout RUN tracé** ; **(iii)** les couches **ne figurent PAS** au
  contrat servi v1 (`REVUE_D06_D07:42,105-106`).

⟹ **Verdict d'acquisition : `NOT_ACQUIRED` pour BDZI, GRHQ, CPTAQ** — verdict d'**état de DONNÉE**
(aucun run G02, rien de déposé/servi, per `CADRE_2:110` + `REVUE:42`), **PAS** une liste S3 (cet
audit est read-only, il ne liste pas S3). Le câblage-qui-existe **ne renverse pas** le verdict
mais **repricie le travail restant** (runner DÉDIÉ G02 + run, pas le câblage). Cet audit établit
les axes **DÉCLARÉS** (tier-1) et **spécifie ce que l'acquisition cluster→S3 devra établir**
(tier-2) avant tout serving. **Aucun fait de source n'est gravé comme acquis** (§5.0 / B4).

## 1. Axes DÉCLARÉS (tier-1 — établis read-only depuis les manifests + spikes)

| Axe | BDZI (`ca-qc/bdzi-flood-zones`) | GRHQ (`ca-qc/grhq-hydrography`) | CPTAQ (`ca-qc/cptaq-zone-agricole`) |
|---|---|---|---|
| **Thème** | Zones inondables (polygones) | Réseau hydrographique (plans d'eau 104 + linéaire 101) | Zone agricole protégée (polygones) |
| **Autorité** [FAIT] | CEHQ / Gouv. QC | MRNF / Gouv. QC | CPTAQ |
| **Diffusion** | Données Québec | Données Québec | Données Québec |
| **Licence** [FAIT] | CC-BY-4.0 déclarée | CC-BY-4.0 déclarée | CC-BY-4.0 déclarée |
| **Endpoint acquis** [FAIT] | ArcGIS REST MapServer EnviroWeb, **couche 22** | ArcGIS REST EnviroWeb, **couches 104 + 101** | **SHP ZIP** `ZA_transposee.zip`, couche `zone_agricole_s` |
| **Format / sortie** [FAIT] | arcgis-rest → GeoJSON WGS84 (outSR=4326), simplify DP 0,0005° | arcgis-rest → GeoJSON WGS84 (outSR=4326) ; 104 simplifié, 101 plein | shp → ogr2ogr `-t_srs EPSG:4326` RFC7946 ; **simplify 0,0005 en unités SRS SOURCE → amplitude INCONNUE (CRS non lu)** |
| **CRS sortie (cible)** [FAIT] | EPSG:4326 | EPSG:4326 | EPSG:4326 (reprojeté) |
| **CRS source** | 4326 (REST outSR) | 4326 (REST outSR) | ⚠ **UNKNOWN — non épinglé** : lu du `.prj` du shapefile À l'acquisition |
| **Cadence déclarée** [FAIT] | P1Y | P1Y | P1Y |
| **Emprise déclarée (grossière)** | province CA-QC | province CA-QC | province CA-QC |
| **Reco (in-repo)** | `build-later` (manifest `bdzi:18` ; REST/WMS d'abord, GPKG ~376 Mo écarté) | `build-later` (manifest `grhq:36`) | ⚠ **non déclarée au manifest** ; `qc-sources/prioritySources.ts:66-72` la lie **`build-now`** (prio 5, tier A, cadence quarterly) |
| **État acquisition** [FAIT] | **`NOT_ACQUIRED`** | **`NOT_ACQUIRED`** | **`NOT_ACQUIRED`** |

## 2. Limites / lacunes connues (tier-1) [FAIT sauf mention]

- **BDZI** : seule la **couche 22** (polygones) est visée ; couche 71 (études/limites de plaine)
  **non acquise**. La géométrie est **simplifiée** (DP 0,0005°) → non exacte au trait ⟹ impacte
  l'`EXACT_GEOM` du join §9 (à qualifier au LOT : tolérance vs "exact").
- **GRHQ** : [FAIT, NB manifest] « GRHQ n'est PAS lui-même le tampon réglementaire — les
  bandes riveraines exigent l'interprétation du règlement local ». ⟹ servir comme **proximité
  environnementale**, JAMAIS comme contrainte réglementaire directe. Couche 104 simplifiée.
- **CPTAQ** : [FAIT, caveat manifest] la couche **transposée** « **n'est PAS le plan légal
  officiel** ». ⟹ à servir avec ce caveat dans la provenance ; ne pas la présenter comme la
  zone agricole légale. Seule la couche polygone `zone_agricole_s` (la ligne `zone_agricole_l`
  = frontière cartographique, pas une surface de contrainte). ⚠ **simplify 0,0005 en unités
  SRS SOURCE** (`cptaq/manifest.ts:90`) : le CRS source n'étant pas épinglé, **l'amplitude de
  simplification est INCONNUE** (0,0005 m vs 0,0005° = ordres de grandeur différents) → impacte
  l'`EXACT_GEOM` §9 comme BDZI/GRHQ, à qualifier au LOT une fois le `.prj` lu.

## 3. No-PII — whitelist d'attributs PAR DATASET (§6 Loi-25, par construction)

[FAIT — champs OBSERVÉS aux spikes ; l'inventaire COMPLET est tier-2, à vérifier à l'acquisition.]
La whitelist est **provisoire** ; la garde au dépôt REJETTE toute propriété non-whitelistée
(pattern `putServedZoneAdditive`). ⚠ §6 avertit que **les tables CPTAQ peuvent porter des noms
de déclarant/propriétaire** → whitelist stricte + inventaire complet obligatoire avant serving.

| Dataset | Whitelist provisoire (spike-observée) | Risque PII |
|---|---|---|
| BDZI 22 | `OBJECTID`, `Description`, `No_rapport`, `Nm_rapport` | faible (thématique) |
| GRHQ 104/101 | `TYPECE`, `PERENNITE` (+ index `Bloc`/`Zone`/`FGDB`) | faible |
| CPTAQ `zone_agricole_s` | `Mrc`, `Date_maj`, `Zonage` | ⚠ **à VÉRIFIER** — inventaire complet requis (noms déclarant/propriétaire possibles ailleurs dans le corpus CPTAQ) |

## 4. Ce que l'ACQUISITION cluster→S3 devra établir (tier-2 — actuellement UNKNOWN)

Ces axes **exigent l'acquisition réelle** ; ils ne sont **pas inventables** read-only :

1. **CRS source réel** (surtout **CPTAQ**, lu du `.prj`) — confirmé, pas supposé.
2. **Emprise spatiale déclarée PAR DATASET** — l'artefact servi + versionné (§9:72) qui pilote
   la garde de couverture 3-états (`not-covered-by-source=UNKNOWN` vs `no-hit-covered=N-A`).
   Aujourd'hui : seulement « province CA-QC » grossier ; le bbox/polygone d'emprise réel = tier-2.
3. **Inventaire d'attributs COMPLET** → whitelist finale + garde (surtout CPTAQ, no-PII §6).
4. **Feature counts + IoU-gold + preuve v2** (`url`, `retrieved_at`, `sha256`, statut) par
   dataset — le manifeste de capture EST la preuve (CLAUDE.md).
5. **CRS métrique de JOIN à épingler** [JUGEMENT] : le Québec couvre plusieurs zones MTM →
   choisir un CRS province-wide (ex. Québec Lambert / une politique par-zone), **pinné + tracé
   dans la provenance du join** (§5.2). Jamais un join en degrés.

## 5. Gate de serving (conséquence)

[JUGEMENT, fondé §5.0] **Le serving §9 reste BLOQUÉ par dataset** tant que l'acquisition n'a pas
établi le tier-2 pour ce dataset. L'ordre est : **audit (ce doc) → acquisition cluster→S3
(tier-2) → serving (`ca-qc-constraints-<slug>` + hits + couverture)**. Un `ConstraintHit` ou une
couverture servis avant le tier-2 = un fait de source inventé → interdit (B4).

- **Priorité de démarrage** [JUGEMENT] : **CPTAQ** (polygone net, un seul SHP, CRS `.prj` à lire)
  et **BDZI 22** (REST, léger) sont les moins risqués ; **GRHQ** dépend d'une sémantique de
  proximité (pas une contrainte directe) → utile mais moins prioritaire pour la démo.
- **Démo warden + saint-stanislas** (§7 du spec §9) : réalisable **dès que ≥1 dataset a passé le
  tier-2** ; saint-stanislas doit montrer les 3 états (hit / N-A-prouvé / not-covered-UNKNOWN),
  ce qui EXIGE l'emprise déclarée (tier-2 axe 2).

## 6. Réconciliation & provenance

- Ce doc **satisfait le prérequis §5.0** (tier-1) et **ORDONNE** le tier-2 avant serving ; il
  **ne grave aucun fait de source comme acquis**.
- `SPEC_GEO_ENV_CONSTRAINTS_S9.md` **SUPERSEDE** `SPEC_ZONES_INONDABLES_SERVED_STUB.md` pour BDZI
  (le stub gate sur une décision de routing owner à intégrer, pas à traiter comme acquise, §9:182).
- Sources examinées (read-only) : `packages/geo-sources-americas/src/ca-qc-constraints/{index,
  bdzi/manifest,grhq/manifest,cptaq/manifest}.ts` ; `docs/spec/SPEC_GEO_ENV_CONSTRAINTS_S9.md §5` ;
  `docs/spec/REVUE_D06_D07_GEO_2026-08-15.md` ; `docs/spec/CADRE_2_REACQUISITION_PAR_CODE.md:110`.
