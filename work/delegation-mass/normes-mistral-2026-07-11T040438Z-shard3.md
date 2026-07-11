# NORMES via Mistral — shard 3/4 — 2026-07-11T040438Z

## Périmètre

- Sélection stricte: index dans la liste triée `% 4 == 3`.
- Matrice au début de la passe: 74 cibles productibles (`zones.status == done`, `normes.status != done`).
- Premier lot (15): `alma`, `aston-jonction`, `beaulac-garthby`, `belleterre`, `cascapedia-saint-jules`, `dunham`, `entrelacs`, `fermont`, `grand-metis`, `honfleur`, `irlande`, `kinnears-mills`, `la-guadeloupe`, `la-redemption`, `lac-megantic`.
- Extraction uniquement Mistral; aucun appel GPT/Codex.
- Dépôts parquet-only; aucun manifeste modifié directement par les extracteurs.

## Dépôt net

### alma

- Source officielle: `https://www.ville.alma.qc.ca/wp-content/uploads/2026/06/2.Grilles_de_specification_199-2012-Alma-.pdf`
- PDF local réutilisé: `work/zonage-norms/alma/grille.pdf`.
- Route: `mistral-schema` / `ocr/mistral-schema`, pages 2..4, `document_annotation`.
- Coût déclaré: 0,009 USD.
- Gates: 20 codes distincts; SIG 1059; overlap 20; `publishedFieldPct=32.5`; OK.
- Dépôt: `registry/qc-zonage-norms/qc-zonage-norms-alma.parquet`.

## Échecs avec preuve, sans dépôt

### belleterre

- Source officielle MRC Témiscamingue: `https://www.mrctemiscamingue.org/app/uploads/2024/01/belleterre-reglement-de-zonage.pdf`.
- Route: Mistral OCR 4.0, 58 pages, auto-grid sans page détectée.
- Résultat: 0 zone extraite; coût déclaré 0,058 USD; aucun dépôt.

### kinnears-mills

- Source officielle: `https://www.kinnearsmills.com/fichiersUpload/fichiers/20250113143349-reglement-264-zonage-et-ses-amendements.pdf`.
- Mistral OCR 4.0 page 130: 0 zone; coût déclaré 0,001 USD.
- Fallback transposé `mistral-schema` page 130: 8 codes, `publishedFieldPct=0`, SIG 67, overlap 0.
- Gate anti-invention: rejet; coût déclaré 0,003 USD; aucun dépôt.

## Découverte du reste du lot

- Inventaire local: PDF présents pour `alma`, `belleterre`, `dunham`, `entrelacs`, `kinnears-mills`, `la-guadeloupe`, `lac-megantic` (le dernier ne fait que 4 KiB).
- Crawler `--download --route-guess --2hop`: seulement 3/12 slugs connus de la registry (`la-guadeloupe`, `aston-jonction`, `dunham`), 0 PDF confirmé.
- Les petites municipalités restantes ne sont pas couvertes par la registry; aucune URL officielle nouvelle n'a été inventée.

## Blocage externe et suites exactes

- La réconciliation `zonage-norms-manifest-merge.ts --apply` a échoué dans le bac à sable avec `getaddrinfo EAI_AGAIN s3.fr-par.scw.cloud`.
- La relance réseau a été refusée parce que la capacité d'approbation de l'environnement était épuisée jusqu'à 04:31. Aucun contournement n'a été tenté.
- En conséquence, le manifeste n'est pas encore réconcilié et `lot-zone-join-run.ts --slugs alma` puis `lots-enriched-run.ts --slugs alma` restent à exécuter après rétablissement de l'accès réseau.
- La boucle n'a pas pu reprendre sur les 59 cibles suivantes du shard pour la même raison; le shard n'est pas épuisé.

## Coût Mistral observé

- Total déclaré: 0,071 USD (`alma` 0,009 + `belleterre` 0,058 + `kinnears-mills` 0,004).
- Tous les plafonds sont restés sous 1 USD par ville.
