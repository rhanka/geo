# Recalage PDF zones — continuation shard 1/2 — 2026-07-12T23:39:50Z

## État

Règle appliquée : slugs dont l’index dans la liste triée est impair. Aucun AGOL owner harvest.

Le sélecteur courant compte 134 slugs `zones.status != done`, dont 128 dans les buckets PDF prioritaires. Les 134/134 sont déjà couverts par le rapport exhaustif précédent ; il n’y a donc aucun slug non traité à reprendre honnêtement dans cette continuation, et aucun nouveau PDF, GCP ou code n’a été inventé.

Preuve exhaustive : `work/delegation-mass/zones-recalage-20260712T233350Z-shard1of2.json` et son rapport Markdown. Ce rapport couvre les dépôts réussis ou les preuves d’échec strict pour chaque ligne du shard courant.

## Dépôt positif re-vérifié

`sainte-elisabeth` :

- `lot-zone-join-run.ts --slugs sainte-elisabeth` : OK, 1119 lots, 97,59 % affectés, parquet et stats présents ; avertissement de correspondance normes à 0 % conservé tel quel.
- `lots-enriched-run.ts --slugs sainte-elisabeth` : OK, 1119 lots, `zone_code` 97,59 %, surface 100 %, code postal 100 %, adresse 98,57 %, dépôt présent.

Le dépôt source et ses gates de recalage sont documentés dans le rapport exhaustif cité ci-dessus : 34 GCP indépendants, résidu maximal 12,977 m, 177 codes réels verbatim, 131 features, 1092/1119 lots.

## Conclusion

La boucle de ce shard est épuisée côté preuve : 134 résidus courants sont déjà documentés, et le seul dépôt positif est revalidé par les deux consommateurs immo. Aucun commit de code n’est justifié ; les changements préexistants hors périmètre sont conservés.
