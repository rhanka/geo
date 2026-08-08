# Soumission cluster PV — batch municipalités vierges 20260808

## Périmètre préparé

Les quatre worklists de découverte lecture seule, committées dans `14742d3c`,
couvrent 25 municipalités vierges et 12 cibles de capture `pv-index` :

| Lot | MRC | Municipalités candidates | URLs PV | Worklist de capture |
| --- | --- | ---: | ---: | --- |
| 0001 | Témiscouata | 5 | 167 | `pv-decouverte-vides-20260808T202000Z-capture-lot-0001.json` |
| 0002 | Papineau | 4 | 216 | `pv-decouverte-vides-20260808T202000Z-capture-lot-0002.json` |
| 0003 | La Matapédia | 2 | 211 | `pv-decouverte-vides-20260808T202000Z-capture-lot-0003.json` |
| 0004 | Abitibi-Ouest | 1 | 257 | `pv-decouverte-vides-20260808T202000Z-capture-lot-0004.json` |

## Tentative de soumission — refus sûr

Le `2026-08-08T16:42:00Z`, le runner canonique
`acquisition/src/k8s-capture-run.ts` a publié la worklist immuable du lot 0001
sous `s3://sentropic-geo/registry/capture-worklists/pv-20260808T164200Z.json`,
puis a exécuté sa garde de cible avant tout `kubectl apply`.

- Job demandé (non créé) : `geo-capture-pv-20260808t164200z`.
- Cible versionnée : `https://hlhedx.c1.bhs5.k8s.ovh.net`, cluster `poc-ca`,
  namespace `geo` (`acquisition/config/k8s-target.json`).
- Kubeconfig disponible : `/home/antoinefa/.kube/poc.yaml`.
- Serveur réellement désigné par ce kubeconfig :
  `https://979c11ad-9f84-4847-a334-c42a5e797976.api.k8s.fr-par.scw.cloud:6443`.
- Résultat : garde anti-mauvais-cluster en échec, **aucun Job Kubernetes créé,
  aucune capture locale, aucun octet PV lu ni classifié**.

Les lots 0002--0004 restent des worklists locales committées et ne sont pas
publiés à la main : leur soumission doit repasser par le même runner pour que
la clé S3 immuable et le Job restent le même contrat.

## Dépendance de reprise — WP7 socle

Fournir au worker PV un kubeconfig d'accès au cluster déclaré `poc-ca` dont
`kubectl config view --minify` retourne exactement
`https://hlhedx.c1.bhs5.k8s.ovh.net`, avec accès au namespace `geo`. Reprendre
alors chaque lot par `k8s-capture-run.ts` (shards 5/4/2/1, concurrence 1,
512 Mi, `source=pv-index`) et consigner les noms de Jobs retournés. Ne pas
utiliser le kubeconfig Scaleway ni effectuer de PUT S3 manuel.
