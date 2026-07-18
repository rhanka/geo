# Provenance règlement — shard 2/3 — 2026-07-18T08:11:55Z

## Périmètre et règle de shard

Liste triée des 295 municipalités avec `reglement=false` dans
`work/coverage/zonage-enrichment.json`; shard retenu: index `% 3 == 2`, soit
98 slugs. Le registre curé était déjà valide et sans modification locale. Il
contenait 15 numéros documentés pour ce shard; les 83 autres entrées sont déjà
des `null` anti-invention motivés dans
`acquisition/config/reglement-provenance.json` et n'ont pas été écrasées ni
réinterprétées.

## Villes servies — avant / après

Avant: les cinq villes étaient encore `reglement=false` dans le snapshot de
couverture. Le fold n'a changé aucune cellule (`cellsChanged=0`): les valeurs
étaient donc déjà présentes dans le polygone S3. Après: l'API servie confirme
le numéro ci-dessous.

| Slug | Numéro registre (verbatim déjà curé) | Après: `qc-zonage-<slug>` |
| --- | --- | --- |
| charette | `2023-02` | `2023-02` |
| degelis | `656` | `656` |
| montebello | `Z-17-01` | `Z-17-01` |
| ogden | `2025-05` | `2025-05` |
| pointe-fortune | `400-2024` | `400-2024` |

Commande de contrôle exécutée pour chaque ligne:

```sh
curl -s "https://api.geo.sent-tech.ca/collections/qc-zonage-<slug>/items?limit=1" | jq -r '.features[0].properties.reglement_numero'
```

## Provenances connues, mais polygone non servi

Avant: `reglement=false` dans le snapshot. Après: le fold a retourné
verbatim `polygone qc-zonage non servi` et l'API a rendu `NO_VALUE`; aucune
écriture ne peut donc être faite sans collection polygone cible.

| Slug | Numéro curé |
| --- | --- |
| beauharnois | `701` |
| bois-des-filion | `7200` |
| calixa-lavallee | `275` |
| marieville | `1066-05` |
| pincourt | `780` |
| saint-blaise-sur-richelieu | `546-23` |
| saint-edouard | `2015-259` |
| saint-marc-sur-richelieu | `3-2011` |
| sainte-therese | `500 N.S.` |
| terrebonne | `1001` |

## Villes `null`

Aucun nouveau `null` n'a été écrit dans ce passage. Les 83 `null` du shard
restent délibérément inchangés: le registre contient déjà la raison et les
citations verbatim correspondantes. Exemples de motifs conservés, sans
inférence depuis une URL ou un nom de fichier:

- `coaticook`: «Règlement de zonage de la ville de Coaticook» ne porte pas de
  numéro; `6-1` est explicitement le règlement abrogé.
- `escuminac`: «GRILLES DE SPÉCIFICATIONS MUNICIPALITÉ D'ESCUMINAC»; aucune
  occurrence d'un «règlement numéro N» dans l'annexe.
- `girardville`: le seul candidat lu, «règlement no 16-385», est «adopté par
  la MRC Maria-» et ne peut être attribué à la municipalité.
- `ham-nord`: le document porte «Règlement n° 480» puis «Règlement n° 496»
  sans relation de remplacement: aucun choix n'est justifiable.
- `new-richmond`: «RÈGLEMENT #717-00 ... CONCERNANT LE STATIONNEMENT»; ce
  n'est pas un règlement de zonage.
- `quebec`: «Dernier règlement ayant modifié la zone» désigne un amendement
  par arrondissement, incompatible avec le modèle per-municipalité.
- `saint-jacques-de-leeds`: le document dit «MUNICIPALITÉ DE SAINT-JACQUES»
  (MRC de Montcalm), pas Saint-Jacques-de-Leeds.
- `sainte-martine`: le seul numéro visible est sous «AMENDEMENTS (RÈGLEMENT
  N° 2019-342, ANNEXE A.)», donc pas la base de zonage.

Les autres raisons `null` sont déjà conservées, slug par slug, dans le
registre; aucune ne doit être convertie en numéro sans un nouveau document
portant le numéro de zonage de manière verbatim.

## Résultat du passage

- 15 provenances curées de ce shard soumises au fold.
- 5 collections polygones servies, confirmées par l'API.
- 10 collections polygones absentes/non servies, donc non stampables.
- 0 valeur inventée, 0 `null` modifié, 0 changement au registre curé.
