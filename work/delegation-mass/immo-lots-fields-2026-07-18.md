# WP9 — champs lots immo, shard 0/1

Date : 2026-07-18.  Toutes les mesures ci-dessous viennent de
`npx tsx acquisition/src/immo-lots-audit.ts` sur S3; aucune valeur locale n'est
comptée comme réalisée.

## Avant / après par champ

| Champ | Audit initial | Audit final S3 | Conclusion |
| --- | ---: | ---: | --- |
| `surface_m2` | 3 371 619 / 3 371 619 (100 %, 849 villes complètes) | 3 374 404 / 3 374 404 (100 %, 850 villes complètes) | Réalisé; aucun résidu avec lots servis. |
| `adresse` | 2 545 630 / 3 371 619 (75,50 %, 613 villes complètes) | 2 548 225 / 3 374 404 (75,52 %, 614 villes complètes) | En cours; les nulls testés sont protégés par la jointure rôle. |
| `code_postal` | 3 371 618 / 3 371 619 (100 %, 849 villes complètes) | 3 374 403 / 3 374 404 (100 %, 850 villes complètes) | Réalisé au seuil d'audit; Pierreville conserve 1 centroïde sans FSA. |
| `folded-normes` | 862 745 / 3 371 619 (25,59 %, 211 villes complètes) | 862 745 / 3 374 404 (25,57 %, 211 villes complètes) | En cours; aucune relance testée n'avait de gain S3 rejouable. |
| `in_tod` | 28 431 / 28 431 (100 %, 4 villes dans le scope) | 28 431 / 28 431 (100 %, 4 villes dans le scope) | Réalisé dans son scope. |

Le dénominateur S3 a changé pendant le travail partagé. Les écarts globaux
ci-dessus sont donc une photographie avant/après, pas une attribution de gain
à cette seule exécution.

## Villes traitées

- Adresse (enrichissement avec rôle, jamais `--no-role`) : `franquelin`,
  `remigny`, `saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
  `saint-gabriel-de-valcartier`. Les dépôts ont été vérifiés; l'audit final les
  confirme toujours à 0 % car la jointure sûre ne peut pas être établie.
- Normes : jointure zones puis ré-enrichissement de `amos`, `ange-gardien`,
  `armagh`, `baie-du-febvre`, `baie-sainte-catherine`. Les valeurs pliées
  finales confirmées sont respectivement 0/515, 40/1 555, 7/1 549, 21/929 et
  9/317; aucune valeur hors des normes sources n'a été ajoutée.
- Code postal : ré-enrichissement de `pierreville`; l'audit final est
  1 830/1 831 (99,95 %). Le lot restant est hors des polygones FSA, donc il
  reste `null`.

## Villes skippées et raisons

- `aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`,
  `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer` : 0 lot servi;
  surface/adresse/code postal ne peuvent pas être calculés sans source lot.
- `franquelin` (recouvrement rôle 22 < 30), `remigny` (1 < 30),
  `saint-eugene-de-ladriere` (4 < 30), `saint-gabriel-de-valcartier` (21 < 30)
  : garde-fou anti-homonymie du rôle foncier; adresse laissée nulle.
- `saint-felix-de-dalquier` : aucun candidat `code_geo` du rôle; adresse
  laissée nulle. `saint-louis-de-gonzague-du-cap-tourmente` n'a pas produit de
  résumé de dépôt dans la fenêtre bornée; il n'est pas compté comme traité.
- `amherst` : aucun zonage servi. `amos` : seulement 2,52 % de lots assignés,
  sans norme correspondante. `cap-chat` : pas de parquet de jointure lots-zones.
- Gate de gain stérile (0 pt) : `roxton-pond`, `vercheres`, `sainte-beatrix`,
  `mont-laurier`, `lange-gardien--la-cote-de-beaupre`, `blue-sea`,
  `saint-christophe-darthabaska`, `scott`, `sainte-victoire-de-sorel`.
- Le triage des grands résidus a isolé des dépendances hors lane : absence de
  normes (`montreal`, `sherbrooke`), absence de zones (`blainville`,
  `chertsey`, `beauharnois`) ou aucune intersection canonique zones/normes
  (`shawinigan`, `saint-eustache`, `saint-colomban`,
  `saint-bruno-de-montarville`, `sainte-julienne`, `bromont`).

## Vérification

- Audit final S3 : 2026-07-18T00:47:17.603Z.
- Le comportement `--no-role` a été vérifié dans
  `acquisition/src/lots-enriched-run.ts` : il écrit `adresse=null`; aucune
  commande de cette exécution n'a utilisé ce drapeau.
