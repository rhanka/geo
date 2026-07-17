# Usage dominant — shard 0/2 — 2026-07-17T21:10Z

## Saint-Bruno-de-Kamouraska

Règlement lu : chapitre 3, art. 3.2 « Codification des zones ». La table affirme qu'une référence alphanumérique « indique la dominante et le numéro de la zone » et donne R Résidentielle, RZ Résidentielle de réserve, M Mixte, P Publique et institutionnelle, AF Agroforestière, F Forestière et ID Îlot déstructuré. La configuration ne s'appuie pas sur les grilles.

Distribution confirmée sur l'API publique après fold : `null:10 agricole:4 residentiel:3`.

| Catégorie | Polygones |
|---|---:|
| residentiel | 3 |
| commercial | 0 |
| industriel | 0 |
| agricole | 4 |
| environnemental | 0 |
| null | 10 |

Nulls explicites : `2ID`, `3ID`, `6ID`, `8ID` (Îlot déstructuré, aucune des cinq catégories); `9RZ`, `15RZ` (Résidentielle de réserve); `11M` (Mixte); `13P`, `14P`, `17P` (Publique et institutionnelle). Le SIG sert les codes digit-first complets, par exemple `1AF`, `10R` et `15RZ`; les 17 codes réellement servis sont donc déclarés tels quels.
