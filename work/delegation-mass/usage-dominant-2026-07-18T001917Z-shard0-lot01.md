# Usage dominant par zone — shard 0/2 — 2026-07-18T00:19:17Z

Périmètre: uniquement les indices pairs de la liste triée `served && usage_dominant=false`.
Les cibles ayant déjà une table réglementaire vérifiée dans
`acquisition/config/usage-dominant-map/` ont été repliées puis contrôlées sur
l'API servie. Le fold est idempotent (`cellsChanged=0`): les cinq collections
étaient déjà estampillées; les distributions API ci-dessous confirment l'état
servi.

## Villes servies

| Slug | Polygones | residentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|---:|
| adstock | 174 | 59 | 0 | 2 | 44 | 16 | 53 |
| audet | 44 | 2 | 0 | 8 | 18 | 1 | 15 |
| batiscan | 52 | 20 | 0 | 1 | 14 | 3 | 14 |
| beauceville | 196 | 47 | 1 | 9 | 44 | 18 | 77 |
| beaumont | 67 | 30 | 3 | 1 | 6 | 5 | 22 |

Chaque map cite verbatim sa table de codification réglementaire; aucune
catégorie ne provient de la matrice des usages permis. Les préfixes déclarés
sont ceux réellement présents dans le SIG.

## Préfixes explicitement `null`

- `adstock`: `M2.7`–`M2.11` « Îlot déstructuré »; `M5.2` « Villageois mixte »;
  `M5.3` « Noyau villageois »; `M5.4` « Zone d'aménagement prioritaire »;
  `ZS.1` « Mont Adstock réserve »; `ZS.6`–`ZS.8` « secteur en attente de
  développement »; `ZS.9` « Utilité publique ». Ces libellés sont soit
  mixtes, réservés/développement futur, soit publics.
- `audet`: `M` « Mixte » (duale), `P` « Publique », `RU` « Rurale » (aucune
  dominante parmi les cinq et bloque le repli sur `R`).
- `batiscan`: `CR` « Commerciale et résidentielle » (duale) et `P` « Publique ».
- `beauceville`: `M` « Mixte-résidentielle (Habitation) / commerciale et de
  services » et `CV` « Centre-ville » (mixtes); `P` « Public »; `EX`
  « Expansion urbaine » (réserve de développement); `V` « Villégiature »;
  `ID`, `IDSM`, `IDSAR`, `IDSMV` « Îlot déstructuré » (avec les qualificatifs
  sans morcellement / vacant), sans dominante nommée. Le map, nécessairement
  code-par-code pour les codes numériques d'abord, énumère les occurrences SIG
  de ces familles.
- `beaumont`: `M` « Mixte (habitation et/ou commerce) » (duale), `P`
  « Publique et institutionnel », `V` « Villégiature », `R` « Récréation et
  tourisme » (vocation duale récréative/touristique).

## Cibles paires différées, sans config

- `abercorn`: le corpus local est le corps du règlement sans l'annexe-légende;
  il ne permet pas de relier de manière verbatim les codes SIG `P`, `R`, `RF`
  à une fonction dominante.
- `aston-jonction`: les pièces locales sont un amendement et des grilles; aucune
  légende de la codification des préfixes SIG `A`, `H`, `HC`, `I`, `P`, `X` n'a
  été lue dans le règlement de base.
- `baie-comeau`: le document disponible est la grille des spécifications; elle
  ne fournit pas la légende réglementaire des préfixes SIG `C`, `CO`, `CV`,
  `F`, `I`, `L`, `M`, `P`, `R`, `V`. Aucun map n'a donc été écrit par déduction.

Vérification API: `qc-zonage-<slug>/items?limit=1000`, regroupée sur
`properties.usage_dominant`.
