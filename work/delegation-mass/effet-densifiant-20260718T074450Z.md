# Effet densifiant (4a) — SHARD 1/3 — 2026-07-18T07:44:50Z

Périmètre, issu de la liste FOCUS triée alphabétiquement (`index % 3 == 1`) :
`champlain`, `la-sarre`, `mont-tremblant`, `plaisance`, `rosemere`,
`saint-come-liniere`, `saint-mathieu-de-beloeil`, `sainte-cecile-de-milton`.

## Méthode et garde

- Lecture du règlement et du millésime effectivement portés par
  `qc-zonage-<slug>` avec `_effet-shard-triage.ts`.
- Inventaire du corpus local avec `_effet-densifiant-triage.ts`, puis lecture
  native des PDF. Les index municipaux d'avis publics ont aussi été consultés
  en lecture seule.
- Aucun compteur, numéro de règlement ou rapprochement de code de zone n'a été
  inféré. En particulier, le verrou `readEntries` n'est pas sollicité sans les
  deux compteurs verbatim et une direction déterminée.

## Villes servies : 0

Aucun artefact `work/effet-densifiant/<slug>.json`, aucun fold et aucune
écriture S3 n'est justifié. Il n'y a donc aucun champ API à vérifier dans ce
lot.

## Inconnu — aucun événement de zonage détectable

| slug | règlement servi | constat |
|---|---|---|
| `mont-tremblant` | `2008-102 / 2008` | Le corpus local ne contient que les annexes de grilles 2008-102; l'index municipal d'avis consulté ne fournit aucun avis/PDF de zonage correspondant. `inconnu:no-event-detected`. |
| `rosemere` | `801 / 2011` | Une seule grille consolidée est disponible; l'index municipal d'avis consulté ne fournit aucun événement de zonage. `inconnu:no-event-detected`. |
| `saint-come-liniere` | `148-06 / 2021` | Le seul corpus est la grille catégorielle consolidée « à date 22 septembre 2021 »; l'index consulté ne livre aucun acte d'amendement identifiable. C'est un gap de découverte, non une absence historique affirmée. `inconnu:no-event-detected`. |

## Événement ou transition détecté — delta interdit

| slug | événement / garde AVANT | raison anti-invention |
|---|---|---|
| `champlain` | Le règlement consolidé 2009-03 liste la modification `2012-03` : « Agrandir la zone 122-R afin d'y autoriser les habitations multifamiliales d'un maximum de 8 logements ». | Le compteur APRÈS est explicite, mais aucun compteur AVANT ni grille pré-2012 n'est disponible. De plus, `122-R` n'est pas une correspondance exacte du code servi `R-122`; aucune normalisation documentée n'autorise ce rapprochement. `inconnu:predecessor-count-and-exact-zone-unresolved`. |
| `la-sarre` | `05-2024 / 2024` est servi APRÈS. Son art. 1.2 abroge et remplace les règlements de zonage antérieurs. | La grille prédécesseure et le mapping exhaustif ancien→nouveau sont absents du corpus. Sans eux, aucun compteur AVANT par zone ne peut être servi. `inconnu:predecessor-not-acquired`. |
| `plaisance` | Le corpus juxtapose `URB 99-05` (mis à jour en 2017) et le **projet** `Urb-02-2024`, qui dit abroger le premier mais laisse la date d'entrée en vigueur vide. | La collection servie ne porte ni `reglement_numero` ni `reglement_millesime`; le côté servi et donc le sens AVANT/APRÈS sont indécidables. `inconnu:served-bylaw-undecided`. |
| `saint-mathieu-de-beloeil` | La grille 2026 affiche des modifications `22.10.xx.23`, `22.10.xx.24` et `22.10.xx.25`; le servi ne porte que `08.09` et un millésime `null`. | La garde Stage 3 exige le millésime servi exact. Les actes individuels, leurs zones touchées et les deux compteurs ne sont pas isolés; les grilles de versions différentes ne suffisent pas à faire un diff attribuable. `inconnu:served-millesime-missing-and-event-scope-unresolved`. |
| `sainte-cecile-de-milton` | L'index officiel contient plusieurs amendements au zonage 560-2017 (dont 659-2024, 662-2024, 670-2024, 675-2025 et 684-2026). | La collection servie porte `560-2017` mais un millésime `null`; aucune grille avant/après de ces actes n'est dans le corpus. La direction et les deux compteurs restent indéterminés. `inconnu:served-millesime-missing-and-two-sided-grids-unavailable`. |

## Suite sûre

1. La Sarre est le meilleur candidat de refonte : acquérir la grille du
   règlement abrogé, établir le mapping ancien→nouveau, puis lire les deux
   compteurs par zone.
2. Champlain exige la grille immédiatement antérieure à 2012-03 et une
   canonicalisation de zone explicitement démontrée avant toute lecture de
   densité.
3. Saint-Mathieu-de-Beloeil et Sainte-Cécile-de-Milton demandent d'abord une
   provenance servie complète (`reglement_numero` + `millesime`) et les actes
   d'amendement/versions de grilles correspondants.

## Garanties

- 0 densification inventée ; aucun delta n'est déduit d'un titre, d'un numéro
  de règlement, d'une année ou d'une classe d'usage.
- 0 artefact de fold écrit, 0 écriture S3, 0 redémarrage de `geo-api`.
