# Provenance règlement — shard 0/2 — 2026-07-18T09:13:49Z

Périmètre strict : les slugs d’indice pair dans la liste alphabétique des villes
servies avec `reglement=false` (126 villes). Le registre curé contenait déjà un
verdict explicite pour chacune : 11 numéros stampables et 115 verdicts `null`.
Cette passe n’a inventé, remplacé ou déduit aucune valeur.

## Avant → après (objets S3 de la collection servie)

Les deux folds ciblés ont été idempotents : les onze valeurs étaient déjà présentes
dans les objets `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`
(`cellsChanged=0`).

| Ville | Numéro du registre | Millésime | Résultat du fold |
| --- | --- | --- | --- |
| degelis | `656` | `2018` | 128 polygones, 0 cellule à modifier |
| montebello | `Z-17-01` | `2017` | 12 polygones, 0 cellule à modifier |
| notre-dame-du-sacre-coeur-dissoudun | `2007-06` | `null` | 22 polygones, 0 cellule à modifier |
| pointe-fortune | `400-2024` | `null` | 23 polygones, 0 cellule à modifier |
| roberval | `2018-09` | `null` | 38 polygones, 0 cellule à modifier |
| saint-damien | `753` | `2017` | 61 polygones, 0 cellule à modifier |
| saint-polycarpe | `218-2025` | `null` | 16 polygones, 0 cellule à modifier |
| saint-roch-des-aulnaies | `315-2016` | `2016` | 28 polygones, 0 cellule à modifier |
| sainte-beatrix | `526-2012` | `2012` | 48 polygones, 0 cellule à modifier |
| sainte-emelie-de-lenergie | `15RG-0712` | `2013` | 52 polygones, 0 cellule à modifier |
| sainte-melanie | `673.1-2024` | `null` | 74 polygones, 0 cellule à modifier |

La source durable contient pour chacun la citation verbatim, la page et l’URL
correspondantes dans `acquisition/config/reglement-provenance.json`. Aucun millésime
absent n’a été déduit du numéro de règlement.

## Villes null maintenues

Les 115 verdicts `null` préexistants restent inchangés, avec leur raison et leur
extrait verbatim dans le champ `_note` du registre. Aucun document supplémentaire
n’a été découvert dans cette passe. Les cinq nulls rejoués par le second fold sont :

| Ville | Raison verbatim conservée |
| --- | --- |
| saint-thomas | « Règlement de zonage - ANNEXE \"B\" » nomme le règlement sans le numéroter ; recherche plein texte du numéro de règlement : aucune occurrence. |
| sainte-lucie-des-laurentides | « Annexe 2 du Règlement de zonage » est un faux positif de motif : le cahier ne porte aucun numéro de base. |
| stanbridge-east | Les cellules citent seulement l’amendement « 399-2011-3 » ; le numéro de base ne peut pas être déduit du nom de fichier ou de cet amendement isolé. |
| temiscouata-sur-le-lac | La couverture dit « RÈGLEMENT NUMÉRO 329-24 / (Projet) / ZONAGE » : un projet n’est pas un règlement officiel adopté. |
| tingwick | Le document dit « MUNICIPALITÉ DE TINGWICK / Règlement de zonage » sans numéro ; « 2010-311 » n’apparaît pas dans le texte et reste un piège du nom de fichier. |

## Contrôle de la surface HTTP

Le contrôle imposé sur
`https://api.geo.sent-tech.ca/collections/qc-zonage-degelis/items?limit=1`
a été exécuté après le fold. La réponse publique est actuellement `HTTP/2 404` avec
le corps `404 page not found`, donc elle ne permet pas de lire
`.features[0].properties.reglement_numero`. Ce 404 est un état de route/API, pas un
verdict `null` sur les données : les objets S3 lus et repliés ci-dessus portent déjà
les onze valeurs.
