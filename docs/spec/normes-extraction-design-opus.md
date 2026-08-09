# Extraction de la grille des spécifications — perspective OPUS (B)

> Angle indépendant pour le double-consensus (perspective A = codex). À synthétiser.
> Cible : étendre `qc-sources/reglements-urbanisme-parser.ts` (extrait aujourd'hui n° règlement + zones[]{code,kind}, pas les valeurs) vers la grille `{usages, densite, hauteur_min/max, marges, frontage_min, superficie_min}` par `zone_code`.

## Insight central — séparer 2 livrables de valeur très différente
1. **Cross-check fiabilité des codes (DÉJÀ là, à shipper MAINTENANT)** : le parser actuel donne les `zone_code` *mentionnés dans le règlement*. Croisés avec les `zone_code` de la **grille spatiale** (ca-qc-zonage) → signal de fiabilité du code (présent dans le règlement ⋈ présent dans le SIG). Faible risque, valeur immédiate. **C'est exactement le « source de fiabilité du code de zone » demandé.**
2. **Valeurs de normes (le dur)** : extraction d'une **table** (annexe « grille des usages et normes »). Problème de **table-extraction**, pas de regex texte.

## Architecture (les NORMES de la chaîne LOT→ZONE→NORMES)

**Phase 1 — Discovery province (réutiliser l'existant)** : le parser est Valleyfield-spécifique ; à l'échelle 1102 munis chaque CMS/PDF diffère → pattern `SourceAdapter` par source-famille + couche de résolution annuaire MAMH → site muni → page urbanisme → **PDF du règlement de base + son annexe grille**. **Commencer par les munis qui ont déjà une grille spatiale** (15/30 + grilles province) pour pouvoir *valider* les normes extraites contre les `zone_code` du SIG.

**Phase 2 — Table extraction (échelle de repli, anti-invention)** :
- (a) PDF natif avec lignes de table → **pdfplumber/Camelot lattice** (tables réglées). Confiance haute.
- (b) PDF natif sans ruling → **pdfplumber stream + clustering de colonnes** ancré sur les **en-têtes** ("usage", "hauteur", "marge", "superficie", "frontage"). Confiance moyenne.
- (c) PDF scanné/image OU (a)(b) sous le seuil → **Mistral OCR via graphify** (décision 4) : vision-LLM lit l'image de la table → lignes structurées. Confiance variable, validée.
- Discipline : valeur de cellule **verbatim** (ex « 12,5 m »), parse d'unités séparé, **jamais** d'interpolation d'une cellule manquante.

**Phase 3 — Confiance par champ + gate 0.85 (décision 4)** : confiance = f(méthode d'extraction, plausibilité de la valeur, **cross-validation** : le `zone_code` extrait matche-t-il le SIG + le texte du règlement ?). Un code présent dans **les 3** (SIG + texte règlement + annexe grille) = haute confiance. < 0.85 → 2e passe Mistral OCR sur la cellule/ligne ; toujours < 0.85 → `null` + flag « à vérifier ».

**Phase 4 — Réconciliation amendements + versionnage (décision 2)** : préférer la **codification administrative consolidée** (beaucoup de munis la publient) à la reconstruction depuis les amendements ; sinon appliquer les amendements en ordre (« remplace la grille de la zone X » → remplace la ligne). Stocker chaque doc brut sur S3 avec version + **HEAD-check** fraîcheur. Chaque valeur porte : valeur + règlement source + version + méthode + confidence + snapshot.

## Schéma (zod) par zone_code
`ZoneNorms = { zone_code, muni_slug, usages:{value:string[],source,confidence}|null, densite:{value,unit,…}|null, hauteur_min/max:{value_m,…}|null, marges:{avant,laterale,arriere}|null, frontage_min:{value_m,…}|null, superficie_min:{value_m2,…}|null, _provenance:{bylaw_numero,bylaw_version,doc_s3,extraction_method,snapshot,source_url} }`

## 3 risques majeurs (vue opus)
1. **Hétérogénéité 1102 munis** — pas de parser unique ; certaines munis n'ont aucune grille publiée, d'autres seulement en PDF scanné. Mitigation : SourceAdapter par famille + `null` honnête « pas de grille » + cibler d'abord les munis AVEC grille spatiale (cross-validation possible).
2. **Fidélité de table** — un décalage de colonne transforme silencieusement hauteur en marge. Mitigation : mapping de colonnes **ancré sur les en-têtes** (pas la position seule) + plausibilité inter-champs + gate 0.85 + repli OCR.
3. **Drift d'amendement** — servir une norme périmée. Mitigation : préférer la codification consolidée ; version + HEAD-check ; flag si dérivé d'amendement seul.

## Réutiliser vs construire
- **Réutiliser** : contrat SourceAdapter, RawDocument, regex code-zone/n°-règlement (= cross-check fiabilité + ancre zone_code), discipline fixtures golden, modules pdf-ocr + voxtral déjà migrés.
- **Construire** : couche table-extraction (pdfplumber/Camelot + ladder Mistral-OCR-via-graphify), schéma ZoneNorms, scorer confidence par champ, réconcilieur d'amendements, discovery province (réutiliser celle de la grille spatiale).

## Reco de séquençage
Ship Phase 0/1 (cross-check fiabilité du code) **tout de suite** sur les munis à grille ; construire Phase 2-4 incrémentalement, **validé contre le SIG**, en commençant par les PDF natifs (pdfplumber) avant d'investir l'OCR.
