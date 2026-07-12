# Normes via Mistral — shard 1/4 — 2026-07-11

## Périmètre et méthode

- Sélection déterministe depuis `work/coverage/coverage-matrix.json`: slugs triés, `index % 4 == 1`, `zones.status == done`, `normes.status != done`.
- 77 candidates au départ; les lots ont été parcourus jusqu’au résiduel `yamaska`. Après le dépôt, le recalcul courant laisse 76 candidates productibles (Saint-Rémi est sorti de la liste).
- `loop-supervise.ts` exécuté au démarrage, entre chaque lot et en fin de passe. Sa supervision a dû utiliser `TMPDIR` dans le workspace, car le pipe IPC `/tmp/tsx-1000` était refusé par la sandbox.
- Extraction uniquement Mistral: `mistral-ocr-4-0` et `document_annotation` (`mistral-schema`). Aucun GPT-5.5, Codex ou autre moteur GPT utilisé.
- Tous les essais payants sont restés sous 1 USD par municipalité et sous six minutes par slug. Dépôts parquet-only; aucun secret, `.claude` ou `.track` touché.

## Dépôt net

| Slug | Route/fenêtre | Résultat des gates |
|---|---|---|
| `saint-remi-de-tingwick` | Mistral OCR p.1–18 puis schema p.1–18 | **DÉPOSÉ**: 32 zone_codes, 53,5 % de champs publiés, overlap 1/26; parquet `registry/qc-zonage-norms/qc-zonage-norms-saint-remi-de-tingwick.parquet` |

Le schema a conservé les cellules verbatim-or-null. Le merge `zonage-norms-manifest-merge.ts --apply` a ajouté Saint-Rémi au manifeste. La seule erreur de merge est la clé S3 globale `registry` absente, déjà connue et sans impact sur le slug déposé.

Aval exécuté:

- `lot-zone-join-run.ts --slugs saint-remi-de-tingwick`: 366 lots, affectation 100 %, vérification parquet Y; match normes 3,28 %.
- `lots-enriched-run.ts --slugs saint-remi-de-tingwick`: dépôt Y, 366 lots, surface/adresse/code postal 100 %; normes 3,28 %. Le faible match est attendu avec overlap 1/26 et n’a pas été masqué.

## Rejets Mistral et preuves

- Lot 1: `denholm` 3 codes, overlap 1/15, champs 0 %; `dosquet` 2 codes, overlap 0/34; `dupuy` 3 pseudo-codes, overlap 0/41; `fugereville` 0 zone. Les autres slugs du lot (`authier-nord`, `berry`, `biencourt`, `champneuf`, `chazel`, `courcelles-saint-evariste`, `esprit-saint`, `fort-coulonge`, `grand-saint-esprit`, `la-visitation-de-yamaska`, `lac-delage`) n’ont produit aucun PDF confirmé.
- Lot 2: `lassomption` overlap 0/359; `laverlochere-angliers` 19 codes, 9 overlaps mais champs 0 %; `lery` 0 zone; `mont-carmel` 0 zone; `namur` 27 codes/58,3 % mais overlap 0/4; `notre-dame-des-prairies` 0 zone; `perce` 14 codes/8 overlaps mais champs 0 %. `macamic` était un 404 HTML, pas un PDF.
- Lot 3: `pont-rouge` pseudo-codes/overlap 0/77; `princeville` 15 codes/overlap 0/116; `saint-cyrille-de-lessard` 0 zone; `saint-edouard-de-fabre` 7 codes/5 overlaps mais champs 0 %; `saint-elzear-de-temiscouata` 0 zone. Saint-Benjamin était un ordre du jour, Saint-Didace un plan-annexe et Saint-Alphonse un homonyme; aucun n’a été envoyé au dépôt.
- Lot 4: `saint-joseph-de-coleraine` 31 codes/36,7 % mais overlap 0/103; `saint-joseph-des-erables` 124 faux codes/overlap 0/5; `saint-lazare` 0 zone. Les 12 autres slugs n’ont donné aucun PDF via le crawler.
- Lot 5: `sainte-anne-de-beaupre` 143 codes mais champs 0 % et SIG=0; `trois-rivieres` 3 codes I/J/R, 62,5 % mais overlap 0/1664. Sainte-Aurélie était un PV et Sainte-Flavie un HTML non-PDF. Les dix autres slugs n’ont produit aucun PDF confirmé.
- Résiduel: `yamaska`, crawler 2-hop: 22 pages, 0 PDF grille confirmé.

## Découverte

Les manifests de découverte dédiés à cette passe sont sous `work/zonage-norms/discovered-shard-1of4-codex-20260711*.json`. Les cibles absentes de `ALL_PV_CITIES` n’ont pas été traitées comme « zéro grille » sans preuve: les portails registry/MRC et le crawler 2-hop ont été sondés par lots; aucun lien PDF HTTP 200 classifié grille n’a été confirmé pour les résidus.

## Coût et état final

Coût Mistral observé de cette passe: environ **1,275 USD** au total; aucune ville n’a dépassé **1 USD**. Un seul dépôt net a franchi tous les gates. Aucun commit/push n’est effectué ici: l’arbre contient déjà de nombreuses modifications et fichiers appartenant à d’autres activités; seuls les artefacts de cette passe et ce rapport doivent être sélectionnés explicitement par le propriétaire.
