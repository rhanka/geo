# Normes Mistral — shard 0/4 — 2026-07-12

## Périmètre et supervision

- Sélection canonique : `npx tsx acquisition/src/normes-shard-select.ts --n 4 --shard 0`; uniquement les slugs dont l’index trié modulo 4 vaut 0.
- Lots successifs supervisés par `npx tsx acquisition/src/loop-supervise.ts`.
- Spécification lue : `docs/spec/normes-extraction-retenu.md`.
- Extraction payante uniquement Mistral (`mistral-ocr-4-0` et `mistral-schema` / `document_annotation`), parquet-only; aucun flux GPT/codex.
- Aucun secret, `.claude` ou `.track` modifié.

## Dépôts validés

| slug | moteur / fenêtre | coût rapporté | codes | overlap SIG | publishedFieldPct | résultat |
|---|---|---:|---:|---:|---:|---|
| `lascension-de-patapedia` | `mistral-schema`, p.1–160 | $0.480 | 26 | 2 | 77.4 % | parquet déposé |
| `saint-antoine-de-tilly` | `mistral-schema`, p.85–92 | $0.024 | 64 | 63 | 57.6 % | parquet déposé |
| `sainte-perpetue--nicolet-yamaska` | `mistral-schema`, p.125–141 | $0.003 | 24 | 23 | 2.6 % | parquet déposé; 2 chunks rejetés `maxBuffer`, cellules non lues nulles |

Les trois parquets ont été réconciliés avec `zonage-norms-manifest-merge.ts --apply`. La fusion signale à chaque passage un ancien objet S3 interprété comme slug `registry`; les dépôts ciblés sont néanmoins ajoutés. Jointure et enrichissement exécutés pour les trois villes :

- L’Ascension : 346 lots, zone affectée 100 %, match normes 0 %.
- Saint-Antoine-de-Tilly : 1 620 lots, zone affectée 99,88 %, match normes 59,09 %.
- Sainte-Perpétue : 785 lots, zone affectée 99,87 %, match normes 95,92 %.

## Gates rejetés / preuves

- `clermont--abitibi-ouest`, schema p.1–97, $0.291 : 97 codes, published 39.9 %, overlap 0 → rejet anti-invention.
- `ivry-sur-le-lac`, schema p.117, $0.003 : 0 code → rejet `<3`.
- `les-iles-de-la-madeleine`, schema p.1–144, $0.432 : 30 codes, published 11.3 %, overlap 0 → rejet.
- `ragueneau`, schema p.377–402, $0.078 : 0 code → rejet `<3`.
- `notre-dame-du-bon-conseil--drummond--2`, schema p.27–33, $0.021 : 7 codes, published 75 %, overlap 0 → rejet.
- `east-broughton`, OCR p.1–16, $0.016 : 0 zone → rejet.
- `gatineau`, OCR p.1–2, 1 code, overlap 1 → rejet `<3`.
- `saint-jean-de-la-lande`, OCR p.133–135, $0.003 : 0 zone → rejet.
- `riviere-bleue`, OCR p.1, $0.001 : 0 zone → rejet.
- `normandin`, schema lancé sur p.1–301 puis interrompu à la borne opérationnelle de 6 minutes; aucun dépôt.

## Découverte et anti-invention

- PDF officiel candidat pour `baie-des-sables` trouvé par recherche Web, mais fetch échoué; aucun appel Mistral/dépôt.
- Crawlers bornés : `la-reine`, `padoue`, `warden` sans muni registry exploitable; lot manquant autour de `saint-patrice-de-beaurivage` sans PDF confirmé.
- Documents explicitement écartés après inspection : cartes (`abercorn`, `lac-des-plages`), amendements (`albanel`, `auclair`, `sainte-lucie`), règlements non-zonage (`frontenac-*`, `new-richmond`, `sacre-coeur-de-jesus`, `saint-prosper`, `sainte-rose-de-watford`), avis/annexes sans codes lisibles et règlements sans annexe grille exploitable.
- `sainte-perpetue` a satisfait les gates malgré le faible taux de champs; les valeurs non lues restent nulles, sans interpolation.

## État final

Le shard 0/4 est épuisé selon le sélecteur au dernier passage : 60 cibles productibles restantes dans la matrice ont été couvertes par découverte, inspection, dépôt ou preuve de gate; les nouveaux dépôts sont les trois slugs listés ci-dessus.
