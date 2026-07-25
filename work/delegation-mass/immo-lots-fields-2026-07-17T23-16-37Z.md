# WP9 — champs immo lots — shard 0/1

Audit S3 de départ : `2026-07-17T23:00:58.640Z`.

Audit S3 final : `2026-07-17T23:16:37.561Z`.

Tous les slugs appartiennent au shard 0/1 (index trié modulo 1).

## Avant / après par champ

| Champ | Avant | Après | Résultat confirmé par `immo-lots-audit.ts` |
| --- | ---: | ---: | --- |
| `surface_m2` | 3 368 162 / 3 368 162 (100 %) | 3 368 162 / 3 368 162 (100 %) | inchangé |
| `adresse` | 2 542 382 / 3 368 162 (75,48 %) | 2 542 382 / 3 368 162 (75,48 %) | inchangé |
| `code_postal` | 3 368 161 / 3 368 162 (100 %, arrondi) | 3 368 161 / 3 368 162 (100 %, arrondi) | inchangé |
| `folded-normes` | 860 604 / 3 368 162 (25,55 %) | 860 646 / 3 368 162 (25,55 %) | +42 lots ; le pourcentage arrondi est inchangé |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | inchangé |

## Villes traitées

### Adresse — jointure rôle foncier activée

`franquelin`, `remigny`, `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
`saint-gabriel-de-valcartier`, `saint-louis-de-gonzague-du-cap-tourmente`,
`saint-pierre`.

Chaque exécution a utilisé `lots-enriched-run.ts` sans `--no-role`, avec une limite
de 360 s. L'audit n'observe pas de gain : les valeurs restent null lorsque la
jointure rôle ne respecte pas le garde-fou d'intersection.

### Normes foldées — recalcul lot → zone puis enrichissement avec rôle

Premier lot : `roxton-pond`, `lac-sainte-marie`, `wentworth`, `lac-simon`,
`saint-germain-de-grantham`, `orford`.

Second lot : `saint-pierre`, `saint-lin-laurentides`, `varennes`, `roberval`,
`pont-rouge`, `saint-zotique`, `rigaud`, `rosemere`.

Tous ont été recalculés par `lot-zone-join-run.ts`, puis matérialisés par
`lots-enriched-run.ts` sans `--no-role`. Le seul gain que l'audit S3 confirme est
`wentworth`, de 54 à 96 lots avec normes foldées (1,82 % → 3,23 %), soit +42.
Les autres dépôts de ces deux lots confirment leur état antérieur dans les sidecars
qc-lots.

## Villes skippées / à reprendre

- `franquelin` : meilleur rôle 22 lots, sous le seuil 30.
- `remigny` : meilleur rôle 1 lot, sous le seuil 30.
- `saint-eugene-de-ladriere` : meilleur rôle 4 lots, sous le seuil 30.
- `saint-felix-de-dalquier` : aucun `code_geo` rôle candidat.
- `saint-gabriel-de-valcartier` : meilleur rôle 21 lots, sous le seuil 30.
- `saint-louis-de-gonzague-du-cap-tourmente` : meilleur rôle 1 lot, sous le seuil 98.
- `saint-pierre` : meilleur rôle 238 lots, sous le seuil 639 ; adresse maintenue
  à null conformément au garde-fou.
- `vercheres`, `sainte-beatrix`, `mont-laurier` : normes déposées, mais 0 % de
  correspondance code de zone → norme après vérification ; lane zones/normes.
- `becancour` : correspondance code de zone → norme de 0,08 % ; lane zones/normes.
- `laval` : différée : 401 594 lots, incompatible avec la limite de 360 s par ville.

Le gisement restant n'est pas déclaré réalisé : aucun résultat non mesuré par
`immo-lots-audit.ts` n'est compté.
