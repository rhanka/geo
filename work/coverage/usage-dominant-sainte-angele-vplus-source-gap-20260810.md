# Usage dominant — Sainte-Angèle-de-Mérici : écart de source VPlus

_Constat au 2026-08-10. Analyse en lecture seule d'artefacts capturés sur le
cluster et déposés sur S3; aucun octet municipal n'est matérialisé localement._

## Cible

La municipalité est servie mais n'a pas de carte `usage_dominant`. Une carte ne
peut être ajoutée que si une source réglementaire établit explicitement la
dominance de chaque code ou préfixe de zone.

## Preuves S3 disponibles

| Artefact | Résultat vérifiable | Limite pour usage dominant |
| --- | --- | --- |
| `raw/usage-dominant-vplus-urbanisme-published-detail/cas/a6108ce241a7362807b7f4776acb135f1abf058aa9406a81597bc354b55ecbfa.json` | La rubrique publiée Urbanisme contient des tarifs et formulaires de permis. | Aucun règlement de zonage ni légende. |
| `raw/usage-dominant-vplus-reglements-published-detail/cas/fe0236a765682893a7f4b8c7c3066f14e25bf6b39afe502d50499a150f3a1104.json` | La rubrique Règlements nomme des modifications au règlement de zonage 2010-06. | Le règlement-base et sa nomenclature/légende ne sont pas publiés. |
| Liste d'objets VPlus publique | La capture cluster de l'endpoint ListObjectsV2 du préfixe municipal reçoit HTTP 403. | Aucun nom de fichier ne peut être déduit de cette réponse. |
| Quatre PDF d'amendement explicitement publiés | Les captures documentent des modifications de 2010-06. | Un amendement ne reconstitue pas le texte-base, la totalité des codes, ni leur dominance. |

Les worklists qui rendent ces captures rejouables sont committées sous
`acquisition/config/usage-dominant-capture-20260810-sainte-angele-*.json`.

## Décision de donnée

`usage_dominant` reste **unknown**. Il ne faut ni créer
`acquisition/config/usage-dominant-map/sainte-angele-de-merici.json`, ni
convertir les intitulés des amendements en catégories : les cinq catégories
attendues doivent être reliées à une nomenclature officielle, pas supposées.

## Condition de reprise

Une nouvelle tentative ne devient justifiée que si une URL officielle distincte
du règlement-base 2010-06, d'une annexe de zonage ou d'une légende est trouvée.
Elle devra être ajoutée à une worklist versionnée, capturée sur le cluster avec
`--kubeconfig /tmp/ovh.kubeconfig`, puis analysée depuis S3. La réponse 403 et
les endpoints déjà capturés ne constituent pas une cible de capture répétable.
