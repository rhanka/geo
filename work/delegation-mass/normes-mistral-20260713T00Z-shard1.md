# Normes via Mistral — shard 1/4

Date d’exécution : 2026-07-12/13 UTC. Branche : `feat/cadre-acquisition`.

## Sélection

Sélection recalculée depuis `work/coverage/coverage-matrix.json` à chaque lot :
`zones.status == done`, `normes.status != done`, slugs triés, index `% 4 == 1`.
La matrice a évolué pendant l’exécution sous l’effet d’autres lanes : le shard est
passé de 51 cibles (203 productibles) à 50 (201 productibles). Aucun slug d’un
autre shard n’a été traité volontairement.

## Moteur et garde-fous

- Découverte : PDF locaux réutilisés en priorité, puis manifests/crawler officiel.
- Extraction : Mistral OCR-4.0 Document-AI et `mistral-schema` (`document_annotation`)
  pour les grilles transposées; une fenêtre Mistral vision one-zone a été utilisée
  uniquement pour les pages classées one-zone. Aucun GPT-5.5/Codex.
- Dépôts : `--no-manifest` / Parquet-only, budget demandé `--budget-usd 1` par muni.
- Gates appliqués : au moins 3 codes, overlap SIG non nul, `publishedFieldPct` non
  nul, verbatim-or-null. Les sorties ambiguës ont été rejetées, jamais corrigées
  par invention.

## Dépôt validé

| slug | codes | overlap SIG | champs publiés | méthode | Parquet |
|---|---:|---:|---:|---|---|
| saint-juste-du-lac | 50 | 5 | 0,3 % | `ocr/mistral-schema` | `registry/qc-zonage-norms/qc-zonage-norms-saint-juste-du-lac.parquet` |

Le Parquet a été fusionné dans le manifeste (`+ saint-juste-du-lac`, 50 lignes).
Le recalage des lots est vérifié : 592 lots, zone_code 100 %, dépôt Parquet OK.
L’enrichissement est déposé : 2 477 504 octets; normes jointes à 3,04 % des lots,
cohérent avec les 5 codes SIG recoupés.

## Échecs contrôlés / preuves

- `publishedFieldPct=0` : Brebeuf (46 codes, overlap 42), Lac-des-Plages
  (30 codes, overlap 11), Notre-Dame-du-Bon-Conseil, Valcourt (66 codes,
  overlap 7), ainsi que plusieurs fenêtres OCR/schema sans cellule de norme.
- `overlap=0` : Biencourt, Grosse-Île, Notre-Dame-des-Prairies, Saint-Cléophas,
  Saint-Lin, Saint-Prosper, Saint-Simon, Saint-Augustin et autres fenêtres
  Mistral; les codes/valeurs plausibles ont été rejetés par le gate SIG.
- `0 zones extracted` ou erreur technique : Albanel, East-Broughton, La
  Visitation-de-Yamaska, L’Assomption, Namur, Normandin, Pont-Rouge,
  Rivière-Bleue, Saint-Antonin, Courcelles-Saint-Évariste, Latulipe-et-Gaboury,
  Ivry-sur-le-Lac, Martinville et plusieurs petites grilles image.
- La Pocatière avait un fichier HTML nommé `.pdf`; le crawler n’a confirmé aucun
  PDF officiel pour les cibles absentes de sa registry. Aucune URL inventée n’a
  été déposée.
- Une fenêtre vision Saint-Simon a été interrompue à la limite de 6 minutes;
  OCR/schema ont ensuite confirmé `overlap=0`.

## Supervision finale

`loop-supervise.ts` relancé après la fusion et les joins. La fusion a signalé une
clé registry absente pour un artefact préexistant (`failed: registry`), mais a
écrit le manifeste et ajouté Saint-Juste-du-Lac.
