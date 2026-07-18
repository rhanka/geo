SHARD 0/2 — liste FOCUS triée, `index % 2 == 0`

# Effet densifiant (4a) — ré-audit 2026-07-18T10:30:11Z

Périmètre exclusif : `alma`, `chelsea`, `la-sarre`, `mont-saint-hilaire`,
`neuville`, `plaisance`, `rimouski`, `saint-amable`,
`saint-come-liniere`, `saint-gilbert`, `saint-raymond`,
`sainte-cecile-de-milton`.

Le rapport de qualification déjà versionné dans `183310a` a été relu. Aucun
nouveau règlement ou document de grille pertinent n'a été versionné depuis
ce rapport. Les constatations non servables restent donc des blocages
verbatim, et non des valeurs supposées.

## Villes SERVIES

| Ville | Zones densifiées | Contrôle de service |
| --- | ---: | --- |
| `rimouski` | 1 | `H-3018` : compteurs verbatim gelés dans `work/effet-densifiant/rimouski.json`, `1 → 16`, donc `densifie`; `820-2014/2014 → 24-018/2024`. Le fold à blanc appaire 1 zone sur la clé servie. L'API publique retourne les six champs attendus pour `H-3018`, dont `densite_avant=1`, `densite_apres=16` et `effet_densifiant=densifie`. |

Contrôle exécuté, sans écriture S3 :

`npx tsx src/fold-effet-densifiant.ts --slug rimouski --old-reglement 820-2014 --new-reglement 24-018 --old-millesime 2014 --new-millesime 2024 --dry-run`

Résultat : `features=1067`, `matched=1`, clé
`normalized/ca-qc-zonage/qc-zonage-rimouski/qc-zonage-rimouski.geojson`.

## Villes `inconnu-sans-event`

| Ville | Constat |
| --- | --- |
| `saint-come-liniere` | La grille catégorielle consolidée (22 septembre 2021) est disponible, mais aucun avis, PV ou acte d'amendement de zonage précis assorti de sa source n'est détectable. `inconnu:no-event-detected`; aucun événement ni delta n'est servi. |

## Villes bloquées — aucun delta servi

| Ville | Événement / garde AVANT-APRÈS | Raison anti-invention |
| --- | --- | --- |
| `alma` | `485-2026` modifie `199-2012`; le servi est `199-2012 / 2012`. `426-2024` comporte aussi un ajout résidentiel ciblé. | Aucune paire de zones exactement résolue avec les deux compteurs de logements verbatim. |
| `chelsea` | `1215-22` abroge `636-05`; le servi `636-05 / 2005` est AVANT. | Refonte : grille APRÈS, correspondance ancien→nouveau exhaustive et deux compteurs ne sont pas acquis. |
| `la-sarre` | Le servi `05-2024 / 2024` abroge et remplace les règlements précédents; il est APRÈS. | Grille prédécesseure et mapping ancien→nouveau absents : pas de compteur AVANT. |
| `mont-saint-hilaire` | Avis d'entrée en vigueur `1235-34` et projet `1235-37`; le servi reste `1235 / 2017`. | Les documents localisés ne fournissent pas une paire de compteurs logements AVANT/APRÈS comparable. |
| `neuville` | La codification `104` intègre des amendements, mais le millésime servi est nul. | Actes ciblés, grilles précédentes et direction Stage 3 indéterminables. |
| `plaisance` | Transition `URB-99-05` / projet `Urb-02-2024`; numéro et millésime servis nuls. | Entrée en vigueur, côté servi et deux grilles indécidables. |
| `saint-amable` | `712-47-2026`, servi `712-00-2013 / 2013`. | Modification de limites et retrait de zone, sans deux compteurs comparables verbatim. |
| `saint-gilbert` | Le projet `U-161-2026` vise `Ra/a-1`; servi `U-08-2014`, millésime nul. | Projet non finalisé, sans grille APRÈS ni compteur de logements; « moyenne densité » n'est pas un compteur. |
| `saint-raymond` | Le servi est APRÈS : `583-15 (am. 922-26) / 2026`; `922-26` crée `HC-14` depuis des portions de `HC-4` et `RX-5`. | Zones mères partielles et hétérogènes; `6-36` est une classe, pas un nombre de logements. |
| `sainte-cecile-de-milton` | Amendements à `560-2017` détectés, dont `659-2024`, `662-2024`, `670-2024`, `675-2025` et `684-2026`; millésime servi nul. | Garde AVANT/APRÈS et deux grilles ciblées par zone indisponibles. |

## Décision

Un seul artefact du shard satisfait actuellement le verrou `readEntries` :
Rimouski. Aucun JSON ne peut être ajouté aux dix blocages tant que les deux
compteurs verbatim et la direction réglementaire ne sont pas établis.
