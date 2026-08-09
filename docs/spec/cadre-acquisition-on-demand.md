# Cadre d'acquisition à la demande — geo (province-wide Québec)

> **Statut** : cadre (design) · **Date** : 2026-06-21 · **Auteur** : geo (claude:geo-quebec) sur directive du principal.
> **But** : passer du chantier ad-hoc à un **service d'acquisition à la demande**, à l'échelle des ~1100 municipalités QC, **fiable** (sources tracées) et **piloté par la demande** (immo demande une ville → geo l'acquiert).

---

## 1. Données cibles (par municipalité) et chaîne de fiabilité

| Donnée | Contenu | Source de fiabilité |
|---|---|---|
| **Grille de zonage** (spatial) | polygones + **code de zone** (H-12, C-3, RA-1…) | la grille réglementaire elle-même |
| **Règlement de zonage** (texte) | **grille des usages et normes** par code de zone : usages permis, densité, **hauteur** min/max, marges, **dimensions de lot min** (frontage, superficie) | le règlement municipal = la source d'autorité du code |
| **Attributs de lot** | géométrie (frontage, superficie, profondeur) **+** normes applicables (hauteur/densité permises) | cadastre (géométrie) **⋈** zone (grille) **⋈** règlement (normes) |

**Chaîne** : `LOT —(géométrie cadastre)→ dimensions` ⋈ `LOT —(point-in-polygon)→ ZONE` ⋈ `ZONE —(grille du règlement)→ NORMES`. Chaque champ porte **source + confidence + snapshot_id** (traçabilité, anti-invention).

## 2. Sources à scraper (par type, à l'échelle QC)

### 2.1 Grille spatiale de zonage
1. **AGOL Feature Services** municipaux (~60-100 QC) — recette `arcgis-zonage`.
2. **Données Québec** (CKAN) — grandes villes.
3. **Portails MRC** (ex. MRC Portneuf = SHP par muni sur blob ; **hétérogènes**, 1 adaptateur par portail).
4. **Géoportails municipaux** (ArcGIS Hub / WFS).
5. **PDF** (cascade extraction P1 boundary → P2 fusion → P3 cadastre) — **fallback** pour les villes sans vecteur ouvert (marche sur plans à topologie urbaine).

### 2.2 Règlement de zonage (texte → grille des usages et normes)
- **Site municipal** (résolu via l'annuaire MAMH → site → page urbanisme → règlement de zonage PDF/HTML).
- La **grille des spécifications** (tableau par code de zone) à parser → `{zone_code, usages[], densite, hauteur_min, hauteur_max, frontage_min, superficie_min, marges}`.
- Parser : étendre `reglements-urbanisme-parser` (déjà extrait n° règlement + codes) vers la grille complète.

### 2.3 Attributs de lot
- **Géométrique** : calculé du cadastre servi (`ST_Area`, frontage = arête sur rue, profondeur).
- **Réglementaire** : jointure `lot → zone → règlement` (hauteur/densité/superficie permises).

## 3. Architecture du cadre

```
immo --(h2a: acquisition.request)--> [GESTIONNAIRE DE DEMANDES] --(dispatch)--> [ORCHESTRATEURS k8s/Scaleway]
                                            |  valide périmètre                      | grid / bylaw / lot-attrs
                                            |  idempotence                            v
                                            |  track (registre)                  normalized/ S3 + API geo
                                            |  escalade --(h2a dossier)--> rhanka/architect (décision)
                                            +--(h2a: done + couverture)--> immo
```

### 3.1 Intake (h2a)
Enveloppe `acquisition.request` : `{ city_slug, data_types: [zoning_grid|zoning_bylaw|lot_attributes], priority, requester }`.

### 3.2 Gestionnaire de demandes (request-manager)
- **Valide le périmètre geo** : `city_slug` est-elle une municipalité QC (annuaire MAMH) ? les `data_types` sont-ils dans le scope geo (géo-données municipales QC : cadastre, zonage, règlement, attributs) ? → sinon **refus motivé**.
- **Idempotence** : que possède-t-on déjà (registre) ? n'acquiert que le manquant.
- **Planifie** : cascade de sources par type (2.1/2.2/2.3).
- **Dispatche** les orchestrateurs sur **k8s tenant geo / Scaleway Jobs** (normes projet : image baked, S3 in/out, disque 10Go→batch).
- **Escalade** à rhanka via **dossier h2a** (`h2a escalate`/`open_negotiation` → `claude:architect` / principal) quand une **décision** est requise : aucune source ouverte (acquisition manuelle/payante ?), donnée hors périmètre, source à licence, conflit de fraîcheur, budget compute.
- **Track** : statut (`queued→running→served|deferred|failed`) + provenance par donnée, dans un **registre** (`s3://sentropic-geo/registry/acquisition-log.jsonl` + table PostGIS).
- **Notifie** immo (h2a) avec la couverture obtenue.

### 3.3 Orchestrateurs (1 par type de donnée)
- **grid-orchestrator** : cascade 2.1 → `qc-zonage-<slug>` (schéma contrat `zone_code/kind/source/confidence`).
- **bylaw-orchestrator** : scrape + parse 2.2 → `qc-zonage-norms-<slug>` (normes par code).
- **lot-attrs-orchestrator** : calcule 2.3 → enrichit `qc-lots-<slug>` (dims + normes jointes).
Réutilisent les pipelines prouvés (moisson MRC, cascade PDF, etc.).

### 3.4 Normes projet (respectées)
k8s tenant `geo` (poc-k8s) · Scaleway Serverless Jobs · h2a (intake + escalade) · ADR (gouvernance) · **federation-first** (geo possède la donnée ; immo consomme via API/PMTiles/index) · **anti-invention** (garde-fous, geom nullable, codes verbatim) · traçabilité (source+confidence+snapshot).

## 4. Escalade — canal décision « dossier » (sentropic)
Le gestionnaire ouvre un **dossier de décision h2a** vers `claude:architect:…` (relais principal) quand il bute sur une décision hors de son automatisme : *pas de source ouverte pour X*, *X hors périmètre geo*, *source payante/licence*, *arbitrage budget/fraîcheur*. Le dossier porte : la demande, ce qui a été tenté, les options, la reco. rhanka tranche ; le gestionnaire reprend.

## 5. Test d'acceptation : les 30 villes z∩m∩p immo (1re cible d'exhaustivité)
Rejouer le cadre sur les 30 : pour chacune, viser les 3 données (grille + règlement + attributs lot), tracer la source/couverture, escalader les irréductibles. **Sortie = un tableau couverture×ville×type** + les dossiers d'escalade ouverts. Puis généraliser au province-wide (demande par demande).
