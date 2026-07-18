# Provenance règlement — shard 0/2

Date : 2026-07-18T08:16:26Z

Périmètre : slugs de `work/coverage/zonage-enrichment.json` dont `served=true`, `reglement=false`, triés par slug réel puis index pair. Les 126 candidats du shard ont déjà une entrée dans `acquisition/config/reglement-provenance.json`; 11 portent un numéro et les 115 autres sont déjà des verdicts `null` curés. Aucun nouveau numéro n'a été déduit ni écrit.

## Avant / action / après

Avant : les 11 villes ci-dessous étaient encore marquées `reglement=false` dans le rapport de couverture. Le registre curé portait déjà leurs quatre champs, et le fold a constaté `cellsChanged=0` sur les clés S3 — les polygones étaient donc déjà conformes.

Après : lecture de la collection publique `qc-zonage-<slug>` avec `limit=1`; chaque numéro ci-dessous est présent sur la première entité servie.

| Slug | Numéro servi vérifié | Millésime curé |
| --- | --- | --- |
| degelis | 656 | 2018 |
| montebello | Z-17-01 | 2017 |
| notre-dame-du-sacre-coeur-dissoudun | 2007-06 | null |
| pointe-fortune | 400-2024 | null |
| roberval | 2018-09 | null |
| saint-damien | 753 | 2017 |
| saint-polycarpe | 218-2025 | null |
| saint-roch-des-aulnaies | 315-2016 | 2016 |
| sainte-beatrix | 526-2012 | 2012 |
| sainte-emelie-de-lenergie | 15RG-0712 | 2013 |
| sainte-melanie | 673.1-2024 | null |

## Villes null

Aucun verdict `null` nouveau dans ce passage : les 115 candidats restants avaient tous déjà une entrée `null` avec note anti-invention dans le registre curé. Les URL servies présentes ont également toutes une entrée de registre ; il ne reste donc aucune source de ce shard sans verdict à traiter sans redécouverte hors périmètre.

Les millésimes `null` du tableau ne sont pas des déductions depuis le numéro : le registre indique qu'aucune date d'adoption ou d'entrée en vigueur verbatim n'était portée par le document lu.
