# Usage dominant — shard 0/2 — 2026-07-17

Configurations paires validées par la légende réglementaire et foldées : `adstock`, `audet`, `batiscan`, `beauceville`, `beaumont`, `belleterre`, `bonsecours`, `brigham`.

Les huit fichiers étaient déjà propres et inclus dans le commit `1672238` (`feat(acquisition): add usage dominant maps for shard 0`). Le fold a couvert chaque code SIG (`sansCode=0`).

## Collections vérifiées servies

| Ville | residentiel | commercial | industriel | agricole | environnemental | null |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| adstock | 59 | 0 | 2 | 44 | 16 | 53 |
| audet | 2 | 0 | 8 | 18 | 1 | 15 |
| batiscan | 20 | 0 | 1 | 14 | 3 | 14 |
| beauceville | 47 | 1 | 9 | 44 | 18 | 77 |
| beaumont | 30 | 3 | 1 | 6 | 5 | 22 |
| belleterre | 7 | 4 | 3 | 10 | 3 | 3 |
| bonsecours | 13 | 0 | 1 | 23 | 0 | 16 |

Préfixes volontairement `null` :

- `adstock` : `M2.7`–`M2.11` îlots déstructurés; `M5.2`/`M5.3` mixtes; `M5.4`, `ZS.1`, `ZS.6`–`ZS.8` réserves ou développement futur; `ZS.9` utilité publique.
- `audet` : `M` mixte, `P` publique, `RU` rurale sans dominante parmi les cinq catégories.
- `batiscan` : `CR` commerciale et résidentielle (duale), `P` publique.
- `beauceville` : `M` et `CV` mixtes; `P` publique; `Ex` expansion/réserve; `V` villégiature hors des cinq; `Id`/`IdSm`/`IdSmv` îlots déstructurés.
- `beaumont` : `M` mixte, `P` publique, `R` récréation et tourisme (duale), `V`/`VB`/`VF` villégiature hors des cinq catégories.
- `belleterre` : `INST` institutionnel et public.
- `bonsecours` : `MIX` mixte, `P` publique, `DMS` dépôt de matières solides, `ID` îlot déstructuré (duale), `RUR` rural sans dominante unique.

## Anomalie de publication : Brigham

Le fold donne `residentiel=6 commercial=1 industriel=2 agricole=7 environnemental=0 null=24` et l'objet S3 `normalized/ca-qc-zonage/qc-zonage-brigham.geojson` contient bien 40 champs `usage_dominant`, dont 16 non nuls. L'API renvoie toutefois encore `null:40`, y compris avec `Cache-Control: no-cache` et un paramètre de cache distinct. Brigham n'est donc pas comptée comme servie dans le tableau ci-dessus.

Ses nulls intentionnels sont `FM` mixte, `P` communautaire/publique, `ID` îlot déstructuré et `E` événementiel sans dominante parmi les cinq. Une fois la collection rafraîchie, la distribution attendue est celle du fold ci-dessus.
