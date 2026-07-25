# Provenance règlement — shard 1/2 — lot no-grille 2

Périmètre déterministe : index impair de la liste triée `perMuni` où
`reglement=false`. Ce lot couvre les 12 cibles `NO-GRILLE` suivantes encore non
curées dans ce shard.

## Avant / après

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Entrées du registre | 726 | 738 |
| Entrées avec numéro | 427 | 427 |
| Entrées null motivées | 299 | 311 |
| Villes stampées sur `qc-zonage-*` | 0 | 0 |

Le corpus local a été sondé pour les 12 slugs : `avec PDF local=0`. Chaque
collection `qc-zonage-norms-*` a retourné HTTP 404, donc aucune grille,
`_source_url` ou `reglement_url` servie n'était disponible. Le fold a donc
produit `SKIP` pour les 12 slugs et les vérifications de
`qc-zonage-*/items?limit=1` retournent toutes `null` pour
`reglement_numero`.

## Villes null — raison verbatim

| Slug | Raison enregistrée |
| --- | --- |
| saint-lambert--abitibi-ouest | `Croisement de qc-zonage-norms-saint-lambert--abitibi-ouest: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-lambert--abitibi-ouest/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-leonard-daston | `Croisement de qc-zonage-norms-saint-leonard-daston: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-leonard-daston/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-louis-de-gonzague--les-etchemins | `Croisement de qc-zonage-norms-saint-louis-de-gonzague--les-etchemins: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-louis-de-gonzague--les-etchemins/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-luc-de-bellechasse | `Croisement de qc-zonage-norms-saint-luc-de-bellechasse: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-luc-de-bellechasse/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-marc-du-lac-long | `Croisement de qc-zonage-norms-saint-marc-du-lac-long: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-marc-du-lac-long/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-michel-de-bellechasse | `Croisement de qc-zonage-norms-saint-michel-de-bellechasse: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-michel-de-bellechasse/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-patrice-de-beaurivage | `Croisement de qc-zonage-norms-saint-patrice-de-beaurivage: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-patrice-de-beaurivage/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-philippe-de-neri | `Croisement de qc-zonage-norms-saint-philippe-de-neri: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-philippe-de-neri/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-pie-de-guire | `Croisement de qc-zonage-norms-saint-pie-de-guire: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-pie-de-guire/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-wenceslas | `Croisement de qc-zonage-norms-saint-wenceslas: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-wenceslas/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sainte-agathe-de-lotbiniere | `Croisement de qc-zonage-norms-sainte-agathe-de-lotbiniere: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-agathe-de-lotbiniere/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sainte-francoise--les-basques | `Croisement de qc-zonage-norms-sainte-francoise--les-basques: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-francoise--les-basques/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
