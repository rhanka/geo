# Effet densifiant — SHARD 1/2

Périmètre strict : indices impairs (`index % 2 == 1`) de la liste triée, soit
`champlain`, `cowansville`, `levis`, `mont-tremblant`,
`petite-riviere-saint-francois`, `preissac`, `rosemere`,
`saint-charles-borromee`, `saint-frederic`, `saint-mathieu-de-beloeil`,
`sainte-catherine` et `stratford`.

Date de passage : 2026-07-18T09:42:13.991Z.

## Villes servies

| Ville | Événement et garde AVANT | Zones pliées | Zones `densifie` |
| --- | --- | ---: | ---: |
| cowansville | Servi `1841`/2016 est AVANT de l'amendement `1841-41-2023`/2023. | `CBB-1`: 4 -> 4, `stable` (déduit de la classe H31, sources verbatim dans l'artefact). | 0 |
| saint-charles-borromee | Servi `2207-2022`/2022 est AVANT de `2207-5-2024`/2024. | `P9`: 24 -> 24, `stable` (compteurs explicites). | 0 |
| sainte-catherine | Servi `2009-Z-00`/2009 est AVANT du PPCMOI `2024-0024`/2025. | `H-415`: `null` -> 113, `inconnu`; le compteur AVANT est absent. | 0 |

Les trois artefacts existants ont été relus par le verrou `readEntries`, puis le
fold a confirmé une correspondance exacte d'une zone sur la collection S3
servie. L'API OGC expose les compteurs pour Cowansville et Saint-Charles-
Borromée. Elle expose aussi le verdict `inconnu` pour Sainte-Catherine; son
cache retourne encore l'ancien identifiant APRÈS `229-07-25` malgré le fold
`2024-0024`, sans redémarrage du service.

## Inconnu — aucun événement de zonage détectable

| Ville | Pré-gate documenté |
| --- | --- |
| levis | L'index officiel `https://www.ville.levis.qc.ca/ville/administration-municipale/avis-publics/` renvoie un document de 919 octets sans ancre de zonage (accès 403 au sitemap). Aucun événement ne peut être affirmé. |
| preissac | L'index officiel contient les avis 2022-2026. Les avis lisibles 2023-2026 des règlements 285 à 302 ne citent ni `zonage`, ni `239`, ni zone ou logement. Les quelques PDF sans couche texte ne fournissent aucun signal de zonage dans leur titre : aucun événement détectable. |
| saint-frederic | `https://www.st-frederic.com/avis-publics/` répond 406 (226 octets), sans ancre. C'est un trou de découverte, pas la preuve qu'aucun amendement n'existe. |

## Bloquées sans delta servi

| Ville | Événement détecté | Raison du non-service |
| --- | --- | --- |
| champlain | Les avis d'urbanisme listent notamment les consultations 2026-16 et 2026-17. | Les pages dynamiques ne fournissent ni PDF, ni texte de règlement, ni avis d'entrée en vigueur; le règlement servi n'a pas de millésime. |
| mont-tremblant | Avis d'entrée en vigueur du 8 juillet 2026 pour `(2026)-102-84`, modifiant `(2008)-102` sur la mixité obligatoire rue Léonard. | Le PDF final nomme seulement le règlement, sans zone ni compteur. La refonte complète publiée est explicitement préliminaire. Aucune zone ne peut être résolue exactement. |
| petite-riviere-saint-francois | Projets 677, 678, 702, 727 et 765 modifiant le zonage 603; l'avis 727 nomme H-1, H-4, F-13, H-24 à H-28. | Les sources trouvées sont des projets/consultations, sans avis final d'entrée en vigueur. Le règlement servi 603 n'a en outre pas de millésime : la garde AVANT interdit le delta. |
| rosemere | PV officiel du 9 mars 2026 : second projet `801-70`, lot 3 005 325 ajouté à `C-18`; projet `801-71`. | Aucun avis final d'entrée en vigueur ni grille APRÈS; le PV dit l'ajout à C-18 « sans changement » et ne donne aucun compteur de logements. |
| saint-mathieu-de-beloeil | La page officielle d'urbanisme publie la refonte `22.10` et ses amendements, avec les grilles actuelles. | La grille servie est `08.09` sans millésime. Même si la grille 22.10 est lisible, la garde AVANT/APRÈS est indécidable et interdit tout delta. |
| stratford | Projet 1185 : modification du règlement 1035 pour autoriser les logements intergénérationnels. | La seule source est la consultation du 5 octobre 2020, sans preuve d'entrée en vigueur ni compteur; la grille servie 1035 n'a pas de millésime. |

## Contrôles de non-invention

- Aucun `densifie` n'a été servi : les seuls compteurs bilatéraux vérifiés de ce
  shard donnent 4 -> 4 et 24 -> 24.
- Chaque zone sans compteur des deux côtés est restée `inconnu`.
- Aucun numéro de règlement ni intitulé de projet n'a été transformé en valeur
  de densité ou en date déduite.
- Les villes sans événement exploitable n'ont pas reçu d'artefact de zone :
  l'absence d'événement signifie zéro événement, non un faux delta stable.
