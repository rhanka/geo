# Spec — Mapping lot ↔ zone ↔ normes (intersection géographique)

**Statut :** VALIDÉ v1 — consensus Claude 4.8 (décisions §7 tranchées) ; revue Codex 5.5 en 2e passe (throttle infra a bloqué la 1re). Prêt à implémenter. L'implémenteur confirme les emplacements réels (§7.5) et RÉUTILISE le code d'intersection existant (couverture-lots du recalage).
**But :** produire l'artefact **parcelle → zonage → grille de normes**, aujourd'hui absent : le recalage sert des *polygones de zones* et le cadastre des *lots*, mais aucune couche ne relie un lot à son `zone_code` ni à ses normes. C'est la donnée directement exploitable par immo (l'utilisateur clique une parcelle → voit son zonage + les normes applicables).

## 1. Contexte & état actuel

- `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson` : polygones de zones avec `zone_code` (562 munis servis).
- Cadastre : lots par muni (1106/1106) — **emplacement S3 à confirmer par l'implémenteur** (candidat : `normalized/qc-cadastre-lots/<slug>...`).
- `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet` : grille de normes par `zone_code` (428 munis).
- L'intersection zones∩lots est **déjà calculée** comme *gate QA* (métrique « couverture-lots » du recalage) mais **jetée** — seul le compteur est gardé. On réutilise cette logique, on la persiste.

## 2. Produit livré

Une couche enrichie **par muni** : un enregistrement par lot cadastral portant :

| champ | type | description |
|---|---|---|
| `lot_id` | string | identifiant cadastral du lot (clé source, verbatim) |
| `zone_code` | string \| null | code de zone dominant (RÉEL, verbatim) ; `null` si le lot n'est couvert par aucune zone |
| `dominant_fraction` | number | fraction de surface du lot couverte par la zone dominante (0–1) |
| `multi_zone` | boolean | vrai si `dominant_fraction < SEUIL` (lot à cheval significatif) |
| `zone_codes` | string[] | tous les codes intersectant le lot (surface décroissante), pour les cas multi-zones |
| `norms` | object \| null | grille de normes de `zone_code` (jointure parquet) ; `null` si zone sans normes |
| `assignment_method` | enum | `area-majority` \| `centroid-fallback` \| `unassigned` |

**Sortie :** `normalized/qc-lot-zonage/<slug>...` (format à trancher au §7 — GeoJSON enrichi vs parquet tabulaire lot↔zone + géométrie par référence). Plus un `<slug>.stats.json` : nb lots, % assignés, % multi_zone, % sans-normes.

## 3. Algorithme (déterministe, compute-only)

1. **Chargement** zones (polygones + `zone_code`) et lots (polygones + `lot_id`).
2. **CRS** : reprojeter en CRS **métrique local** (MTM/NAD83 de la muni, ou une projection équivalente-surface) AVANT tout calcul de surface. ⚠️ Ne JAMAIS calculer une aire en degrés (EPSG:4326). Détecter/normaliser le CRS d'entrée.
3. **Index spatial** : STRtree/flatbush sur les polygones de zones ; pour chaque lot, requête bbox → candidats zones, puis intersection exacte. ⚠️ Perf obligatoire : munis jusqu'à ~42k lots (trois-rivieres a déjà timeout sans index).
4. **Assignation** — règle primaire = **majorité de surface d'intersection** : `zone_code` = la zone maximisant `area(lot ∩ zone)`. `dominant_fraction = area(lot ∩ zone*) / area(lot)`.
   - Si `dominant_fraction ≥ SEUIL_DOMINANT` (défaut **0.6**) → `area-majority`.
   - Si `0 < dominant_fraction < SEUIL_DOMINANT` → assigner quand même la dominante MAIS `multi_zone=true` + remplir `zone_codes[]`.
   - Si aucune intersection (`area = 0`) → `zone_code=null`, `assignment_method=unassigned` (honnête : lot en rue/eau/hors-plan).
   - **Fallback centroïde** (`centroid-fallback`) UNIQUEMENT si le calcul d'aire exact échoue (géométrie invalide) : PIP sur centroïde. Tracé explicitement.
5. **Jointure normes** : `zone_code` → parquet norms du muni → `norms`. Clé = `zone_code` verbatim (même normalisation que la grille : casse/espaces).
6. **Robustesse géométrie** : réparer les polygones invalides (buffer(0)) avant intersection ; ignorer les slivers (aire d'intersection < ε).

## 4. Garde-fous anti-invention (dans le CODE)

- Un lot n'hérite QUE d'un `zone_code` **présent dans la couche de zones servie** (jamais interpolé/inventé au-delà de la majorité-surface mesurée).
- Lot non couvert → `zone_code=null` (JAMAIS de remplissage « zone la plus proche » sans overlap ; le plus-proche-voisin est une invention).
- `dominant_fraction` et `multi_zone` exposent l'incertitude au lieu de la masquer.
- La qualité du mapping hérite de la qualité du recalage : ne PAS produire de mapping pour un muni dont les zones n'ont pas passé les gates de recalage (couverture-lots ≥ seuil). La provenance du recalage est portée dans les stats.

## 5. API publiée (lib pérenne `packages/geo`)

Compute-only, déterministe, testable — dans la lib publique open-source `@sentropic/geo` (pas dans `acquisition/`, qui n'est que l'orchestration/dépôt).

```ts
// packages/geo/src/zonage/lotZoneJoin.ts  (chemin exact à confirmer selon l'arbo lib)
export interface LotZoneAssignment {
  lotId: string;
  zoneCode: string | null;
  dominantFraction: number;
  multiZone: boolean;
  zoneCodes: string[];
  method: 'area-majority' | 'centroid-fallback' | 'unassigned';
}
export interface LotZoneJoinOptions {
  dominantThreshold?: number;   // défaut 0.6
  sliverAreaEps?: number;
  targetCrs?: string;           // CRS métrique de calcul
}
/** Pur : lots + zones (déjà en CRS métrique) → assignations. */
export function assignLotZones(
  lots: Feature<Polygon|MultiPolygon>[],
  zones: Feature<Polygon|MultiPolygon>[],
  zoneCodeOf: (z) => string,
  opts?: LotZoneJoinOptions,
): LotZoneAssignment[];
/** Pur : join zone_code → grille de normes. */
export function enrichWithNorms(
  assignments: LotZoneAssignment[],
  normsByZoneCode: Map<string, object>,
): (LotZoneAssignment & { norms: object | null })[];
```

L'orchestration (`acquisition/src/lot-zone-join-run.ts`) : charge S3, reprojette, appelle la lib, dépose, vérifie. La lib reste pure (pas d'I/O).

## 6. Contrat de service (immo)

Deux options, à trancher :
- **(A) Artefact pré-calculé** : la couche `qc-lot-zonage` est déposée + servie en collection OGC ; immo passe une parcelle et lit son `zone_code`+`norms` directement (rapide, permet agrégats nb-lots/zone).
- **(B) PIP à la requête** : geo-api fait le point-in-polygon zones↔parcelle à la demande (pas de pré-calcul, toujours frais).
Recommandation : **(A)** pour la perf immo et les agrégats, avec la lib pure réutilisable côté (B) si besoin. Respecte `immo-geo-data-contract` (geo-api = scan S3 pur ; immo = passthrough OGC).

## 7. Décisions tranchées (consensus Claude 4.8)

1. **Format de sortie → PARQUET tabulaire clé `lot_id`** (colonnes : zone_code, dominant_fraction, multi_zone, zone_codes[], + champs de normes aplatis ou norms-json). La géométrie N'est PAS dupliquée : elle reste dans le cadastre, jointure par `lot_id`. Plus léger, agrégeable (nb lots/zone), cohérent avec le pattern parquet rôle-foncier/cadastre. immo joint parquet ↔ géométrie cadastre. (GeoJSON enrichi rejeté : duplication géométrie lourde.)
2. **Seuil dominant → 0.6, `dominant_fraction` exposé** ; règle quasi-égalité : si les 2 premières zones sont à <0.1 l'une de l'autre → `multi_zone=true`. PAS de seuil rue/eau distinct : le `zone_code=null` (aucun overlap) couvre déjà rue/eau/hors-plan honnêtement.
3. **Multi-zone → flag + `zone_codes[]` en v1** (suffit à immo : « parcelle à cheval A-1/C-2 »). Split géométrique du lot par zone = hors v1 (sur-ingénierie ; à rouvrir seulement si un besoin agricole concret émerge).
4. **Normalisation `zone_code` → fonction PARTAGÉE `normalizeZoneCode()`** dans la lib (trim, majuscule, collapse espaces internes, normalisation des variantes de tiret –/—/-), appliquée des DEUX côtés (couche zones ET clé grille normes). Conserver le `zone_code` brut. **Exposer le taux de match** dans les stats ; warn si <95% (signale un désalignement de vocabulaire à investiguer, pas un remplissage silencieux).
5. **Emplacements → confirmés par l'implémenteur** : arbo `packages/geo` (module compute-only + exports + tests selon conventions de la lib), chemin réel des lots cadastraux en S3/normalized, et **réutilisation du code d'intersection existant** (le calcul de couverture-lots du recalage). Ne pas réinventer le PIP/area-overlap.

## 8. Plan de test

- Unitaires lib (pur) : lot entièrement dans une zone → dominante 1.0 ; lot à cheval 50/50 → multi_zone ; lot hors zones → null ; sliver ignoré ; CRS-degrés rejeté.
- Pilote 5 munis focus-30 servies (windsor, arundel, coteau-du-lac, hudson, granby) : % lots assignés attendu élevé (cohérent avec la couverture-lots du recalage), échantillon lot→zone→norme vérifié à la main.
- Perf : muni ~40k lots (trois-rivieres si servi) sous un budget temps borné grâce à l'index.

## 9. Références

`docs/spec/zonage-georeferencement-gcp.md` (recalage & couverture-lots), `immo-geo-data-contract` (mémoire), `zonage-recalage-pipeline` (mémoire). Commits recalage : voir `git log feat/cadre-acquisition`.
