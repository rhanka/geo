# Extraction de la grille des spécifications — DESIGN RETENU (double-consensus)

> Synthèse de 2 perspectives indépendantes : **A = opus** (`normes-extraction-design-opus.md`) + **B = reviewer adversarial** (Claude, remplace le runtime codex instable). B a corrigé A sur des points porteurs, vérifiés dans le code. Ceci est le design de référence.

## Correction porteuse (B, vérifiée)
1. **Les valeurs de normes ne sont PAS dans le PDF d'amendement** : elles vivent dans les **annexes « grille des usages et normes »** (souvent une image/table) du **règlement de zonage de BASE + son annexe A consolidée**. L'amendement ne contient que des *pointeurs* vers ces annexes. → **Cible-document = règlement de base + annexe A**, pas l'amendement (le parser actuel ne fetch que les amendements : à corriger).
2. **Le SIG (ca-qc-zonage, 118 endpoints) ne porte AUCUNE valeur de norme** (que `zoneCodeField`). → La cross-validation SIG ne valide que la **présence du `zone_code`**, jamais une valeur. Le scoring 0.85 mesure donc des signaux **internes**, pas un consensus inter-sources.
3. **graphify / Mistral-OCR-vision = brique à CONSTRUIRE** (geo n'a que `voxtral-transcriber` audio + `pdf-ocr` tesseract non-vision non câblé).

## Deux livrables distincts
- **D1 — Cross-check fiabilité des codes (shippable bientôt, codes seuls)** : `zone_code` du règlement (parser migré) ⋈ `zone_code` du SIG ⋈ `zone_code` de l'annexe → signal de fiabilité de l'**existence** du code. C'est le meilleur insight d'opus, à livrer *en tant que tel* (sans prétendre valider des valeurs).
- **D2 — Valeurs de normes (le dur)** : extraction de la grille. Architecture ci-dessous.

## Architecture D2
1. **Discovery** (par muni) : annuaire MAMH → page urbanisme → **règlement de zonage de base + annexe A consolidée** (PDF natif texte de préférence). SourceAdapter par famille de source.
2. **Classifieur de page** `is_grille_page` (présence des en-têtes canoniques : usages, marges, hauteur, superficie, rapport plancher/terrain, implantation, frontage).
3. **Routeur d'extraction piloté par format** (PAS une cascade linéaire) :
   - PDF natif vectoriel avec lignes → pdfplumber/Camelot *lattice*.
   - PDF natif texte sans ruling → pdfplumber *stream* + clustering **ancré sur en-têtes**.
   - **Image/scanné → OCR-vision (Mistral via graphify) en PREMIER rang** (Camelot n'a rien à mordre).
4. **Capture verbatim par cellule** → **normaliseur d'unités séparé et testable** : `raw` conservé à côté de `value` ; virgule décimale FR, `m`/`m²`/`étages`, hauteur en mètres ET en étages, `s.o.`/`—`/`n/a` → `null` (jamais `0`). Motif non reconnu → `value:null` + `raw` gardé.
5. **Confidence 0.85 par champ = min des signaux INTERNES** : (i) qualité d'extraction (méthode + score OCR/cellule), (ii) **intégrité structurelle de la grille**, (iii) plausibilité par champ (hauteur 1–60 m, marge 0–30 m, superficie ≥~150 m², frontage ≥~6 m), (iv) **double-passe OCR en CONCORDANCE** (2 passes divergentes = faible confiance, pas « prendre la 2e »). Publie `value` si min ≥ 0.85, sinon `value:null` + `flag:"a-verifier"` + `raw`. Cross-val SIG = score d'**existence de zone** seulement.
6. **GARDE-FOU #1 (risque le plus dangereux) — anti-décalage de colonnes** : un mauvais alignement produit une valeur *plausible mais fausse* qui passe le gate silencieusement (hauteur 11 m → marge 11 m). Mitigations DURES : (a) `nb_colonnes_détectées == nb_en-têtes_canoniques` à la bonne position, sinon **rejet de la grille entière** (pas de correction silencieuse) ; (b) **round-trip** : reconstruire la ligne depuis les cellules et la re-matcher au texte OCR brut de la bande ; (c) **type-checking sémantique** : `marge` en `m²` ou `superficie` en `m` → rejet (l'unité trahit le décalage même si le nombre est plausible) ; (d) **échantillon de contrôle humain** (5 zones/muni) avant publication auto du reste.
7. **Réconciliation = moteur d'opérations typées ordonnées** : `REPLACE_GRID / ADD_ZONE / RENAME_ZONE(keepGeometry) / ABROGATE / RESIZE`, appliquées en **ordre chronologique d'entrée en vigueur** depuis l'annexe A consolidée (le parser d'amendement repère déjà ces verbes). Si codification consolidée : base + **flag « en retard de N amendements »** (le HEAD-check ETag/Last-Modified détecte le *drift fichier*, PAS le *drift réglementaire*).
8. **Provenance PAR CHAMP** (pas par zone) : `{bylaw_numero, version, méthode, confidence, snapshot, page_bbox, source_url}` — pour tracer « hauteur_max de H-521 = amendement 150-51 art.7, reste = base 150 ».
9. **Produit** : `qc-zonage-norms-<slug>` (federation-first, immo lit). Doc brut stocké S3 versionné + HEAD-check (décision 2).

## MVP (recommandé par B)
**Pilote = Salaberry-de-Valleyfield, règlement de BASE 150 + annexe A** (on a déjà CDN + pipeline fetch+pdftotext + codes réels en fixture + l'amendement 150-51 pour la réconciliation).
Livrable : `ZoneNorms` pour **3-5 zones connues** (H-521, REC-137, C-566) avec par champ `value`|`null` + `raw` + méthode + confidence + provenance ; appliquer 1 amendement réel (U-521→H-521 art.7) ; **golden fixture `zone-norms-valleyfield.fixture.ts` + test qui ÉCHOUE si une valeur est inventée** (tout champ servi ≠ verbatim cellule = échec dur).
**Métrique-produit = « 0 norme fausse servie comme certaine »** (précision 100% + zéro invention ; rappel rapporté non bloquant). C'est la seule garantie contractuelle à immo.

## Bricks à construire (acté)
- **OCR-vision Mistral via graphify** (n'existe pas dans geo ; clé `sentropic/.env`). Décision 4.
- Classifieur `is_grille_page` + routeur de format + normaliseur d'unités QC + garde-fou anti-décalage + moteur de réconciliation typée.
- Discovery base-bylaw+annexe (étendre les `DEFAULT_REGLEMENT_PDFS` au-delà des amendements).

## Ledger consensus (garder vs changer)
- **GARDÉ d'opus** : split D1/D2, anti-invention (`null`>invention, verbatim, parse unités séparé, jamais d'interpolation), SourceAdapter+fixtures+gate, schéma ZoneNorms + S3 versionné.
- **CHANGÉ par B** : cible = base+annexe (pas amendement) ; routeur de format (pas cascade linéaire) ; 0.85 = signaux internes + double-passe concordante (pas cross-val de valeurs) ; garde-fou anti-décalage DUR ; réconciliation typée + flag retard ; provenance par champ ; critère pilote = « grille consolidée PDF natif texte » ; OCR-graphify = à construire.
