# WP9 — champs lots immo, shard 0/1

Date d'audit S3 de référence : 2026-07-18T11:13:33Z.  Audit final S3 :
2026-07-18T11:23:45Z.  Les chiffres ci-dessous proviennent exclusivement de
`immo-lots-audit.ts`; les valeurs non résolues sont restées `null`.

## Historique conservé — passe antérieure du 18 juillet

Le rapport versionné contenait déjà une passe S3 de 09:44:49Z à 09:59:43Z,
sans variation pour `surface_m2`, `adresse`, `code_postal` et `in_tod`; elle
avait mesuré `folded-normes` à 871 805 / 3 386 747 (25,74 %). Cette passe avait
vérifié les dépôts pour `val-des-monts`, `disraeli--les-appalaches`,
`berthier-sur-mer`, `saint-leon-de-standon` et `saint-fabien-de-panet`, sans
gain S3, et avait écarté `saint-come` après dépassement de son budget de six
minutes. Les villes `normesStatus=to-research` y étaient déjà laissées à la
lane normes. Les sept villes adresse de la passe courante avaient également
été validées sans rôle fiable; elles sont re-mesurées ci-dessous, sans
contradiction ni effacement de ce constat.

| Champ | Avant (S3) | Après (S3) | Résultat |
| --- | --- | --- | --- |
| `surface_m2` | 3 386 747 / 3 386 747 (100 %) | 3 386 747 / 3 386 747 (100 %) | Aucun résidu dans l'audit courant; aucune écriture nécessaire. |
| `adresse` | 2 559 983 / 3 386 747 (75,59 %) | 2 559 983 / 3 386 747 (75,59 %) | Sept réenrichissements avec rôle foncier activé; les gardes de chevauchement ont tous rejeté la jointure, donc aucune adresse n'a été inventée. |
| `code_postal` | 3 386 746 / 3 386 747 (100 % arrondi) | 3 386 746 / 3 386 747 (100 % arrondi) | Pierreville recalculée; son unique lot non résolu ne recoupe aucun polygone FSA ouvert et reste `null`. |
| `folded-normes` | 872 229 / 3 386 747 (25,75 %) | 872 229 / 3 386 747 (25,75 %) | Seize villes ont été rejouées zone → normes → lots. Les taux observés sont les taux réellement joignables de leurs sources S3; aucun gain non confirmé n'est revendiqué. |
| `in_tod` (scopé) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | Déjà complet; aucune écriture nécessaire. |

## Villes traitées

- Adresse (rôle activé, sans `--no-role`) : `franquelin`, `remigny`,
  `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
  `saint-gabriel-de-valcartier`, `saint-louis-de-gonzague-du-cap-tourmente`,
  `saint-pierre`.
- Normes (jointure puis enrichissement) : `bearn`, `mont-carmel`,
  `riviere-au-tonnerre`, `lac-superieur`, `hatley-township-municipality`,
  `saint-roch-ouest`, `la-corne`, `val-des-bois`, `ferme-neuve`, `val-dor`,
  `kingsbury`, `les-escoumins`, `duhamel`, `temiscaming`, `leclercville`,
  `belleterre`.
- Code postal : `pierreville`.

## Villes skippées ou sans gain, avec raison vérifiée

- Adresse : `franquelin` (22 correspondances rôle < seuil 30), `remigny`
  (1 < 30), `saint-eugene-de-ladriere` (4 < 30),
  `saint-gabriel-de-valcartier` (21 < 30),
  `saint-louis-de-gonzague-du-cap-tourmente` (1 < seuil 98) et
  `saint-pierre` (238 < seuil 639) : chevauchement cadastre/rôle insuffisant.
  `saint-felix-de-dalquier` : aucun candidat `code_geo`. Ces sept villes
  restent à 0 % adresse afin d'éviter une attribution erronée.
- Normes : `bearn`, `mont-carmel`, `lac-superieur`, `la-corne` et
  `val-des-bois` ont une assignation de zone mais 0 % de match de codes vers
  les normes; `riviere-au-tonnerre` a 0 % de lots assignés;
  `hatley-township-municipality` a 0,72 % de lots assignés. Il n'existe donc
  pas de norme source joignable à replier pour ces villes dans cette lane.
- Normes : `ferme-neuve` (7,76 %), `val-dor` (13,95 %), `kingsbury` (97,58 %),
  `les-escoumins` (0,61 %), `duhamel` (26,15 %), `temiscaming` (96,39 %),
  `leclercville` (97,62 %) et `belleterre` (1,36 %) ont été rejouées avec le
  même taux que l'audit de départ : la jointure S3 confirme le résidu, sans
  source additionnelle à acquérir dans cette mission.
- Normes : `acton-vale` et `adstock` n'ont pas été comptées comme traitées :
  le runner local a été interrompu avant sortie `DONE` et avant dépôt vérifié.
  Les autres villes `normesStatus=to-research` n'ont pas été touchées, car
  l'acquisition de normes est explicitement hors de cette lane.
- Code postal : `pierreville`, un lot hors polygone FSA ouvert après recalcul;
  il reste `null` conformément au contrat anti-invention.

## Exécution

Les enrichissements adresse ont tous utilisé le rôle foncier. Aucun appel
`--enrich-no-role` ni `--no-role` n'a été exécuté.
