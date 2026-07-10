# Zones recalage - shard 0/2 - 2026-07-10T164228Z

Shard applique: slugs dont l'index dans la liste triee verifie `index % 2 == 0`.
Mode: PDF municipal officiel ou cache local deja present; aucun harvest AGOL owner.

## Depot net

### blue-sea
- Source traitee: `work/pdf-cache/blue-sea.pdf` (titre PDF: `PREL-25 MARS 2025_Affectation Blue Sea_24x36`, 1 page).
- T1: echec attendu, aucun `/VP /Measure /GEO`.
- T2 autogcp: `work/gcp/blue-sea.autogcp.report.json`, `pass=true` apres arbitrage anisotropie.
- GCP: 41 GCP independants, residu max 11.700 m, holdout max 11.750 m, couverture service arbitration 87.65%, spatial 1.246 km.
- Build: `t2-build.ts --labels text`, 43 codes distincts, 40 features servies, 2030/2316 lots assignes (87.65%), depot `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-blue-sea.geojson`.
- Inline: `lot-zone-join-run` OK, 2316 lots, assigned 87.74%; `lots-enriched-run` OK, `zone_code=87.74%`, depot enrichi OK.
- Note qualite: warning normes match 0% attendu ici, car les normes repliees ne sont pas encore disponibles; le depot zones est passe les gates.

## Echecs ou preuves consignees - lot initial

### alleyn-et-cawood
- Source locale: `work/pdf-cache/alleyn-et-cawood.pdf`, scan Canon iR2525.
- Preuve existante relue: `work/gcp/alleyn-et-cawood.autogcp.report.json`.
- T1/T2: aucun georef embarque; `svg_points=0`; `pass=false`, raison `no (extent x rotation) seed cleared the residual+holdout gate`.
- Conclusion: T3 ou GCP manuel requis; aucun depot fabrique.

### amherst
- Source officielle inspectee: `https://municipalite.amherst.qc.ca/urbanisme/`.
- PDF local correspondant: `work/pdf-cache/amherst.pdf` (`352-02-Zonage-revise-2017.pdf` publie sur la page officielle).
- T1: aucun georef embarque.
- Inspection texte: reglement de zonage et grilles, pas de plan cartographique PDF distinct exploitable dans ce passage.
- Conclusion: source plan PDF non trouvee; aucun depot.

### aumond
- Source officielle inspectee: `https://www.aumond.ca/index.php/citoyens/reglements-municipaux`.
- Preuve anterieure relue: source `https://www.aumond.ca/images/r%C3%A8glement_2022-06-275-_final_sign%C3%A9.pdf`, reglement/modification 5 pages.
- T1: aucun georef embarque.
- Conclusion: pas de plan cartographique de zonage trouve; aucun depot.

### belcourt
- Sources officielles locales: `work/zonage-plans/belcourt-rural-plan.pdf`, `work/zonage-plans/belcourt-urbain-plan.pdf` depuis `http://munbelcourt.ca/services-aux-citoyens/urbanisme-permis-et-inspection`.
- Preuves relues: `work/gcp/belcourt-rural.autogcp.shard4.report.json`, `work/gcp/belcourt-urbain.autogcp.shard4.report.json`.
- Rural: 15 seeds passent residu/holdout mais aucune ne passe orientation/isotropie; disambiguation rotation non decisive; arbitrage anisotropie refuse (meilleure couverture service 50.3% < 85%).
- Urbain: `pass=false`, aucun seed residual+holdout; au plus 3 GCP independants apres pruning.
- Conclusion: pas de depot sans controle/GCP manuel.

### bethanie
- Source officielle: `https://municipalitedebethanie.ca/documents-publics/reglements-durbanisme/`, PDF `Reglement-Zonage-Bethanie.pdf`.
- T1: aucun georef embarque.
- Inspection texte: page 190 = `ANNEXE B PLAN DE ZONAGE`.
- T2 page 190: `work/gcp/bethanie.autogcp.report.json`, `svg_points=0`, `pass=false`, aucune seed residual+holdout.
- Conclusion: plan annexe raster/non vectoriel; T3 ou GCP manuel requis.

### bonaventure
- Source officielle locale: `work/zonage-plans/bonaventure-plan.pdf`, URL publiee sur `https://villebonaventure.ca/services-aux-citoyens/avis-publics-et-reglements/reglements-durbanisme/` (`PZ_PLAN-complet_REG2006-543_REG2021-745_Mai.2021.pdf`).
- T1: GeoPDF ArcMap, `NAD_1983_MTM_5`, residu 0.31 m, 19 codes distincts.
- Gate spatial: echec sur global et pages 1-4; distances label-centroid/cadastre = 8.14 a 8.88 km (> 8 km).
- Conclusion: rejet spatial strict; aucun seuil relache.

### bouchette
- Source officielle inspectee: `https://www.bouchette.ca/fr/ma-municipalite/reglements-municipaux/`.
- Liens trouves: parties du reglement de zonage (`reglement-85-zonage-partie-i/ii/iii`), aucun plan/carte PDF distinct.
- Conclusion: source plan PDF non trouvee dans ce passage.

### charette
- Sources officielles inspectees: `https://www.municipalite-charette.ca/urbanisme/`, `https://www.municipalite-charette.ca/documentation/`.
- Resultat: aucun lien PDF de plan de zonage publie dans les pages statiques capturees; seulement contact urbanisme et librairie documents.
- Conclusion: source plan PDF non trouvee dans ce passage.

### chartierville
- Preuve anterieure relue: `https://chartierville.ca/wp-content/uploads/2025/04/Reglement-2025-03-Modifiant-reglement-de-zonage-corriger-RU-7.pdf`.
- T1: aucun georef embarque.
- Conclusion: PDF de modification, pas un plan cartographique; aucun depot.

### chertsey
- Source locale: `work/zonage-plans/chertsey.pdf`.
- Preuve relue: `work/gcp/chertsey.autogcp.report.json`.
- T2: `svg_points=0`, aucune tentative exploitable, `pass=false`.
- Conclusion: raster/non-georef, T3 ou GCP manuel requis.

### chibougamau
- Source officielle inspectee: `https://www.ville.chibougamau.qc.ca`.
- Resultat: page PWA VPlus, bundle principal telecharge, aucun PDF de zonage/plan expose comme URL litterale.
- Conclusion: source plan PDF officielle non trouvee; aucun harvest SIG/AGOL tente.

## Echecs ou preuves consignees - nouveau lot

### colombier
- Site officiel repere: `https://www.colombierhcn.com`.
- Non traite en profondeur dans ce passage faute de source PDF locale; a reprendre par decouverte officielle.

### cote-nord-du-golfe-du-saint-laurent
- Preuve anterieure relue dans `work/delegation-mass/zones-recalage-2026-07-10T123411Z-shard0.md`.
- Resultat: site MAMH `https://www.mun-cngsl.ca` / `http://www.mun-cngsl.ca`, DNS echoue.
- Conclusion: aucun PDF officiel recuperable dans le passage anterieur borne.

### desbiens
- Preuve anterieure relue dans `work/delegation-mass/zones-recalage-2026-07-10T123411Z-shard0.md`.
- Source locale: `work/zonage-plans/desbiens.pdf`, scan de reglement 188 pages.
- T1: aucun georef embarque; premieres pages scannees; pas de plan autonome exploitable trouve.

### duhamel
- Source officielle connue: `https://www.municipalite.duhamel.qc.ca/public_upload/files/URBANISME/Plan%20de%20zonage%20-%20feuillet%203-%202023.pdf`.
- Preuve T1 dry-run relue: `work/delegation-mass/zones-cadence-Z3-20260709T1825Z/duhamel-t1-dry-spatial12/qc-zonage-duhamel.stats.json`.
- T1: GeoPDF, residu 0.078 m, 38 codes distincts, mais spatial 9.575 km et seulement 16/218 lots assignes (7.34%), 1 feature servie en dry-run.
- T2 rapports existants: `work/gcp/duhamel.autogcp.report.json`, `work/gcp/duhamel-f2.shard2.autogcp.report.json`; pas de seed acceptable sous orientation/isotropie.
- Conclusion: gate spatial/couverture refuse; aucun depot.

### eeyou-istchee-james-bay
- Site officiel repere: `https://www.greibj.ca`.
- Non traite en profondeur dans ce passage faute de source PDF locale; a reprendre par decouverte officielle.

### fassett
- Sources locales: `work/zonage-plans/fassett-plan.pdf`, `work/pdf-cache/fassett.pdf`.
- T2 preuve relue: `work/gcp/fassett.autogcp.shard4.report.json`.
- Resultat: scan Canon, `svg_points=0`, aucune seed residual+holdout.
- Conclusion: T3 ou GCP manuel requis.

### forestville
- Source locale: `work/pdf-cache/forestville-carte3.pdf`.
- T1: aucun georef embarque.
- T2: `work/gcp/forestville.autogcp.report.json`, `pass=false`; un seed passe residu/holdout mais echoue orientation north-up, pas d'arbitrage decisive.
- Conclusion: pas de depot.

### grand-remous
- Sources locales inspectees: `work/zonage-plans/grand-remous-home*.html`, `work/zonage-plans/grand-remous-urbanisme.html`, `work/zonage-plans/grand-remous-reglements.html`.
- Non traite en profondeur dans ce passage; a reprendre par decouverte officielle du plan PDF.

### grandes-piles
- Source locale: `work/pdf-cache/grandes-piles.pdf`.
- T1: aucun georef embarque.
- T2: `work/gcp/grandes-piles.autogcp.report.json`, `pass=false`; seulement 396 points SVG, aucun seed avec >=6 GCP independants.
- Conclusion: T3 ou GCP manuel requis.

### hatley
- Source locale: `work/pdf-cache/hatley-f1.pdf`.
- T1: GeoPDF `NAD_1983_CSRS_MTM_8`, residu 0.23 m, 121 codes distincts.
- Gate spatial: label-centroid/cadastre = 11.70 km (> 8 km).
- Conclusion: mauvais feuillet/municipalite probable; aucun seuil relache.

### hebertville
- Preuve anterieure relue dans `work/delegation-mass/zones-recalage-2026-07-10T123411Z-shard0.md`.
- Source locale: `work/zonage-plans/hebertville-reglement.pdf`, reglement 229 pages.
- T1: aucun georef embarque; pas de plan cartographique trouve dans les pages inspectees.

### inverness
- Source locale: `work/zonage-plans/inverness.pdf`.
- T2 preuve relue: `work/gcp/inverness.autogcp.report.json`.
- Resultat: scan/image conversion, `svg_points=0`, aucune seed residual+holdout.
- Conclusion: T3 ou GCP manuel requis.

### kipawa
- Preuve anterieure relue dans `work/delegation-mass/zones-recalage-2026-07-10T123411Z-shard0.md`.
- Resultat: site officiel accessible seulement avec certificat invalide; page cartes sans PDF de plan de zonage.

## Artefacts crees ou utilises

- `work/gcp/blue-sea.autogcp.json`
- `work/gcp/blue-sea.autogcp.report.json`
- `work/gcp/bethanie.autogcp.report.json`
- `work/gcp/forestville.autogcp.report.json`
- `work/gcp/grandes-piles.autogcp.report.json`
- `work/zones-recalage/shard0of2/*.html`
- `work/zones-recalage/shard0of2/chibougamau-main.js`

