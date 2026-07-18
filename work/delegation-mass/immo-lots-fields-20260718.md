# IMMO lots fields — shard 0/1 — 2026-07-18

Audit S3 initial : `npx tsx acquisition/src/immo-lots-audit.ts --report /tmp/immo-lots-before.json`.
Audit S3 final : même script, rapport `/tmp/immo-lots-final.json` (sortie redirigée), puis `--brief`.
Tous les slugs servis appartiennent au shard 0/1 (index de la liste triée modulo 1).

## Avant / après par champ

| Champ | Avant (lots) | Après (lots) | Écart | Preuve S3 |
|---|---:|---:|---:|---|
| `surface_m2` | 3 386 747 / 3 386 747 (100 %) | 3 386 747 / 3 386 747 (100 %) | 0 | audit final |
| `adresse` | 2 559 983 / 3 386 747 (75,59 %) | 2 559 983 / 3 386 747 (75,59 %) | 0 | audit final |
| `code_postal` | 3 386 746 / 3 386 747 (100 %, arrondi) | 3 386 746 / 3 386 747 (100 %, arrondi) | 0 | audit final |
| `folded-normes` | 872 229 / 3 386 747 (25,75 %) | 872 229 / 3 386 747 (25,75 %) | 0 | audit final |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 | audit final |

## Villes traitées

- Adresse, rôle foncier activé (jamais `--enrich-no-role` ni `--no-role`) : `saint-pierre`, `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`, `franquelin`, `saint-gabriel-de-valcartier`, `saint-eugene-de-ladriere`, `remigny`.
- Normes : `lac-superieur` — `lot-zone-join-run.ts`, puis `lots-enriched-run.ts` avec rôle.
- Code postal : `pierreville` — `lots-enriched-run.ts` avec rôle et index RTA/FSA.

## Villes skippées / non matérialisables

- `saint-pierre` : meilleur recouvrement rôle 238 lots, sous le seuil de validation 639 ; adresse reste `null`.
- `saint-louis-de-gonzague-du-cap-tourmente` : meilleur recouvrement rôle 1, sous le seuil 98 ; adresse reste `null`.
- `saint-felix-de-dalquier` : aucun candidat `code_geo` rôle pour le slug ; adresse reste `null`.
- `franquelin` : recouvrement rôle 22, sous le seuil 30 ; adresse reste `null`.
- `saint-gabriel-de-valcartier` : recouvrement rôle 21, sous le seuil 30 ; adresse reste `null`.
- `saint-eugene-de-ladriere` : recouvrement rôle 4, sous le seuil 30 ; adresse reste `null`.
- `remigny` : recouvrement rôle 1, sous le seuil 30 ; adresse reste `null`.
- `lac-superieur` : la jointure lots→zones réussit, mais le taux de correspondance codes zones→normes déposées est 0 % ; aucune norme ne peut être foldée honnêtement.
- `pierreville` : un lot demeure sans RTA/FSA au centroïde (99,95 %) ; le code postal reste `null`.
- `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` : 0 lot mesuré ; aucune surface ni RTA/FSA ne peut être matérialisée.
- `montreal` : ré-enrichissement interrompu avant dépôt confirmé dans la fenêtre d'exécution ; laissé non traité.
- `laval` : non lancé après le constat d'interruption de Montréal ; laissé non traité.

Le résidu `folded-normes` dépend des villes avec normes et codes de zones jointables ; les cas sans correspondance sont laissés à la lane normes/recalage. Aucune valeur n'a été inventée.
