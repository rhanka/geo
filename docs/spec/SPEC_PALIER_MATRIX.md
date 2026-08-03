# SPEC — Matrice palier par-ville × 20 KPI (format FIGÉ)

Tableau de bord du sprint (mesure par **PALIER**), à côté du portfolio 1106.
Générateur : `scripts/palier-matrix-report.mjs`. Sorties datées :
`work/coverage/palier-matrix-30x167-<YYYYMMDD>.{json,md}`.

> Comme le portfolio : **corriger le générateur, jamais la sortie**. Ce format
> est figé ; toute évolution passe par ce SPEC + le générateur + son test.

## Décision owner (20260803, RÉVISÉE)

- **Les 20 KPI comptent TOUS** dans la cible : la **preuve-v2 exacte (col 10)** ET
  le **recall/précision v3.4 (col 20)** sont **DANS la gate** — aucune colonne exclue.
- **%/ville sur les 20 KPI applicables** (N-A hors dénominateur), plus sur 18.
- Le **résultat v3.4 (col 20) est VISIBLE** : il compte comme `absent` tant qu'aucune
  source per-ville (jointures WP5) n'est intégrée (anti-invention — jamais fabriqué).
- Cible durable = **100%-RÉSOLU** (0 `unknown` : `complete` OU N-A **prouvé**) sur 20.
- Inscription durable = **matrice committée + track + SPEC**.

## Gouvernance & ownership

Ce document est la **matrice de MESURE** (qa) ; la **gouvernance** (cohorte, les
20 KPI, l'ownership lane→colonne, la cible) vit dans `docs/spec/SPEC_PALIER_OWNERSHIP.md`
et les **critères de résolution N-A** dans `docs/spec/SPEC_PALIER_RESOLUTION.md`
(durables, verbatim de la décision owner). Cette matrice mesure ; elle ne décide pas.

**Règle d'or N-A (SPEC_PALIER_RESOLUTION §1)** : une cellule ne devient `N-A` que
sur **preuve d'absence REPRODUCTIBLE** (requête/source re-jouable établissant que la
donnée n'existe pas), portée par la lane propriétaire. Un vide NON prouvé reste
`unknown` — **INTERDIT** de le relabeller `N-A`. Ce générateur ne fabrique donc
JAMAIS un N-A : il ne classe N-A que ce que la source committée porte déjà comme tel
(p.ex. TOD hors-39). Les preuves N-A sont produites par les lanes, pas par la mesure.

Ownership des colonnes (source de vérité = SPEC_PALIER_OWNERSHIP §3) : zones
possède 1, 2, 3, 8, 9, 10, 11 ; reglement 5, 6, 7 ; pv 4 ; lot 2, 12, 13 ; WP5
(jointures) 20 ; immo 14–19. **KPI 2 (cohérence lot-zone) est CO-PORTÉ zones+lot.**

Chaque cellule reflète la **source committée autoritaire la plus récente** et STAMPE
sa date (section Sources). Une mesure de lane plus fraîche non encore committée en
matrice full (p.ex. un re-fold cohorte lot) N'EST PAS auto-captée tant qu'elle
n'est pas déposée sous le nom/schéma attendu — le palier reste alors sur la
dernière matrice full, date affichée, **jamais une valeur fabriquée**.

## Lignes = cohorte de slugs (paramétrable)

- Défaut : `work/coverage/palier-matrix-cohort-167.json` (**SET-167 B′ complet**),
  dérivé du `set-167-bprime.tsv` FIGÉ (i-cond) par `scripts/build-palier-cohort-167.mjs`
  (slug/priorityRank VERBATIM ; `graph_matched` = `match!=UNMATCHED`). La **vue 30**
  (palier 1) = `priorityRank<=30`, exposée en sous-ensemble (`subset_palier1_rank_le_30`).
  Cohorte 30 seule : `--cohort=work/coverage/palier-matrix-cohort-30.json`.
- **PENDING-GRAPH-NODE** (`match=UNMATCHED`, aucun nœud graphe — 5 sur 167, dont
  `brossard`/`ile-dorval`/`kirkland` dans le top-30) : lignes visibles, **toutes
  cellules `unknown` + drapeau**, EXCLUES de tous les dénominateurs (rollups KPI et
  gate). Ajoutées dès qu'i-cond cadre les nœuds.
- Élargissement : 30 → **167** → 1106 (même générateur, autre `--cohort`).

## Plafonds externes (arbitrage owner) — ⛰

Certaines colonnes sont bornées par un mur EXTERNE, pas par un défaut d'acquisition ;
leur `incomplete`/`unknown` n'est PAS librement acquérable. C'est un **contexte annoté**
(`per_kpi[].ceiling`), **jamais un N-A fabriqué** (anti-invention : N-A seulement si
PROUVÉ que la donnée n'existe pas). Colonnes plafonnées : **7 effet-densifiant**
(plafond documentaire), **10 preuve-v2** (~48 % URL mortes, mur de recalage), **20
recall-v3.4** (maturité WP5, non per-ville). Le plafond est un **contexte annoté**,
PAS une exclusion de gate : depuis la révision owner, **ces colonnes comptent DANS
la gate** (leur absence est réelle, juste bornée par un mur externe qu'on DIT).
`incomplete+unknown` des AUTRES colonnes = gisement ACQUÉRABLE. Seul un N-A
**prouvé** (p.ex. TOD hors des 39) est classé N-A.

## Colonnes = 20 KPI

| # | KPI | Source per-ville | Règle cellule |
|---:|---|---|---|
| 1 | Zones — complétion | `completion-1-zones-matrix-*` `cities[].state` | état direct |
| 2 | Zones — cohérence lot-zone | `lot-zone-consistency-scale-*` `cities[]` | complete ssi `status=measured` ∧ `mismatch_pct<5` ; sinon unknown |
| 3 | Normes — complétion | `completion-1-normes-matrix-*` `cities[].state` | état direct |
| 4 | PV — **capté (indexé)** | capté `pv-couverture-municipale-*` `municipal_coverage.slugs[]` (≥1 doc INDEXED owner-confirmé) + déclaratif `pv-completion-city-audit.json` `cities[].state` | complete ssi CAPTÉ ; N-A si déclaratif N-A ; sinon incomplete (attendu, 0 octet capté) / unknown. **`presence_strict`** : présent ssi complete (capté) — un vert déclaratif non capté est ABSENT (vert par omission = rouge) |
| 5 | Règlement — déclarée+preuve | `completion-regdens-percity-*` `cities[].{reglement_declared,reglement_proven}` (source UNIFIÉE reglement) | complete ssi `reglement_proven=complete` ; incomplete ssi `reglement_declared=complete` OU `reglement_proven=incomplete` ; sinon unknown. `details.{declared,proven}` en JSON |
| 6 | Usage dominant — complétion | `completion-regdens-percity-*` `cities[].usage_dominant` | état direct |
| 7 | Effet densifiant — complétion | `completion-regdens-percity-*` `cities[].effet_densifiant` | état direct |
| 8 | Provenance — jointure exacte | `zone-provenance-quality-matrix-*` `rows[]` | complete ssi `collection_key` non-null ; sinon unknown |
| 9 | Provenance — qualité retained | idem `quality_status` | {acceptable,v2}→complete ; {candidate,orphan}→incomplete ; unknown |
| 10 | Provenance — PREUVE v2 exacte | idem `quality_status` | v2→complete ; {acceptable,candidate,orphan}→incomplete ; unknown. **DANS la gate** (plafond recalage annoté) |
| 11 | Provenance — URL source servie | `zone-source-readback-audit-*` `details[].status` | STAMPED→complete ; STAMPED_NULL/UNSTAMPED→incomplete ; read_error/absent→unknown |
| 12 | Immo — assignation lot-zone | `immo-lot-zone-assignment-matrix-*` `city_buckets` | bucket → état |
| 13 | Immo — normes pliées | `immo-folded-normes-city-matrix-*` `city_buckets` | bucket → état (`not_applicable`→N-A) |
| 14–19 | Immo champs / TOD | `immo-field-completion-matrix.json` `cities[].<champ>.status` | état direct (`lots_served`, `surface_m2`, `postal_code`, `civic_address`, `tod_applicability`, `tod_completion`) |
| 20 | Recall+précision v3.4 qc-zoning-events | `zoning-events-col20-*-<YYYYMMDD>.json` `rows[]` (artefact jointures WP5, capitalisé octet-pour-octet depuis `lane/jointures@a5c0cf41`) | `statut=measured`→complete ; `measured-geo-empty`→incomplete ; `immo-gt-pending`→unknown ; hors périmètre mesuré→unknown (GAP). `details` : statut, geo_events_count, immo_gt_events, matched, recall_pct. **DANS la gate** ; VISIBLE. Périmètre limité aux villes à GT immo (167 bloqué sur 2 handoffs immo) |

Sélection des sources datées : la **plus récente** (par champ horodaté interne
pour capture-kpi/effet, par nom sinon) — le nom/champ EST le contrat de découverte.

## Deux vues, cellule = `complete | incomplete | unknown | N-A`

1. **Complétion** (état fin) : `%/KPI` = complete / villes matchées ; `compl` par
   ville = complete /20.
2. **Présence** (gate) : `présence(cellule)` = `present` si état ≠ `unknown`
   (∧ ≠ N-A), `absent` si `unknown`, N-A hors dénominateur. **Les 20 KPI comptent —
   AUCUNE colonne exclue** (cols 10 preuve-v2 & 20 v3.4 INCLUSES, décision owner
   révisée). `%présence/ville` = present / (present+absent) sur les 20 colonnes
   applicables (`presence.denom_applicable`). `presence_gate.cities_full_presence`
   = villes à 0 absent sur les 20.

## Précédent / Δ — PAR CELLULE

- Snapshot précédent = `palier-matrix-30x167-<date>.json` avec date **< aujourd'hui**,
  la plus récente. `deltas[<kpi>]` par ville : `«—»` si aucun snapshot, `«·»` si
  état inchangé, `«new»` si ville absente du snapshot, sinon `«avant→après»`.
- **Anti-invention** : `unknown ≠ complete` ; **aucun Δ fabriqué** ; entrée
  manquante → `unknown` ; partitions cellules (=20) et KPI (=villes matchées)
  fermées (assertions dures, exit ≠ 0 en `--check`).

## Validation (`--check`)

Rejette (exit ≠ 0) si : une partition cellule ≠ 20 ; une partition KPI ≠ villes
matchées ; la sortie n'est pas déterministe entre deux constructions. Sinon
`CHECK OK`. Test : `acquisition/src/palier-matrix-report.test.ts`.

## Handoff démo

Dès le JSON committé, le chemin exact + SHA sont transmis au conducteur pour le
rendu d'un dashboard Artifact web à l'owner.
