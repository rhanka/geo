# Normes via Mistral — shard 3/4

Date d’exécution : 2026-07-12T03:31:20Z  
Branche : `feat/cadre-acquisition`  
Sélection : `coverage-matrix.json`, liste triée, `index % 4 == 3` uniquement.  
Moteur : Mistral OCR-4.0 et Mistral `document_annotation` (`mistral-schema`). Aucun chemin GPT/codex utilisé.

## Résultat

- Cibles productibles au départ : 65.
- Cibles parcourues : 65, en cinq lots (15 + 15 + 15 + 15 + 5).
- Dépôts Parquet-only acceptés : 2.
- Preuves de non-dépôt : 63.
- Budget : chaque commande d’extraction était bornée à `--budget-usd 1`; les coûts observés sont restés sous cette limite par ville.

## Dépôts acceptés

| slug | source Mistral | codes | champs publiés | overlap SIG | suite |
|---|---|---:|---:|---:|---|
| `entrelacs` | annexe officielle `S-1_S-2_S-3_S-4_S-5_S-6.pdf` exposée par l’API VPlus municipale | 6 | 43,8 % | 5 | Parquet restauré avec la meilleure des annexes testées; manifeste fusionné; jointure et lots enrichis exécutés |
| `nouvelle` | `reglement-325-1-grille-des-specifications.pdf` exposé par le site municipal | 78 | 37,5 % | 77 | manifeste fusionné; jointure et lots enrichis exécutés |

Les sorties de jointure ont été vérifiées : `entrelacs` 2 564 lots, 12 % de match zone-normes; `nouvelle` 1 257 lots, 84,09 % de match zone-normes. Les valeurs publiées restent verbatim-or-null selon les gates du runner.

## Échecs et preuves

- `beaulac-garthby`, `belleterre`, `fermont`, `moffet`, `notre-dame-du-nord`, `pierreville`, `saint-anaclet-de-lessard`, `saint-camille`, `sainte-anne-de-sorel` : PDF officiel confirmé, extraction Mistral à 0 zone.
- `new-carlisle` : PDF confirmé, appel Mistral retourné `400 invalid_request_file` (fichier temporaire introuvable), donc 0 zone et aucun dépôt.
- `notre-dame-de-stanbridge` : OCR auto et fenêtre confirmée p.29–31 à 0 zone; schema Mistral p.29–31 à 0 zone.
- `saint-alexandre-de-kamouraska` : OCR global et fenêtre confirmée p.133–136 à 0 zone; schema à 0 zone.
- `saint-guillaume` : OCR global, schema p.27–28 et OCR ciblé p.27–28 à 0 zone.
- `kinnears-mills` : OCR à 4 codes mais overlap SIG 0; schema p.130 à 8 codes, overlap 0 et champs publiés 0; rejet anti-invention.
- `saint-lin-laurentides` : OCR global à 0 zone; schema p.121–141 à 8 codes hors SIG, overlap 0; rejet anti-invention.
- `saint-simon-de-rimouski` : schema p.1–32 à 32 codes, champs publiés 52,7 %, mais overlap SIG 0; rejet anti-invention.
- `westbury` : OCR global à 0 zone; schema p.61 à 0 zone.
- `aston-jonction`, `dunham`, `la-guadeloupe` : crawler officiel 2-hop, PDF grille HTTP confirmé absent.
- `cascapedia-saint-jules`, `grand-metis`, `honfleur`, `irlande`, `lac-megantic`, `launay`, `les-hauteurs`, `manseau`, `marieville`, `montreal`, `parisville`, `saint-adrien-dirlande`, `saint-bruno-de-guigues`, `saint-celestin--nicolet-yamaska--2`, `saint-cleophas-de-brandon`, `saint-dominique-du-rosaire`, `saint-edmond-les-plaines`, `saint-elzear--bonaventure`, `saint-ephrem-de-beauce`, `saint-felix-de-kingsey`, `saint-francois-de-la-riviere-du-sud`, `saint-gabriel`, `saint-jean-de-dieu`, `saint-juste-du-lac`, `saint-leonard-daston`, `saint-louis-de-gonzague--les-etchemins`, `saint-marcel`, `saint-medard`, `saint-michel-du-squatec`, `saint-philippe-de-neri`, `saint-pierre-de-lile-dorleans`, `saint-rene-de-matane`, `saint-romain`, `saint-sylvestre`, `saint-theophile`, `sainte-germaine-boule`, `shigawake`, `trois-pistoles`, `val-saint-gilles`, `wotton` : aucun PDF officiel confirmé dans les manifests/portails sondés pendant le lot; aucun téléchargement ni extraction inventée.
- `la-redemption` : page officielle sondée; aucun règlement de zonage de base/grille exposé dans les documents accessibles.
- `landrienne` : site officiel exposant un lien Acrobat vers le règlement; ce lien n’était pas un PDF directement confirmable, donc aucun dépôt.
- `trecesson` : manifest existant avec `sourceUrl=non-disponible`; aucun dépôt.

## Opérations post-dépôt

- `zonage-norms-manifest-merge.ts --apply` relancé après les dépôts; le manifeste a été écrit. Le merge signale aussi `registry: The specified key does not exist` pour l’entrée registry globale, sans bloquer les dépôts municipaux.
- `lot-zone-join-run.ts --slugs entrelacs,nouvelle` exécuté séparément et vérifié.
- `lots-enriched-run.ts --slugs entrelacs,nouvelle` exécuté séparément et vérifié.
- `loop-supervise.ts` exécuté au démarrage puis relancé en clôture; scoreboard final observé : `normes=650 (+1)`.
