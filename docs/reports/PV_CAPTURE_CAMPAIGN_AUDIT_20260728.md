# Audit CAS — campagne PV `pv-probable-20260728-b32de19169bc`

## Résultat

Le cumul réel dédupliqué par clé CAS est **4 719**. Le chiffre de 5 300 n'est
donc pas confirmé : il ne correspond ni aux URL observées ni aux octets
durablement captés.

| Mesure | Nombre |
| --- | ---: |
| Observations PV | 5 800 |
| URL canoniques observées | 5 350 |
| Observations avec `storage_key` CAS | 4 975 |
| URL canoniques avec CAS | 4 729 |
| Clés CAS distinctes | **4 719** |

Les 450 observations redondantes comprennent les 200 URL des lots 0108--0111,
identiques aux lots 0104--0107. Les 825 observations sans `storage_key` ne
sont jamais comptées comme documents captés.

## Méthode reproductible, lecture seule

L'auditeur `acquisition/src/pv-capture-campaign-audit.ts` liste tous les
manifests sous le préfixe de campagne (sans se fier à l'état), refuse toute
lecture locale ou S3 de plus de 5 MiB, puis déduplique les seules lignes
`pv-index` portant une `storage_key`. Il a contrôlé 104 manifests de campagne
(5 200 lignes) et les 12 rapports complets ci-dessous (600 lignes) :

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 npx tsx acquisition/src/pv-capture-campaign-audit.ts \
  --campaign=pv-probable-20260728-b32de19169bc \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0100.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0101.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0102.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0103.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0104.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0105.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0106.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0107.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0108.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0109.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0110.json \
  --classification=work/coverage/pv-capture-octets-classification-20260728-lot-0111.json
```

L'état S3 est bien `halted` (94 `settled`, 5 `blocked`, 813 `pending`), mais
104 manifests existent : c'est pourquoi il sert de diagnostic et jamais de
filtre du cumul. Huit rapports ont leur manifeste de run encore lisible et
identique; les quatre manifests cités par 0108--0111 sont absents après la
migration, mais leurs rapports complets n'ajoutent **aucune** clé CAS qui ne
soit déjà prouvée par les manifests présents. Aucune campagne n'a été relancée.
