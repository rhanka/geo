# WP9 — champs lot immo, shard 0/1

Audit S3 de départ : `2026-07-17T22:39:26.340Z`.

Audit S3 final : `2026-07-17T22:53:17.755Z`.

Les deux audits lisent les sidecars `normalized/qc-lots/*.stats.json` et portent sur
853 villes servies, 3 368 162 lots. Les pourcentages et numérateurs ci-dessous sont
les sorties de `immo-lots-audit.ts`; aucune valeur n'est estimée.

| Champ | Avant | Après | Écart mesuré |
| --- | ---: | ---: | ---: |
| `surface_m2` | 3 368 162 / 3 368 162 — 100 % | 3 368 162 / 3 368 162 — 100 % | 0 lot |
| `adresse` | 2 542 382 / 3 368 162 — 75,48 % | 2 542 382 / 3 368 162 — 75,48 % | 0 lot |
| `code_postal` | 3 368 161 / 3 368 162 — 100 % arrondi | 3 368 161 / 3 368 162 — 100 % arrondi | 0 lot |
| `folded-normes` | 859 599 / 3 368 162 — 25,52 % | 860 604 / 3 368 162 — 25,55 % | +1 005 lots |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 — 100 % | 28 431 / 28 431 — 100 % | 0 lot |

## Villes traitées

Les ré-enrichissements suivants ont tous été lancés sans `--no-role`; l'index rôle
2026 et l'index FSA ont été chargés à chaque dépôt :

- Adresse : `abercorn`, `acton-vale`, `adstock`, `albanel`, `aston-jonction`,
  `baie-johan-beetz`, `baie-sainte-catherine`, `baie-trinite`, `berry`,
  `bethanie`, `franquelin`, `remigny`, `saint-eugene-de-ladriere`,
  `saint-felix-de-dalquier`, `saint-gabriel-de-valcartier`, `pierreville`,
  `charlemagne`, `clarenceville`, `disraeli--les-appalaches`, `frelighsburg` et
  `armagh`.
- Jointure lot → zone → normes, puis enrichissement : `charlemagne`,
  `clarenceville`, `disraeli--les-appalaches`, `frelighsburg`, `acton-vale`,
  `adstock` et `armagh`.

Le gain global de 1 005 lots `folded-normes` est uniquement constaté dans l'audit
S3 final. Le dépôt est partagé avec d'autres travaux, donc ce rapport ne l'attribue
pas à une ville ou une commande particulière sans audit de différence par dépôt.

## Villes skippées / limites vérifiées

- `franquelin` (22 lots rôle recouvrants), `remigny` (1),
  `saint-eugene-de-ladriere` (4) et `saint-gabriel-de-valcartier` (21) : le
  recouvrement rôle/cadastre est inférieur au seuil sûr de 30 lots; l'adresse reste
  `null` pour ne pas joindre le mauvais rôle.
- `saint-felix-de-dalquier` : aucun `code_geo` rôle résolu; adresse conservée à
  `null`.
- `pierreville` : un lot reste hors des polygones RTA/FSA, donc son `code_postal`
  reste `null` (99,95 % sur la ville).
- `cap-chat` : aucune zone servie sous `normalized/ca-qc-zonage/`.
- `fort-coulonge` : zones servies, mais aucun `zone_code` exploitable.
- Les jointures de `charlemagne`, `clarenceville`,
  `disraeli--les-appalaches` et `frelighsburg` ont bien été déposées, mais leur
  taux de code de zone trouvant une norme est 0 %. Les normes ne sont pas déduites
  en l'absence de code commun.
- À la ré-audit, 175 villes sous 100 % pour `folded-normes` sont toujours
  `normes=to-research` et 3 n'ont pas de statut normes : elles relèvent de la lane
  normes et sont donc hors de ce lot. Parmi les autres résidus, 621 villes sont
  `normes=done` mais exigent une compatibilité supplémentaire entre leurs codes de
  zone et leurs normes; ce rapport ne les déclare pas complétées.

Les artefacts d'audit locaux correspondants sont
`work/coverage/immo-lots-before-20260717T000000Z-shard0.json` et
`work/coverage/immo-lots-after-20260717T000000Z-shard0.json`.
