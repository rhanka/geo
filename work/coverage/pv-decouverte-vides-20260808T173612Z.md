# File de capture PV — vides 2026-08-08T17:36:12Z

Découverte web en lecture seule (GET textuels seulement) depuis
`pv-decouverte-worklist/v1`; aucun octet de document n'a été lu et aucune
capture n'a été soumise. L'univers frais contient 222 municipalités vides.
Les 25 municipalités du batch `20260808T202000Z` ont été exclues; ce lot prend
les 24 suivantes, groupées par MRC. Les cibles de capture portent toutes la
source `pv-index`.

| MRC | Municipalités | Capturables | Sans source | URLs prêtes |
| --- | ---: | ---: | ---: | ---: |
| Abitibi | 7 | 0 | 7 | 0 |
| Le Fjord-du-Saguenay | 6 | 0 | 6 | 0 |
| Les Laurentides | 6 | 4 | 2 | 235 |
| Le Domaine-du-Roy | 5 | 1 | 4 | 111 |
| **Total** | **24** | **5** | **19** | **346** |

Les municipalités ouvrables sont Brébeuf (78 URLs), Ivry-sur-le-Lac (95), La
Conception (20), Sainte-Agathe-des-Monts (42) et Chambord (111). Les MRC les
plus productives sont donc Les Laurentides, puis Le Domaine-du-Roy.

Parmi les 19 municipalités sans source, 14 ont un site lisible mais aucun PV
documentaire observable; 5 sont indéterminées faute de site utilisable
(DNS/transport). Aucun cas `offsite`, SPA ou robots/403 n'a été observé dans ce
lot, donc aucune URL de ces catégories n'est inventée ou retenue.

Les artefacts `capture-lot-0001` et `capture-lot-0002` sont volontairement
vides (Abitibi et Fjord-du-Saguenay). Les deux worklists non vides prêtes pour
la soumission, lorsque WP7 aura rétabli le kubeconfig, sont
`capture-lot-0003` et `capture-lot-0004`. Avec le batch précédent (851 URLs),
la file cumulée est de 1 197 URLs uniques, sans doublon inter-batch.
