# Recalage PDF zones - shard 2/6 - 2026-07-10T123321Z

Branche: feat/cadre-acquisition.
Shard applique: slugs tries dont index % 6 == 2.
Mission: servir des zonages municipaux reels depuis plans PDF officiels, sans AGOL owner harvest.

## Synthese

- Shard non-done au depart: 56 slugs.
- Lots de decouverte PDF traites: 5 lots de 12/12/12/12/8 slugs.
- Depot net: saint-armand.
- Rejets probants traites dans ce passage: duhamel, stanstead--memphremagog--2, saint-isidore-de-clifton, saint-telesphore, trois-rives, saint-louis-de-gonzague--beauharnois-salaberry.
- Aucun code de zone invente; tous les depots passent par t2-build/t1-build et leurs gates.

## Depot reussi

### saint-armand

Source locale du run: work/gcp/saint-armand.autogcp.json.
Preuve d'arbitrage: work/gcp/saint-armand.arb.report.json.

Resultat:
- t2-autogcp aniso-arbitrate: pass=true, best density+10% rot0.
- Arbitrage: anisotropie moderee confirmee par cadastre, coverage serving 90.72%, tight 54.79%, 286 codes, residual 26.823 m, holdout 26.147 m.
- t2-build live: 46 GCP independants, residual max 26.823 m, 286 codes distincts, 862 labels in-frame, spatial 0.552 km, 143 features, 929/1024 lots assignes (90.72%).
- Depot S3: normalized/ca-qc-zonage/qc-zonage-saint-armand.geojson.

Aval immo:
- lot-zone-join-run: OK saint-armand lots=1024 assigned=90.72%, parquet=Y, stats=Y.
- lots-enriched-run: OK saint-armand lots=1024 zone_code=90.72%, surface=100%, code_postal=100%, adresse=99.61%, deposit=Y.
- A noter: match normes faible (4.59% a 5.06% selon etape), donc zonage servi mais grilles/normes a ameliorer separement.

## Rejets / preuves

### duhamel

Sources:
- work/delegation-mass/zones-recalage-shard2-20260710-batch1.gdal-candidates.json
- work/t1-duhamel-f1/qc-zonage-duhamel.stats.json
- work/t1-duhamel-f3/qc-zonage-duhamel.stats.json
- work/gcp/duhamel-f2.shard2.autogcp.report.json

Preuves:
- Feuillet 3 officiel detecte GeoPDF: Plan de zonage - feuillet 3 - 2023, ArcGIS ESRI, /Measure + /Viewport, 38 zone tokens.
- Feuillet 1 T1: georef residual 0.078 m, 19 codes, mais 0/218 lots assignes; label spatial 17.602 km.
- Feuillet 3 T1: georef residual 0.078 m, 38 codes, mais seulement 16/218 lots assignes (7.34%), spatial 9.575 km, 2/48 labels dans bbox au diagnostic precedent. Pas de depot.
- Feuillet 2: T1 abort no /VP /Measure /GEO. T2 auto-seed local: 9 seeds passent residual/holdout, mais aucun ne passe orientation/isotropy; pas de GCP gagnant.

Verdict: non depose. Les gates geometriques et couverture-lots refusent.

### stanstead--memphremagog--2

Sources:
- work/delegation-mass/zones-recalage-shard2-20260710-batch5.gdal-candidates.json
- work/gcp/stanstead--memphremagog--2.shard2.autogcp.report.json
- work/gcp/stanstead--memphremagog--2.shard2.sim.autogcp.report.json
- work/delegation-mass/zones-recalage-shard2-20260710-stanstead-ville-plan.pdf

Preuves:
- Le scan automatique a trouve un GeoPDF de cantonstanstead.ca, mais ce PDF est pour le Canton de Stanstead, pas la Ville de Stanstead du slug stanstead--memphremagog--2.
- T1 sur ce PDF Canton avec le slug Ville: georef OK, 77 codes, mais spatial 12.09 km du cadastre Ville. Rejet homonyme correct.
- Source officielle Ville trouvee sur stanstead.ca/reglements-municipaux: Plan de zonage 2012-URB-02.
- T1 Ville: abort no /VP /Measure /GEO.
- T2 affine Ville: 19 seeds passent residual/holdout, mais aucun ne passe orientation/isotropy (anisotropie dure 2.05 a 5.46 ou orientation non north-up).
- T2 similarity Ville: aucun seed ne passe residual/holdout.

Verdict: non depose.

### saint-isidore-de-clifton

Le lot 4 a confirme trois PDFs officiels de carte de zonage, mais tous sont des scans Toshiba sans marqueurs georef ni texte exploitable:
- CARTE-DE-ZONAGE-COMPLET-DETAILLE-1.pdf: markers=[], zoneTok=0, producer=TOSHIBA e-STUDIO255.
- CARTE-DE-ZONAGE-COMPLET-1.pdf: markers=[], zoneTok=0, producer=TOSHIBA e-STUDIO2555C.
- CARTE-DE-ZONAGE-VILLAGE-1.pdf: markers=[], zoneTok=0, producer=TOSHIBA e-STUDIO2555C.

Verdict: T1/T2 non exploitables; T3 raster-register seulement, avec labels image/dict requis.

### saint-telesphore

Plan trouve: Carte-zonage-Annexe-1-Plan-30-06-09.pdf.
Preuve: markers=[], zoneTok=8, producer=PScript5.dll Version 5.2.2.

Verdict: PDF avec quelques codes texte mais sans georef; pas de depot dans ce passage.

### trois-rives

Plan trouve dans le lot 5: Trois-Rives_Reglement-2016-03_Annexe-A_Plan-zonage.pdf.
Preuve: markers=[], zoneTok=0, producer=Microsoft Office Word 2007.

Verdict: non georef, pas exploitable T1/T2.

### saint-louis-de-gonzague--beauharnois-salaberry

Plans trouves dans le lot 5:
- Plan-SLG-16-125-01-Annexe-B_1.pdf
- Plan-SLG-16-125-02-Annexe-B_2.pdf

Preuve: markers=[], zoneTok=0, producer=Microsoft Print To PDF pour les deux.

Verdict: annexe/plans non georef sans codes; pas de depot.

## Decouverte par lots

- Batch 1: 12 villes, 3 planLinks, 1 telecharge, 1 GeoCandidate, 6 noPlanLink. Candidat unique: duhamel.
- Batch 2: 12 villes, 0 planLinks, 0 GeoCandidate.
- Batch 3: 12 villes, 0 planLinks, 0 GeoCandidate.
- Batch 4: relance courte interrompue avant ecriture JSON sur un domaine lent; preuves console utiles pour saint-isidore-de-clifton et saint-telesphore consignees ci-dessus.
- Batch 5: 8 villes, 6 planLinks, 6 telecharges, 2 GeoCandidates. Les deux GeoCandidates sont pour le Canton de Stanstead; celui de zonage est un homonyme du slug Ville, celui d'affectation est hors zonage.

## Superviseur

Avant travaux: zones=797 au premier loop-supervise.
Apres depot/enrichissement: zones=803 au loop-supervise final.

Commandes aval executees pour saint-armand:
- npx tsx acquisition/src/t2-build.ts --slug saint-armand --gcp work/gcp/saint-armand.autogcp.json --labels text --source t2-autogcp-aniso --confidence contour-auto-gcp-aniso
- npx tsx acquisition/src/lot-zone-join-run.ts --slugs saint-armand
- npx tsx acquisition/src/lots-enriched-run.ts --slugs saint-armand
