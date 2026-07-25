# NORMES via Mistral — shard 0/4

Date: 2026-07-11T17:00:36Z  
Branche: `feat/cadre-acquisition`  
Sélection: villes triées de `coverage-matrix.json`, `zones.status == done`, `normes.status != done`, indice `% 4 == 0`.

## Résultat

- Cibles éligibles du shard: 73.
- PDF locaux réutilisables recensés: 41/73.
- Dépôts parquet-only nets: 1 (`matapedia`).
- Moteurs utilisés: `mistral-ocr-4-0` et `mistral-schema` (`document_annotation`) uniquement.
- GPT/codex: jamais utilisé pour l'extraction.
- Coût Mistral observé total: environ 0,922 USD; aucune ville n'a dépassé 1 USD.

## Dépôt accepté

| slug | moteur | zones | overlap SIG | champs publiés | coût | objet |
|---|---:|---:|---:|---:|---:|---|
| `matapedia` | `ocr/mistral-schema` | 35 | 23/43 | 62,5 % | 0,039 USD pour la passe schema; 0,052 USD avec la passe OCR rejetée | `registry/qc-zonage-norms/qc-zonage-norms-matapedia.parquet` |

Gates passés: au moins trois codes verbatim, overlap SIG non nul, `publishedFieldPct` non nul, valeurs verbatim-ou-null. La première passe OCR markdown a été rejetée (`overlap=0`, libellés lus comme codes); la passe `document_annotation` a corrigé le routage sans assouplir les gates.

## Preuves d'échec / rejets

| slug | route(s) | preuve | coût |
|---|---|---|---:|
| `albanel` | OCR-4.0, 4 pages | 0 zone extraite; aucun dépôt | 0,004 USD |
| `saint-cyprien-de-napierville` | OCR-4.0, fenêtre auto 37–41 | 0 zone extraite; la fenêtre était du corps réglementaire et non une annexe-grille | 0,005 USD |
| `saint-damase--les-maskoutains` | OCR-4.0 puis schema, 10 pages | schema: 29 zones et 62,5 % de champs, mais `overlap=0/44`; gate anti-invention respecté, aucun dépôt | 0,040 USD |
| `saint-eugene-de-ladriere` | OCR-4.0 pages 1–80 puis schema document complet 247 pages | 0 zone aux deux passes; gate `<3` respecté, aucun dépôt | 0,821 USD |
| `barnston-ouest` | preuves locales antérieures OCR/vision/multizone | grille locale basse résolution: 0 zone; règlement auto-grid sur mauvaise table, overlap 0 | non relancé |
| `east-broughton` | preuve locale antérieure | document 16 pages sans code de zone; annexe séparée non localisée | non relancé |

## Lot 1 évalué (15 slugs)

`abercorn`, `albanel`, `auclair`, `baie-des-sables`, `barnston-ouest`, `beaumont`, `bedford--brome-missisquoi--2`, `caplan`, `chute-aux-outardes`, `clermont--abitibi-ouest`, `cloridorme`, `east-broughton`, `escuminac`, `frontenac`, `gatineau`.

Constats locaux complémentaires:

- `auclair`: PDF de 5 pages, un seul code candidat (`P-41`), sous le gate de trois codes.
- `gatineau`: PDF de 3 pages, un seul code candidat (`CO-04`), sous le gate.
- `bedford--brome-missisquoi--2`: règlement de 131 pages, aucune page avec au moins trois codes lisibles dans la couche texte; annexe non localisée.
- `chute-aux-outardes`: règlement de 417 pages, aucune page avec au moins trois codes lisibles dans la couche texte; source officielle locale disponible pour une future passe schema.
- `abercorn` est un plan PDF, pas une grille de spécifications confirmée.
- `baie-des-sables`, `beaumont`, `caplan`, `clermont--abitibi-ouest`, `cloridorme`, `escuminac`, `frontenac`: aucun PDF local confirmé.

## Reliquat du shard

Les 73 slugs, dans l'ordre trié qui définit le shard:

`abercorn`, `albanel`, `auclair`, `baie-des-sables`, `barnston-ouest`, `beaumont`, `bedford--brome-missisquoi--2`, `caplan`, `chute-aux-outardes`, `clermont--abitibi-ouest`, `cloridorme`, `east-broughton`, `escuminac`, `frontenac`, `gatineau`, `grosse-ile`, `hope`, `ivry-sur-le-lac`, `la-pocatiere`, `la-reine`, `la-visitation-de-lile-dupas`, `lac-des-plages`, `lascension-de-patapedia`, `lepiphanie`, `les-iles-de-la-madeleine`, `lile-danticosti`, `lislet`, `matapedia`, `new-richmond`, `normandin`, `notre-dame-des-pins`, `notre-dame-du-bon-conseil--drummond--2`, `padoue`, `port-daniel-gascons`, `price`, `ragueneau`, `remigny`, `riviere-bleue`, `roquemaure`, `sacre-coeur-de-jesus`, `saint-alfred`, `saint-antoine-de-tilly`, `saint-bonaventure`, `saint-camille-de-lellis`, `saint-cyprien-de-napierville`, `saint-damase--les-maskoutains`, `saint-donat--la-mitis`, `saint-epiphane`, `saint-eugene-de-ladriere`, `saint-hilaire-de-dorset`, `saint-jacques-de-leeds`, `saint-jean-de-la-lande`, `saint-joseph-de-sorel`, `saint-jules`, `saint-leon-de-standon`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-majorique-de-grantham`, `saint-marcel-de-richelieu`, `saint-octave-de-metis`, `saint-patrice-de-beaurivage`, `saint-philemon`, `saint-pie`, `saint-pierre-de-broughton`, `saint-prosper`, `sainte-agathe-de-lotbiniere`, `sainte-apolline-de-patton`, `sainte-francoise--les-basques`, `sainte-gertrude-manneville`, `sainte-justine`, `sainte-lucie-de-beauregard`, `sainte-perpetue--nicolet-yamaska`, `sainte-rose-de-watford`, `warden`.

Après le dépôt de `matapedia`, il reste 72 cibles dans l'état de matrice courant tant que le manifeste n'est pas fusionné. Parmi les sources locales, les prochaines candidates les mieux étayées sont `lepiphanie` (grille dédiée et URL officielle connue), `chute-aux-outardes`, `notre-dame-des-pins`, `riviere-bleue` et `saint-pierre-de-broughton`.

## Blocage opérationnel

À 2026-07-11T16:59Z, l'autorisation externe requise pour le prochain appel Mistral/S3 a été refusée par le contrôleur avec une limite d'usage jusqu'à 17:08. Aucun contournement n'a été tenté. Par conséquent, les opérations réseau finales restent à faire:

1. `zonage-norms-manifest-merge.ts --apply` pour rendre le dépôt Matapédia visible dans la matrice;
2. `lot-zone-join-run.ts --slugs matapedia`;
3. `lots-enriched-run.ts --slugs matapedia`;
4. reprise des lots suivants du shard;
5. push du commit ciblé si l'accès réseau est disponible.

Le dépôt partagé était déjà fortement sale au départ. Aucun secret, fichier `.claude` ou `.track` n'a été modifié par cette lane.
