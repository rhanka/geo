# Zones recalage - shard 0/2 - 2026-07-10T174825Z

Shard applique: index dans la liste triee, `index % 2 == 0`.
Mode: plans PDF municipaux officiels seulement; aucun AGOL owner harvest.

## Depot net

### louiseville
- Sources officielles reprises du bloc precedent: `https://www.louiseville.ca`, PDFs telecharges dans `work/pdf-cache/`.
- T1:
  - `work/pdf-cache/louiseville-zonage-622-mai2024.pdf`: abort, aucun `/VP /Measure /GEO`.
  - `work/pdf-cache/louiseville-zonage-agricole-622.pdf`: abort, aucun `/VP /Measure /GEO`.
- T2 plan principal `louiseville-zonage-622-mai2024.pdf`: `svg_points=0`, aucune seed.
- T2 plan agricole `louiseville-zonage-agricole-622.pdf`: PASS.
  - 45 GCP independants, 0 derives bbox.
  - Residu max 9.345 m, RMS 4.003 m; holdout max 7.778 m.
  - Anisotropie moderee confirmee par lot-coverage: serving 95.8%, 26 codes.
  - Build: 29 labels, 26 codes distincts, spatial 2.012 km, 28/29 labels dans bbox.
  - Depot: `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-louiseville.geojson`.
  - Resultat zones: 24 features, 3967/4141 lots assignes (95.8%).
  - Inline: `lot-zone-join-run` OK, parquet verifie; `lots-enriched-run` relance apres jointure OK, `zone_code=95.8%`, `norms=95.8%`, depot enrichi OK.

## Echecs / preuves consignees

### alleyn-et-cawood
- Site officiel en cache: `https://alleyn-cawood.ca/fr/amenagement-urbain/zonage`.
- `work/pdf-cache/alleyn-et-cawood.pdf`: vrai PDF scan Canon, T1 abort sans georef embarque.
- `work/gcp/alleyn-et-cawood.autogcp.report.json`: T2 fail, aucune seed residual+holdout.
- `work/zonage-norms/alleyn-et-cawood/grille.pdf`: grille/normes, pas un plan; T1 abort sans georef.

### amherst
- Page officielle: `https://municipalite.amherst.qc.ca/urbanisme/`.
- PDF teste: `work/pdf-cache/amherst.pdf` / reglement `352-02-Zonage-revise-2017.pdf`.
- T1 abort: aucun georef embarque.
- Le texte du reglement mentionne deux feuillets cartographiques annexes A/B, mais aucun plan PDF recalable separe n'a ete localise dans ce passage.

### aumond
- Pages officielles en cache: `https://www.aumond.ca/index.php/citoyens/reglements-municipaux`.
- Aucun plan de zonage PDF explicite localise; liens visibles = reglements generaux/modificatifs.
- `work/zonage-norms/aumond/grille.pdf`: grille vide au texte, T1 abort sans georef.

### belcourt
- Page officielle: `http://munbelcourt.ca/services-aux-citoyens/urbanisme-permis-et-inspection`.
- PDFs officiels: `BELCOURT_PLAN-ZONAGE-RURAL_2016.pdf`, `BELCOURT_zonage_urbain_adopte_2013.pdf`.
- T1 urbain et rural: abort, aucun georef embarque.
- T2 urbain existant: `work/gcp/belcourt-urbain.autogcp.shard4.report.json`, fail aucune seed residual+holdout.
- T2 rural existant: `work/gcp/belcourt-rural.autogcp.shard4.report.json`, seeds plausibles mais orientation ambigue et anisotropie non confirmee; meilleur serving 50.3% < 85%, donc skip.

### bethanie
- Page officielle: `https://municipalitedebethanie.ca/documents-publics/reglements-durbanisme/`.
- PDF officiel: `work/zonage-plans/bethanie-reglement-zonage.pdf`.
- T1 abort: aucun georef embarque.
- Texte: annexe B = plan de zonage, mais le PDF de reglement n'offre pas un plan georeference exploitable.
- T2 existant: `work/gcp/bethanie.autogcp.report.json`, fail aucune seed residual+holdout.

### bonaventure
- Page officielle: `https://villebonaventure.ca/services-aux-citoyens/avis-publics-et-reglements/reglements-durbanisme/`.
- PDF officiel: `work/zonage-plans/bonaventure-plan.pdf`.
- T1 detecte GeoPDF: NAD_1983_MTM_5, residu 0.305 m.
- Gate strict page par page: spatial 8.14 a 8.88 km > seuil 8 km.
- Dry-run diagnostic avec `spatial-km=10` sur page 4: seulement 5/20 labels dans bbox, 127/2932 lots assignes (4.33%), code parasite `R2008-568`.
- Conclusion: georef present mais labels/couverture non probants; aucun depot.

### bouchette
- Page officielle: `https://www.bouchette.ca/fr/ma-municipalite/reglements-municipaux/`.
- Liens visibles: reglements generaux; aucun plan de zonage PDF explicite repere.
- `work/zonage-plans/lac-bouchette.pdf` est vide et ne correspond pas a un plan servable pour `bouchette`.

### charette
- Page officielle: `https://www.municipalite-charette.ca/documentation/`.
- Dossier officiel Memphis `Cartographie` interroge via endpoint public `mdocs_ajax`.
- PDFs officiels telecharges:
  - `work/zonage-plans/charette-zonage-territoire.pdf`.
  - `work/zonage-plans/charette-zonage-pu.pdf`.
- T1 sur les deux: abort, aucun georef embarque.
- T2 auto-GCP sur les deux: `svg_points=0`, aucune seed residual+holdout.
- T3 non lance: le wrapper exige un seed local de >=3 GCP grossiers; aucun seed reel disponible.

### chartierville
- Pages officielles: `https://chartierville.ca/sample-page/reglements/`.
- PDFs officiels testes:
  - `work/zonage-plans/chartierville-zonage-concordance-2024-03.pdf`.
  - `work/zonage-plans/chartierville-zonage-modif-2025-03.pdf`.
- T1 sur les deux: abort, aucun georef embarque.
- Ce sont des reglements Word/PDF, pas des plans de zonage georeferencables.

### chertsey
- PDF local officiel: `work/zonage-plans/chertsey.pdf`.
- T1 abort: aucun georef embarque.
- T2 existants: `work/gcp/chertsey.autogcp.report.json`, `work/gcp/chertsey.autogcp.sim.report.json`, `work/gcp/chertsey.autogcp-report.json`; tous fail, aucune seed residual+holdout.

### chibougamau
- Site officiel MAMH: `https://www.ville.chibougamau.qc.ca`.
- Capture: portail citoyen VPlus (`work/zones-recalage/shard0of2/chibougamau-home.refresh.html`).
- Bundle inspecte uniquement pour URLs litterales; aucun PDF statique plan/zonage repere.
- `work/zonage-plans/chibougamau.pdf` est HTML, pas un PDF.

### colombier
- Site officiel MAMH: `https://www.colombierhcn.com`.
- Recuperation `curl` interrompue apres plus d'une minute sans reponse, coherent avec le rapport precedent.
- Aucun PDF officiel recupere dans ce passage.

### maniwaki
- Sources officielles reprises du bloc precedent: `work/pdf-cache/maniwaki-zonage-2025.pdf`, `work/pdf-cache/maniwaki-plan-urbanisme-2025.pdf`.
- T1 sur les deux: abort, aucun georef embarque.
- Aucun plan de zonage exploitable localise dans ces PDFs Word multi-pages pendant ce passage.

## Repioche

Apres le lot, `loop-supervise` rapporte `zones=809` sur 1106. La repioche `zones-recalage-shardN-select --mod 2 --rem 0 --compact` montre encore plusieurs slugs `to-research` car les preuves d'echec ne modifient pas `coverage-matrix.json`; le prochain bloc non traite utile commence apres les slugs consignes ici et les rapports precedents, avec priorite aux slugs qui ont deja des PDFs officiels localises.
