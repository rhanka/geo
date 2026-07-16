# SPEC EVOL — Staging officiel Saint-Amable zones + normes

## Intention

Construire un staging local, déterministe et auditable des 109 zones officielles de Saint-Amable et de leurs 109 grilles PDF liées. Ce staging prépare une future promotion sans jamais modifier S3, le live ou Track.

La source municipale a été vérifiée le 2026-07-15 : 109 géométries, 109 codes uniques, 109 PDF uniques, `H-59` présente et `RX-122` absente. La promotion globale reste interdite tant que les variantes multi-colonnes des grilles ne sont pas représentées fidèlement.

Une incohérence officielle est figée explicitement : l'OID 71, zone `A4-106`, porte `groupe="A3 | Agricole - Industrielle"`. Les 108 autres groupes concordent avec le préfixe de zone; toute autre divergence reste rejetée.

## Décisions

### D1 — Fence de source obligatoire

Le runner lit avant et après le run l'item Feature Service, `editingInfo`, le compteur et les 109 OID. Les OID sont triés localement puis lus par lots explicites. Toute variation entre T0 et T1 invalide le run.

### D2 — Ensemble exact, pas seulement un compteur

L'acceptation exige l'égalité exacte des 109 OID, 109 codes raw/canoniques et 109 URL PDF. Null, doublon, collision de normalisation, ajout ou omission provoquent un `NO_READY`.

### D3 — PDF canonique et intégrité ArcGIS

Le champ `pdf` est la source canonique; `hyperlien` n'est qu'une corroboration dont le href doit être identique. Chaque URL doit viser un item ArcGIS public 32-hex, de type PDF, dont le titre correspond au code attendu. Le runner vérifie métadonnées avant/après, magic PDF, taille bornée, une page et SHA-256 des octets.

L'autorité du compte de pages est le `/Count` de l'arbre de pages, jamais le nombre d'occurrences `/Type /Page` : une mise à jour incrémentale conserve l'objet page remplacé, donc une grille légitime d'une page peut en porter plusieurs. Un arbre de pages divergent échoue fermé (`PDF_PAGE_TREE_AMBIGUOUS`). Le nombre d'objets page reste exposé (`pageObjectCount`) à côté de `pageCount` pour distinguer un artefact de révision d'un vrai document multi-pages. La protection anti-substitution reste le SHA-256, le titre d'item et la taille.

### D4 — Code observé et code autoritaire

Le code autoritaire vient exclusivement du manifeste FeatureServer. Les deux lectures d'extraction doivent néanmoins observer indépendamment le même header; `expectedZone` ne peut pas masquer un PDF échangé. Les suffixes de note (`H-59 *27`, `H-59 *6`) sont des artefacts interdits.

### D5 — Variantes de colonnes préservées

Une zone peut porter plusieurs colonnes réglementaires. Le staging conserve `variants[]` avec index, bbox, structure, usages, normes et renvois de note. Il ne transforme jamais une variante en nouveau `zone_code` et n'applique aucun keep-best par simple richesse.

### D6 — Projection mono-row conservatrice uniquement

Un aperçu mono-row peut publier localement uniquement une valeur identique dans toutes les variantes applicables. Une divergence reste `null` avec un drapeau explicite et les valeurs sources dans `variants[]`. Cette projection n'autorise aucune promotion; le futur contrat live multi-variantes demeure une décision propriétaire séparée.

### D7 — Vocabulaire fermé des usages

Seules les classes de la section `USAGES AUTORISÉS` (`h1`–`h5`, `c1`–`c6`, `p1`–`p3`, `i1`–`i3`, `a1`) sont admissibles, avec marqueur d'autorisation concordant dans les deux passes. `Isolée`, `Jumelée`, `Contiguë`, les carrés vides et les notes `*N` sont interdits dans `usages`.

### D8 — Extraction native d'abord

Les 109 PDF ont une vraie couche texte. L'extraction primaire doit utiliser les coordonnées/bbox des glyphes. La vision est un fallback désactivé par défaut, borné en coût et en concurrence; tout résultat vision reste `needs_review`.

### D9 — Goldens bloquants

Les fixtures minimales sont : H-59 (3 variantes, hauteur 1–2), CEN-181 (3, hauteur 3–4), HCV-187 (7, variantes 2–2 et 2–3 conservées), PCV-197 (1, hauteur 1–5), TR-184 (6, hauteur 2–3). Aucun code synthétique ni libellé structurel dans les usages.

### D10 — Artefacts locaux déterministes

Le runner produit atomiquement dans un nouveau répertoire : manifeste canonique trié, receipt opérationnel, données variantes, projection conservative, parquet candidat, diff contre live et hashes SHA-256. Un rerun avec le même fence, les mêmes PDF et versions doit reproduire le hash du manifeste.

### D11 — Reprise et échecs

Les PDF sont mis en cache CAS par SHA avec fichiers `.part` puis rename. `--resume` exige le même fence et le même config hash. Un échec, 429 épuisé, PDF tronqué, conflit ou source mouvante conserve un diagnostic mais ne crée aucun marqueur `READY`.

### D12 — Séparation stricte staging/promotion

Le runner de staging n'importe pas le client S3 et n'expose aucune option de dépôt. La promotion sera un outil et une décision séparés, avec revalidation du fence, compare-and-swap des ETag live, sauvegardes immuables et rollback testé.

### D13 — Contrat sérialisé Lot 2 → Lot 3 fermé

Le runner ingère directement le JSON `snake_case` du parseur de variantes sans dépendance de package. Il exige l'égalité exacte du code, du SHA-256 PDF et de l'ensemble des zones préparées; il conserve bbox, usages, structures, normes, notes et provenance. Les colonnes doivent être ordonnées, non négatives et sans chevauchement, et les cellules de normes respecter le vocabulaire et le schéma fermés du Lot 2. Toute divergence produit `NO_READY`.

## Gates `READY_STAGING`

- source stable et ensemble exact 109/109;
- 109 items/PDF valides, une page chacun, titres et headers conformes;
- zéro code synthétique, usage structurel, collision ou PDF manquant;
- variantes et provenance complètes pour 109 zones;
- contrat sérialisé Lot 2 exact, sans colonne ou norme hors schéma;
- goldens H-59/CEN-181/HCV-187/PCV-197/TR-184 verts;
- manifeste déterministe reproductible;
- zéro écriture S3, live ou Track.

`READY_STAGING` ne vaut jamais `GO_PRODUCTION`.

## État d'acceptation au 2026-07-15

Le premier run live a validé les 109 enregistrements source, puis a rejeté un PDF compté à deux pages avec `PDF_PAGE_COUNT_MISMATCH`. Le diagnostic contient maintenant OID, code zone et item ID, mais la relance d'identification est bloquée par le quota de lecture externe jusqu'au 2026-07-21. Aucun `READY_STAGING` n'a été créé et la géométrie officielle n'a pas été publiée.

## Revue contradictoire

- Pair correctness : direction approuvée sous réserve des invariants D1–D7 et D10–D13; le canary H-59 actuel est bloquant sans eux.
- Pair opérations/risque : extraction native et variantes obligatoires; pagination par OID, fences, CAS local, reprise stricte et séparation absolue de la promotion.
- Réconciliation : les deux revues convergent. La représentation fidèle `variants[]` est retenue pour le staging; l'évolution du contrat live reste explicitement hors périmètre.
