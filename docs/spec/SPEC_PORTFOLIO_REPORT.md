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

### Existants (18) — repart des matrices de complétion committées

| KPI | Source | Champ |
|---|---|---|
| Zones — complétion | `work/coverage/completion-1-zones-normes-summary-20260723.json` ; **overlay N/A** : `work/coverage/zones-unzonable-absence-attestation-*.json` (le plus récent par nom) + état de base per-muni via `deliverables.zonesMatrix` | `lanes.zones.state_counts` + reclassement N/A des `N-A-PROVEN` (voir « Overlay N/A un-zonable » ci-dessous) |
| Normes — complétion | idem (`completion-1-zones-normes-summary-20260723.json`) | `lanes.normes.state_counts` |
| PV — complétion | `work/coverage/pv-completion-city-audit.json` | `summary.states` (denom = 1 106) |
| Règlement — complétion déclarée | `work/coverage/completion-regdens-20260802.json` | `totals.reglement_declared` |
| Règlement — preuve v2 | idem | `totals.reglement_proven` |
| Usage dominant — complétion | idem | `totals.usage_dominant` |
| Effet densifiant — complétion | idem | `totals.effet_densifiant` |
| Provenance zones — jointure exacte | `work/coverage/zone-provenance-quality-matrix-20260723-74345365.json` | `validation.city_identity` (exact vs sans jointure) |
| Provenance zones — qualité retained | idem | `validation.quality_status_partition.counts` (acceptable/candidate/orphan/unknown) |
| Provenance zones — preuve v2 exacte | idem | `counts.v2` (0 ; toutes not-assessed) |
| Immo — assignation lot-zone | `work/coverage/immo-lot-zone-assignment-matrix-20260802.json` | `summary.city_states` |
| Immo — normes pliées | `work/coverage/immo-folded-normes-city-matrix-20260802.json` | `counts.cityStates` |
| Immo champs — lots servis | `work/immo-field-completion-matrices/immo-field-completion-matrix.json` | `summary.by_field_status.lots_served` |
| Immo champs — surface m² | idem | `…surface_m2` |
| Immo champs — code postal | idem | `…postal_code` |
| Immo champs — adresse civique | idem | `…civic_address` |
| Immo champs — applicabilité TOD | idem | `…tod_applicability` (denom 39) |
| Immo champs — complétion TOD | idem | `…tod_completion` (denom 39) |

### Ajouts qualité/provenance (3) — rendent la ré-acquisition/le stampage MESURABLES

| KPI | Source | Définition |
|---|---|---|
| **Provenance zones — URL source servie** | `work/coverage/zone-source-readback-audit-*.json` (le plus récent par nom) | Nombre de collections servies dont `zone_source_url` est une URL http réelle (`STAMPED`) / total servi (871). `STAMPED_NULL` (champ présent, null) comptés `incomplete` ; `UNSTAMPED` (champ absent) comptés séparément. Ce KPI signale immédiatement un dé-stampage (ré-acquisition sans re-stamp dans la même passe). |
| **Provenance zones — fraîcheur/millésime** | `work/coverage/zones-sig-freshness-perime-inventory-*.json` (le plus récent par nom) | Unité = collection zonage servie ; dénominateur = total servi LU dans l'inventaire (nombre de lignes `munis`, `served_total`). Mapping AVEC PRÉCÉDENCE par ligne muni : `incomplete` si `vintage_perime.bool = true` (millésime périmé/suspect, même capture-fraîche) ; sinon `complete` si `freshness_class = "fresh"` ; sinon `unknown` si `freshness_class = "source-gap"`. `N/A = 0`. Voir la définition détaillée ci-dessous. |
| **Zones — cohérence lot-zone** | `work/coverage/lot-zone-consistency-scale-*.json` (le plus récent par nom) ; **repli** sur `work/coverage/lot-zone-consistency.json` si aucune passe à l'échelle n'existe | Si la source couvre assez de villes (≥ 50 % de l'univers, soit 553), ville `complete` ssi `status = "measured"` **ET** `mismatch_pct < 5 %`. Sinon → `donnée insuffisante` (aucune extrapolation). Règles d'exclusion : voir ci-dessous. |

**Registre des villes canoniques** — `work/coverage/coverage-matrix.json` est lu pour son
**seul ensemble de clés `cities`** (les 1 106 slugs canoniques), jamais pour ses valeurs de
couverture. Il sert de garde : une ligne de source hors de cet ensemble ne reçoit **aucun
crédit de complétion** (cf. `l-assomption`, `l-epiphanie`, `sainte-christine-d-auvergne`).

#### Définition du KPI « Provenance zones — fraîcheur/millésime »

- **Source** : l'inventaire committé de fraîcheur/millésime des zonages SIG servis,
  `work/coverage/zones-sig-freshness-perime-inventory-*.json`, le plus récent par nom daté
  (`discoverLatest`). Absent → KPI `unknown` (jamais inventé, `Précédent/Δ = —`).
- **Unité** = collection zonage servie. **Dénominateur** = total servi LU dans l'inventaire :
  le nombre de lignes du tableau per-muni `munis` (recoupé avec `served_total` ; écart signalé,
  jamais silencieux). **Jamais codé en dur.**
- **Mapping AVEC PRÉCÉDENCE**, ligne muni par ligne muni :
  1. `incomplete` si le booléen de vintage périmé `vintage_perime.bool` est `true` (servi mais
     millésime périmé/suspect → à re-sourcer), **même capture-fraîche** (la précédence prime) ;
  2. sinon `complete` si la classe de capture-freshness `freshness_class` vaut `"fresh"`
     (capture-fraîche ET non périmée) ;
  3. sinon `unknown` si `freshness_class` vaut `"source-gap"` (fraîcheur non mesurable en
     lecture seule). `N/A = 0`.
- Les comptes `complete`/`incomplete`/`unknown` sont **recalculés depuis les lignes muni**
  (measure > infer), puis **confrontés au bloc `summary`** de l'inventaire (`freshness.fresh`,
  `freshness.source-gap`, `vintage_perime.marker_suspect`) — tout écart est émis en
  avertissement, **jamais silencieux**.
- **Partition fermée** sur le total servi : `complete + incomplete + unknown + N/A =
  partitionTotal` (= nombre de lignes muni). Toute ligne dont la classe n'est ni `fresh` ni
  `source-gap` et qui n'est pas périmée (non attendu ; `stale = 0`) rompt la fermeture ⇒ KPI
  `unknown` + avertissement. `unknown` n'est **jamais** compté `complete`.
- **Traçabilité** : `actuel.extra` porte `{ fresh, vintage_suspect, source_gap,
  vintage_suspect_slugs: [{ slug, basis, freshness_class }] }`. Une note Markdown nomme la/les
  municipalité(s) vintage-suspecte(s) avec leur base (marqueur LU) et la source committée quand
  `vintage_suspect > 0` — pas deviné.
- **Exemple mesuré (2026-08-30, inventaire committé)** : `363 / 873` fraîches (`complete`) ·
  `1` périmé/vintage-suspect (`incomplete`) · `509` source-gap (`unknown`) = 873. La seule
  municipalité vintage-suspecte est `mont-tremblant` (marqueur `vintage-marker (Ancien)`),
  capture-fraîche mais millésime périmé : comptée `incomplete` par précédence, donc
  `complete = 364 fresh − 1 périmé-capture-fraîche = 363`.

#### Règles NON NÉGOCIABLES du KPI « cohérence lot-zone »

1. **Seuil** : ville `complete` **ssi** `mismatch_pct < 5 %` (strict).
2. **`inconclusive_zero_assigned` ⇒ `unknown`, jamais `complete`.** Une ville dont aucun lot
   servi ne porte de `code_zone` a `assigned = 0` : son `mismatch_pct` vaut `null` (0 mécanique
   si on le calculait). Le compter `complete` créditerait une **absence de donnée** comme une
   qualité. Ces villes sont `unknown`.
3. **Ville non auditable ⇒ `unknown`.** L'audit croise deux géométries SERVIES ; sans zonage
   servi **ou** sans lots servis il n'y a rien à comparer. Jamais `complete`, jamais `N/A`
   (l'absence de donnée servie est un manque, pas une non-applicabilité).
4. **Partition fermée sur 1 106** : `complete + incomplete + unknown + N/A = 1 106`, avec
   `unknown = inconclusive_zero_assigned + non auditables`. `--check` le vérifie.
5. **Contrôle défensif** : le générateur recalcule `complete` depuis les lignes villes et le
   confronte à l'agrégat `kpi_threshold_5pct` publié par la source (net des lignes
   hors-univers) ; tout écart est émis en avertissement, jamais silencieux.
6. **Contexte lots, séparé du KPI ville** : le mismatch pondéré par les lots et le volume de
   lots servis **sans `code_zone`** sont rapportés dans le bloc de notes (comme « normes
   pliées »), **jamais fondus** dans la complétion-ville.

#### Overlay N/A « un-zonable prouvé » du KPI Zones

Une municipalité **prouvée un-zonable** — désignation autoritative MAMH non-municipale-locale
(`Territoire non organisé` / `Gouvernement régional`), incapable d'un zonage municipal local —
est comptée **N/A** dans le KPI Zones. La preuve vient de l'attestation d'absence committée
`work/coverage/zones-unzonable-absence-attestation-*.json` (la plus récente par nom),
classification `N-A-PROVEN` uniquement. Rien n'est deviné ; sans attestation, aucun N/A n'est
ajouté (KPI de base inchangé).

Règles NON NÉGOCIABLES de l'overlay :

1. **Source committée seule.** Seules les lignes `classification = "N-A-PROVEN"` de l'attestation
   déclenchent un N/A. Une `UNKNOWN-source-gap` reste `unknown` (une absence de grille non prouvée
   n'est jamais N/A) — `unknown` n'est toujours JAMAIS compté `complete`.
2. **Gate univers canonique.** Chaque slug est confronté à l'ensemble des 1 106 clés `cities`
   (`coverage-matrix.json`) ; un slug hors-univers est ignoré (avertissement), aucun N/A.
3. **Anti-contradiction.** Un slug `N-A-PROVEN` dont la grille `qc-zonage` est SERVIE (`served_qczonage = true`)
   est refusé (avertissement) : une revendication d'inzonabilité contredite par une grille servie ne
   reclasse jamais en silence.
4. **Additif et mesuré (measure > infer).** L'état de base de chaque slug est **lu** dans la matrice
   zones per-muni (`deliverables.zonesMatrix`, verrouillée à la même passe que l'agrégat) ; la
   municipalité est retirée du **seul bucket qu'elle occupe réellement** (`complete`/`incomplete`/`unknown`)
   et ajoutée à `N/A`. Le bucket cible n'est jamais supposé. Sans matrice per-muni, l'overlay est
   **sauté** (aucune inférence).
5. **Partition fermée, jamais négative.** `complete + incomplete + unknown + N/A = 1 106` ; le
   dénominateur affiché vaut `1 106 − N/A`. Si un décrément dépasserait le compte de base d'un bucket,
   l'overlay est **entièrement sauté** (avertissement) — jamais de bucket négatif ni de partition non fermée.
6. **Traçabilité.** Le champ `actuel.extra` du KPI Zones porte `unzonable_na_proven_applied`, la source,
   et la liste des slugs reclassés avec leur désignation MAMH verbatim et leur `from_state` ; une note
   Markdown nomme les municipalités quand le compte est > 0.

Au 2026-08-30, l'overlay reclasse **2** municipalités : `caniapiscau` (Territoire non organisé) et
`eeyou-istchee-james-bay` (Gouvernement régional), toutes deux `incomplete` en base → `N/A`
(dénominateur Zones `1 106 − 2 = 1 104`).

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
- Règlement = **DEUX lignes distinctes**, jamais fondues : « complétion déclarée »
  (`regdens totals.reglement_declared`, source désormais committée) et « preuve v2 »
  (`totals.reglement_proven`, sous-partie alignée sur une preuve de capture v2). La
  bascule du 20260803 scinde l'ancienne ligne unique (preuve 542) ; la déclarée (895)
  est comparable à l'ancienne mesure déclarée 815 (progrès, PAS une régression). Le
  renommage de clé réinitialise la chaîne de diff (Précédent/Δ = `—` cette fois, aucun
  Δ fabriqué) — la comparabilité est DITE en note, jamais calculée.
- **Le snapshot précédent doit lui-même porter une mesure comparable.** Si le KPI y était
  `unknown`/`insufficient` (champs `null`), aucun Δ n'est calculable : la cellule vaut `—`,
  **jamais `0`** (un `0` laisserait croire à une absence de mouvement). Le rapport le DIT
  explicitement dans les notes plutôt que d'inventer un Δ.

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
