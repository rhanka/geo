# Col-17 (adresse Immo) — triage des unknowns du sous-ensemble 167

Instantané 20260803. Lecture seule sur artefacts committés ; aucune écriture S3.

Col-17 sur 167 : **116 complete + 0 N/A = 116 résolus**, 51 unknown, 0 foldable.

Convertible par un fold côté geo **maintenant** : **0** (= foldable). Les 51 unknowns sont donc **intégralement gated sur le col-14 (immo)** :

| Blocage col-14 | Villes |
| --- | ---: |
| Aucune collection qc-lots servie (present:false) | 50 |
| Collection servie mais non résolvable (défaut d'identité/serving) | 1 |

## Servie mais non résolvable

| slug | pop | lots servis | lots/hab | anomalie |
| --- | ---: | ---: | ---: | --- |
| saint-pierre | 291 | 21322 | 73.3 | identité |

## Aucune collection qc-lots servie (immo doit déposer)

beloeil, henryville, lery, les-cedres, lile-cadieux, lile-dorval, lile-perrot, lorraine, marieville, mascouche, mcmasterville, mercier, mont-saint-gregoire, napierville, noyan, pincourt, pointe-calumet, pointe-des-cascades, richelieu, saint-blaise-sur-richelieu, saint-cesaire, saint-cyprien-de-napierville, saint-edouard, saint-isidore--roussillon, saint-jacques-le-mineur, saint-jean-sur-richelieu, saint-joseph-du-lac, saint-louis-de-gonzague--beauharnois-salaberry, saint-marc-sur-richelieu, saint-michel, saint-patrice-de-sherrington, saint-paul-dabbotsford, saint-paul-de-lile-aux-noix, saint-placide, saint-remi, saint-roch-de-lachigan, saint-roch-de-richelieu, saint-sebastien--le-haut-richelieu, saint-urbain-premier, saint-valentin, sainte-angele-de-monnoir, sainte-anne-des-plaines, sainte-marthe-sur-le-lac, sainte-martine, sainte-sabine--brome-missisquoi, sainte-therese, senneville, terrasse-vaudreuil, terrebonne, vaudreuil-sur-le-lac.

Conclusion : aucun re-fold col-17 côté geo ne convertit un unknown (foldable=0). La frontière col-17 est le dépôt/identité qc-lots (col 14, immo). Le générateur col-17 reclassera automatiquement dès qu'immo dépose/corrige les collections servies.
