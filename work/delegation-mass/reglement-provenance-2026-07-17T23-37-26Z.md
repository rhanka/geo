# Provenance règlement — shard 0/2 — reprise de service

Date : 2026-07-17T23:37:26Z

Périmètre : slugs dont l’index, dans `served && reglement=false` trié, est pair.

## Constat avant action

Le registre durable contenait déjà une décision pour les 136 slugs du shard :

- 20 entrées avec un `reglement_numero` étayé par une lecture verbatim ;
- 116 entrées `null` avec leur raison verbatim dans `_note`.

Le sélecteur `acquisition/src/_reglement-provenance-targets.ts --shard 0/2 --with-url`
confirme donc `TODO-URL=0` : aucun PDF inédit à lire sans dupliquer une décision
existante. Les 116 nulls restent inchangés, sans stamp ; leurs raisons verbatim sont
la source de vérité dans `acquisition/config/reglement-provenance.json` (champ `_note`).
Exemples directement recontrôlés : `ange-gardien` est une contamination homonyme,
`authier` est un document muet, `coaticook` porte un règlement consolidé sans numéro
(et `6-1` dans l’URL est abrogé), et `clerval` est un règlement de construction, pas
de zonage.

## Villes servies — avant / après

Le fold a été rejoué en deux lots de dix. Il est idempotent (`cellsChanged=0` pour
chaque objet S3) et chaque numéro ci-dessous a ensuite été relu sur
`https://api.geo.sent-tech.ca/collections/qc-zonage-<slug>/items?limit=1`.

| slug | avant (registre) | après collection servie |
|---|---:|---:|
| acton-vale | 069-2003 | 069-2003 |
| bolton-est | 2025-447 | 2025-447 |
| coteau-du-lac | URB 400 | URB 400 |
| franklin | 272 | 272 |
| labrecque | 300-07 | 300-07 |
| lac-sainte-marie | 2024-08-002 | 2024-08-002 |
| mont-laurier | 134 | 134 |
| new-carlisle | 2013-344 | 2013-344 |
| potton | 2001-291 | 2001-291 |
| saint-antonin | 922-26 | 922-26 |
| saint-cuthbert | 352 | 352 |
| saint-eustache | 1288 | 1288 |
| saint-gilles | 363-08 | 363-08 |
| saint-marc-du-lac-long | 2015-02 | 2015-02 |
| saint-prosper-de-champlain | 04-04-2009 | 04-04-2009 |
| saint-rene | 119-06 | 119-06 |
| sainte-angele-de-merici | 2010-06 | 2010-06 |
| schefferville | 2013-120 | 2013-120 |
| sorel-tracy | 2222 | 2222 |
| tres-saint-redempteur | 288-2026 | 288-2026 |

## Villes null

Aucune nouvelle décision `null` n’a été créée dans cette reprise : les 116 décisions
existantes sont conservées telles quelles avec leur raison verbatim dans le registre.
Le fold ignore ces slugs par conception, car aucun `reglement_numero` ne doit être
inventé.
