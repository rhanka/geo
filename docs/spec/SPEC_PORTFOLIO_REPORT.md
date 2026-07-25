# SPEC — Rapport portfolio par ville (format figé)

Statut : **figé** le 2026-07-23 (rapport validé par le propriétaire), rendu pérenne et
reproductible le 2026-07-24. Générateur : `scripts/portfolio-city-report.mjs`.

Ce document est la référence normative du rapport « portfolio par ville ». Le
générateur en est l'implémentation ; en cas de divergence, cette spec prime et le
générateur doit être corrigé (jamais le rapport à la main).

## Principe repo (à retenir)

> **Toute donnée servie doit porter sa source de preuve (`zone_source_url`). Une
> ré-acquisition doit re-stamper dans la même passe.** Le rapport mesure la
> **PRÉSENCE ET la QUALITÉ/PROVENANCE** ; sans l'axe provenance, la ré-acquisition
> et le stampage sont invisibles (un re-dépôt qui efface le stamp passe inaperçu).

## Commande de reproduction

```
node scripts/portfolio-city-report.mjs            # écrit md + json + snapshot history, imprime le tableau
node scripts/portfolio-city-report.mjs --check    # valide déterminisme + fermeture des partitions (n'écrit rien)
node scripts/portfolio-city-report.mjs --stdout   # imprime le Markdown sans écrire
node scripts/portfolio-city-report.mjs --date=YYYYMMDD   # force la date (test / reproduction)
```

Contraintes d'exécution : **déterministe**, **0 réseau**, **0 S3**, **0 déploiement**,
**0 Track**, **0 commit**. Aucune lecture hors des artefacts locaux committés.

## Sorties (whitelist)

- `work/coverage/portfolio-city-report-<YYYYMMDD>.md` — rapport lisible du jour.
- `work/coverage/portfolio-city-report-<YYYYMMDD>.json` — rapport machine du jour.
- `work/coverage/portfolio-report-history/<YYYYMMDD>.json` — snapshot sédimenté
  (identique au JSON du jour) servant de base au diff Précédent/Δ des runs futurs.

## Colonnes (ordre figé)

`KPI villes | Précédent | Actuel | Δ | Cible`

- **Ligne = un KPI** (jamais une ville).
- **Unité = la ville** ; dénominateur **1 106** villes canoniques (ou **1 100** quand
  6 villes Immo sans lot sont N/A explicites ; **39** pour l'axe TOD applicable).
- **Actuel** = complétion-ville : `N / DENOM complete · X incomplete · Y unknown · Z N/A`.
- **Précédent** = la mesure `Actuel` du snapshot daté le plus récent **antérieur** à
  aujourd'hui dans `portfolio-report-history/`. Absente → `—`.
- **Δ** = diff du snapshot précédent, par KPI, sur les champs `complete / incomplete /
  unknown / N/A` (mouvements non nuls, `complete` d'abord), ex. `+1 complete · -1 unknown`.
  Aucun snapshot précédent → `—`. **Aucun Δ n'est fabriqué.**
- **Cible** = dénominateur applicable, avec note N/A si < 1 106
  (ex. `1 100 (6 N/A explicites)`, `39 (1 067 N/A explicites)`).

## Mesure : règles invariantes

1. **`unknown` n'est JAMAIS compté `complete`.** Une entrée sans preuve locale reste
   `unknown` ; on n'en déduit ni présence ni absence.
2. **Les partitions ferment.** Pour chaque KPI ville :
   `complete + incomplete + unknown + N/A = 1 106`. Le dénominateur affiché (Cible)
   vaut `1 106 − N/A`, sauf **PV** qui conserve ses 2 villes pilotes N/A dans la cible
   1 106 (denominator = 1 106). Le KPI collection « URL source servie » ferme à son
   propre total (871 collections servies), pas à 1 106.
3. **Anti-invention.** Source/entrée manquante → KPI `unknown` avec `Précédent/Δ = —`,
   jamais deviné. Donnée présente mais couverture insuffisante → statut explicite
   `donnée insuffisante` (jamais extrapolé).
4. Chaque source est listée avec son **as-of** et son **sha256** recalculé sur les
   octets lus.

## Liste des KPI

### Existants (17) — repart des matrices de complétion committées

| KPI | Source | Champ |
|---|---|---|
| Zones — complétion | `work/coverage/completion-1-zones-normes-summary-20260723.json` | `lanes.zones.state_counts` |
| Normes — complétion | idem | `lanes.normes.state_counts` |
| PV — complétion | `work/coverage/pv-completion-city-audit.json` | `summary.states` (denom = 1 106) |
| Règlement — complétion | `work/coverage/completion-regdens-20260723.json` | `totals.reglement` |
| Usage dominant — complétion | idem | `totals.usage_dominant` |
| Effet densifiant — complétion | idem | `totals.effet_densifiant` |
| Provenance zones — jointure exacte | `work/coverage/zone-provenance-quality-matrix-20260723-74345365.json` | `validation.city_identity` (exact vs sans jointure) |
| Provenance zones — qualité retained | idem | `validation.quality_status_partition.counts` (acceptable/candidate/orphan/unknown) |
| Provenance zones — preuve v2 exacte | idem | `counts.v2` (0 ; toutes not-assessed) |
| Immo — assignation lot-zone | `work/coverage/immo-lot-zone-assignment-matrix-20260723.json` | `summary.city_states` |
| Immo — normes pliées | `work/coverage/immo-folded-normes-city-matrix.json` | `counts.cityStates` |
| Immo champs — lots servis | `work/immo-field-completion-matrices/immo-field-completion-matrix.json` | `summary.by_field_status.lots_served` |
| Immo champs — surface m² | idem | `…surface_m2` |
| Immo champs — code postal | idem | `…postal_code` |
| Immo champs — adresse civique | idem | `…civic_address` |
| Immo champs — applicabilité TOD | idem | `…tod_applicability` (denom 39) |
| Immo champs — complétion TOD | idem | `…tod_completion` (denom 39) |

### Ajouts qualité/provenance (2) — rendent la ré-acquisition/le stampage MESURABLES

| KPI | Source | Définition |
|---|---|---|
| **Provenance zones — URL source servie** | `work/coverage/zone-source-readback-audit-*.json` (le plus récent par nom) | Nombre de collections servies dont `zone_source_url` est une URL http réelle (`STAMPED`) / total servi (871). `STAMPED_NULL` (champ présent, null) comptés `incomplete` ; `UNSTAMPED` (champ absent) comptés séparément. Ce KPI signale immédiatement un dé-stampage (ré-acquisition sans re-stamp dans la même passe). |
| **Zones — cohérence lot-zone** | `work/coverage/lot-zone-consistency.json` | Si le fichier couvre assez de villes (≥ 50 % de l'univers), ville `complete` ssi `mismatch_pct < 5 %`. Sinon → `donnée insuffisante` (aucune extrapolation). |

## Schéma JSON de sortie

```json
{
  "contract": "portfolio-city-report/v1",
  "generatedAt": "<ISO>",
  "reportDate": "YYYY-MM-DD",
  "universe": 1106,
  "previousSnapshotDate": "YYYYMMDD | null",
  "kpis": [
    {
      "key": "<id stable>",
      "kpi": "<libellé>",
      "precedent": "<texte Actuel du snapshot précédent | —>",
      "precedentDate": "YYYYMMDD | null",
      "actuel": {
        "complete": <n|null>, "incomplete": <n|null>, "unknown": <n|null>, "na": <n|null>,
        "denominator": <n|null>, "partitionTotal": <n>, "status": "ok|unknown|insufficient",
        "display": "<texte>", "extra": { ... }?
      },
      "delta": "<texte Δ | —>",
      "cible": "<texte>"
    }
  ],
  "sources": [ { "path": "...", "asOf": "...", "sha256": "sha256:..." } ],
  "warnings": [ ... ]
}
```

Le snapshot history est identique au JSON du jour. Le diff se fait par `key` (stable),
avec repli sur le libellé `kpi`.

## Convention Δ (diff de snapshots, jamais fabriqué)

- Le générateur lit le snapshot `portfolio-report-history/<YYYYMMDD>.json` dont la date
  est **strictement < aujourd'hui**, la plus récente.
- Δ = diff par KPI sur `complete / incomplete / unknown / N/A` ; mouvements non nuls
  joints par ` · `, `complete` en premier, signe explicite (`+`/`-`).
- Pas de snapshot précédent, KPI `unknown`/`insufficient`, ou champ non numérique →
  Précédent/Δ = `—`.

## Validation (`--check`)

Rejette (exit ≠ 0) si : une partition ne ferme pas à son `partitionTotal` ; un KPI `ok`
a `complete > denominator` (unknown gonflerait complete) ; la sortie n'est pas
déterministe entre deux constructions. Sinon `CHECK OK`.

---

## Bloc guidance repo

> Aucun fichier de guidance racine (`CLAUDE.md` / `AGENTS.md` / `rules/`) n'existe à la
> racine du repo `geo` au 2026-07-24 ; ce bloc tient donc lieu de pointeur normatif.

- **Rapport standard portfolio par ville** = `node scripts/portfolio-city-report.mjs`
  (format figé : `docs/spec/SPEC_PORTFOLIO_REPORT.md`).
- **Principe** : toute donnée servie porte sa source de preuve (`zone_source_url`) ; une
  ré-acquisition doit re-stamper dans la même passe. Le rapport mesure présence **et**
  provenance.
