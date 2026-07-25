# Provenance règlement — shard 2/3 — 2026-07-18T03:44:01-04:00

Périmètre strict : les slugs de `zonage-enrichment.json` avec `served=true`,
`reglement=false`, triés, puis `index % 3 == 2`. Univers : 84 slugs.

## Avant / après

- Avant l’intervention, les 84/84 slugs du shard avaient déjà une entrée curée
  dans `acquisition/config/reglement-provenance.json`; le fichier était propre.
- Aucun numéro, millésime ou URL n’a été inventé ou écrasé.
- Pliage relancé pour les trois entrées portant un numéro : `ogden`,
  `pointe-fortune`, `saint-polycarpe`. Résultat S3 : `cellsChanged=0` pour les
  trois (provenance déjà présente dans les polygones).
- Contrôle API après pliage : Ogden=`2025-05`, Pointe-Fortune=`400-2024`,
  Saint-Polycarpe=`218-2025`.

## Villes numérotées servies

| Slug | Numéro lu | Millésime | Page | État |
| --- | --- | --- | --- | --- |
| `ogden` | `2025-05` | `2025` | 1 | Complet dans le registre et déjà servi. |
| `pointe-fortune` | `400-2024` | `null` | 1 | Numéro réellement lu, mais aucune date d’adoption/entrée en vigueur verbatim : ne pas déduire `2024`. |
| `saint-polycarpe` | `218-2025` | `null` | 1 | Page-titre : « RÈGLEMENT DE ZONAGE NUMÉRO 218-2025 »; aucune date d’adoption/entrée en vigueur dans la codification : ne pas déduire `2025`. |

Les deux derniers numéros sont donc servis par le pliage existant, mais ne
constituent pas une provenance P0_1 complète tant que leur millésime reste nul.

## Villes null — raison verbatim (lot de PDF déjà référencés)

| Slug | Raison de refus |
| --- | --- |
| `barkmere` | p1 : « GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de zonage / VILLE DE BARKMERE ». L’annexe ne donne aucun numéro; « No. de règlement / Entrée en vigueur » est seulement un en-tête de modifications. |
| `lac-des-aigles` | Grille de 7 pages sans occurrence de « règlement », ni numéro, ni date d’adoption/entrée en vigueur. Les « 2011 à 2099 » sont des codes d’usage CUBF, pas un millésime. |
| `mont-saint-michel` | URL servie `Grilles_specifications_R257.pdf` : HTTP 404. `R257` n’est jamais retenu depuis le nom de fichier. |
| `saint-antoine-de-lisle-aux-grues` | PDF image : p1 « ST-ANTOINE-DE-L’ISLE-AUX-GRUES / GRILLE DES USAGES PERMIS », p2 grille pure; aucun numéro visible. `18070` est un identifiant de fichier. |
| `saint-alexis` | URL servie `2025-127_annexe_B.pdf` : HTTP 404; `2025-127` n’est pas déduit du nom de fichier. |
| `saint-felicien` | Cahier de notes et grilles, pas le corps. `18-943` n’apparaît jamais verbatim; les numéros lus (`18-969`, `18-965`, `18-967`, `18-950`) sont des amendements/autres règlements. |
| `saint-jean-de-matha` | « GRILLE DES SPÉCIFICATIONS / Règlement de zonage / ZONE P1-1 » : `P1-1` est explicitement le code de zone, jamais un numéro de règlement. |
| `saint-gabriel-de-brandon` | Grilles de 80 pages sans mention de règlement ni de municipalité; recherche plein texte sans « règlement de zonage numéro N ». |
| `saint-roch-ouest` | « ANNEXE 4.2 CADRE NORMATIF POUR LE CONTRÔLE DE L’UTILISATION DU SOL DANS LES ZONES DE CONTRAINTES » : ce n’est ni le corps ni une grille de zonage. `151-2023` n’est pas confirmé dans un cartouche de règlement de base. |
| `sainte-brigide-diberville` | « Annexe B : Grille des usages et des normes »; p15 « avant l’entrée en vigueur de ce règlement » et p17 « article 12.2 du règlement de zonage », sans numéro. |
| `hemmingford--les-jardins-de-napierville` | URL servie `https://www.mrcmatapedia.qc.ca/` : provenance transposée fausse (Hemmingford est dans Les Jardins-de-Napierville, non La Matapédia), donc URL et numéro restent nuls. |
| `sainte-paule` | p1 : « Cette grille fait partie integrante du reglement no. » suivi de rien; « Revise le / Reglement # » et « Authentifiee le » sont vides. `SP_XXX-19` contient le placeholder littéral `XXX`. |
| `saint-thomas` | p1 : « Règlement de zonage - ANNEXE “B” »; l’annexe désigne le règlement sans jamais le numéroter. |
| `temiscouata-sur-le-lac` | Couverture p1 : « RÈGLEMENT NUMÉRO 329-24 / (Projet) / ZONAGE »; le préambule parle d’« adopter un projet de règlement » : un projet n’est pas un règlement officiel adopté. |
| `tring-jonction` | Grille de deux pages; pied : « MUNICIPALITÉ DE TRING-JONCTION / RÈGLEMENT DE ZONAGE / PAGE B-I », sans numéro de base. |

Les 67 autres slugs du shard ne présentent pas de nouvelle URL PDF directe dans
la grille servie; ils sont déjà consignés au registre avec un verdict nul ou une
provenance à compléter. Aucun ne justifie une redécouverte hors de cette lane.
