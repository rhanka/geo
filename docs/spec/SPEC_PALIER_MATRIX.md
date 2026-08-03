# SPEC — Matrice palier par-ville × 20 KPI (format FIGÉ)

Tableau de bord du sprint (mesure par **PALIER**), à côté du portfolio 1106.
Générateur : `scripts/palier-matrix-report.mjs`. Sorties datées :
`work/coverage/palier-matrix-30x167-<YYYYMMDD>.{json,md}`.

> Comme le portfolio : **corriger le générateur, jamais la sortie**. Ce format
> est figé ; toute évolution passe par ce SPEC + le générateur + son test.

## Décision owner (20260803)

- **CIBLE MERCREDI = PRÉSENCE** (donnée là) sur les 30 villes sélection A.
- La **preuve-v2 exacte (col 10)** est une campagne **LONGUE séparée**, PAS la gate.
- Inscription durable = **matrice committée + track + SPEC**.

## Lignes = cohorte de slugs (paramétrable)

- Défaut : `work/coverage/palier-matrix-cohort-30.json` (SET-30 sélection A =
  `priorityRank<=30` du `set-167-bprime.tsv` FIGÉ ; extensible au 167 via
  `--cohort=<liste>.json`).
- **27 matchées graphe** + **3 PENDING-GRAPH-NODE** (`brossard`, `ile-dorval`,
  `kirkland`) : lignes visibles, **toutes cellules `unknown` + drapeau**, EXCLUES
  de tous les dénominateurs (rollups KPI et gate). Ajoutées dès qu'i-cond cadre
  les nœuds.

## Colonnes = 20 KPI

| # | KPI | Source per-ville | Règle cellule |
|---:|---|---|---|
| 1 | Zones — complétion | `completion-1-zones-matrix-*` `cities[].state` | état direct |
| 2 | Zones — cohérence lot-zone | `lot-zone-consistency-scale-*` `cities[]` | complete ssi `status=measured` ∧ `mismatch_pct<5` ; sinon unknown |
| 3 | Normes — complétion | `completion-1-normes-matrix-*` `cities[].state` | état direct |
| 4 | PV — complétion | `pv-completion-city-audit.json` `cities[].state` | état direct |
| 5 | Règlement — déclarée+preuve | déclarée `acquisition/config/reglement-provenance.json` (`reglement_numero`) + preuve `reglement-capture-kpi-*` (`state`) | complete ssi preuve `capture_inchange` ; incomplete ssi déclaré OU preuve incomplète ; sinon unknown. `details.{declared,proven}` en JSON |
| 6 | Usage dominant — complétion | `zonage-enrichment.json` `perMuni[].usage_dominant` (bool) | true→complete, false→incomplete, absent→unknown |
| 7 | Effet densifiant — complétion | `effet-densifiant-bprime-acquisition-universe-*` `rows[].state` | known→complete, absent→incomplete, unknown_only/unserved→unknown |
| 8 | Provenance — jointure exacte | `zone-provenance-quality-matrix-*` `rows[]` | complete ssi `collection_key` non-null ; sinon unknown |
| 9 | Provenance — qualité retained | idem `quality_status` | {acceptable,v2}→complete ; {candidate,orphan}→incomplete ; unknown |
| 10 | Provenance — PREUVE v2 exacte | idem `quality_status` | v2→complete ; {acceptable,candidate,orphan}→incomplete ; unknown. **HORS gate** |
| 11 | Provenance — URL source servie | `zone-source-readback-audit-*` `details[].status` | STAMPED→complete ; STAMPED_NULL/UNSTAMPED→incomplete ; read_error/absent→unknown |
| 12 | Immo — assignation lot-zone | `immo-lot-zone-assignment-matrix-*` `city_buckets` | bucket → état |
| 13 | Immo — normes pliées | `immo-folded-normes-city-matrix-*` `city_buckets` | bucket → état (`not_applicable`→N-A) |
| 14–19 | Immo champs / TOD | `immo-field-completion-matrix.json` `cities[].<champ>.status` | état direct (`lots_served`, `surface_m2`, `postal_code`, `civic_address`, `tod_applicability`, `tod_completion`) |
| 20 | Recall+précision v3.4 qc-zoning-events | — (aucune source per-ville) | **GAP → unknown** ; **HORS gate** jusqu'aux jointures WP5 |

Sélection des sources datées : la **plus récente** (par champ horodaté interne
pour capture-kpi/effet, par nom sinon) — le nom/champ EST le contrat de découverte.

## Deux vues, cellule = `complete | incomplete | unknown | N-A`

1. **Complétion** (état fin) : `%/KPI` = complete / villes matchées ; `compl` par
   ville = complete /20.
2. **Présence** (gate mercredi) : `présence(cellule)` = `present` si état ≠
   `unknown` (∧ ≠ N-A), `absent` si `unknown`, N-A hors dénominateur. **Cols 10
   (preuve-v2) et 20 (v3.4) EXCLUES** de la gate (pistes longues / non mesurables
   per-ville). `%présence/ville` = present / (present+absent) sur les 18 colonnes
   de gate. `presence_gate.cities_full_presence` = villes à 0 absent.

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
