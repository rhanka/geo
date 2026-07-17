# Usage dominant — shard 1/2 — 2026-07-17T19:34:00Z

Slugs traités (index trié impair) : `lac-au-saumon`, `lac-saint-joseph`, `perce`, `saint-ulric`, `saint-bruno-de-guigues`.

| Ville | Distribution servie | Préfixes `null` et raison |
| --- | --- | --- |
| Lac-au-Saumon | `residentiel:47 commercial:14 industriel:6 agricole:39 environnemental:20 null:12` | `P` : « publique ». |
| Lac-Saint-Joseph | S3 après fold : `residentiel:22 agricole:5 environnemental:6 null:3` | `P` : « Publique et institutionnelle »; `M` : « Militaire ». L’API publique retournait encore `null:36` lors des deux lectures; l’objet S3 servi contient bien la distribution ci-dessus (propagation à surveiller hors de cette passe). |
| Percé | `residentiel:46 commercial:20 industriel:7 agricole:36 environnemental:34 null:55` | `M` : « Mixte »; `P` : « Publique et institutionnelle »; `HX` : présent au SIG mais absent de la table réglementaire. |
| Saint-Ulric | `residentiel:13 commercial:8 industriel:1 agricole:32 environnemental:1 null:2` | `P` : « Communautaire »; `ZAD` : présent au SIG mais absent de la table de dominance. |
| Saint-Bruno-de-Guigues | `residentiel:8 commercial:6 agricole:11 null:5` | `INST` : « zonage institutionnel et public ». |

Sources réglementaires lues : article 4.1 de Lac-au-Saumon, article 19 de Lac-Saint-Joseph, article 16 de Percé, section 5.3 de Saint-Ulric et article 5.2 de Saint-Bruno-de-Guigues. Les cinq cartes s’appuient sur ces légendes/nomenclatures, jamais sur les matrices d’usages permis.

Correctif de service : les SIG écrivent parfois les mêmes codes en forme numéro-lettres (`64 P`, `004-Rec`). Le fold compare désormais la forme brute et la forme canonique lettre-numéro, avec une régression Vitest dédiée; les anciennes cartes explicites restent compatibles.
