# IMMO lots fields — shard 0/1

Audits S3 : avant `2026-07-18T08:14:32.420Z`, après `2026-07-18T08:17:48.663Z`.
Instrument de preuve : `acquisition/src/immo-lots-audit.ts` (sidecars S3). Les chiffres ci-dessous sont présentés par champ, sans total composite.

## Avant / après par champ

| Champ | Avant | Après | Conclusion S3 |
| --- | --- | --- | --- |
| `surface_m2` | 3 378 313 / 3 378 313 (100 %) | 3 378 313 / 3 378 313 (100 %) | inchangé, plafond atteint |
| `adresse` | 2 551 756 / 3 378 313 (75,53 %) | 2 551 756 / 3 378 313 (75,53 %) | inchangé, aucune adresse fiable supplémentaire |
| `code_postal` | 3 378 312 / 3 378 313 (100 % arrondi) | 3 378 312 / 3 378 313 (100 % arrondi) | inchangé, un lot hors RTA/FSA reste `null` |
| `folded-normes` | 865 959 / 3 378 313 (25,63 %) | 865 959 / 3 378 313 (25,63 %) | inchangé, aucune jointure rejouable sous la limite de temps |
| `in_tod` (scopé) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | inchangé, fait |

## Villes traitées

- Ré-enrichissement AVEC rôle-foncier, jamais `--no-role` : `saint-pierre`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`, `franquelin`, `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`.
- Chaque dépôt S3 a été vérifié ; les sept restent à `adresse=0 %`. Les garde-fous anti-collision ont conservé `adresse=null` au lieu d'inventer une correspondance.

## Villes skippées et raisons

- `saint-pierre` : meilleur recouvrement rôle 238 lots, seuil 639 ; `saint-louis-de-gonzague-du-cap-tourmente` : 1 < 98 ; `franquelin` : 22 < 30 ; `saint-gabriel-de-valcartier` : 21 < 30 ; `saint-eugene-de-ladriere` : 4 < 30 ; `remigny` : 1 < 30. Les adresses restent donc nulles.
- `saint-felix-de-dalquier` : aucun candidat `code_geo` du rôle foncier pour ce slug ; adresse laissée nulle.
- `montreal` (680 087 lots) et `laval` (401 594 lots) : adresse partielle mais ré-enrichissement terminal hors budget de six minutes par ville.
- `laval` (normes foldées) : gate S3 `REJOUABLE-GAIN`, +34,81 points potentiels, mais la jointure doit recalculer 401 594 lots ; non lancée afin de respecter la limite de six minutes. `brebeuf` est `STERILE` (75,02 % servi = 75,02 % joignable) : pas de réexécution.
- Autres résidus `folded-normes` : pas déclarés faits ; ils ne sont pas relancés sans un gain S3 démontré (sources normes/zones absentes, mismatch canonique, état stérile ou régressif : lanes amont).
- Surface : `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` ont chacun 0 lot, donc aucune surface ne peut être matérialisée.
- Code postal : les mêmes six villes ont 0 lot. `pierreville` conserve 1 830 / 1 831 (99,95 %) ; le lot restant est hors RTA/FSA et demeure null selon la source ouverte.

## Garde-fous appliqués

- `lots-enriched-run.ts` relu avant exécution : `--no-role` désactive le rôle et écrit `adresse=null`; cet argument n'a pas été utilisé.
- Les valeurs des champs restent celles de leurs sources réelles : rôle foncier pour l'adresse, RTA/FSA pour le code postal, et normes jointes seulement quand la zone et la norme se correspondent.
