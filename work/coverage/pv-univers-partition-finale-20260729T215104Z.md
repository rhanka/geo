# Partition finale de l'univers PV CAS

Généré (UTC) : 2026-07-29T21:51:07.563Z

Population ancrée sur `work/coverage/pv-graphify-semantic-real-universe-20260729-snapshot-01.json` : **6382** clés CAS. La priorité finale est : INDEXED > CONTAMINATION_OWNER_MISMATCH > OWNER_NOT_CONFIRMED > GRAPHIFY_FAILED > DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED > VISUALLY_UNREADABLE > CAS_SHA_MISMATCH > UNKNOWN_NO_TERMINAL_PV_MANIFEST > UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE. L'état final prime donc sur le parcours.

| Verdict final | Clés CAS |
|---|---:|
| INDEXED | 5492 |
| CONTAMINATION_OWNER_MISMATCH | 53 |
| OWNER_NOT_CONFIRMED | 337 |
| GRAPHIFY_FAILED | 0 |
| DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED | 417 |
| VISUALLY_UNREADABLE | 0 |
| CAS_SHA_MISMATCH | 0 |
| UNKNOWN_NO_TERMINAL_PV_MANIFEST | 83 |
| UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE | 0 |
| UNCLASSIFIED_NO_TERMINAL_VERDICT | 0 |
| **TOTAL** | **6382** |

Verdicts multiples : **186** clés ont au moins deux verdicts distincts; **243** ont au moins deux observations terminales. Parcours dominant : `DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED -> INDEXED` (170).

Contrôle du total naïf des rapports Graphify : **6464 - 6382 = 82**; ces 82 observations en trop portent sur 81 clés déjà présentes. La lecture visuelle est un mécanisme distinct : 186 observations dans cet univers (185 INDEXED, 1 OWNER_NOT_CONFIRMED), dont 15 ont ensuite été rejouées par Graphify. Toutes sources confondues, l'historique contient 268 observations de plus que la partition. 0 lecture(s) visuelle(s) hors univers ont été exclues.

Couverture municipale : **174/1106** municipalités ont au moins un PV indexé.

Écart de partition : **aucun**.
