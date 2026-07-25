# Provenance règlement — shard 0/2 — réconciliation 2026-07-17

Sélection : `served && reglement=false` dans `work/coverage/zonage-enrichment.json`, triée, avec `index % 2 == 0`.

Le registre curé contenait déjà les 136 cibles de ce shard. Vingt ont un numéro non-null, lu verbatim dans le document consigné dans `acquisition/config/reglement-provenance.json`; les 116 autres ont les quatre champs à `null` et une `_note` verbatim. Aucun numéro n'a été déduit de l'URL ni du nom de fichier.

## Villes servies

Le pliage a été relancé en deux lots de dix. Pour chaque collection, le résultat était `cellsChanged=0`, donc la valeur servie était déjà présente avant le passage et reste identique après. La valeur après a été relue dans `qc-zonage-<slug>`.

| Slug | Numéro (registre) | Millésime | Page source | Avant | Après |
| --- | --- | --- | --- | --- | --- |
| acton-vale | `069-2003` | `null` | 1 | `069-2003` | `069-2003` |
| bolton-est | `2025-447` | `2025` | 1 | `2025-447` | `2025-447` |
| coteau-du-lac | `URB 400` | `null` | 1 | `URB 400` | `URB 400` |
| franklin | `272` | `null` | 1 | `272` | `272` |
| labrecque | `300-07` | `null` | 2 | `300-07` | `300-07` |
| lac-sainte-marie | `2024-08-002` | `null` | 1 | `2024-08-002` | `2024-08-002` |
| mont-laurier | `134` | `2007` | 1 | `134` | `134` |
| new-carlisle | `2013-344` | `2013` | 1 | `2013-344` | `2013-344` |
| potton | `2001-291` | `2001` | 1 | `2001-291` | `2001-291` |
| saint-antonin | `922-26` | `null` | 2 | `922-26` | `922-26` |
| saint-cuthbert | `352` | `2024` | 1 | `352` | `352` |
| saint-eustache | `1288` | `1988` | 1 | `1288` | `1288` |
| saint-gilles | `363-08` | `2008` | 1 | `363-08` | `363-08` |
| saint-marc-du-lac-long | `2015-02` | `null` | 1 | `2015-02` | `2015-02` |
| saint-prosper-de-champlain | `04-04-2009` | `null` | 1 | `04-04-2009` | `04-04-2009` |
| saint-rene | `119-06` | `2006` | 1 | `119-06` | `119-06` |
| sainte-angele-de-merici | `2010-06` | `null` | 1 | `2010-06` | `2010-06` |
| schefferville | `2013-120` | `null` | 2 | `2013-120` | `2013-120` |
| sorel-tracy | `2222` | `2013` | 1 | `2222` | `2222` |
| tres-saint-redempteur | `288-2026` | `null` | 2 | `288-2026` | `288-2026` |

Les PDFs servis et accessibles ont été relus. Plusieurs sont des annexes/grilles et ne portent pas le numéro; la preuve du numéro reste donc le corps ou l'amendement explicitement cité dans la `_note` du registre. Les URLs de lac-sainte-marie, mont-laurier, saint-marc-du-lac-long, saint-rene, sainte-angele-de-merici et schefferville répondaient 404 côté collection de normes; aucune valeur n'a été inventée pour les remplacer.

## Villes null

Aucune nouvelle décision `null` n'a été écrite dans cette réconciliation. Les 116 autres slugs pairs sont déjà `null` dans le registre, chacun avec sa raison verbatim dans `_note`; le gate du pliage les exclut et aucun champ de polygone n'est stampé.

## Mutation du registre

Aucune : les vingt entrées numérotées existaient déjà et les 116 verdicts `null` restent inchangés. Cet addendum documente la relecture et la vérification de la collection servie.
