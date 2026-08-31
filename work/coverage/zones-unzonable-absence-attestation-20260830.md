# Attestation d'absence rejouable — 14 municipalités candidat-un-zonable

_Généré : 2026-08-30T23:52:19.215Z — sonde `acquisition/src/_zones-unzonable-absence-attestation-20260830.ts` (lecture seule)._

## Contrat (anti-invention)

Absence-de-preuve ≠ preuve-d'absence. **N-A-PROVEN** exige une preuve POSITIVE autoritative que l'entité n'est pas une municipalité locale capable de zonage (TNO, gouvernement régional, entité régionale/MRC, ou absence du répertoire municipal comme municipalité locale). Une vraie Ville/Municipalité locale → l'absence de grille est un **source-gap**, jamais N-A. verbatim-or-null.

## Sources

- **Primaire (porteuse)** : `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — MAMH — Répertoire des municipalités du Québec (cc-by-4.0), generatedAt=2026-06-16T00:52:48.516544Z. Champ `designation` lu VERBATIM.
- **Recoupement** : `data/normalized/ca-qc-sda/qc-municipalites.geojson` — découpage administratif MRNF SDA, fetchedAt=2026-06-13T20:34:57.756Z, 1343 features.
- **Empreinte servie (secondaire)** : S3 HEAD lecture seule. configured=true, reachable=true, bucket=sentropic-geo. S3 joignable (bucket sentropic-geo) — HEAD lecture seule, aucune écriture
- Désignations traitées comme non-municipalité-locale : `Territoire non organisé`, `Gouvernement régional`.

## Résumé (partition fermée)

- **Total** : 14
- **N-A-PROVEN** : 2 — eeyou-istchee-james-bay, caniapiscau
- **UNKNOWN-source-gap** : 12 — baie-johan-beetz, blanc-sablon, bonne-esperance, gros-mecatina, longue-pointe-de-mingan, matagami, natashquan, riviere-saint-jean, saint-augustin--le-golfe-du-saint-laurent, la-tuque, aguanish, cote-nord-du-golfe-du-saint-laurent
- Partition ferme à 14 : OK

## Table

| slug | origine | designation (MAMH, verbatim) | mrc (SDA) | qc-lots servi | qc-zonage servi | classification |
|------|---------|------------------------------|-----------|---------------|-----------------|----------------|
| baie-johan-beetz | 220 | Municipalité | Minganie | true | false | UNKNOWN-source-gap |
| blanc-sablon | 220 | Municipalité | Le Golfe-du-Saint-Laurent | true | false | UNKNOWN-source-gap |
| bonne-esperance | 220 | Municipalité | Le Golfe-du-Saint-Laurent | true | false | UNKNOWN-source-gap |
| gros-mecatina | 220 | Municipalité | Le Golfe-du-Saint-Laurent | false | false | UNKNOWN-source-gap |
| longue-pointe-de-mingan | 220 | Municipalité | Minganie | false | false | UNKNOWN-source-gap |
| matagami | 220 | Ville | Jamésie | false | false | UNKNOWN-source-gap |
| natashquan | 220 | Municipalité | Minganie | false | false | UNKNOWN-source-gap |
| riviere-saint-jean | 220 | Municipalité | Minganie | false | false | UNKNOWN-source-gap |
| saint-augustin--le-golfe-du-saint-laurent | 220 | Municipalité | Le Golfe-du-Saint-Laurent | false | false | UNKNOWN-source-gap |
| la-tuque | 16-data-gap | Ville | La Tuque | false | false | UNKNOWN-source-gap |
| eeyou-istchee-james-bay | 16-data-gap | Gouvernement régional | Jamésie | false | false | N-A-PROVEN |
| aguanish | 16-data-gap | Municipalité | Minganie | true | false | UNKNOWN-source-gap |
| caniapiscau | 16-data-gap | Territoire non organisé | Caniapiscau | true | false | N-A-PROVEN |
| cote-nord-du-golfe-du-saint-laurent | 16-data-gap | Municipalité | Le Golfe-du-Saint-Laurent | true | false | UNKNOWN-source-gap |

## Bases (verbatim)

### baie-johan-beetz — UNKNOWN-source-gap

Baie-Johan-Beetz (mamhCode 98035) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["baie-johan-beetz"].designation → designation="Municipalité", mamhName="Baie-Johan-Beetz", mamhCode=98035 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98035" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Baie-Johan-Beetz", MUS_CO_GEO=98035, MUS_NM_MRC="Minganie", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-baie-johan-beetz` — HEAD qc-lots-baie-johan-beetz + qc-zonage-baie-johan-beetz (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-baie-johan-beetz.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### blanc-sablon — UNKNOWN-source-gap

Blanc-Sablon (mamhCode 98005) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["blanc-sablon"].designation → designation="Municipalité", mamhName="Blanc-Sablon", mamhCode=98005 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98005" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Blanc-Sablon", MUS_CO_GEO=98005, MUS_NM_MRC="Le Golfe-du-Saint-Laurent", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-blanc-sablon` — HEAD qc-lots-blanc-sablon + qc-zonage-blanc-sablon (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-blanc-sablon.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### bonne-esperance — UNKNOWN-source-gap

Bonne-Espérance (mamhCode 98010) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["bonne-esperance"].designation → designation="Municipalité", mamhName="Bonne-Espérance", mamhCode=98010 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98010" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Bonne-Espérance", MUS_CO_GEO=98010, MUS_NM_MRC="Le Golfe-du-Saint-Laurent", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-bonne-esperance` — HEAD qc-lots-bonne-esperance + qc-zonage-bonne-esperance (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-bonne-esperance.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### gros-mecatina — UNKNOWN-source-gap

Gros-Mécatina (mamhCode 98014) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["gros-mecatina"].designation → designation="Municipalité", mamhName="Gros-Mécatina", mamhCode=98014 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98014" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Gros-Mécatina", MUS_CO_GEO=98014, MUS_NM_MRC="Le Golfe-du-Saint-Laurent", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-gros-mecatina` — HEAD qc-lots-gros-mecatina + qc-zonage-gros-mecatina (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### longue-pointe-de-mingan — UNKNOWN-source-gap

Longue-Pointe-de-Mingan (mamhCode 98045) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["longue-pointe-de-mingan"].designation → designation="Municipalité", mamhName="Longue-Pointe-de-Mingan", mamhCode=98045 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98045" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Longue-Pointe-de-Mingan", MUS_CO_GEO=98045, MUS_NM_MRC="Minganie", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-longue-pointe-de-mingan` — HEAD qc-lots-longue-pointe-de-mingan + qc-zonage-longue-pointe-de-mingan (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### matagami — UNKNOWN-source-gap

Matagami (mamhCode 99015) porte une désignation autoritative "Ville" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["matagami"].designation → designation="Ville", mamhName="Matagami", mamhCode=99015 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="99015" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Matagami", MUS_CO_GEO=99015, MUS_NM_MRC="Jamésie", MUS_CO_DES=V, MUS_NM_REG="Nord-du-Québec" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-matagami` — HEAD qc-lots-matagami + qc-zonage-matagami (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### natashquan — UNKNOWN-source-gap

Natashquan (mamhCode 98025) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["natashquan"].designation → designation="Municipalité", mamhName="Natashquan", mamhCode=98025 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98025" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Natashquan", MUS_CO_GEO=98025, MUS_NM_MRC="Minganie", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-natashquan` — HEAD qc-lots-natashquan + qc-zonage-natashquan (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### riviere-saint-jean — UNKNOWN-source-gap

Rivière-Saint-Jean (mamhCode 98050) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["riviere-saint-jean"].designation → designation="Municipalité", mamhName="Rivière-Saint-Jean", mamhCode=98050 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98050" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Rivière-Saint-Jean", MUS_CO_GEO=98050, MUS_NM_MRC="Minganie", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-riviere-saint-jean` — HEAD qc-lots-riviere-saint-jean + qc-zonage-riviere-saint-jean (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### saint-augustin--le-golfe-du-saint-laurent — UNKNOWN-source-gap

Saint-Augustin (mamhCode 98012) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["saint-augustin--le-golfe-du-saint-laurent"].designation → designation="Municipalité", mamhName="Saint-Augustin", mamhCode=98012 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98012" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Saint-Augustin", MUS_CO_GEO=98012, MUS_NM_MRC="Le Golfe-du-Saint-Laurent", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-saint-augustin--le-golfe-du-saint-laurent` — HEAD qc-lots-saint-augustin--le-golfe-du-saint-laurent + qc-zonage-saint-augustin--le-golfe-du-saint-laurent (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### la-tuque — UNKNOWN-source-gap

La Tuque (mamhCode 90012) porte une désignation autoritative "Ville" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["la-tuque"].designation → designation="Ville", mamhName="La Tuque", mamhCode=90012 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="90012" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="La Tuque", MUS_CO_GEO=90012, MUS_NM_MRC="La Tuque", MUS_CO_DES=V, MUS_NM_REG="Mauricie" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-la-tuque` — HEAD qc-lots-la-tuque + qc-zonage-la-tuque (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### eeyou-istchee-james-bay — N-A-PROVEN

Désignation autoritative "Gouvernement régional" pour Eeyou Istchee Baie-James (mamhCode 99060) dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ n'est PAS une municipalité locale capable de zonage municipal. Nuance (contexte) : entité régionale gouvernant un territoire (produit de zonage éventuel de niveau régional, distinct du zonage municipal local).

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["eeyou-istchee-james-bay"].designation → designation="Gouvernement régional", mamhName="Eeyou Istchee Baie-James", mamhCode=99060 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="99060" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Eeyou Istchee Baie-James", MUS_CO_GEO=99060, MUS_NM_MRC="Jamésie", MUS_CO_DES=GR, MUS_NM_REG="Nord-du-Québec" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-eeyou-istchee-james-bay` — HEAD qc-lots-eeyou-istchee-james-bay + qc-zonage-eeyou-istchee-james-bay (layouts plat + niché) → qc-lots=false, qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### aguanish — UNKNOWN-source-gap

Aguanish (mamhCode 98030) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["aguanish"].designation → designation="Municipalité", mamhName="Aguanish", mamhCode=98030 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98030" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Aguanish", MUS_CO_GEO=98030, MUS_NM_MRC="Minganie", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-aguanish` — HEAD qc-lots-aguanish + qc-zonage-aguanish (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-aguanish.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### caniapiscau — N-A-PROVEN

Désignation autoritative "Territoire non organisé" pour Caniapiscau (mamhCode 97908) dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ n'est PAS une municipalité locale capable de zonage municipal. Nuance (contexte, ne renverse pas la classe) : le territoire d'un TNO peut être couvert par un zonage de niveau MRC (produit distinct) ; le slug-muni reste N-A sur le zonage MUNICIPAL, valide pour le KPI 1106-muni.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["caniapiscau"].designation → designation="Territoire non organisé", mamhName="Caniapiscau", mamhCode=97908 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="97908" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Caniapiscau", MUS_CO_GEO=97908, MUS_NM_MRC="Caniapiscau", MUS_CO_DES=NO, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-caniapiscau` — HEAD qc-lots-caniapiscau + qc-zonage-caniapiscau (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-caniapiscau.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)

### cote-nord-du-golfe-du-saint-laurent — UNKNOWN-source-gap

Côte-Nord-du-Golfe-du-Saint-Laurent (mamhCode 98015) porte une désignation autoritative "Municipalité" dans packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json (MAMH Répertoire, generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15) ⇒ vraie municipalité/ville locale : l'absence de grille de zonage est un source-gap NON prouvable en lecture seule (une muni peut avoir un règlement de zonage non publié en données ouvertes), JAMAIS N-A.

- `packages/geo-sources-americas/src/ca-qc/municipalities/municipal-directory.qc.json` — QC_MUNICIPAL_DIRECTORY.entries["cote-nord-du-golfe-du-saint-laurent"].designation → designation="Municipalité", mamhName="Côte-Nord-du-Golfe-du-Saint-Laurent", mamhCode=98015 (retrieved_at: generatedAt=2026-06-16T00:52:48.516544Z; entry.verifiedAt=2026-06-15)
- `data/normalized/ca-qc-sda/qc-municipalites.geojson` — feature where MUS_CO_GEO=="98015" (fallback: unique normalized MUS_NM_MUN) → MUS_NM_MUN="Côte-Nord-du-Golfe-du-Saint-Laurent", MUS_CO_GEO=98015, MUS_NM_MRC="Le Golfe-du-Saint-Laurent", MUS_CO_DES=M, MUS_NM_REG="Côte-Nord" (match by-code) (retrieved_at: fetchedAt=2026-06-13T20:34:57.756Z)
- `s3://sentropic-geo/normalized/{qc-lots,ca-qc-zonage}/…-cote-nord-du-golfe-du-saint-laurent` — HEAD qc-lots-cote-nord-du-golfe-du-saint-laurent + qc-zonage-cote-nord-du-golfe-du-saint-laurent (layouts plat + niché) → qc-lots=true [normalized/qc-lots/qc-lots-cote-nord-du-golfe-du-saint-laurent.geojson], qc-zonage=false (retrieved_at: 2026-08-30T23:52:19.215Z)
