# Triage dette "normes pliées manquantes" — focus-30 — 2026-07-24

Lane READ-ONLY : aucune écriture S3, aucun re-fold exécuté. `levis` (30 165) exclu — déjà jugé non fermable (voir `immo-steve-score-tranche-10-to-6-20260723.md`).

## Méthode et sources (autorité)

- **Grille servie** : `registry/qc-zonage-norms/manifest.json` (S3, lu via `_norms-manifest-entry.ts` et un peek dédié `_norms-manifest-crossval-peek.ts`, tous deux read-only). C'est l'autorité — pas `coverage-matrix.json` (mémoire `norms-manifest-is-authority`).
- **Couverture des codes** : `crossval.recoupSig` de l'entrée manifest = `overlap / sigZoneCodes` (codes de la grille présents ∩ univers des codes SIG de la ville).
- **Norms actuel des lots** : `foldedNormesPct` de `work/coverage/immo-folded-normes-city-matrix.json` (dérivé d'`immo-lots.json`, sha256 `fe9f45…` du 2026-07-19, cf. fichier).
- **Gain estimé (approximatif)** = `servedLots × recoupSig − foldedNormesLots`, plafonné à `[0, missing]`. C'est une ESTIMATION à valider en dry-run (audit-after) — pas une mesure. Deux mécanismes de régression connus la rendent peu fiable en aveugle : (1) `--simplify-zones-m` a fait exploser `outside_all` sur 3 villes lors d'un refold antérieur ; (2) plusieurs villes ci-dessous montrent un fold ACTUEL supérieur à ce que la grille LIVE peut justifier — signe qu'une grille plus large a été remplacée par une grille plus mince lors d'un re-dépôt (mémoire `reglprov-redepot-zones-efface-le-stamp`, même famille de piège).

## Tableau par ville

| Ville | Grille servie | Codes grille/SIG (recoupSig) | Norms lots actuel | Dette (missing) | Gain estimé | Verdict |
|---|---|---:|---:|---:|---:|---|
| saint-amable | oui | 95/104 (91.3%) | 72.74% | 1 421 | **~969** | FERMABLE-REFOLD |
| mont-saint-hilaire | oui | 168/170 (98.8%) | 89.24% | 920 | **~819** | FERMABLE-REFOLD |
| saint-frederic | oui | 6/6 (100%) | 23.63% | 795 | **~795** | FERMABLE-REFOLD |
| petite-riviere-saint-francois | oui | 101/127 (79.5%) | 59.25% | 1 115 | **~555** | FERMABLE-REFOLD |
| neuville | oui | 77/127 (60.6%) | 59.24% | 1 258 | ~43 | FERMABLE-PARTIEL (plafond quasi atteint) |
| la-sarre | oui | 76/132 (57.6%) | 58.74% | 1 747 | ~0 | FERMABLE-PARTIEL (plafond atteint) |
| sainte-catherine | oui | 49/190 (25.8%) | 44.26% | 3 207 | ~0 | ⛔ ANOMALIE (fold > grille live) |
| saint-charles-borromee | oui | 2/136 (1.5%) | 27.66% | 3 704 | ~0 | ⛔ ANOMALIE (fold > grille live) |
| hemmingford--…--2 | oui | 0/38 (0%) | 31.83% | 1 103 | ~0 | ⛔ ANOMALIE (fold > grille live) |
| coaticook | oui | 30/203 (14.8%) | 86.37% | 554 | ~0 | ⛔ ANOMALIE FORTE (fold≫grille live) |
| alma | oui | 20/1059 (1.9%) | 87.02% | 1 536 | ~0 | ⛔ ANOMALIE FORTE (fold≫grille live) |
| rimouski | oui | 6/2134 (0.28%) | 0.13% | 9 691 | ~14 | ACQUISITION-ÉQUIVALENTE (grille stub) |
| sainte-cecile-de-milton | oui | 1/32 (3.1%) | 1.45% | 1 496 | ~25 | ACQUISITION-ÉQUIVALENTE (grille 1 ligne) |
| saint-boniface | oui¹ | gridFound=**false** | 0.03% | 3 841 | ~0 | ACQUISITION-ÉQUIVALENTE (SIG non matché) |

¹ Grille déposée (5 lignes/codes, `codex/gpt-5.5-vision`, 2026-07-09) mais `crossval.gridFound=false` en dernier calcul enregistré — aucun layer SIG de zonage matché pour croiser. À vérifier côté lane zonage avant tout refold.

**Point notable : les 14 villes ont TOUTES une grille `qc-zonage-norms-<slug>` servie** (confirmé au manifest S3, pas de `NOT-IN-MANIFEST`). Aucune n'est un cas de "pas de grille" au sens strict — mais 8 des 14 ont une grille fonctionnellement inutile (couverture de codes trop faible ou incohérente avec le fold déjà en place).

## Groupe ⛔ ANOMALIE — ne pas refold avant investigation

5 villes où le **fold actuel dépasse ce que la grille live peut justifier** : `alma` (87.0% folded vs 1.9% recoupSig), `coaticook` (86.4% vs 14.8%), `hemmingford--les-jardins-de-napierville--2` (31.8% vs 0%), `saint-charles-borromee` (27.7% vs 1.5%), `sainte-catherine` (44.3% vs 25.8%). Hypothèse la plus probable : un re-dépôt a remplacé une grille plus large par une grille plus mince (le fold existant vient d'une version antérieure du produit `qc-zonage-norms`). Une tentative de recalcul crossval (`zonage-norms-crossval-refresh.ts --slug alma,coaticook`, DRY-RUN, non appliqué) a d'ailleurs donné des chiffres incohérents avec l'entrée manifest actuelle (alma : overlap 20→804 avec `extractedZoneCodes` 20→876 sur le MÊME parquet — écart x44 non expliqué, à ne pas utiliser tel quel). **Un refold sur ces 5 villes risque de régresser le fold déjà acquis.** Action recommandée : auditer l'historique de dépôt (`deposited_at`, versions antérieures du parquet) avant tout dry-run de refold. Sous-cas `hemmingford--2` : sa sœur `hemmingford--les-jardins-de-napierville` (sans `--2`) a une bonne grille (78/89 = 87.6%) — vérifier si un mauvais routage de slug explique le stub à 3 lignes / 0 overlap du `--2`.

## Classement FERMABLE-REFOLD (prêtes pour dry-run mesuré), triées par gain estimé

| # | Ville | Gain estimé | % de la dette | Grille (méthode / codes / sig) |
|---:|---|---:|---:|---|
| 1 | saint-amable | ~969 | 68% | mistral-vision, 111 codes / sig 104, overlap 95 |
| 2 | mont-saint-hilaire | ~819 | 89% | codex/gpt-5.5-vision, 250 codes / sig 170, overlap 168 |
| 3 | saint-frederic | ~795 | 100% | ocr/mistral-schema, 42 codes / sig 6, overlap 6 |
| 4 | petite-riviere-saint-francois | ~555 | 50% | native-text/grille-spec, 101 codes / sig 127, overlap 101 |

Gain cumulé estimé des 4 villes prêtes : **~3 138 lots** sur une dette de 4 251 (≈74%). `neuville` (~43) et `la-sarre` (~0) sont à plafond de grille quasi atteint — refold à faible ROI, non prioritaire.

**Contrainte anti-régression (rappel explicite du donneur d'ordre)** : le re-fold via `lot-zone-join-run` + `lots-enriched-run` a déjà régressé 3 villes avec `--simplify-zones-m` (`outside_all` explosé). Pour CHACUNE des 4 villes ci-dessus : mesurer d'abord en **DRY-RUN (audit-after)**, comparer `outside_all` avant/après, et NE PAS utiliser `--simplify-zones-m` sans validation — avant tout dépôt réel.

## Bilan dette (32 388 lots, hors levis)

| Groupe | Dette | Gain réaliste aujourd'hui |
|---|---:|---:|
| FERMABLE-REFOLD (4 villes prêtes) | 4 251 | ~3 138 |
| FERMABLE-PARTIEL / plafond atteint (neuville, la-sarre) | 3 005 | ~43 |
| ANOMALIE — investigation requise (5 villes) | 10 104 | ~0 (bloqué tant que non investigué) |
| ACQUISITION-ÉQUIVALENTE — grille inutilisable (rimouski, sainte-cecile-de-milton, saint-boniface) | 15 028 | ~39 |

≈90% de la dette (29 137/32 388) ne se ferme PAS avec un simple refold aujourd'hui : soit investigation de version de grille requise, soit acquisition d'une vraie grille.

## Outils read-only utilisés

- `npx tsx acquisition/src/_norms-manifest-entry.ts --slugs "<liste>"` (existant, committé).
- `npx tsx acquisition/src/zonage-norms-crossval-refresh.ts --slug <liste>` sans `--apply` (existant, committé, dry-run par défaut).
- `npx tsx acquisition/src/_norms-manifest-crossval-peek.ts --slugs "<liste>"` (nouveau, ajouté cette lane, lecture seule, non commité — miroir de `_norms-manifest-entry.ts` incluant le bloc `crossval` complet).
- Aucun appel réseau n'a nécessité de retry (aucun ETIMEDOUT observé).
