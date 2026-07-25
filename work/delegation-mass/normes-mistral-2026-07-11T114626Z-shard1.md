# Normes Mistral — shard 1/4 — 2026-07-11T11:46:26Z

## Périmètre

- Branche : `feat/cadre-acquisition`.
- Shard figé au démarrage : villes de `coverage-matrix.json` avec `zones.status=done` et `normes.status!=done`, liste triée, indices où `index % 4 == 1` (73 slugs).
- Extraction payante exclusivement Mistral : `mistral-ocr-4-0` et `mistral-schema` (`document_annotation`). Aucun GPT/Codex utilisé comme moteur d'extraction.
- Dépôts parquet-only, puis fusion explicite du manifeste.
- Gates stricts conservés : au moins 3 codes, overlap SIG non nul, champs publiés non nuls, cellules verbatim-or-null.
- Le worktree était massivement sale au démarrage; `.claude`, `.track` et les modifications partagées n'ont pas été touchés ni inclus dans le périmètre de commit.

## Dépôts nets

| Slug | Source officielle | Moteur | Codes | Overlap SIG | Champs publiés | Coût observé |
|---|---|---|---:|---:|---:|---:|
| `sainte-luce` | Annexe 2, grille des normes d'implantation R-2025-411, API publique VPlus | Mistral schema | 106 au parquet fusionné | 104/104 | 59 % au manifeste | environ 0,040 USD, reprises comprises |
| `sainte-marie-madeleine` | six grilles VPlus officielles, zones 101–513, composées avec sidecar page→source | Mistral OCR 4.0 | 29 | 28/40 | 30,2 % | 0,013 USD |
| `ristigouche-sud-est` | Annexe 2 — grilles de spécifications du règlement 2022-002, API publique VPlus | Mistral schema | 23 | 22/22 | 57,1 % | 0,105 USD, rapport et reprise compris |

Coût Mistral connu de cette passe : environ 0,158 USD; aucune ville n'approche le plafond de 1 USD.

### Sainte-Luce

- OCR simple : 108 codes, overlap 104/104, mais `publishedFieldPct=0`; rejet sans dépôt.
- Schéma transposé : gate OK. Le parquet a été déposé par la première commande, dont la session avait continué après le premier retour de terminal; la reprise a confirmé l'idempotence.
- Fusion manifeste : 618 → 619, `sainte-luce` ajoutée.
- `lot-zone-join-run` : 2 466 lots, 100 % assignés, match normes 100 %, sans normes 0 %.
- `lots-enriched-run` : 2 466 lots, zones 100 %, normes 100 %, surface 100 %, code postal 100 %, adresse 99,03 %, dépôt vérifié.

### Sainte-Marie-Madeleine

- Six PDF officiels VPlus confirmés `%PDF`, composés en 13 pages; provenance détaillée dans `grille-perzone.json`.
- OCR Mistral : gate OK et dépôt parquet direct.
- Fusion manifeste : 619 → 620, `sainte-marie-madeleine` ajoutée.
- `lot-zone-join-run` : 1 612 lots, 99,63 % assignés, match normes 100 %, sans normes 0 %.
- `lots-enriched-run` : 1 612 lots, zones/normes 99,63 %, surface 100 %, code postal 100 %, adresse 91,56 %, dépôt vérifié.

### Ristigouche-Sud-Est

- OCR simple rejeté : 4 pseudo-codes (`NOMBREMAXIMALDELOGEMENTS`, `0`, `3`, `1`), overlap 0.
- Schéma transposé : gate OK; passe de dépôt à 23 codes, overlap 22/22, champs 57,1 %.
- Fusion manifeste : 620 → 622; `ristigouche-sud-est` ajouté. Le merge a aussi intégré un parquet concurrent `sainte-monique--nicolet-yamaska`, non revendiqué et non retraité ici.
- `lot-zone-join-run` : 430 lots, 100 % assignés, match normes 100 %, sans normes 0 %.
- `lots-enriched-run` : 430 lots, zones/normes 100 %, surface 100 %, code postal 100 %, adresse 96,51 %, dépôt vérifié.

## Découverte et preuves d'échec

- Crawler 2-hop sur 15 slugs : seulement 3 présents dans la registry PV; aucune grille confirmée et aucun manifeste final. Cela confirme que le crawler seul ne couvre pas les petites municipalités.
- Portail VPlus Sainte-Luce : annexe de normes dédiée trouvée et déposée.
- Portail VPlus Sainte-Marie-Madeleine : six grilles par blocs trouvées, composées et déposées.
- Portail VPlus Ristigouche-Sud-Est : annexe 2 dédiée trouvée et déposée.
- `saint-godefroi` : PDF local = projet d'amendement de trois pages; il dit explicitement que la grille des spécifications n'est pas touchée. Aucun coût Mistral.
- `saint-martin` : règlement de base 304-2006 confirmé, 111 pages; annexes A–C agricoles seulement, aucune grille par zone. Aucun coût Mistral.
- `beaulac-garthby` : règlement officiel confirmé, classé `reglement`, aucune grille détectée.
- `chute-aux-outardes` : règlement officiel confirmé et classé `grille/multizone`; extraction non lancée, car l'approbation Mistral a été refusée pour limite d'usage jusqu'à 12:06.
- `notre-dame-de-stanbridge` : règlement officiel confirmé et classé `grille/multizone`; même blocage d'approbation, aucune tentative de contournement.

## État final

- Trois dépôts nets Mistral, tous fusionnés et propagés aux lots enrichis.
- Deux prochaines grilles productibles déjà téléchargées et classifiées : `chute-aux-outardes`, `notre-dame-de-stanbridge`.
- Clé parasite `registry` toujours signalée par le merge comme absente; elle n'a bloqué aucune fusion valide.
