# Effet densifiant (4a) — SHARD 2/3 — 2026-07-18T08:13:02Z

**SHARD 2/3** — FOCUS trié alphabétiquement, `index % 3 == 2` :
`chelsea`, `levis`, `neuville`, `preissac`, `saint-amable`,
`saint-frederic`, `saint-raymond`, `stratford`.

## Contrôle de la donnée effectivement servie

Lecture S3 de `qc-zonage-<slug>` le 2026-07-18 : les huit collections existent
et n'ont aucun champ `effet_densifiant` plié. Les identités servies sont :

| slug | règlement / millésime servi |
|---|---|
| chelsea | `636-05 / 2005` |
| levis | `RV-2011-11-23 / 2011` |
| neuville | `104 / null` |
| preissac | `239-2014 / null` |
| saint-amable | `712-00-2013 / 2013` |
| saint-frederic | `297-15 / 2015` |
| saint-raymond | `583-15 (am. 922-26) / 2026` |
| stratford | `1035 / null` |

Le verrou `readEntries` de `fold-effet-densifiant.ts` a été relu : un effet
est dérivé des deux compteurs et un compteur nul force `inconnu`. Aucun artefact
`work/effet-densifiant/<slug>.json` ni fold S3 n'est donc justifié ci-dessous.

## Villes SERVIES

Aucune — **0 zone densifiée**. Aucun nombre de logements n'a été inféré d'un
numéro de règlement, d'une classe d'usage ou d'un objectif de densification.

## Inconnu — aucun événement de zonage exact détectable

| slug | constat |
|---|---|
| levis | La grille source servie `RV-2011-11-23` est le seul document identifié dans cette passe; aucun avis/PV ou acte d'amendement avec zone touchée n'est disponible. `inconnu:no-event-detected`. |
| preissac | `Preissac_Zonage_239-2014_MAJ_2015.pdf` est une grille consolidée. « MAJ 2015 » ne constitue ni un numéro d'acte ni une zone touchée. `inconnu:no-event-detected`. |
| saint-frederic | `Zonage_297-15_amende-5.pdf` est une compilation à un seul état; aucun règlement d'amendement source avec zone précise n'est isolé. `inconnu:no-event-detected`. |
| stratford | `STR_GRILLE_20220621.pdf` est l'annexe courante du règlement 1035. La date de fichier ne prouve pas un amendement et aucun événement zoné n'est détecté. `inconnu:no-event-detected`. |

## Événement détecté, delta interdit

| slug | direction et preuve | raison du blocage |
|---|---|---|
| chelsea | La collection est servie `636-05/2005` (AVANT). Le règlement 1215-22 dit : « Le présent règlement abroge le règlement numéro 636-05 [...] tel que modifié par tous ses amendements. » | Refonte territoriale : le mapping exhaustif `636-05 → 1215-22` et les deux compteurs verbatim par zone ne sont pas extraits dans cette lane. `inconnu:refonte-mapping-and-counts-not-extracted`. |
| neuville | Le règlement 104 est une codification « mise à jour le 8 juin 2021 » qui intègre 25 amendements, de 104.1 à 104.34. | La source ne donne qu'un état consolidé; les actes par zone et les grilles AVANT correspondantes ne sont pas acquis. `inconnu:one-sided-codification`. |
| saint-amable | Le règlement 712-47-2026 est entré en vigueur le 12 juin 2026, modifie les limites de H-59 et retire RX-122; le servi reste `712-00-2013/2013` (AVANT). Preuve : `work/coverage/saint-amable-712-47-2026-norms-retire-rx122.json`. | Événement géométrique/retrait de zone sans deux compteurs de logements verbatim pour une zone comparable. `inconnu:counts-not-applicable`. |
| saint-raymond | La collection est déjà APRÈS (`583-15 (am. 922-26)/2026`). L'art. 1 de 922-26 crée HC-14 « à même une partie » de HC-4 et RX-5; l'annexe B ne fournit qu'une classe d'usage `6-36` pour HC-14. | Deux zones-mères hétérogènes et aucun compteur AVANT/APRÈS explicitement comparable; `6-36` n'est pas servi comme nombre de logements. `inconnu:new-zone-no-verbatim-avant`. |

## Sources lues

- Chelsea 1215-22 : `https://www.chelsea.ca/download_file/view/8272/3573`.
- Neuville 104 : `https://www.ville.neuville.qc.ca/storage/app/media/ma-ville/administration-et-finances/reglementation-municipale/reglement-de-zonage-104.pdf`.
- Saint-Raymond 922-26 : `https://villesaintraymond.com/uploads/documents/pieces-jointes/reg.-922-26-adoption.pdf`.

Conclusion : **verbatim-ou-inconnu respecté**; aucune écriture API/S3, aucun
redémarrage de `geo-api`.
