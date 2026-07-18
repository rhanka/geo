# Effet densifiant (4a) — SHARD 0/2 — clôture

Périmètre strict, liste FOCUS triée puis `index % 2 == 0` : `alma`,
`chelsea`, `la-sarre`, `mont-saint-hilaire`, `neuville`, `plaisance`,
`rimouski`, `saint-amable`, `saint-come-liniere`, `saint-gilbert`,
`saint-raymond`, `sainte-cecile-de-milton`.

Le verrou de `fold-effet-densifiant.ts` a été relu : un effet est dérivé des
deux compteurs. Aucun chiffre n'est déduit d'un numéro, d'une date, d'une
classe d'usage ou d'un indice Steve.

## Villes SERVIES

| Ville | Zones densifiées | Résultat vérifié |
| --- | ---: | --- |
| `rimouski` | 1 | `H-3018`, règlement `24-018` : `1 → 16` logements par bâtiment. L'API OGC relue le 2026-07-18 retourne `effet_densifiant=densifie`, `plus 15 log`, `densite_avant_reglement=820-2014`, `densite_apres_reglement=24-018`. Artefact déjà validé : `work/effet-densifiant/rimouski.json`. |

`rimouski` avait été pliée avant cette clôture ; aucun artefact ni pli n'a été
réécrit dans ce passage.

## Inconnu — sans événement de zonage détectable

| Ville | Constat |
| --- | --- |
| `saint-come-liniere` | Le corpus accessible est la consolidation `148-06` « à date 22 septembre 2021 » ; aucun avis/PV ou acte d'amendement zoné n'a été isolé. `inconnu:no-event-detected` est un manque de découverte, pas une affirmation d'absence historique. |

## Bloquées — événement ou transition détecté, delta interdit

| Ville | Raison anti-invention |
| --- | --- |
| `alma` | L'amendement `485-2026` modifie des portions de zones ; les avis ne fournissent ni les codes résolubles ni deux compteurs de logements, et aucune grille APRÈS comparable n'est acquise. |
| `chelsea` | La refonte `1215-22`, en vigueur le 2022-11-29, abroge `636-05` servi (donc servi = AVANT). Le mapping territorial exhaustif et les deux grilles de compteurs ne sont pas extraits. |
| `la-sarre` | `05-2024` servi est une refonte APRÈS qui abroge les règlements antérieurs. La grille prédécesseure et le mapping ancien→nouveau sont absents. |
| `mont-saint-hilaire` | Les avis 2026 identifiés sont des projets ou ne donnent que des limites de zones ; aucune entrée en vigueur avec les deux grilles et compteurs n'est publique. |
| `neuville` | La codification `104` intègre des amendements mais ne fournit qu'un état consolidé : actes zonés, grille antérieure et compteurs AVANT sont absents. |
| `plaisance` | La transition `URB 99-05 → Urb-02-2024` reste indécidable : le document 2024 est titré PROJET et laisse l'entrée en vigueur vide, tandis que le règlement/millésime servi est nul. La garde AVANT/APRÈS interdit le delta. |
| `saint-amable` | `712-47-2026` retire `RX-122` et modifie les limites de `H-59` ; c'est un changement géométrique sans paire de compteurs verbatim comparable. |
| `saint-gilbert` | Les avis détectés, dont `U-161-2026`, restent au stade projet/approbation référendaire ; aucune grille APRÈS, compteur postérieur, ni millésime servi déterminant le sens n'est disponible. |
| `saint-raymond` | `922-26` crée `HC-14` à partir de portions de `HC-4` et `RX-5`; le servi est déjà APRÈS. Les zones-mères sont hétérogènes et aucun compteur AVANT/APRÈS unique et verbatim ne peut être projeté sur la nouvelle zone. |
| `sainte-cecile-de-milton` | Des amendements à `560-2017` ont une entrée en vigueur, mais le millésime servi est nul et les deux grilles ciblées avec compteurs ne sont pas acquises. |

## Contrôles

- Les identités servies ont été relues depuis les collections S3 par les sondes
  TypeScript de la lane.
- L'API OGC de Rimouski a été relue sans redémarrer `geo-api`.
- Aucun nouvel effet n'est servi : les artefacts existants restent inchangés,
  plutôt que de transformer un état à un seul côté en delta.
