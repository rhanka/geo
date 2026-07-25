# Effet densifiant (4a) — SHARD 2/3 — 2026-07-18T07:30:34Z

**SHARD 2/3** : FOCUS trié alphabétiquement, `index % 3 == 2` :
`chelsea`, `levis`, `neuville`, `preissac`, `saint-amable`,
`saint-frederic`, `saint-raymond`, `stratford`.

## Méthode et garde

- Lecture du règlement/millésime réellement servi par `qc-zonage-<slug>`
  (API OGC) et recoupement avec `acquisition/config/reglement-provenance.json`.
- Pré-gate d'événement sur les documents municipaux accessibles et les sources
  locales. Une grille consolidée, un nom de fichier ou un numéro de règlement
  n'est jamais interprété comme un compteur de logements.
- Le verrou `readEntries` de `fold-effet-densifiant.ts` a été respecté : aucun
  artefact `work/effet-densifiant/<slug>.json`, aucun fold et aucune écriture S3
  ne sont justifiés sans les deux valeurs verbatim.

## SERVIES : 0

Aucune zone n'a deux compteurs de logements comparables, lus verbatim avant et
après. Aucun `densifie`, `reduit` ou `stable` n'a donc été servi.

## Inconnu — aucun événement de zonage exact détectable

| slug | règlement servi | constat |
|---|---|---|
| `levis` | `RV-2011-11-23 / 2011` | Source de base seule. Le répertoire municipal de zonage trouvé est protégé (`403`) et ne fournit pas, dans cette passe, un avis/PV ou un amendement identifié avec une zone. `inconnu:no-event-detected` (gap de découverte, pas une absence historique affirmée). |
| `neuville` | `104 / null` | Source de base `reglement-de-zonage-104.pdf`; aucune refonte ou modification ponctuelle avec zone précise n'est détectée dans les sources accessibles. `inconnu:no-event-detected`. |
| `preissac` | `239-2014 / null` | La seule provenance est une grille compilée `Preissac_Zonage_239-2014_MAJ_2015.pdf`; « MAJ 2015 » n'identifie ni un règlement-événement ni une zone. `inconnu:no-event-detected`. |
| `stratford` | `1035 / null` | Seule l'annexe de grille `STR_GRILLE_20220621.pdf` est disponible. Le `20220621` est une date de version, pas un millésime/verbatim de règlement; aucun événement zoné n'est détectable. `inconnu:no-event-detected`. |

## Inconnu — événement ou consolidation détecté, delta interdit

| slug | événement / direction | raison anti-invention |
|---|---|---|
| `chelsea` | **Refonte** `1215-22`, en vigueur le 29 novembre 2022. Le PDF officiel dit verbatim : « Le présent règlement abroge le règlement numéro 636-05 ». La grille servie `636-05 / 2005` est donc l'**AVANT**. | La refonte couvre tout le territoire : le mapping exhaustif des zones et les deux grilles de compteurs n'ont pas été acquis/lus dans la limite du lot. Aucun compteur n'est déduit des classes ou du changelog. `inconnu:predecessor-and-mapping-not-extracted`. Sources : `https://www.chelsea.ca/download_file/view/8272/3573`, p. 1/3/25; source AVANT servie `https://www.chelsea.ca/application/files/1715/9838/2413/1147-20_mod_636-05_Zonage_francais.pdf`. |
| `saint-amable` | `712-47-2026`, entré en vigueur le 12 juin 2026; il modifie les limites de `H-59` et supprime `RX-122`. | Changement géométrique/retrait de zone, sans deux nombres de logements verbatim. `RX-122` n'existe plus après l'événement, et `H-59` ne porte pas un diff de logements. `inconnu:counts-not-applicable`. Preuve locale : `work/coverage/saint-amable-712-47-2026-norms-retire-rx122.json`. |
| `saint-frederic` | La seule grille disponible est `Zonage_297-15_amende-5.pdf` (servi `297-15 / 2015`). | Une compilation amendée n'est pas l'acte ponctuel : aucun PDF d'amendement numéroté, zone touchée et état prédécesseur n'a été isolé. Un unique état APRÈS ne permet pas de produire un delta. `inconnu:one-sided-consolidated`. |
| `saint-raymond` | `922-26` crée `HC-14` à même une partie de `HC-4` et de `RX-5`; le servi est déjà estampillé `583-15 (am. 922-26) / 2026`, donc APRÈS. | `HC-14` vient de deux zones-mères hétérogènes et le règlement ne fournit pas un unique nombre AVANT pour ce nouveau code. La grille locale pré-amendement ne donne pas le nombre de logements des zones mères; l'annexe B de `922-26` n'offre pas non plus un compteur comparable explicitement libellé. `inconnu:new-zone-no-verbatim-avant`. Source : `https://villesaintraymond.com/uploads/documents/pieces-jointes/reg.-922-26-adoption.pdf`, art. 1–2 et annexe B, p. 1–5. |

## Suite sûre

1. Chelsea : acquérir/lire les deux grilles complètes et une correspondance
   exhaustive `636-05` → `1215-22` avant de créer tout artefact de fold.
2. Saint-Raymond : obtenir une règle source qui donne un compteur comparable
   pour chacune des portions `HC-4` et `RX-5`; sinon la zone nouvelle reste
   `inconnu`.
3. Les autres slugs demandent d'abord un avis/PV ou PDF d'amendement exact;
   l'absence actuelle est explicitement un gap de découverte, jamais un zéro
   logement ou une densité inférée.
