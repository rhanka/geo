# Usage dominant — shard 0/2 — 2026-07-17

Configurations écrites et pliées (lecture S3 idempotente, `cellsChanged=0` après écriture) : `amqui`, `baie-du-febvre`, `beaupre`, `lac-des-seize-iles`, `saint-pascal`.

| Ville | Distribution pliée | Préfixes explicitement `null` |
| --- | --- | --- |
| amqui | résidentiel 100; commercial 34; industriel 17; agricole 39; environnemental 14; null 22 | P : « publique » |
| baie-du-febvre | résidentiel 2; commercial 4; industriel 1; agricole 10; environnemental 0; null 15 | AR : « Agriculture-Récréation » (duale); HC : « Habitation-Commerce » (duale); P : public et institution; G : gouvernementale; V : « Villégiature », hors des cinq catégories |
| beaupre | résidentiel 44; commercial 3; industriel 2; agricole 1; environnemental 5; null 23 | M : mixte; P : publique; Ri1 : récréation intensive avec possibilité d’habitation (duale); un polygone sans code |
| lac-des-seize-iles | résidentiel 0; commercial 0; industriel 0; agricole 0; environnemental 5; null 39 | RV : « Résidentielle et de villégiature » (duale); V : « Villageoise », hors des cinq catégories |
| saint-pascal | résidentiel 15; commercial 5; industriel 4; agricole 7; environnemental 0; null 27 | M : mixte; P : publique et institutionnelle; RZ/RZI : réserves; ID : « îlot déstructuré », sans dominante contractuelle |

Toutes les catégories viennent de la nomenclature « division/codification des zones » citée verbatim dans les cinq fichiers de configuration; aucune matrice de grilles n’a servi au classement.

## Vérification servie

Le pliage a bien persisté dans les objets S3 : le second passage à blanc rapporte `cellsChanged=0` et les distributions ci-dessus. L’API publique `https://api.geo.sent-tech.ca` retourne néanmoins encore uniquement `null` pour les cinq collections, y compris avec un paramètre de cache distinct. Cette divergence de cache/lecture API est signalée ici; aucune attente artificielle ni modification de données supplémentaire n’a été faite.
