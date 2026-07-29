# Régulations INCONNUE — sondage adversarial

Généré en UTC: 2026-07-29T03:02:32Z

Population: 1401 `INCONNUE` sur 2045 `Regulation`; 644 qualifiées (31.49 %). Échantillon pseudo-aléatoire reproductible: 40 occurrences sur 15 municipalités, graine `pv-inconnues-sample/v1`.

| Cause | Compte |
|---|---:|
| `a` ABSENCE_VRAIE_MENTION_NUE | 15 |
| `b` PORTEE_HORS_FENETRE | 5 |
| `c` VOCABULAIRE_STATUT_NON_RECONNU | 19 |
| `d` OPERATEUR_PDF_SEPARE | 1 |
| `e` AUTRE | 0 |

Cause dominante du tirage: `c` (19/40). Exemple verbatim: [work/graphify/pv-semantic-20260728T220136Z/dolbeau-mistassini/f08496638483.pdf/input/document.txt:427] « AVIS DE MOTION - RÈGLEMENT NUMÉRO 1959-24 CRÉANT UNE RÉSERVE ».

`INCONNUE` n’est donc pas majoritairement un verdict honnête dans ce tirage: 15/40 sont des absences vraies, contre 25/40 avec portée, vocabulaire ou extraction à traiter. Cela ne signifie jamais « adopté » ou « en vigueur »: avis de motion, projet, adoption, certificat et entrée en vigueur restent distincts; aucun PV seul ne permet ici de fabriquer une date d’entrée en vigueur.

Aucune extrapolation à 1 401 n’est faite: les marqueurs `c` sont juridiquement hétérogènes. Remontée au conducteur: élargir portée/vocabulaire et préserver la rupture PDF, sans modifier la lane concurrente ici.
