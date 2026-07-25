# IMMO lots — finalisation des champs (shard 0/1)

Mesure d’autorité : `acquisition/src/immo-lots-audit.ts`, sidecars S3. Shard
`0/1` : tous les slugs triés sont dans le périmètre. Aucun champ n’est compté
sans confirmation S3.

Audits : avant `2026-07-18T08:45:28.902Z` ; après
`2026-07-18T08:51:45.666Z`.

## Avant / après, par champ

| Champ | Avant S3 | Après S3 | Résultat |
| --- | --- | --- | --- |
| `surface_m2` | 3 379 358 / 3 379 358 (100 %) | 3 379 358 / 3 379 358 (100 %) | inchangé ; plafond atteint |
| `adresse` | 2 552 682 / 3 379 358 (75,54 %) | 2 552 682 / 3 379 358 (75,54 %) | inchangé ; aucune adresse fiable supplémentaire |
| `code_postal` | 3 379 357 / 3 379 358 (100 % arrondi) | 3 379 357 / 3 379 358 (100 % arrondi) | inchangé ; un lot hors RTA/FSA reste `null` |
| `folded-normes` | 871 804 / 3 379 358 (25,80 %) | 871 804 / 3 379 358 (25,80 %) | inchangé ; aucun gain de fold rejouable dans le budget |
| `in_tod` (scopé) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | inchangé ; fait |

## Villes traitées

Ré-enrichissement avec rôle foncier actif (sans `--no-role`) et index RTA/FSA,
avec dépôt S3 vérifié pour chacune :

- `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
  `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` : zéro lot dans le
  cadastre ; `surface_m2` et `code_postal` restent à 0/0 sans valeur inventée.
- `pierreville` : `surface_m2` 100 %, `code_postal` 1 830/1 831 (99,95 %),
  `adresse` 93,56 %. Le dernier centroïde ne recoupe aucun polygone RTA/FSA,
  donc son code postal reste `null`.

## Villes skippées avec raison

- Adresse : les sept villes à 0 % (`saint-pierre`,
  `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`,
  `franquelin`, `saint-gabriel-de-valcartier`,
  `saint-eugene-de-ladriere`, `remigny`) ont déjà un recouvrement rôle↔cadastre
  insuffisant ou aucun candidat. Le garde anti-collision doit laisser
  `adresse=null`. Montréal et Laval dépassent le budget de six minutes par ville.
- Normes : deux lots de gate S3 ont vérifié 24 villes `STERILE` (parquet déjà au
  taux servi), 4 `REGRESSIF` (rejouer ferait perdre des normes) et 2 `NO-JOIN`.
  Elles ne sont donc pas relancées. Laval est le seul gain signalé, mais ses
  401 594 lots dépassent le budget par ville ; les autres manques relèvent des
  lanes normes/zonage/canonicalisation.

## Garde-fous

- `lots-enriched-run.ts` a été relu : `--no-role` affecte explicitement
  `adresse=null`. Il n’a pas été employé.
- Les valeurs restent issues du rôle foncier, du géocodage RTA/FSA et des
  parquets de normes réellement joints. Les champs absents à la source restent
  `null`.
