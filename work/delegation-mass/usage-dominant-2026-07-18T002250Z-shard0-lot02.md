# Usage dominant par zone — shard 0/2 — 2026-07-18T00:22:50Z

Deuxième lot: seulement les indices pairs de la liste triée
`served && usage_dominant=false`, avec priorité aux configurations qui citent
une table de codification réglementaire. Les préfixes ont été relus sur les
collections SIG, puis le fold a été exécuté et l'API contrôlée.

## Villes servies et vérifiées par l'API

| Slug | Polygones | residentiel | commercial | industriel | agricole | environnemental | null |
|---|---:|---:|---:|---:|---:|---:|---:|
| belleterre | 30 | 7 | 4 | 3 | 10 | 3 | 3 |
| bonsecours | 53 | 13 | 0 | 1 | 23 | 0 | 16 |
| cookshire-eaton | 27 | 0 | 0 | 1 | 10 | 1 | 15 |
| dixville | 46 | 9 | 0 | 0 | 29 | 0 | 8 |
| dudswell | 32 | 7 | 0 | 2 | 13 | 0 | 10 |
| dupuy | 41 | 7 | 2 | 1 | 20 | 3 | 8 |

`fold-usage-dominant.ts` a été idempotent (`cellsChanged=0`), et chacune de
ces distributions est celle retournée par
`qc-zonage-<slug>/items?limit=1000`.

## Préfixes explicitement `null`

- `belleterre`: `INST` est la famille « zonage institutionnel et public ».
- `bonsecours`: `MIX` « Zones mixtes », `P` « Zones publiques », `DMS`
  « Zones de dépôt de matières solides », `ID` « Zones d'îlots déstructurés »
  et `RUR` à caractère rural mixte; aucune dominante unique n'est imposée.
- `cookshire-eaton`: `Ru` « rurale » et `V` « villégiature » sont des groupes
  distincts de la lettre résidentielle `Re` dans la table de l'art. 5.1.
- `dixville`: `ML` « Mixte-locale », `MA` « Mixte-artérielle » et `P`
  « Publique ».
- `dudswell`: `Ru` « Rurale » et `Rte` (emprises `Rte.112` / `Rte.255`,
  infrastructure absente de la légende des vocations).
- `dupuy`: `CV` « Centre village » (mixte), `RE` « Réserve urbaine », `PC`
  « Publique et communautaire » et `RN` « Ressource naturelle » sans
  dominante parmi les cinq.

## Brigham — écart de service à reprendre

Le règlement 06-101, Annexe B, légende « Vocations principales », couvre tous
les préfixes SIG (`A`, `AF`, `C/C1`, `E`, `FM`, `I/I1-I3`, `ID`, `P`,
`R/R1/R5`, `V`). Le fold S3 donne 40 polygones: résidentiel 6, commercial 1,
industriel 2, agricole 7, `null` 24 (`ID` îlot déstructuré 21, `FM` mixte,
`P` communautaire/public, `E` événementiel). Toutefois l'API renvoie encore
`null:40`; les trois échantillons retournent aussi
`usage_dominant_source:null`, alors que le fold lit déjà les valeurs estampillées
et reste à `cellsChanged=0`. C'est un cache/API non rafraîchi, pas une raison de
modifier ou de déduire la nomenclature; Brigham n'est donc pas comptée parmi
les villes vérifiées par l'API ci-dessus.

`clermont--abitibi-ouest` a été écartée du lot: son map existant se fonde sur
des libellés SIG auto-descriptifs, sans table/légende lue dans le règlement;
ce fondement ne satisfait pas le gate de ce passage.
