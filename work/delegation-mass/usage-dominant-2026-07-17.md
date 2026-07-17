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
