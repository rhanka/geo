# Effet densifiant (4a) — SHARD 1/2 — 2026-07-18T08:17:01Z

Périmètre strict : liste FOCUS triée, `index % 2 == 1` :
`champlain`, `cowansville`, `levis`, `mont-tremblant`,
`petite-riviere-saint-francois`, `preissac`, `rosemere`,
`saint-charles-borromee`, `saint-frederic`,
`saint-mathieu-de-beloeil`, `sainte-catherine`, `stratford`.

## Villes SERVIES

| Ville | Zones densifiées | État vérifié |
| --- | ---: | --- |
| `cowansville` | 0 | `CBB-1` : 4 → 4, `stable`; artefact existant et OGC relu à `https://api.geo.sent-tech.ca/collections/qc-zonage-cowansville/items?limit=2000`. |
| `saint-charles-borromee` | 0 | `P9` : 24 → 24, `stable`; artefact existant et OGC relu à `https://api.geo.sent-tech.ca/collections/qc-zonage-saint-charles-borromee/items?limit=2000`. |

Ces deux plis existaient déjà (`24ef77b`, `f7e0346`). Les artefacts respectent la
dérivation obligatoire de `readEntries`; aucun nouvel artefact ou fold n'était
fondé dans ce shard.

## Inconnu — aucun événement de zonage final détectable

| Ville | Règlement servi / contrôle | Constat |
| --- | --- | --- |
| `levis` | `RV-2011-11-23 / 2011` | Une seule grille locale; aucun avis/PV ou règlement d'amendement zoné à deux côtés n'est disponible. `inconnu:no-event-detected`. |
| `mont-tremblant` | `2008-102 / 2008` | Les annexes locales sont toutes celles du règlement servi. Les signaux 2026 sont au stade `avis_motion` et ne constituent pas un règlement de zonage entré en vigueur avec zone et grille APRÈS. `inconnu:no-final-zoning-event-detected`. |
| `preissac` | `239-2014 / millésime non établi` | La codification `MAJ 2015` n'identifie ni acte d'amendement ni zone; aucun événement exact ne passe le pré-gate. `inconnu:no-event-detected`. |
| `rosemere` | `801 / 2011` | La grille R-801 consolidée est le seul corpus acquis. Le signal de pôle régional est au stade `avis_motion`, sans règlement zoné final ni seconde grille. `inconnu:no-final-zoning-event-detected`. |
| `saint-frederic` | `297-15 / 2015` | La grille « amendé-5 » est une consolidation; le prétendu côté précédent est une page HTML 404, pas un acte/grille. `inconnu:no-event-detected`. |
| `stratford` | `1035 / millésime null` | L'annexe courante confirme seulement le règlement 1035; aucun acte d'amendement zoné et daté ni paire de grilles n'est publié. `inconnu:no-event-detected`. |

## Événement détecté, mais delta interdit

| Ville | Événement / garde | Raison anti-invention |
| --- | --- | --- |
| `champlain` | La codification 2009-03 mentionne `2012-03`: agrandissement de `122-R` pour des habitations multifamiliales d'un maximum de 8 logements. | Aucun compteur AVANT ni grille pré-2012; le code servi est `R-122`, non `122-R`, et aucune canonicalisation réglementaire ne permet de les joindre. `inconnu:predecessor-count-and-exact-zone-unresolved`. |
| `petite-riviere-saint-francois` | Projet 783 modifiant 603. | Pas d'entrée en vigueur ni de compteurs de logements par zone; millésime servi nul, donc garde AVANT/APRÈS indécidable. `inconnu:project-not-in-force-and-counts-unavailable`. |
| `saint-mathieu-de-beloeil` | La grille 2026 porte les amendements `22.10.02.23` et `22.10.07.24`; les avis 2026 restent au stade motion/projet. | La collection servie ne donne que `08.09` et un millésime nul; actes ciblés, zones touchées et deux compteurs verbatim ne sont pas isolés. `inconnu:served-millesime-missing-and-event-scope-unresolved`. |
| `sainte-catherine` | `2009-Z-94`, en vigueur le 30 juin 2026. | L'acte ajuste la superficie maximale de bâtiments mixtes dans des zones non nommées; aucun compteur « logement » AVANT/APRÈS. `inconnu:counts-not-extractable`. |

## Contrôles

- Pré-gate local effectué sur les dix slugs non déjà servis : provenance du
  règlement, corpus `work/zonage-norms` et recherche de second côté.
- Les passages/événements ci-dessus ont été confrontés aux rapports sourcés
  existants de la lane; aucun nombre n'est déduit d'un numéro, d'une année, d'un
  titre ou d'un signal Steve.
- Lecture OGC réussie pour les deux résultats déjà servis. Aucun redémarrage de
  `geo-api` et aucune écriture S3 n'ont été effectués.
