# EVOL — écart documents de densité et objets servis

## Contexte

Le corpus fermé contient 35 documents revus. Les rapports d'ingest en marquent
25 `publishable`, mais seules 18 sources distinctes alimentent directement les
normes servies. Les 7 autres sont des versions antérieures de Champlain ou
Chesterville: leurs 223 lectures raccordées au SIG, ainsi que leurs lectures
hors SIG, sont identiques aux références municipales plus récentes.

L'écart nominatif et la mesure S3 sont figés dans
`work/coverage/density-document-served-gap-20260728.{json,md}`.
Ils se régénèrent depuis `acquisition/` avec:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  node --import tsx src/density-document-served-gap-report.ts
```

Le lot de contrôle se rejoue séparément, sans possibilité de dépôt:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  node --import tsx src/density-document-norm-ingest.ts \
  --slug champlain \
  --review-corroboration-ids champlain-file-18292,champlain-wayback-original-2009,champlain-wayback-modification-2014 \
  --output ../work/coverage/density-document-control-lot-3-20260728.json
```

Sa mesure S3 doit être figée avant le lot restant. Ce mode ne lit aucun rapport
de classification finale et sort aussitôt après avoir validé 10 collections et
522 polygones:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  node --import tsx src/density-document-served-gap-report.ts \
  --write-control-snapshot ../work/coverage/density-document-control-lot-3-served-20260728.json
```

Les quatre documents restants se rejouent ensuite par collection:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  node --import tsx src/density-document-norm-ingest.ts \
  --slug champlain \
  --output ../work/coverage/density-document-final-classification-champlain-20260728.json

NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  node --import tsx src/density-document-norm-ingest.ts \
  --slug chesterville \
  --output ../work/coverage/density-document-final-classification-chesterville-20260728.json
```

## Décisions

- **D1 — Référence directe.** Un document est directement reflété seulement si
  sa `densite_source_url` porte une densité finie et une unité dans la grille de
  normes servie, et que cette ligne rejoint un polygone servi portant exactement
  la même valeur et la même unité.
- **D2 — Versions antérieures.** Une grille datée mais antérieure, sans valeur
  unique ni divergente, est `corroboration-only`. Elle ne remplace jamais la
  source plus récente et ne participe pas aux patches de référence. La relation
  nomme son profil de référence; le run refuse une date non antérieure, un autre
  propriétaire, une valeur unique ou une divergence.
- **D3 — Gain réel.** Un gain compte des polygones servis passant d'une densité
  non finie à une densité finie sourcée. `undefined` face à `null` est un no-op;
  `cellsChanged=0` ne suffit jamais comme mesure.
- **D4 — Exécution.** Le reclassement se fait d'abord sur 3 documents de
  contrôle, puis sur les 4 restants seulement si les dispositions, les sources
  sélectionnées et les 522 polygones servis restent exacts. Le rapport conserve
  un snapshot S3 distinct après le contrôle, puis re-mesure S3 après le lot
  restant. Il conserve les SHA des rapports d'entrée et les ETag, dates et SHA
  des objets S3 lus; un changement d'ETag pendant une lecture fait échouer le
  run.

## Revue adversariale

Deux revues indépendantes (exactitude de jointure; légalité/provenance) ont
convergé: aucun des 7 documents ne doit être plié comme nouvel état. Elles ont
également identifié le risque futur actuel: tant qu'un document antérieur reste
dans `allPatches`, une divergence historique peut supprimer une norme courante
comme conflit. Le reclassement ferme ce risque sans modifier la densité servie.
