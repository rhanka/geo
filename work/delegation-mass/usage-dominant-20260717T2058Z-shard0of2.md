# Usage dominant — shard 0/2 — 2026-07-17T20:58Z

Deux règlements de la shard paire ont passé les gates de nomenclature : Batiscan (099-2008, art. 4.1) et Saint-Bonaventure (297-2018, art. 1.19). Les citations verbatim, les sources et le recouvrement SIG sont consignés dans leurs configurations respectives. Les grilles d'usages n'ont pas servi de source de dominance.

| Ville | résidentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|
| Batiscan (objet plié) | 20 | 0 | 1 | 14 | 3 | 14 |
| Saint-Bonaventure (API) | 11 | 6 | 2 | 10 | 0 | 3 |

## Préfixes laissés à `null`

| Ville | Codes / préfixe | Raison verbatim de la légende |
|---|---|---|
| Batiscan | `101-CR`, `106-CR`, `107-CR`, `112-CR`, `114-CR`, `116-CR`, `117-CR`, `119-CR`, `123-CR`, `127-CR` | `CR` = « Commerciale et résidentielle » : dualité, donc aucune dominante forcée. |
| Batiscan | `108-P`, `109-P`, `113-P`, `210-P` | `P` = « Publique » : zone publique. |
| Saint-Bonaventure | `P-1`, `P-2` | `P` = « Institutionnel » : public/institutionnel, hors des cinq catégories. |
| Saint-Bonaventure | `R-1` | `R` = « Forêt-récréation » : forestière (agricole) et récréative (environnemental), donc duale. |

## Vérification servie

`fold-usage-dominant.ts --slugs batiscan,saint-bonaventure` a écrit les deux objets. Saint-Bonaventure est confirmé par l'API publique : `null:3 agricole:10 commercial:6 industriel:2 residentiel:11`.

Batiscan est diagnostiqué puis plié sur les 52 codes bruts réellement servis (`221-E`, `218-RU`, `127-CR`, etc.) : le SIG est digit-first alors que `_dump-sig-codes` ne montre que sa forme canonique lettre-first. La lecture S3 après pliage confirme `environnemental:3 residentiel:20 agricole:14 industriel:1 null:14`. À 2026-07-17T20:58Z, l'API publique renvoie encore `null:52`; elle ne reflète donc pas encore l'objet réécrit. Cette divergence de surface est signalée, non masquée.

## Cibles lues, non servies

Abercorn, Aston-Jonction, Baie-Comeau, Frelighsburg, Ham-Sud, Lac-Supérieur, Matane, Notre-Dame-de-Stanbridge, Saint-Jean-de-la-Lande, Saint-Liboire, Saint-Lin–Laurentides et Sainte-Élisabeth ont été contrôlées dans la shard paire, mais sans table de légende couvrant les codes SIG, avec un millésime incompatible, ou avec des codes numériques dépourvus de la lettre de dominance. Aucun map n'a été écrit pour elles.
