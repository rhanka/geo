# WP9 — champs LOT immo, shard 0/1

Mesures S3 uniquement. Audit initial : `2026-07-18T08:26:28.538Z` ;
audit final : `2026-07-18T08:45:28.902Z`.

| Champ | Avant (lots / périmètre) | Après (lots / périmètre) | Écart constaté |
|---|---:|---:|---:|
| `surface_m2` | 3 379 358 / 3 379 358 (100 %) | 3 379 358 / 3 379 358 (100 %) | 0 |
| `adresse` | 2 552 682 / 3 379 358 (75,54 %) | 2 552 682 / 3 379 358 (75,54 %) | 0 |
| `code_postal` | 3 379 357 / 3 379 358 (100 % arrondi) | 3 379 357 / 3 379 358 (100 % arrondi) | 0 |
| `folded-normes` | 866 327 / 3 379 358 (25,64 %) | 871 804 / 3 379 358 (25,80 %) | +5 477 |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

## Villes traitées

- Adresse, jointure rôle activée (jamais `--no-role`) : `franquelin`, `remigny`,
  `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
  `saint-gabriel-de-valcartier`, `saint-louis-de-gonzague-du-cap-tourmente`.
  Le rôle n'a fourni aucune correspondance sûre (candidat absent ou recouvrement
  sous le seuil) ; les adresses sont donc restées `null`.
- Normes jointes puis foldées et dépôts S3 vérifiés : `lac-simon`,
  `saint-germain-de-grantham`, `becancour`, `saint-leon-de-standon`, `bristol`,
  `saint-ours`, `saint-tite-des-caps`, `racine`, `labrecque`.

## Villes skippées / à reprendre

- Aucune norme réellement jointe : `saint-polycarpe`, `la-presentation`,
  `saint-chrysostome`, `saint-benoit-labre`, `notre-dame-des-neiges`,
  `sainte-anne-de-sabrevois`, `riviere-rouge`. Le fold n'a donc pas été lancé :
  l'absence de valeur source reste `null`.
- Couche de zonage absente : `baie-durfe`.
- Runner sans diagnostic exploitable : `wentworth` (sauté par
  `lot-zone-join-run.ts` sans message).
- Borne de six minutes atteinte avant un résultat vérifiable : `lac-sainte-marie` ;
  les villes suivantes du même lot n'ont pas été lancées : `orford`,
  `grande-riviere`, `saint-anselme`.
- `saint-pierre` n'a pas atteint son étape de dépôt dans le lot adresse ; à reprendre
  isolément. Le résidu `code_postal` mesuré est `pierreville` (99,95 %), mais la
  valeur manquante n'a pas été inventée.

Les lots urbains lourds tentés (`gatineau`, `trois-rivieres`, `sherbrooke`,
`longueuil`, `drummondville`, `levis`, `brossard`, `saint-jerome`) n'ont produit
aucun dépôt dont le résultat puisse être vérifié par l'audit ; ils ne sont pas
revendiqués comme traités.
