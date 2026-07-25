# Provenance règlement — shard 1/2 — lot no-grille 1

Périmètre déterministe : index impair de la liste triée `perMuni` où
`reglement=false`. Ce lot couvre les 12 premières cibles `NO-GRILLE` encore non
curées dans ce shard.

## Avant / après

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Entrées du registre | 706 | 718 |
| Entrées avec numéro | 423 | 423 |
| Entrées null motivées | 283 | 295 |
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
| grand-saint-esprit | `Croisement de qc-zonage-norms-grand-saint-esprit: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/grand-saint-esprit/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| hope | `Croisement de qc-zonage-norms-hope: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/hope/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| huntingdon | `Croisement de qc-zonage-norms-huntingdon: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/huntingdon/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| la-redemption | `Croisement de qc-zonage-norms-la-redemption: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/la-redemption/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| lile-du-grand-calumet | `Croisement de qc-zonage-norms-lile-du-grand-calumet: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/lile-du-grand-calumet/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-elphege | `Croisement de qc-zonage-norms-saint-elphege: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-elphege/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-epiphane | `Croisement de qc-zonage-norms-saint-epiphane: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-epiphane/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-fortunat | `Croisement de qc-zonage-norms-saint-fortunat: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-fortunat/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-francois-de-la-riviere-du-sud | `Croisement de qc-zonage-norms-saint-francois-de-la-riviere-du-sud: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-francois-de-la-riviere-du-sud/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-gabriel | `Croisement de qc-zonage-norms-saint-gabriel: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-gabriel/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-jacques-le-majeur-de-wolfestown | `Croisement de qc-zonage-norms-saint-jacques-le-majeur-de-wolfestown: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-jacques-le-majeur-de-wolfestown/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
| saint-jean-de-lile-dorleans | `Croisement de qc-zonage-norms-saint-jean-de-lile-dorleans: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-jean-de-lile-dorleans/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.` |
