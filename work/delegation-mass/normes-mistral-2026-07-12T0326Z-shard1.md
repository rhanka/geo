# Normes via Mistral — shard 1/4

Date : 2026-07-12T03:26Z  
Sélection : `Object.keys(coverage-matrix.cities).sort()`, index `% 4 == 1`  
Cibles : `zones.status == done` et `normes.status != done`  
Moteur : Mistral OCR-4.0 / `document_annotation` `mistral-schema` uniquement  
Dépôt : Parquet-only pendant les extractions, puis `zonage-norms-manifest-merge.ts --apply`.

## Supervision

- `loop-supervise.ts` exécuté au début, entre les lots et en fin.
- État final observé : `SCOREBOARD /1106 : normes=649`, `zones=818`.
- Aucun fichier `.claude` ou `.track` touché par cette mission.
- Le runner `tsx` nécessitait l’autorisation d’exécution hors sandbox pour son tube IPC temporaire ; aucune clé n’a été imprimée.

## Dépôts Mistral validés

| slug | source officielle | route | pages | zones | champs publiés | overlap SIG | coût annoncé | aval |
|---|---|---|---:|---:|---:|---:|---:|---|
| `dosquet` | `https://www.municipalitedosquet.com/wp-content/uploads/2022/09/Dosquet_ZONAGE_final-245-2013.pdf` | `mistral-schema` | 135 | 4 | 78,1 % | 4 | 0,003 USD | join 855 lots puis enrichissement OK |
| `lery` | `https://www.lery.ca/images/articles/urbanisme/reglements/R%C3%A8glement_2017-464_Grilles.pdf` | `mistral-schema` | 1–83 | 86 | 55,4 % | SIG indisponible (`gridFound=false`, 0 code) | 0,249 USD | pas de zones S3 trouvées sous `lery`, join sauté honnêtement |
| `perce` | `https://ville.perce.qc.ca/wp-content/uploads/2022/05/Zonage_436-2011_Perce_codification-admin_20220428.pdf` | `mistral-schema` | 177 | 41 | 11,0 % | 38 | 0,003 USD | join 1 484 lots puis enrichissement OK |

Parquets confirmés :

- `registry/qc-zonage-norms/qc-zonage-norms-dosquet.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-lery.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-perce.parquet`

La fusion de manifeste a été appliquée après Dosquet et Léry. Lors de la fusion après Percé, le Parquet Percé était déjà présent dans le manifeste partagé ; aucune entrée existante n’a été supprimée. Les lignes `registry` signalées par le merge sont le résidu de l’énumération S3, pas une ville.

## Garde-fous et échecs documentés

- `dosquet` OCR fenêtre par défaut : rejeté (2 codes, overlap 0) ; schéma sur la page image de l’annexe 2 : validé.
- `denholm` : PDF officiel confirmé ; OCR 80 pages = 3 codes mais `publishedFieldPct=0`, rejeté ; schéma pages 133–134 = 0 code, rejeté.
- `mont-carmel` : schéma page 229 = 0 code ; vision Mistral page 229 = 0 code concordant, rejeté.
- `pont-rouge` : 10 codes de catégories (`COM-01`, `RES-01`, etc.), champs 76,3 %, overlap 0/77, rejeté.
- `saint-elzear-de-temiscouata` : 5 codes de catégories, champs 60 %, overlap 0/27, rejeté.
- `princeville` : annexe J pages 293–294, 0 code, rejeté.
- `dupuy` : annexe page 99, 1 code `92`, 0 champ publié, rejeté.
- `lassomption` : annexe B pages 3–4, 0 code, rejeté.
- `senneterre--la-vallee-de-lor` : 4 catégories (`RU`, `RE`, `RC`, `REX`), overlap 0/124 et 0 champ publié, rejeté.
- `trois-rivieres` : 3 catégories (`I`, `J`, `R`), overlap 0/1664, rejeté.
- `saint-didace` : le PDF local et la source officielle sont un plan d’annexe A, pas une grille de normes ; aucun appel de dépôt.
- `valcourt--le-val-saint-francois--2` : le PDF local est le règlement de base, alors que l’URL de grille enregistrée pointe vers un autre fichier ; écarté pour éviter de croiser deux documents.
- `notre-dame-des-prairies` : ancienne URL 2025-07 HTTP 404 ; l’URL 2025-12 est bien un PDF de 110 MB, mais son traitement de 182 pages a été interrompu avant 6 minutes sans dépôt.
- Premier lot `authier-nord, berry, biencourt, champneuf, chazel, courcelles-saint-evariste, denholm, dosquet, dupuy, esprit-saint, fort-coulonge, fugereville, grand-saint-esprit, la-visitation-de-yamaska, lac-delage` : découverte multi-sauts du crawler ; 4 communes du registre ont été sondées sans PDF confirmé, et les autres ne sont pas dans le registre. Les sites officiels ont été consultés pour le fallback ; aucune URL de grille confirmée n’a été déposée pour les résidus.

## Autres résidus inspectés

L’inventaire read-only du shard comptait 27 PDFs locaux parmi 74 cibles encore éligibles au dernier passage. Les URLs déjà enregistrées ont été réutilisées lorsque leur signature HTTP était `%PDF` et leur fenêtre de grille identifiable. Les fichiers sans provenance officielle exploitable (`saint-alphonse`, `saint-cyrille-de-lessard`, `saint-edouard-de-fabre`, `saint-flavie`, etc.) restent sans dépôt ; aucune URL n’a été inventée.

## Coût Mistral de ce passage

Coût annoncé par les runners pour les routes ayant produit une réponse : environ `0,35 USD` pour les extractions principales déposées ou gateées, hors tentative Notre-Dame interrompue. Aucun budget de ville n’a dépassé 1 USD.
