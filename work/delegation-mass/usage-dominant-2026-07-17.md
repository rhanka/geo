# Usage dominant — 2026-07-17

## Shard 0/2 (préexistant)

Configurations écrites et pliées (lecture S3 idempotente, `cellsChanged=0` après écriture) : `amqui`, `baie-du-febvre`, `beaupre`, `lac-des-seize-iles`, `saint-pascal`.

| Ville | Distribution pliée | Préfixes explicitement `null` |
| --- | --- | --- |
| amqui | résidentiel 100; commercial 34; industriel 17; agricole 39; environnemental 14; null 22 | P : « publique » |
| baie-du-febvre | résidentiel 2; commercial 4; industriel 1; agricole 10; environnemental 0; null 15 | AR : « Agriculture-Récréation » (duale); HC : « Habitation-Commerce » (duale); P : public et institution; G : gouvernementale; V : « Villégiature », hors des cinq catégories |
| beaupre | résidentiel 44; commercial 3; industriel 2; agricole 1; environnemental 5; null 23 | M : mixte; P : publique; Ri1 : récréation intensive avec possibilité d’habitation (duale); un polygone sans code |
| lac-des-seize-iles | résidentiel 0; commercial 0; industriel 0; agricole 0; environnemental 5; null 39 | RV : « Résidentielle et de villégiature » (duale); V : « Villageoise », hors des cinq catégories |
| saint-pascal | résidentiel 15; commercial 5; industriel 4; agricole 7; environnemental 0; null 27 | M : mixte; P : publique et institutionnelle; RZ/RZI : réserves; ID : « îlot déstructuré », sans dominante contractuelle |

Toutes les catégories du shard 0/2 viennent de la nomenclature « division/codification des zones » citée verbatim dans les cinq fichiers de configuration; aucune matrice de grilles n’a servi au classement.

## Shard 1/2

Configurations servies par `fold-usage-dominant.ts` :

| Ville | Distribution S3 servie |
| --- | --- |
| Clermont (Charlevoix-Est) | résidentiel 55, commercial 2, industriel 4, agricole 27, environnemental 5, null 16 |
| La Durantaye | résidentiel 10, commercial 0, industriel 5, agricole 5, environnemental 1, null 8 |
| Saint-Nérée-de-Bellechasse | résidentiel 15, commercial 0, industriel 2, agricole 18, environnemental 2, null 8 |

Les trois cartes utilisent la légende de dominance lue dans le règlement officiel, et non les grilles des usages permis. Les `zone_code` servis commencent par leur numéro (par exemple `012.1-Af`), donc les clés de configuration sont les codes SIG complets afin de respecter le matching par préfixe du fold.

## Nulls explicites

- Clermont : `002-Up` est « Utilité publique »; `113-P`, `115-P`, `115.1-P`, `122.5-P`, `143-P` sont « Publique »; `115.2-M`, `120-M`, `121-M`, `122-M`, `122.1-M`, `122.2-M`, `122.3-M`, `135-M`, `136-M`, `136.1-M` sont « Mixte ».
- La Durantaye : `22-P`, `24-P` sont « Publique et institutionnel »; `11-M`, `12-M`, `13-M`, `14-M`, `15-M`, `33-M` sont « Mixte (habitation et/ou commerce) ».
- Saint-Nérée-de-Bellechasse : `21-P`, `22-P` sont « Publique et institutionnel »; `11-M`, `12-M`, `13-M`, `14-M`, `15-M`, `16-M` sont « Mixte (habitation et/ou commerce) ».

## Vérification API

La Durantaye a répondu directement : `agricole:5 environnemental:1 industriel:5 null:8 residentiel:10`.

Clermont et Saint-Nérée-de-Bellechasse avaient déjà leur collection en cache côté geo-api et l'API a répondu `null:109` et `null:45` après le fold. La relecture S3 par `fold-usage-dominant.ts --dry-run` est idempotente (`cellsChanged=0`) et confirme les distributions du tableau; aucun cache n'a été contourné ni modifié.

## Cibles laissées sans configuration

Hampstead, Notre-Dame-de-Lourdes, Saint-Philippe et Stoke ont été lus mais leur règlement ne fournit pas la légende reliant les préfixes SIG aux catégories; Saint-Armand, Saint-Narcisse, Saint-Stanislas-des-Chenaux et Sainte-Geneviève-de-Batiscan n'ont pas d'URL de règlement servie. Aucun préfixe n'a été inféré à partir des grilles ou de sa seule forme.

## Shard 0/2 — lot de publication

Les cinq cartes ci-dessous avaient une configuration réglementaire déjà committée. Les légendes sont citées verbatim dans les cartes; aucune matrice des usages permis n’a servi au classement. Le fold a été suivi du redémarrage documenté de `geo-api`, qui recharge les collections S3 mises en cache au premier GET.

| Ville | résidentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|
| ascot-corner | 22 | 12 | 3 | 8 | 1 | 60 |
| cantley | 15 | 0 | 0 | 10 | 0 | 42 |
| cap-sante | 78 | 11 | 2 | 15 | 9 | 29 |
| cote-saint-luc | 155 | 17 | 1 | 0 | 0 | 66 |
| la-conception | 0 | 0 | 0 | 9 | 2 | 31 |

Vérification OGC effectuée sur `https://api.geo.sent-tech.ca/collections/qc-zonage-<slug>/items?limit=1000` après le redémarrage de `geo-api`.

### Préfixes `null` explicites

| Ville | Préfixes | Justification réglementaire |
|---|---|---|
| ascot-corner | `M`; `P`; `RU`; `ID`, `IS` | Mixtes; publiques; rurales sans dominante parmi les cinq; îlots déstructurés / `IS` sans dominante énoncée. |
| cantley | `RF`; `PU`; `TM`; `RU`, `RC`, `FN`, `RM` | Réserve foncière; publique; touristique mixte; affectations à fonctions hétérogènes. |
| cap-sante | `M`; `P`; `Rx`; `T` | Mixte résidentielle-commerciale; publique et institutionnelle; résidentielle de réserve; transport hors catégories. |
| cote-saint-luc | `PM`, `PE`, `PGE`; `IR` | Dominances publique et institutionnelle. |
| la-conception | `FC`; `RF`; `RR` | « Foresterie et de conservation »; « Résidentielle et faunique »; « Résidentielle et récréation »: chacune joint deux catégories. |

Notes de qualité: Côte-Saint-Luc comporte 3 polygones sans code SIG, servis `null` sans inventer de préfixe. Bedford--Brome-Missisquoi est laissé hors lot: le règlement local lu identifie les zones par lettres et numéros, mais ne donne pas la légende lettre→dominante; aucune catégorie n'est déduite des grilles d'usages. La collection résolue de Beaupré comporte 20 polygones sans code SIG, donc aucun mapping supplémentaire n'est créé.

## Shard 0/2 — second lot de publication

| Ville | résidentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|
| lawrenceville | 19 | 0 | 3 | 17 | 0 | 5 |
| mont-saint-hilaire | 119 | 24 | 5 | 36 | 27 | 29 |
| neuville | 52 | 6 | 5 | 32 | 8 | 24 |
| pointe-claire | 71 | 6 | 7 | 0 | 22 | 16 |
| preissac | 10 | 0 | 1 | 10 | 2 | 2 |

Toutes les distributions sont vérifiées sur l’API OGC après fold. Les légendes réglementaires pertinentes sont citées verbatim dans chaque carte committée; les grilles d'usages permis ne sont pas utilisées.

### Préfixes `null` explicites

| Ville | Préfixes | Justification réglementaire |
|---|---|---|
| lawrenceville | `MIX`; `P`; `PAT` | Zones mixtes; publiques; patrimoniales, hors des cinq catégories. |
| mont-saint-hilaire | `CA`; `P` | « Commercial-agricole » est dual; « Publique et institutionnelle » est public. |
| neuville | `M`, `M/a`, `C/I`; `Pa`, `Pb`; `T`; `Rx` | Vocations duales; publique/utilité publique; transport; résidentielle de réserve. |
| pointe-claire | `Cv`; `Pb`, `Pc`; `U` | Commerce et logements villageois (dual); institutions/cimetières; services d'utilité publique. |
| preissac | `REC` | « Récréotouristique » rangée par le règlement sous la dominante communautaire, hors catégories servies. |

La Sarre est laissée hors lot: 340 de ses 570 polygones n'ont pas de code SIG. Aucun `null` de dominante n'est créé pour masquer cette absence de code.

## Shard 1/2 — Mont-Carmel et Métis-sur-Mer

Les deux configurations ont été pliées et contrôlées sur l’API OGC publique. Mont-Carmel s’appuie sur la légende « Dominantes » de l’Annexe A du règlement 340-2025. Métis-sur-Mer est un `null` servi légitime : l’art. 4.1 définit les dominantes par des lettres suffixes, alors que le SIG ne sert que les numéros `01` à `65`, sans lien réglementaire entre un numéro et son suffixe.

| Ville | résidentiel | commercial | industriel | agricole | environnemental | null |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mont-Carmel | 4 | 1 | 0 | 10 | 2 | 33 |
| Métis-sur-Mer | 0 | 0 | 0 | 0 | 0 | 67 |

### Préfixes explicitement `null`

- Mont-Carmel : `M` est « Mixte », `P` « Publique et institutionnelle », `RZ`/`RZI` des « Résidentielle[s] de réserve », `ID` un « Îlot déstructuré » et `V` « Villégiature ».
- Métis-sur-Mer : chacun des codes numériques `01` à `65` reste `null`; le règlement ne permet pas de les raccorder à AGC/AGF/AIC/FRT/RCT/VLG/CSV/HBF/HMD/MTF/CMC/ILD/LSR.
