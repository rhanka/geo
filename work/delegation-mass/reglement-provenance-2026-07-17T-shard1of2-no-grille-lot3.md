# Provenance règlement — shard 1/2 — lot no-grille 3

Périmètre déterministe : index impair de la liste triée `perMuni` où
`reglement=false`. Ce lot épuise les 8 dernières cibles `NO-GRILLE` non curées du
shard.

## Avant / après

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Entrées du registre | 738 | 746 |
| Entrées avec numéro | 427 | 427 |
| Entrées null motivées | 311 | 319 |
| Villes stampées sur `qc-zonage-*` | 0 | 0 |

Le corpus local a été sondé pour les 8 slugs : `avec PDF local=0`. Chaque
collection `qc-zonage-norms-*` a retourné HTTP 404, donc aucune grille,
`_source_url` ou `reglement_url` servie n'était disponible. Le fold a donc
produit `SKIP` pour les 8 slugs et les vérifications de
`qc-zonage-*/items?limit=1` retournent toutes `null` pour
`reglement_numero`.

## Villes null — raison verbatim

| Slug | Raison enregistrée |
| --- | --- |
| sainte-helene-de-mancebourg | `Croisement de qc-zonage-norms-sainte-helene-de-mancebourg: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-helene-de-mancebourg/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sainte-justine | `Croisement de qc-zonage-norms-sainte-justine: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-justine/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sainte-madeleine | `Croisement de qc-zonage-norms-sainte-madeleine: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-madeleine/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sainte-marie-de-blandford | `Croisement de qc-zonage-norms-sainte-marie-de-blandford: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-marie-de-blandford/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| sherbrooke | `Croisement de qc-zonage-norms-sherbrooke: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sherbrooke/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| val-saint-gilles | `Croisement de qc-zonage-norms-val-saint-gilles: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/val-saint-gilles/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| warden | `Croisement de qc-zonage-norms-warden: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/warden/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| yamaska | `Croisement de qc-zonage-norms-yamaska: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/yamaska/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
