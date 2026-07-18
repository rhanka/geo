# Usage dominant par zone — shard 0/2 — 2026-07-18T00:24:53Z

Troisième lot: cinq slugs d'indice pair, retenus parce que leur configuration
cite la nomenclature du règlement et ne déduit pas la catégorie de la matrice
des usages. Les préfixes SIG ont été relus avant le fold. Celui-ci est
idempotent (`cellsChanged=0`); les valeurs ci-dessous sont vérifiées sur l'API.

| Slug | Polygones | residentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|---:|
| frelighsburg | 11 | 2 | 0 | 0 | 6 | 3 | 0 |
| fugereville | 33 | 15 | 2 | 0 | 6 | 0 | 10 |
| godbout | 59 | 17 | 0 | 1 | 5 | 18 | 18 |
| grosse-ile | 42 | 8 | 0 | 6 | 10 | 14 | 4 |
| ham-sud | 36 | 1 | 0 | 0 | 7 | 0 | 28 |

## Préfixes explicitement `null`

- `frelighsburg`: aucun; les quatre préfixes SIG (`AE`, `AF`, `RA`, `REC`)
  sont tous univoques dans la légende de l'annexe C.
- `fugereville`: `A` et `F` relèvent du « zonage rural » multi-usage; `BG`
  est la zone spéciale du domaine de la Baie Gillies; `Eg` est le zonage de
  l'église, institutionnel. Trois polygones sont sans code. Ces sept `null`
  nommés et les trois sans code font les dix retournés par l'API.
- `godbout`: `M` « Multifonctionnelle » (la table dit « la ou les fonctions
  dominantes ») et `P` « Publique et institutionnelle ».
- `grosse-ile`: `Pa` « Zone publique » et `NVa` sous « Zone noyau villageois »
  (aucune des cinq dominantes n'est énoncée).
- `ham-sud`: `M` « Mixte commerciale – résidentielle » et `V`
  « Villégiature »; `F`, `Rt`, `Rur`, `Rua`, `ZER` sont présents au SIG mais
  absents de la nomenclature courante 2025-08, donc maintenus `null` par
  anti-invention, sans repli vers `R` ni vers `A`.

`guerin` a été écartée: la configuration existante résout plusieurs lettres à
partir des usages autorisés, sans table réglementaire de fonction dominante.
Cela ne satisfait pas le gate de cette passe et aucun fold n'a été lancé pour
elle.
