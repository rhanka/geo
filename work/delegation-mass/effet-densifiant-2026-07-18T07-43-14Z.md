# Effet densifiant — SHARD 2/3

Date de départ : 2026-07-18T07:43:14.086Z

Slugs autorisés par `index % 3 == 2` : saint-mathieu-de-beloeil, rimouski,
champlain, cowansville, plaisance, saint-charles-borromee, preissac, stratford.

## Lot 1 — saint-mathieu-de-beloeil, rimouski, champlain, cowansville

### Villes SERVIES

| Ville | Zones densifiées | Preuve |
| --- | ---: | --- |
| rimouski | 1 | H-3018, règlement 24-018 : 1 → 16 logements par bâtiment, en vigueur le 2024-07-11. Artifact `work/effet-densifiant/rimouski.json`, fold validé et API OGC relue. |

### Villes inconnu — sans événement exploitable

| Ville | Résultat du pré-gate |
| --- | --- |
| champlain | L’archive officielle Urbanisme (`/fr/avis-publicc842/urbanisme/page-1`) et ses pages déclarées par le sitemap ne livrent aucun avis/PDF de changement de zonage à zones résolubles. Aucune densité n’est inférée. |
| preissac | L’index officiel des avis publics ne contient que quatre dérogations mineures (92 et 104 chemin des Peupliers, 207 du Lac, 51 Doré) : exclusions explicites de la lane, pas un événement de grille. |

### Villes bloquées

| Ville | Raison |
| --- | --- |
| saint-mathieu-de-beloeil | Les avis 2025–2026 citent des projets d’amendement au règlement de zonage 22.10 (dont I-4, I-2, IDC-*), mais le corpus lu les qualifie de projet/demande d’approbation référendaire ; aucune entrée en vigueur n’a été trouvée. |
| cowansville | La « Refonte du plan et des règlements d’urbanisme » publiée le 2022-10-18 est une démarche annoncée avec consultations prévues ; aucun règlement de zonage final remplaçant le 1841 servi, ni deux grilles comparables, n’a été trouvé. |
| plaisance | Garde AVANT impossible : la provenance servie est explicitement nulle pendant la transition URB 99-05 → projet Urb-02-2024. Le document 2024 laisse littéralement la date d’entrée en vigueur en blanc ; aucun delta n’est servi. |
| saint-charles-borromee | Événements adoptés détectés (notamment 2207-6-2024, 2207-12-2024 et 2207-13-2025, avec certificat MRC), mais les avis indiquent que les règlements ne sont consultables qu’à l’hôtel de ville. Les deux compteurs verbatim par zone ne sont donc pas publics et aucun delta n’est construit. |
| stratford | Événements de zonage détectés (1206, 1208, 1236 et 1257), mais la grille servie porte `reglement_numero=1035` et `reglement_millesime=null`. Le garde AVANT de la lane rend l’ordre pré/post indécidable ; aucun delta n’est servi. |

## Lot 2 — plaisance, saint-charles-borromee, preissac, stratford

Terminé sans élargir le shard.
