# NORMES via Mistral — shard 2/4 — 2026-07-12T0751Z

## Portée

- Branche: `feat/cadre-acquisition`.
- Sélection: `coverage-matrix.json`, `zones.status == done`, `normes.status != done`, liste triée, `index % 4 == 2` uniquement.
- Norme de référence lue: `docs/spec/normes-extraction-retenu.md`.
- `loop-supervise.ts` exécuté au début et entre les lots. Le premier lancement sandboxé a échoué avant le métier sur `tsx`/IPC (`listen EPERM`); relance autorisée réussie.
- Aucun GPT/Codex utilisé. Extraction payante: Mistral OCR/document annotation uniquement.
- Les artefacts concurrents déjà présents, `.claude`, `.track` et secrets n’ont pas été modifiés.

## Dépôts nets

| slug | source officielle | voie Mistral | gates | produit aval |
|---|---|---|---|---|
| `adstock` | `https://www.adstock.ca/wp-content/uploads/2026/05/R.299-24-Reglement-durbanisme_COD_2026-05.pdf` | `mistral-schema`, pages 90–237, 148 pages, coût total de la ville ≈ 0,968 USD (OCR initial + deux passages schema) | 52 codes, overlap SIG 35, `publishedFieldPct=59.1%`, chunks 19/19 | parquet `registry/qc-zonage-norms/qc-zonage-norms-adstock.parquet`; join 3 345 lots, 100% assignés; enrichi 3 345 lots |
| `la-bostonnais` | `https://labostonnais.ca/file-21011` (page municipale Zonage, HTTP 200, `application/pdf`, 56 828 564 octets) | `mistral-schema`, pages 1–171, 171 pages, 0,513 USD | 50 codes, overlap SIG 13, `publishedFieldPct=51.8%`, chunks 22/22 | parquet `registry/qc-zonage-norms/qc-zonage-norms-la-bostonnais.parquet`; join 707 lots, 98.02% assignés; enrichi 707 lots |

Les deux dépôts sont parquet-only. `zonage-norms-manifest-merge.ts --apply` les a ajoutés au manifeste; l’outil a aussi signalé la clé préexistante indépendante `registry` absente, sans empêcher les ajouts.

## Gates négatifs et preuves

- `adstock`: la route OCR sur les fenêtres initiales et 90–237 a donné 0 zone; la voie `document_annotation` sur la fenêtre vérifiée a ensuite passé les gates et a été déposée. Aucun champ non verbatim n’a été forcé.
- `batiscan`: `work/zonage-norms/batiscan/grille.pdf` est `<!DOCTYPE html>` (2 630 octets), pas un PDF.
- `bonsecours`: aucune URL officielle PDF récupérable dans la passe; l’URL historique du portail a échoué sans octet confirmé.
- `brebeuf`: PDF officiel de 33 pages confirmé, mais le diagnostic ne trouve que des listes de zones dans un chapitre d’usages; pas une grille de spécifications exploitable.
- `clerval`: PDF MRC officiel de 7 pages classifié `plan-image`, sans grille exploitable.
- `dundee`: PDF officiel de 13 pages classifié `plan-image`, aucun signal de grille textuelle.
- `elgin`, `franquelin`, `gallichan`, `godbout`, `howick`, `la-trinite-des-monts`: découverte bornée/crawl et recherche portail sans PDF de grille HTTP 200 confirmé; aucune URL inventée.
- `esterel`: PDF officiel de 2 pages, amendement du règlement de zonage, sans annexe grille.
- `guerin`: preuve Mistral antérieure relue: règlement officiel 55 pages, 0 zone et aucune ancre de grille; aucun second coût engagé.
- `lac-frontiere`: annexe A officielle confirmée et extraite par schema (1 page): 20 codes, overlap 2, mais `publishedFieldPct=0`; gate anti-invention, aucun dépôt.
- `lac-saint-joseph`: annexe B «GRILLE DES SPECIFICATIONS» localisée à la page 206 du règlement officiel 2024-301. Schema Mistral: 0 zone; fallback Mistral multi-zone: 0 zone; aucun dépôt.

Les autres résiduelles du shard (notamment `latulipe-et-gaboury`, `laval`, `lile-du-grand-calumet`, `martinville`, `nantes`, `pointe-a-la-croix`, `quebec`, `ripon`, `saint-adrien`, `saint-alphonse-de-granby`, `saint-antonin`, `saint-augustin-de-desmaures`, `saint-celestin--nicolet-yamaska`, `saint-cyprien--les-etchemins`, `saint-damien`, puis `saint-edmond-de-grantham` à `thetford-mines`) ont des preuves Mistral/portail antérieures relues: 0 zone, champs publiés à 0, overlap nul, source absente ou erreur bornée. Aucun dépôt n’a été fabriqué à partir de ces preuves.

## Artefacts ciblés

- Seeds de sources confirmées: `work/zonage-norms/seed-shard-2-20260712-batch1.json` et `seed-shard-2-20260712-batch2.json`.
- Manifeste de découverte batch 1: Adstock, Clerval, Estérel; batch 2: Brébeuf, Dundee, annexe Lac-Frontière. Les PDF non productibles restent des preuves de classification, pas des dépôts.
- Aucun commit global, aucune modification de couverture, `.claude` ou `.track`.

## Résultat

- Dépôts nets: **2** (`adstock`, `la-bostonnais`).
- Gâtes passés: **2**; gates négatifs conservés comme preuves.
- Join/enrichissement aval réussi pour les deux dépôts.
- Commit ciblé et push demandés pour ce rapport et les deux seeds uniquement.
