# Provenance règlement — shard 0/2 — pliage de rattrapage

Date : 2026-07-17T20:54:54Z

Périmètre strict : slugs d’indice pair dans la liste triée `served && reglement=false`.

## Villes servies

Les dix entrées étaient déjà curées dans `acquisition/config/reglement-provenance.json` mais la matrice de couverture les déclarait encore `reglement=false`. Les titres/avis ont été relus, puis `fold-reglement-to-zonage.ts --slugs` a été exécuté. Il était idempotent (`cellsChanged=0`) : les valeurs étaient déjà présentes dans les objets S3. La vérification API des polygones servis confirme l’après.

| slug | avant norme servie | numéro vérifié verbatim | après polygone servi |
|---|---|---|---|
| acton-vale | `null` | `069-2003` — «modifiant le règlement de zonage numéro 069-2003 de la Ville d’Acton Vale» (avis p1) | `069-2003` |
| bolton-est | `null` | `2025-447` — «RÈGLEMENT DE ZONAGE N° 2025-447» (p1), adoption 4 août 2025 | `2025-447` |
| coteau-du-lac | `null` | `URB 400` — «RÈGLEMENT DE ZONAGE / NUMÉRO URB 400» (p1) | `URB 400` |
| franklin | `null` | `272` — «RÈGLEMENT DE ZONAGE / NUMÉRO 272» (p1) | `272` |
| lac-sainte-marie | `null` | `2024-08-002` — «RÈGLEMENT DE ZONAGE / NUMÉRO 2024-08-002» (p1) | `2024-08-002` |
| mont-laurier | `null` | `134` — «Règlement numéro 134» (p1), adoption 26 novembre 2007 | `134` |
| new-carlisle | `null` | `2013-344` — «RÈGLEMENT NUMÉRO 2013-344» (p1), entrée en vigueur avril 2013 | `2013-344` |
| potton | `null` | `2001-291` — «RÈGLEMENT DE ZONAGE #2001-291» (p1) | `2001-291` |
| saint-antonin | `null` | `922-26` — «RÈGLEMENT DE ZONAGE NO922-26» (p1); dates de projet vides, donc millésime conservé `null` | `922-26` |
| saint-cuthbert | `null` | `352` — «RÈGLEMENT DE ZONAGE / RÈGLEMENT NUMÉRO 352» (p1) | `352` |

## Villes null maintenues

Les entrées suivantes du premier segment pair restent honnêtement null dans le registre, sans pliage.

| slug | raison verbatim ou constatable |
|---|---|
| ange-gardien | Le PDF lu dit «MUNICIPALITÉ DE L’ANGE-GARDIEN / RÈGLEMENT NUMÉRO 2025-008» : homonyme avec article, non attribuable au slug `ange-gardien`; aucun stamp. |
| authier | PDF direct : «MUNICIPALITÉ D’AUTHIER / GRILLE DES SPÉCIFICATIONS»; recherche plein texte : aucune occurrence de règlement, zonage ou année. |
| baie-des-sables | Aucune URL servie et aucun PDF local : rien à lire. |
| baie-trinite | La provenance servie vaut littéralement `non-disponible` : aucun document à lire. |
| candiac | La provenance servie vaut littéralement `non-disponible` : aucun document à lire. |
| champneuf | Aucune URL servie et aucun PDF local : rien à lire. |
| cheneville | PDF direct d’une page : «ZONAGE», «numéro de la zone»; aucune occurrence de «règlement». |
| clerval | Le document local est le «RÈGLEMENT DE CONSTRUCTION / NUMÉRO 84», pas un règlement de zonage; numéro écarté. |

Le registre n’a pas été modifié dans ce passage : les dix valeurs avaient déjà été curées; l’action nécessaire était le pliage et sa vérification côté collection servie.
