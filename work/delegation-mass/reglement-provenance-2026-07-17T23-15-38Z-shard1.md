# P0_1 — provenance règlement — shard 1/2 — 2026-07-17T23:15:38Z

## Verdict

Le registre curé contenait déjà une entrée pour les **157** slugs impairs de
`zonage-enrichment.json` avec `reglement=false` : 32 numéros et 125 nulls
motivés. Aucune donnée ne permettait une écriture sûre dans
`acquisition/config/reglement-provenance.json` durant cette passe.

Deux lots de 10 slugs (tous d'indice impair dans la liste triée) ont été
contrôlés. Le fold ne déduit aucune valeur : il a confirmé les 10 numéros déjà
servis et a ignoré les 10 nulls.

## Villes servies — avant = après

`fold-reglement-to-zonage.ts --dry-run`, puis le fold réel, ont produit
`ok=10/10` et `cellsChanged=0` pour les **864 polygones** ci-dessous. Les quatre
champs étaient donc déjà présents dans les GeoJSON servis. La vérification HTTP
publique demandée (`curl ... | jq -r ...reglement_numero`) a renvoyé, dans le
même ordre, les valeurs de la colonne « après ».

| slug | polygones | numéro avant | numéro après / HTTP |
|---|---:|---|---|
| coteau-du-lac | 28 | URB 400 | URB 400 |
| franklin | 82 | 272 | 272 |
| labrecque | 37 | 300-07 | 300-07 |
| lac-sainte-marie | 86 | 2024-08-002 | 2024-08-002 |
| potton | 113 | 2001-291 | 2001-291 |
| saint-adrien | 56 | 248-2003 | 248-2003 |
| saint-alphonse | 43 | 274-2013 | 274-2013 |
| saint-cuthbert | 35 | 352 | 352 |
| saint-donat--la-mitis | 63 | 318 | 318 |
| saint-eustache | 321 | 1288 | 1288 |

## Villes null — aucun stamp

Le fold réel a répondu `SKIP` pour chacune des 10 villes suivantes, car ni le
registre ni la grille normes ne portent `reglement_numero`. Les raisons ci-dessous
sont les extraits verbatim déjà conservés dans le registre ; elles sont maintenues,
pas réinterprétées.

| slug | raison verbatim conservée |
|---|---|
| amos | « GRILLE DE SPECIFICATIONS / ZONE A-1 » ; « Aucun numero de reglement, ni en entete, ni en pied, ni en note ». |
| armagh | « aucun PDF local » et « aucune URL ouvrable » ; « Rien n'a ete LU => aucun stamp. » |
| authier-nord | « MUNICIPALITÉ D’AUTHIER » ; le document ne se déclare jamais Authier-Nord. |
| baie-durfe | « Annexe 2 du Règlement de zonage / Baie-D'Urfé », « sans numero du reglement parent » ; `1110` du fichier est écarté. |
| baie-trinite | `source_url` vaut littéralement « non-disponible » ; « Aucun document a lire ». |
| bristol | « Zoning By-law - Number 312A.1 » mais aussi « Zoning By-law number 264 » ; conflit non tranché. |
| candiac | `source_url` vaut littéralement « non-disponible » ; « Aucun document a lire ». |
| champneuf | « aucun PDF local » et « aucune grille de normes servie » ; « Rien n'a ete LU => aucun stamp. » |
| cheneville | « 0 occurrence de « reglement » » ; « aucun numero verbatim disponible dans le document servi ». |
| clerval | « RÈGLEMENT DE CONSTRUCTION / NUMÉRO 84 » ; `84` est écarté car ce n'est pas le règlement de zonage. |

## Intendance

- Le fold réel des numéros a été idempotent (`cellsChanged=0`) ; le lot null a
  été intégralement ignoré (`ok=0/10`, `skipped=10`).
- Aucun numéro, millésime, URL ou page n'a été déduit d'un nom de fichier ou
  d'une URL.
- Pas de commit de provenance : le registre était inchangé. Ce rapport est le
  seul artefact local de cette passe.
