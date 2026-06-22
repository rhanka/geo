# Plan de couverture — données géo Québec (cible maximale + roadmap remote)

> Établi le 2026-06-22. Comptes **réels** mesurés (S3 + OGC live + repo), pas d'estimé.
> Source inventaire : `work/immo-audit/INVENTAIRE-scraping-qc.md`.

## 1. État actuel — par layer (couverture réelle)

| # | Layer | Acquis aujourd'hui | Méthode | Stockage |
|---|---|---|---|---|
| 1 | Frontières admin (SDA/MERN) | **1343** polygones munis | harvest SDA | `normalized/qc-admin-boundaries/` |
| 2 | Cadastre lots (géométrie) | **1102** munis (1080 clippés SDA, ~1,78 M lots) | harvest cadastre rénové + clip frontière | `normalized/qc-cadastre-lots/` |
| 3 | Rôle foncier (attributs bâtiment) | **1095** munis | parse XML MAMH | `registry/role-foncier/` |
| 4 | Index zéro-copie immo | **1102** parquet (code_zone non-null sur ~15-28 munis) | cadastre ⋈ rôle ⋈ code_zone | `registry/index-immo/` |
| 5 | code_zone sur lots (point-in-polygon) | **28** munis | PIP lot ⋈ zone | servi OGC + index |
| 6 | **ZONES spatiales (polygones)** | **387 collections servies** ; **~99 munis 1:1** (38 propres + 61 désagrégées) | ArcGIS Hub par compte + CKAN + MRC + désagrégation + PDF | `normalized/ca-qc-zonage/` + OGC |
| 7 | **NORMES / grilles (valeurs régl.)** | **25** munis déposés (crawl province → ~370 grilles en vue) | découverte PDF (crawler PV) + extraction native/multizone/vision | `registry/qc-zonage-norms/` |
| 8 | PV / procès-verbaux (signaux) | **563** villes configurées (code prêt) | scrapers `@geo/qc-sources` | code — prod **non basculée** |
| 9 | PMTiles (tuiles vectorielles) | **2** archives province (zones+lots) | tippecanoe (job Scaleway) | `pmtiles/` (bucket **privé**) |
| 10 | Rapport statut client | prod (md+docx) | `@geo/qc-status-report` | repo |

## 2. Cible MAXIMALE par layer (plafond honnête + raison)

| Layer | Cible max atteignable | Plafond / raison |
|---|---|---|
| Cadastre lots | **~1086 / 1102 = ceiling** ✅ déjà atteint | 16 TNO nordiques ont 0 lot cadastral |
| Rôle foncier | **~1099 = ceiling** ✅ quasi atteint | quelques munis sans rôle MAMH publié |
| Index immo | **1102 structurel** ✅ ; sa VALEUR (code_zone) suit les zones | borné par la couverture zones |
| code_zone sur lots | **= couverture zones** (jusqu'à ~280-350 munis) | suit le layer 6 |
| **ZONES vecteur (polygones nets)** | **~280-350 munis (25-32 %)** | **plafond open-data dur** : au-delà, pas de zonage vecteur public — uniquement PDF/scan |
| **NORMES / grilles** | **~370-500 munis** | = munis publiant une grille PDF en ligne (le crawl en trouve ~66 %) |
| PV / signaux | **1106** (scrapers extensibles ; 563 prêts) | borné par l'effort d'ajout de configs muni |
| PMTiles | **province + par-ville, public/CDN** | = exposer ce qui existe |
| Zones PDF longue traîne (~700 munis) | **zones grossières** (codes localisés à l'aire, pas polygones nets) | les PDF scannés sans frontière interne ne donnent pas de polygone propre (cf. verdict A-16) |

**Synthèse cible** : socle foncier (cadastre/rôle/index) ~100 % ✅ ; **zones vecteur plafonnent ~30 %** (limite open-data, pas un manque d'effort) ; **normes extensibles à ~400 munis** (le vrai gisement de valeur restant) ; PV à basculer en prod ; PMTiles à rendre publics.

## 3. Roadmap — remote-optimisée (réponse à « ça va pas assez vite »)

**Principe directeur** : **rien de lourd ne tourne en séquentiel sur le poste local.** Toute acquisition de masse passe en **jobs Scaleway Serverless parallèles shardés** ; le serving reste sur **k8s** (geo-api + PostGIS, déjà en place). Politesse préservée : on shard **par muni** (chaque worker frappe des sites différents).

### Phase A — NORMES à l'échelle (le plus gros gisement de valeur), PARALLÈLE
- **A1.** Déployer le job Scaleway normes (déjà codé+commité `deploy/normes-job/`, mode `extract`) → build image + push registre Scaleway + `scw jobs definition`.
- **A2.** Sharder les 563 munis en **N=10-20 jobs parallèles** (`--slugs <shard>`) → la découverte province passe de **~7 h séquentiel à ~30 min**.
- **A3.** Extraction normes en jobs parallèles sur les PDF stagés (S3) → normes **25 → ~300-370 munis**.
- **Gain** : ×10-20 sur le mur d'acquisition. **C'est l'accélération demandée.**

### Phase B — PMTiles publics (seul engagement ouvert envers immo)
- Provisionner un **bucket S3 PUBLIC dédié + CDN** ; (re)tuiler zonage par-ville + lots province via le job tippecanoe Scaleway ; publier un **manifeste versionné** `(snapshot_id, etag/ville)` ; fixer l'endpoint + ETA pilote saint-frederic. (ADR-0022.)

### Phase C — ZONES vecteur jusqu'au plafond (~280 munis)
- Énumération **nominative** des comptes ArcGIS Hub des 87 MRC (pas keyword — stérile) + désagrégation (déjà faite, +61) + adaptateurs portails SHP (type Portneuf). Vérif spatiale par muni **obligatoire** (≥1 faux positif/2 sondes). → ~99 → ~280 munis 1:1.

### Phase D — PV prod (reversion immo→geo)
- Basculer en production les scrapers PV (563 prêts) côté geo ; les exposer ; étendre vers 1106.

### Phase E — exposer les NORMES en collections OGC
- Publier `registry/qc-zonage-norms/` en collections OGC `qc-zonage-norms-<slug>` pour qu'immo puisse les puller (aujourd'hui parquet S3 only).

### Phase F — longue traîne PDF (le dur, ~700 munis)
- Extraction PDF→GeoJSON par calage sur lots (ADR-0023, >85 % auto sur T1/T2/T3, semi-manuel T4) — par lots, en jobs ; donne des zones grossières là où le vecteur public n'existe pas.

### Ordre & parallélisme
- **Maintenant en parallèle** : A (normes shardé) + B (PMTiles publics) — indépendants, tous deux remote.
- **Ensuite** : C (zones vecteur MRC nominatif) + E (normes OGC).
- **Continu** : D (PV), F (PDF longue traîne).

> Tout le code d'orchestration est TS, commité ; l'exécution de masse vise Scaleway Jobs (coût ~$0.06-0.32/muni mesuré pour les normes vision). Le poste local ne sert qu'à piloter/valider.
