# SPEC — §9 Couches environnementales geo : rendu 3D + ConstraintHit servi

> **Statut : PROPOSÉ — INCOMPLET (prérequis §5.0 : l'audit de sources D07 est À
> PRODUIRE avant serving).** Périmètre WP6 (contrat d'émission/serving, pas l'impl).
> Auteur : geo-archi (`claude:archi`). Design pass mode (b) : geo-archi conçoit +
> **fable-5 = 2e avis indépendant** (double-instruction ; codex-sol runtime saturé).
> Revue fable v1 : 4 blockers (B1–B4) + 9 should-fix INTÉGRÉS ci-dessous. Contrat
> consommateur validé par i-arch. Conduite→ratification : geo-cond→i-cond→owner.
> **Phase 1 seulement** — couche user custom + stockage/ACL (dissent #3) DIFFÉRÉS
> Phase 2 (décision owner), hors ce spec.

## 1. Objet

Servir et démontrer les **couches environnementales** `ca-qc-constraints` (BDZI =
zones inondables ; GRHQ = hydrographie ; CPTAQ = zone agricole protégée) sur les
villes pertinentes (**warden** = ancre G02 reproductible ; **saint-stanislas** ;
autres à couverture connue). Le §9 geo sert **DEUX faces**, jamais confondues :

- **(a) la géométrie-contrainte**, rendue via `@sentropic/geo-map-engine` (moteur
  B, 3D — même engine/pattern que §5, contrat gelé v1 `SPEC_GEO_MAP_ENGINE §1`) ;
- **(b) le `ConstraintHit` résolu** — geo fait le spatial-join `EXACT_GEOM`
  (lot/zone ∩ contrainte, pattern #13, jamais fuzzy) **+ la COUVERTURE** (§3).
  immo consomme (b), projette (`graph_nodes`, écrivain unique, V34/3.4),
  score/affiche — **zéro op spatiale**.

**Frontière (validée i-arch, cohérente V34 + #13)** : geo = spatial-join + serve ;
immo = projette / score / affiche. geo n'écrit JAMAIS `graph_nodes`.

## 2. Contrat `ConstraintHit` (servi par geo, consommé par immo)

Forme gelée (validée i-arch ; corrigée revue fable B2/B3/S2/S3) :

```
ConstraintHit:
  target:     { kind: "lot" | "zone",
                ref:  lot  -> { no_lot (verbatim), no_lot_norm }          # no_lot_norm : normalisation PINNÉE (path+sha de la fn, dans le manifeste). no_lot unique/province (cadastre rénové) — invariant à énoncer.
                      zone -> { city_slug, zone_ref_canon_v1, reglement_number }   # (B2) la TRIADE normative complète (SPEC_GEO_SERVED_CONTRACT §2) — zone_ref_canon_v1 seul N'EST PAS unique/1106 munis
                geometry_snapshot_sha256 }                                # (B3) la version de la géométrie lot/zone jointe — les DEUX côtés du join pinnés
  constraint: { kind: ConstraintKind,                                     # v1 = { cptaq-zone-agricole | bdzi-inondable | grhq-hydro } SEULEMENT (S1 : bande-riveraine/milieu-humide = dérivés/non-sourcés → hors v1)
                constraint_ref: <id stable de la feature-contrainte>,
                attrs?: <whitelist PAR DATASET, définie par l'audit §5.0> }  # (S3) ex. BDZI récurrence 0-20/20-100, courant fort/faible — sinon immo sur-lit "intersects"
  resolution: { method: "EXACT_GEOM",                                     # jamais fuzzy (score 1.0, #13)
                relation: "intersects" | "within",                       # (S2) DE-9IM propres ; "adjacent" RETIRÉ de v1 (prédicat flou + tolérance/CRS non pinnés → réintroduirait du fuzzy sous EXACT_GEOM)
                overlap: { measure: "area_m2" | "fraction", value } }     # (S3) un intersects 1%-touché ≠ 99%-couvert ; calculé par geo en CRS métrique
  source:     { dataset, version, provenance: { artifact_uri, upstream_uri } }
  confidence_scale: "high" | "medium" | "low"                            # (note fable) l'échelle
  needs_manual_check?: boolean                                           # servitude/PIIA — flag d'action SÉPARÉ de l'échelle
  proof:      immo-feature-proof/v1-style + proof-v2 de la géométrie-contrainte  # (S8) reprend l'invariant du stub SPEC_ZONES_INONDABLES_SERVED_STUB §2 (schema_version 2.0, geometry_source url/method/retrieved_at/sha256)
```

- **Zone canon en collision** (`canonical_collisions`, retirée de `joinable` en v1)
  → **AUCUN ConstraintHit servi** pour cette zone → immo la rend **UNKNOWN** (B2).
- Unité `lot` ET `zone` (lot=actionnable Steve, zone=contexte) ; la `relation` est
  servie honnêtement (jamais collapsée).

## 3. Couverture — la garde `N-A prouvé ≠ UNKNOWN ≠ non-couvert` (invariant dur)

`explicit_unknown ≠ known` appliqué aux contraintes, **rendu ÉTANCHE (revue fable
B1)** : un `no-hit` de spatial-join ne prouve l'absence QUE si l'unité est **dans
l'emprise déclarée du dataset**. Un dataset qui ne CARTOGRAPHIE pas un territoire
(ex. BDZI hors municipalités cartographiées) renvoie 0 intersection — ce n'est PAS
une absence prouvée. Trois états, pas deux :

```
Coverage (servi à côté des hits ; PARTITION FERMÉE, CAS'd — S4) :
  { target: { kind, ref (triade/lot pinnés, §2) },
    dataset, version, evaluated_at,
    geometry_snapshot_sha256,                          # (B3) la version géométrie jointe
    result: "hit"              # ≥1 ConstraintHit émis
          | "no-hit-covered"   # unité DANS l'emprise du dataset, 0 intersection = N-A PROUVÉ, rejouable
          | "not-covered-by-source" }                  # (B1) unité HORS emprise cartographiée du dataset = UNKNOWN, PAS une absence
  # EMPRISE : l'emprise spatiale déclarée par dataset (§5.0 audit) est elle-même un artefact SERVI + versionné.
  # FERMETURE (S4) : par (ville × dataset), hit + no-hit-covered + not-covered-by-source == unités_évaluées ; comptes clos dans le manifeste haché.
```

immo rend : **contrainte** (hit) ; **N-A prouvé** (`no-hit-covered`) ; **UNKNOWN**
(`not-covered-by-source` OU aucune ligne de couverture). **Sans l'emprise servie, un
no-hit ne vaut jamais N-A** — il reste UNKNOWN. **geo n'invente jamais une absence.**

## 4. Rendu sur `geo-map-engine` (moteur B, 3D)

Géométrie-contrainte → **`GeoLayerSpec`** (contrat gelé v1, renderer-neutre) — 1
layer par `ConstraintKind`, tout via **tokens** (jamais hex/paint brut) :

- `ColorEncoding` : `by:'category'` sur `constraint.kind` → 1 token/rôle par classe
  (`token:'constraint.bdzi'`, `…cptaq`, `…grhq`) — DS owne la palette.
- **3D = DRAPE SEULEMENT (v1).** Les contraintes ne s'extrudent pas (ce ne sont pas
  des bâtiments) ; le 3D sert le contexte terrain/caméra partagé §5. ⚠ (S9) une
  `elevation` depuis une **cote de crue réelle** NE peut PAS rendre honnêtement en
  v1 : le terrain est **hors du contrat moteur v1** (`SPEC_GEO_MAP_ENGINE §1.5.1`) →
  une cote absolue flotterait au-dessus d'un sol plat = indistinguable d'une hauteur
  inventée. **`elevation` cote-pilotée = DIFFÉRÉE** jusqu'à ce que le terrain entre
  au contrat moteur (changement versionné). v1 = drape/teinte, aucune hauteur.
- **z-order / chevauchement** (note fable) : ordre de layer DÉTERMINISTE, pinné =
  `[grhq, bdzi, cptaq]` (hydro sous aléa sous agricole) ; opacité modérée. Un lot
  BDZI ∩ CPTAQ produit une teinte mêlée non-légendée — **limite de démo assumée**
  (le ColorEncoding gelé n'a pas de hachure/pattern) ; la RÉSOLUTION vit dans le
  ConstraintHit, le rendu ne décide rien.

Réutilise le pattern §5 (même engine, host stable, switch 2D/3D préserve
caméra/sélection §1.5) — zéro logique dupliquée, **aucun changement de contrat
moteur**.

## 5. Pipeline, prérequis, disciplines héritées

### 5.0 ⚠ PRÉREQUIS (revue fable B4) — l'audit de sources D07 est À PRODUIRE

`REVUE_D06_D07_GEO_2026-08-15.md` est une **revue** dont le verdict = « **AUDIT À
PRODUIRE** » ; l'audit lui-même n'existe pas encore, et BDZI = `NOT_ACQUIRED`
(`CADRE_2_REACQUISITION_PAR_CODE:110`). Ce spec **NE grave PAS** de fait de source
(CRS, autorité, licence, emprise) comme acquis — il les **DÉLÈGUE à l'audit**, qui
est un **prérequis ORDONNÉ avant tout serving**. L'audit doit livrer, par source
(BDZI/GRHQ/CPTAQ) : **autorité, licence de redistribution** (archi peut REFUSER une
source à licence non déclarée, `SPEC_WORKPACKAGES §3` / stub §3), **CRS/EPSG,
fréquence, emprise spatiale déclarée** (§3), **limites/lacunes connues**, **schéma
d'attributs whitelisté** (§2 `attrs`, §6 no-PII). Aucun `ConstraintHit`/couverture
ne se sert avant que l'audit ait établi ces axes pour le dataset concerné.

### 5.1 Pipeline
`acquisition (cluster → S3 UNIQUEMENT, G02)` → `served (URIs + snapshot sha256 +
pointeur CAS — S5)` → engine consomme le layer (a) + immo consomme hits+couverture
(b). **Surface de serving (S5)** : famille de collections `ca-qc-constraints-<slug>`
pour (a) ; les hits + la couverture sont servis en snapshots nommés par sha256 avec
pointeur CAS (pattern `SPEC_GEO_SERVED_CONTRACT §1`) — schéma d'URI + discipline de
snapshot à instancier au LOT (pas seulement invoqués par référence).

### 5.2 Disciplines (ne pas régresser — REVUE §4.3)
- **Acquisition cluster→S3 seul (G02)** ; octets bruts + manifeste (url,
  retrieved_at, sha256, statut) sur S3 ; agents locaux ANALYSENT en lecture seule.
- **Manifeste versionné + haché, compare-and-swap** (§1) ; re-run octet-identique.
- **Partitions fermées** (§3 : couverture close par ville×dataset).
- **Provenance par source** (§2 `source`, `proof` v2) + **provenance des DEUX
  entrées du join** (B3 : `geometry_snapshot_sha256` sur hits ET couverture) → un
  re-stampage/ré-acquisition de géométrie invalide les hits/couverture périmés de
  façon DÉTECTABLE.
- **CRS** : établi par l'audit (§5.0) ; le join se fait dans un **CRS métrique NOMMÉ**
  unique (ex. Québec Lambert / EPSG à pinner au LOT ; le Québec couvre plusieurs
  zones MTM → un CRS province-wide ou une politique par-zone, choix pinné + tracé
  dans la provenance du join). Jamais un join en degrés.
- **Préprod-first** : immo-preprod ← geo-preprod (couches + hits), jamais geo-prod
  (`SPEC_GEO_PREPROD_SERVING_2026-08-15.md:36`).

## 6. Loi-25 — invariant no-PII PAR CONSTRUCTION (dur — revue fable S6/S7)

Le `ConstraintHit` + couverture + géométrie servie sont **purement géospatiaux**.
Mais l'invariant doit être **par construction, pas déclaratif** (les tables CPTAQ
peuvent porter des noms de déclarant/propriétaire) : **whitelist de propriétés
servies PAR DATASET** (définie par l'audit §5.0) + **garde au dépôt qui REJETTE
toute propriété non-whitelistée** (pattern `putServedZoneAdditive`, CLAUDE.md).
**ZÉRO propriétaire / ZÉRO PII** sur toute face servie — vérifié par construction.

## 7. Démonstration (warden G02 + saint-stanislas)

- **warden** = ancre bout-en-bout reproductible (G02) : capture cluster→S3 →
  served → hits+couverture → rendu 3D ; rejouable sur checkout propre.
- **saint-stanislas** + autres à couverture connue : classes différentes + des unités
  en **N-A-prouvé vs UNKNOWN vs not-covered**, pour rendre la garde §3 VISIBLE.
- Artefacts : les `GeoLayerSpec` servis, la vue 3D moteur B, la table
  hits+couverture (ville×dataset, 3 états), le manifeste de provenance (2 entrées).

## 8. Frontière, réversibilité, pré-mortem

- **Frontière** : geo = EXACT_GEOM join + serve (hits + couverture + géométrie) ;
  immo = projette/score/affiche/UNKNOWN, 0 spatiale. ConstraintHit immo =
  **greenfield, 0 migration**.
- **Réversibilité** : additif (nouvelle famille `ca-qc-constraints`), n'altère pas
  l'existant ; rendu réutilise l'engine gelé (0 changement de contrat) ; rollback =
  retirer les collections servies.
- **Pré-mortem** : « ça a échoué parce que » — (i) un `no-hit` hors-emprise lu comme
  N-A (faux) → **la garde §3 `not-covered-by-source` (B1) l'empêche** ; (ii) un join
  sur `zone_ref_canon_v1` seul a joint le mauvais nœud → **la triade (B2) l'empêche** ;
  (iii) une ré-acquisition de géométrie a rendu tous les hits périmés en silence →
  **`geometry_snapshot_sha256` (B3) le rend détectable** ; (iv) un fait de source
  inventé faute d'audit → **l'audit-prérequis (B4) le bloque** ; (v) une propriété
  PII servie → **la whitelist par-construction (§6) la rejette** ; (vi) une cote de
  crue rendue comme hauteur flottante → **drape-seulement + terrain-différé (§4) l'évite**.

## 9. Attendus owner / suite

- **Prérequis** : produire l'audit de sources (§5.0) — autorité/licence/CRS/emprise/
  attributs whitelist — AVANT tout serving. Sans lui, §9 reste INCOMPLET.
- **Réconciliation** : ce spec **SUPERSEDE `SPEC_ZONES_INONDABLES_SERVED_STUB.md`**
  pour la couche BDZI (et reprend son invariant proof-v2, §2) — le stub gate sur une
  décision de routing owner à intégrer ici, pas à traiter comme acquise.
- Ratification owner (via geo-cond→i-cond) du contrat serving (ConstraintHit 3-états
  + couverture close + no-PII par-construction + rendu 3D drape).
- Démo warden/saint-stanislas : i-arch fournit scoring/affichage/UNKNOWN dès le
  contrat calé.
- **DIFFÉRÉ Phase 2** : couche user custom + stockage/ACL (dissent #3, position
  i-arch (B) préservée).
