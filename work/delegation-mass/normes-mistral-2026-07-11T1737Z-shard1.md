# NORMES via Mistral — shard 1/4 — 2026-07-11T17:37-04:00

## Périmètre

- Branche demandée : `feat/cadre-acquisition`.
- Sélection figée au démarrage : `coverage-matrix.json`, 282 villes avec `zones.status == done` et `normes.status != done`, triées par slug; 71 slugs où `index % 4 == 1`.
- Moteurs d'extraction utilisés exclusivement : Mistral OCR 4.0 et Mistral `document_annotation` (`mistral-schema`). Aucun GPT/Codex n'a servi à extraire une grille.
- Chaque commande payante a utilisé un budget maximal de 1 USD par ville, un dépôt parquet-only et une limite murale de 350 secondes.
- Le worktree était massivement sale avant cette passe. Les changements partagés, `.claude` et `.track` n'ont pas été touchés.

## Dépôt net

| Slug | Source officielle | Moteur | Codes | Overlap SIG | Champs publiés | Coût |
|---|---|---|---:|---:|---:|---:|
| `chute-aux-outardes` | Règlement 401-2015 VPlus, pages 400–414 | Mistral OCR 4.0 + texte natif | 44 | 36/79 | 11,4 % | 0,013 USD |

Objet parquet créé : `registry/qc-zonage-norms/qc-zonage-norms-chute-aux-outardes.parquet`.

Tous les gates ont passé : au moins trois codes verbatim, overlap SIG non nul, champs publiés non nuls, sortie verbatim-ou-null. La fusion de manifeste a ensuite été refusée par le contrôleur externe pour limite d'usage jusqu'à 22:10; les joins et l'enrichissement ne pouvaient donc pas être lancés honnêtement.

## Rejets anti-invention

| Slug | Route/fenêtre | Preuve du gate | Coût observé |
|---|---|---|---:|
| `saint-remi-de-tingwick` | OCR 1–20, puis schema 1–20 | OCR: fichier Mistral expiré; schema: 54 codes, 39,6 % de champs, overlap 0/26 | 0,060 USD |
| `saint-alexandre-de-kamouraska` | OCR 1–80 puis page 133 | 0 zone aux deux passes | 0,081 USD |
| `saint-lazare` | OCR 1–9 | 0 zone | 0,009 USD |
| `lassomption` | schema 28–34 | 4 pseudo-codes, 0 % de champs, overlap 0/359 | 0,021 USD |
| `sainte-praxede` | schema 82–89 | 5 codes Va–Ve et 40 % de champs, mais overlap 0/42 | 0,024 USD |
| `princeville` | OCR auto 211–215 puis schema 51–125 | OCR: 15 codes, overlap 0/116; schema: 0 zone | 0,230 USD |
| `pont-rouge` | OCR page 181 | 0 zone | 0,001 USD |
| `sainte-anne-des-plaines` | OCR annexe A, page unique | 6 codes, `publishedFieldPct=0` | 0,001 USD |
| `saint-augustin-de-desmaures` | schema 157–261 | 99 codes, 10 % de champs, overlap 0/10 | 0,315 USD |
| `valcourt--le-val-saint-francois--2` | schema PDF direct 1–18 | 66 codes, overlap 7/20, mais `publishedFieldPct=0` | 0,054 USD |
| `fugereville` | OCR puis schema, règlement complet | OCR: 0 zone; schema: 14 codes, overlap 5/29, mais `publishedFieldPct=0` | 0,220 USD |
| `laverlochere-angliers` | OCR 1–72 | 0 zone | 0,072 USD |
| `saint-edouard-de-fabre` | OCR 1–74 | 0 zone | 0,074 USD |
| `saint-joseph-de-coleraine` | OCR 1–80 | 0 zone | 0,080 USD |
| `mont-carmel` | OCR 1–80 | 0 zone | 0,080 USD |
| `perce` | OCR 75–208 | 2 codes seulement, sous le gate de trois; overlap 1/194 | 0,134 USD |
| `notre-dame-des-prairies` | OCR auto 94–110 | 0 zone | 0,017 USD |

Coût Mistral observé de la passe : environ 1,486 USD au total; aucune ville n'a dépassé 0,315 USD.

## Découverte

- Crawler 2-hop, lot 1 de 15 : seulement `courcelles-saint-evariste`, `adstock` et `dunham` étaient dans la registry PV; aucune grille confirmée. Les 12 petites municipalités absentes de la registry n'ont pas été prétendues explorées par ce crawler.
- Crawler 2-hop, lot 2 : `lassomption` et `notre-dame-des-prairies` sans candidat; `princeville` a reconfirmé le règlement officiel et la fenêtre 51–125. Le crawl s'est enlisé sur le portail mutualisé pour `nantes` et a été interrompu avant la borne de six minutes; aucun manifeste incomplet n'a été utilisé.
- Portail MRC Témiscamingue : trois règlements officiels réutilisés ensemble (`fugereville`, `laverlochere-angliers`, `saint-edouard-de-fabre`). La famille contient des codes mais aucune norme publiable dans les fenêtres/documents testés.
- Une recherche Web officielle supplémentaire pour `normandin`, `saint-malo` et `sainte-brigitte-des-saults` a été refusée par le contrôleur externe pour limite d'usage. Aucun contournement n'a été tenté.

## Reliquat du shard figé

Les 71 slugs initiaux étaient : `adstock`, `authier-nord`, `beaulac-garthby`, `berry`, `caplan`, `chute-aux-outardes`, `courcelles-saint-evariste`, `dunham`, `entrelacs`, `fermont`, `fugereville`, `grand-metis`, `honfleur`, `ivry-sur-le-lac`, `la-redemption`, `la-visitation-de-yamaska`, `lac-megantic`, `lassomption`, `laverlochere-angliers`, `les-hauteurs`, `lile-du-grand-calumet`, `maria`, `mont-carmel`, `nantes`, `normandin`, `notre-dame-des-prairies`, `padoue`, `perce`, `pont-rouge`, `princeville`, `remigny`, `roxton-falls`, `saint-alexandre-de-kamouraska`, `saint-anaclet-de-lessard`, `saint-augustin-de-desmaures`, `saint-calixte`, `saint-celestin--nicolet-yamaska--2`, `saint-cyrille-de-lessard`, `saint-dominique-du-rosaire`, `saint-edouard-de-fabre`, `saint-elzear--bonaventure`, `saint-epiphane`, `saint-felix-de-kingsey`, `saint-gabriel`, `saint-hilaire-de-dorset`, `saint-isidore--roussillon`, `saint-jean-de-brebeuf`, `saint-joseph-de-coleraine`, `saint-julien`, `saint-lazare`, `saint-louis-de-gonzague--les-etchemins`, `saint-malo`, `saint-marcellin`, `saint-michel-du-squatec`, `saint-patrice-de-beaurivage`, `saint-pie`, `saint-pierre-de-la-riviere-du-sud`, `saint-remi-de-tingwick`, `saint-simon`, `saint-venant-de-paquette`, `sainte-angele-de-merici`, `sainte-anne-des-plaines`, `sainte-brigitte-des-saults`, `sainte-flavie`, `sainte-gertrude-manneville`, `sainte-lucie-de-beauregard`, `sainte-praxede`, `senneterre--la-vallee-de-lor`, `trecesson`, `valcourt--le-val-saint-francois--2`, `yamaska`.

Le shard n'est pas épuisé. La cause d'arrêt est externe et vérifiable : refus de toute nouvelle opération réseau jusqu'à 22:10. Les étapes prioritaires à la reprise sont la fusion du manifeste, les deux joins de `chute-aux-outardes`, puis la découverte/extraction du reliquat non traité.
