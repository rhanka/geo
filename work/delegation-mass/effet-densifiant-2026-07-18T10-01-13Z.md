SHARD 0/2 — liste FOCUS triée, `index % 2 == 0`

# Effet densifiant (4a) — 2026-07-18T10:01:13Z

Périmètre exclusif : `alma`, `chelsea`, `la-sarre`, `mont-saint-hilaire`,
`neuville`, `plaisance`, `rimouski`, `saint-amable`,
`saint-come-liniere`, `saint-gilbert`, `saint-raymond`,
`sainte-cecile-de-milton`.

## Villes SERVIES

| Ville | Zones densifiées | Compteurs et vérification |
| --- | ---: | --- |
| `rimouski` | 1 | `H-3018`: `1 → 16`, donc `densifie`, de `820-2014/2014` à `24-018/2024`. L'artefact versionné cite les deux passages verbatim. Le fold a écrit la clé S3 servie et l'API OGC publique retourne `densite_avant=1`, `densite_apres=16`, `effet_densifiant=densifie`. |

## Villes `inconnu-sans-event`

| Ville | Constat |
| --- | --- |
| `saint-come-liniere` | Corpus disponible : grille consolidée à date du 22 septembre 2021. Aucun avis, PV ou acte d'amendement de zonage précis, avec source exploitable, n'est détectable. |

## Villes bloquées — aucun delta servi

| Ville | Événement ou garde AVANT/APRÈS | Raison anti-invention |
| --- | --- | --- |
| `alma` | `485-2026` modifie `199-2012`; grille servie `199-2012/2012`. | Les reclassements par portions n'offrent pas une paire de zones univoque avec deux compteurs de logements verbatim. |
| `chelsea` | `1215-22` remplace `636-05`; la grille servie est `636-05/2005`. | Refonte : grille après, correspondance ancien→nouveau exhaustive et deux compteurs ne sont pas acquis. |
| `la-sarre` | `05-2024/2024` est la refonte servie. | Grille antérieure et correspondance ancien→nouveau absentes. |
| `mont-saint-hilaire` | `1235-34` est entré en vigueur le 22 juin 2026; il modifie les limites de `H-96`, `H-97`, `H-97-1` et `PE-15`. | Documents de limites, sans deux grilles et deux compteurs de logements comparables. |
| `neuville` | Codification `104`, mais millésime servi nul. | Côté servi et direction Stage 3 indécidables; aucun acte ciblé avec les deux grilles. |
| `plaisance` | Transition `URB-99-05` / projet `Urb-02-2024`; métadonnées servies nulles. | Entrée en vigueur, côté servi et deux grilles non établis. |
| `saint-amable` | `712-47-2026`; grille servie `712-00-2013/2013`. | Limites/retrait de zone sans paire de compteurs logements verbatim comparable. |
| `saint-gilbert` | Projet `U-161-2026` pour `Ra/a-1`; millésime servi nul. | Projet non finalisé, aucune grille après ni compteur; « moyenne densité » n'est pas un nombre de logements. |
| `saint-raymond` | La grille servie est après : `583-15 (am. 922-26)/2026`; `922-26` crée `HC-14` à partir de portions de `HC-4` et `RX-5`. | Deux zones-mères partielles hétérogènes : `6-36` est une classe, non un compteur unique avant/après projetable sur `HC-14`. |
| `sainte-cecile-de-milton` | Amendements `659-2024`, `662-2024`, `670-2024`, `675-2025` et `684-2026` détectés sur `560-2017`; millésime servi nul. | Garde AVANT/APRÈS et grilles ciblées par zone indisponibles. |

## Contrôles exécutés

- `readEntries` impose que l'effet soit dérivé des deux compteurs; aucun compteur nul n'est converti en densification.
- Le pré-gate S3 a relu les identités de règlement des 12 grilles servies.
- Depuis `acquisition/`, le dry-run Rimouski a apparié `H-3018` sur la clé servie; le fold réel a ensuite écrit cette clé, sans redémarrage de `geo-api`.
- Vérification OGC : `curl -s https://api.geo.sent-tech.ca/collections/qc-zonage-rimouski/items?limit=2000`, puis lecture de `H-3018` : `1`, `16`, `densifie`, `820-2014`, `24-018`.
