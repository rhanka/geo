# Zones recalage - shard 0/6 - 2026-07-10T123411Z

Shard applique: slugs dont l'index dans la liste triee verifie `index % 6 == 0`.
Mode: PDF municipal officiel uniquement; pas de harvest AGOL owner.

## Depots nets

### abercorn
- Source PDF: `work/pdf-cache/abercorn.pdf` / `work/zonage-plans/abercorn.pdf`, titre PDF `2. 2016-07-20 Plan de zonage Reges 20160412`.
- T1: echec attendu, aucun `/VP /Measure /GEO`.
- T2: `t2-autogcp.ts` avec arbitration anisotropie cadastre, 32 GCP, residu max 10.487 m, holdout 12.791 m, spatial 0.406 km.
- Build: `t2-build.ts --labels text`, 117 codes distincts, 455/455 lots assignes, depot `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-abercorn.geojson`.
- Inline: `lot-zone-join-run` OK 455 lots, assigned 100%; `lots-enriched-run` OK 455 lots, zone_code 100%, depot enrichi OK.

### frampton
- Source PDF officielle locale: `work/pdf-cache/frampton-rural.pdf` et `work/pdf-cache/frampton-urbain.pdf`.
- T1: GeoPDF ArcGIS Pro, rural residu 2.235 m; urbain residu 0.000 m.
- Labels texte: insuffisant, labels glyphes/fragments; dictionnaire reel depuis libelles visibles des plans.
- Build: `t1-build-multisheet-claude.ts`, 77 points valides, 67 codes distincts, spatial 1.616 km, 1370/1545 lots assignes, surface couverte 74.21%, depot `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-frampton.geojson`.
- Inline: `lot-zone-join-run` OK 1545 lots, assigned 88.67%; `lots-enriched-run` OK 1545 lots, zone_code 88.67%, depot enrichi OK.

### les-escoumins
- Sources PDF officielles:
  - `https://www.escoumins.ca/wp-content/uploads/2024/11/Plan1_zonage_ensemble_territoire_avril2023.pdf`
  - `https://www.escoumins.ca/wp-content/uploads/2024/11/Plan2_zonage_agglomeration_20231204.pdf`
  - Grilles officielles: `Grilles-territoire_14-11-2023.pdf`, `Grilles-perimetre-urbain_14-11-2023.pdf`.
- T1: GeoPDF ArcMap, residus 0.122 m et 0.199 m.
- Labels texte generiques: echec gate car codes locaux `numero + sigle` non joints par le parseur T1.
- Dictionnaire: 111 codes reels extraits des grilles officielles; lectures positionnees extraites du texte PDF et validees par la voie `--labels claude --reads`.
- Build: `t1-build-multisheet-claude.ts`, 107 points valides, 102 codes distincts, spatial 3.611 km, 114/165 lots assignes, surface couverte 83.81%, depot `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-les-escoumins.geojson`.
- Inline: `lot-zone-join-run` OK 165 lots, assigned 69.09%; `lots-enriched-run` relance sequentielle OK, zone_code 69.09%, depot enrichi OK.

## Echecs consignes

### alleyn-et-cawood
- Source locale: `work/pdf-cache/alleyn-et-cawood.pdf`, Canon iR2525, scan.
- T1: aucun georeferencement embarque.
- Texte: `pdftotext` vide sur la page 1.
- T2 autogcp: `pass=false`, raison `no (extent x rotation) seed cleared residual+holdout gate`, `svg_points=0`, aucune tentative exploitable.
- Conclusion: T3/manuel requis; pas de depot fabrique.

### aumond
- Source connue: `https://www.aumond.ca/images/r%C3%A8glement_2022-06-275-_final_sign%C3%A9.pdf`.
- PDF de reglement/modification, 5 pages, pas de plan cartographique de zonage trouve dans les sources inspectees.
- T1: aucun georeferencement embarque.
- Conclusion: source officielle plan PDF non trouvee dans ce passage.

### chartierville
- Source connue: `https://chartierville.ca/wp-content/uploads/2025/04/Reglement-2025-03-Modifiant-reglement-de-zonage-corriger-RU-7.pdf`.
- PDF de modification, 3 pages, pas de plan cartographique.
- T1: aucun georeferencement embarque.
- Conclusion: source officielle plan PDF non trouvee dans ce passage.

### chertsey
- Source locale: `work/zonage-plans/chertsey.pdf`, Qt 5.15.2, A0.
- T1: aucun georeferencement embarque.
- Rapport autogcp existant: `pass=false`, `svg_points=0`, aucune seed residual+holdout.
- Conclusion: raster/non-georef, T3/manuel requis.

### cote-nord-du-golfe-du-saint-laurent
- Site MAMH: `https://www.mun-cngsl.ca` / `http://www.mun-cngsl.ca`.
- Preuve: resolution DNS echouee (`Could not resolve host`).
- Conclusion: aucun PDF officiel recuperable dans ce passage.

### desbiens
- Source locale: `work/zonage-plans/desbiens.pdf`, Canon iR-ADV C3525, 188 pages.
- T1: aucun georeferencement embarque.
- Texte: premieres pages vides/scannees; pas de plan autonome exploitable trouve.
- Conclusion: scan de reglement, T3/manuel requis.

### hebertville
- Source locale: `work/zonage-plans/hebertville-reglement.pdf`, 229 pages Word/PDF.
- T1: aucun georeferencement embarque.
- Texte: reglement de zonage `364-2004`, pas de plan cartographique dans les pages inspectees.
- Conclusion: pas de plan PDF de zonage exploitable dans ce passage.

### kipawa
- Site officiel: `https://kipawa.ca`, certificat invalide dans la session; recuperation avec `curl -k`.
- Page `https://kipawa.ca/cartes/` inspectee: cartes Google, aucun PDF de plan de zonage.
- Conclusion: aucun plan PDF officiel trouve.

### la-morandiere-rochebaucourt
- Site officiel: `https://lamorandiere.ca`, certificat invalide dans la session; recuperation avec `curl -k`.
- Page `https://lamorandiere.ca/cartes/`: lien vers portail Web SIG, aucun PDF de zonage.
- Conclusion: pas de lane PDF; pas de harvest SIG/AGOL.

### lac-sainte-marie
- Source connue: `https://www.lac-sainte-marie.com/images/reglements/reglement-2024-08-002-grilles-annexeB.pdf`.
- PDF de grilles/normes, 134 pages; pas de plan cartographique.
- T1: aucun georeferencement embarque.
- Conclusion: source officielle plan PDF non trouvee dans ce passage.

### montpellier
- Sources locales: `work/zonage-plans/montpellier-rural.pdf`, `work/zonage-plans/montpellier-villageois.pdf`.
- T1: aucun georeferencement embarque sur les deux feuillets.
- T2 rural: 7 seeds passent residu/holdout mais aucune ne passe orientation/isotropie; exemple meilleur residu/holdout: percentile rot0 residu 11.561 m, holdout 8.701 m, anisotropie 2.142; full rot0 anisotropie 2.330. Gate refuse.
- T2 villageois: `pass=false`, aucune seed residual+holdout; maximum 5 GCP independants.
- Conclusion: pas de depot sans GCP manuel/controle.

### longue-pointe-de-mingan
- Site officiel: `https://longuepointedemingan.ca`, certificat invalide dans la session; recuperation avec `curl -k`.
- Pages inspectees: accueil, `services-aux-citoyens/urbanisme`, `affaires-municipales/reglements`, `documentation-et-formulaires`.
- Preuve: aucun lien PDF de zonage directement publie; les listes de documents sont chargees par JS/AJAX non resolu dans la limite par slug.
- Conclusion: source officielle plan PDF non trouvee dans ce passage borne.

## Artefacts principaux

- `work/zonage-dicts/frampton.codes.json`
- `work/zonage-recalage/frampton-rural.reads.json`
- `work/zonage-recalage/frampton-urbain.reads.json`
- `work/gcp/abercorn.gcp.json`
- `work/gcp/abercorn.autogcp.aniso.report.json`
- `work/gcp/alleyn-et-cawood.autogcp.report.json`
- `work/zonage-dicts/les-escoumins.codes.json`
- `work/zonage-recalage/les-escoumins-extract-reads.mjs`
- `work/zonage-recalage/les-escoumins-plan1.reads.json`
- `work/zonage-recalage/les-escoumins-plan2.reads.json`
- `work/gcp/montpellier-rural.autogcp.report.json`
- `work/gcp/montpellier-villageois.autogcp.report.json`
- `work/zones-recalage/*abercorn*`, `*frampton*`, `*les-escoumins*`
