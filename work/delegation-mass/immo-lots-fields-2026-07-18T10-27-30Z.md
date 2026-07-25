# IMMO lots fields — shard 0/1

Périmètre : tous les slugs de la liste triée (`index % 1 == 0`). Les mesures
viennent exclusivement des sidecars S3 lus par `immo-lots-audit.ts`; aucun
champ sans source n'a été complété.

Audit initial : `2026-07-18T10:06:54.509Z`.

Audit final : `2026-07-18T10:34:01.522Z`.

## Avant / après, par champ

| Champ | Avant | Après | Écart mesuré |
| --- | ---: | ---: | ---: |
| `surface_m2` | 3 386 747 / 3 386 747 (100 %) | 3 386 747 / 3 386 747 (100 %) | 0 |
| `adresse` | 2 559 983 / 3 386 747 (75,59 %) | 2 559 983 / 3 386 747 (75,59 %) | 0 |
| `code_postal` | 3 386 746 / 3 386 747 (100 % arrondi) | 3 386 746 / 3 386 747 (100 % arrondi) | 0 |
| `folded-normes` | 871 805 / 3 386 747 (25,74 %) | 872 229 / 3 386 747 (25,75 %) | +424 |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

La hausse de `folded-normes` est confirmée par l'audit S3. Notre-Dame-de-la-Paix
apporte exactement 164 lots à elle seule (`18,55 %` de 884); les 260 autres
lots du delta ne sont pas attribués à ce shard, car des écritures concurrentes
ont eu lieu sur S3 pendant ce lot.

## Villes traitées

- Adresses, avec rôle foncier actif (jamais `--no-role`) :
  `saint-pierre`, `saint-louis-de-gonzague-du-cap-tourmente`,
  `saint-felix-de-dalquier`, `franquelin`,
  `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`.
  Elles restent toutes à 0 % : les recouvrements rôle/cadastre étaient
  insuffisants (respectivement 238/639, 1/98, aucun `code_geo`, 22/30,
  21/30, 4/30 et 1/30). Le garde-fou laisse donc `adresse=null`.
- Normes : `saint-donat--matawinie` et `val-des-monts` ont reçu la jointure
  lot→zone puis le ré-enrichissement avec rôle. Les jointures ont assigné
  88,45 % et 78,38 % des lots, mais 0 % des codes de zones correspondaient à
  une norme déposée; les normes restent donc nulles.
- Normes, second lot : `frelighsburg`, `inverness`, `sainte-eulalie`,
  `packington`, `baie-saint-paul` et `notre-dame-de-la-paix` ont reçu la
  jointure puis le ré-enrichissement avec rôle. Les cinq premières restent à
  0 % de normes concordantes; Notre-Dame-de-la-Paix est passée de 0 à
  164/884 lots (`18,55 %`) de normes pliées, valeur confirmée par son sidecar
  S3 puis l'audit final.
- Résidu postal : `pierreville` a été ré-enrichie. Elle reste à
  1 830/1 831 (99,95 %) : le lot dont le centroïde ne recoupe pas de polygone
  FSA n'a pas reçu de code postal inventé.
- `surface_m2` n'avait aucun résidu dans l'audit initial ni final.

## Villes skippées / limites

- `beauharnois` : pas de zonage sous `normalized/ca-qc-zonage/`; aucune
  jointure normes possible.
- `saint-come` : jointure interrompue avant dépôt après six minutes, selon la
  borne par ville; aucune réussite n'est comptée.
- `plessisville`, `beauceville`, `mont-blanc` et `lac-brome` : non lancées
  après l'interruption du lot séquentiel, afin de ne pas dépasser la limite de
  temps du slug en cours.
- `saint-joachim` et `fort-coulonge` : zonage disponible mais sans
  `zone_code` utilisable, donc jointure normes impossible.
- Les villes marquées `normesStatus=to-research` ne sont pas traitées : elles
  n'ont pas de normes déposées et relèvent de la lane normes.

## Preuve

Commande finale :

`npx tsx acquisition/src/immo-lots-audit.ts --report /tmp/immo-lots-shard0-final-20260718.json`

Résultat final : 863 villes servies, 3 386 747 lots et aucun sidecar manquant.
