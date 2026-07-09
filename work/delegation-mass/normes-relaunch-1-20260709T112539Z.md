# NORMES relance 1 - 20260709T112539Z

## Resultat

- Shard: 80 slugs.
- Etat initial: `hatley` deja depose; 79 libres.
- SIG exploitable: 47 candidats `gridFound && !normesDone && sigZoneCodes > 0`.
- PDFs locaux: 21, dont 20 non deja deposes.
- Depot realise: `champlain` en parquet-only, sans manifest partage.

## Depot

`champlain`

- Source: `https://www.municipalite.champlain.qc.ca/file-18340`.
- PDF local: `work/zonage-norms/champlain/grille.pdf`.
- Fenetre retenue: pages 135..198.
- Methode: `native-text/zoneheader`.
- Resultat S3: `registry/qc-zonage-norms/qc-zonage-norms-champlain.parquet`.
- Lignes: 62.
- Codes uniques: 62.
- `publishedFieldPct`: 56.5.
- Crossval SIG: 65 codes SIG, overlap 60, recoup extracted 97%, recoup SIG 92%.
- Cout vision/OCR du depot: 0.

Le premier essai OCR/autogrid sur `champlain` a borne 1..20, facture 20 pages OCR (~$0.0200), puis rejete correctement avec `0 zones extracted`.

## Correctif

Petit correctif dans `packages/qc-sources/src/sources/grille-zoneheader-locator.ts`: accepter le header explicite `ZONE : 101` comme code numerique verbatim.

Ce correctif ne fabrique pas le prefixe SIG. Les codes extraits restent `101`, `102`, etc.; la validation passe uniquement parce que le pont numerique SIG existant confirme des numeros uniques (`101` <-> `R-101`, etc.).

Test ajoute dans `packages/qc-sources/src/sources/grille-zoneheader-locator.test.ts`.

## Discovery

- `discovery-a`: demande sur 8 premiers slugs sans PDF; seul `baie-des-sables` etait dans le registre crawler; 0 PDF confirme.
- `discovery-b`: `frontenac`, `lislet`, `lorrainville`; 0 PDF confirme.
- Fichiers: `work/delegation-mass/normes-relaunch-1-20260709T112539Z.discovery-a.json`, `work/delegation-mass/normes-relaunch-1-20260709T112539Z.discovery-b.json`.

## Dry-runs sans depot

Route `zoneheader`, budget 0, sans manifest, resultat `0 zones extracted`:

- `bearn`
- `bristol`
- `east-broughton`
- `ivry-sur-le-lac`
- `la-macaza`

## Verification

- `npx vitest run src/sources/grille-zoneheader-locator.test.ts` dans `packages/qc-sources`: 19 tests passes.
- `norms-status-check champlain`: `DEPOSITED sig=yes champlain`.
- `npm run typecheck` dans `packages/qc-sources` echoue sur des erreurs nullability preexistantes dans des fichiers de test non lies au correctif (`grille-spanheader-parser.test.ts`, `grille-vision-zoneheader.test.ts`, `grille-zoneheader-parser.test.ts`).

## Notes

- `NORMS_NO_MANIFEST=1` utilise pour les extractions; aucun manifest partage n'a ete ecrit.
- Pas de secret modifie ni imprime.
- Pas de modification manuelle de `.claude` ou `.track`.
