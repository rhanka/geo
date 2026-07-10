# Zones recalage - shard 0/2 - 2026-07-10T165905Z

Shard applique: slugs dont l'index dans la liste triee verifie index % 2 == 0.
Mode: plans PDF municipaux officiels seulement; aucun harvest AGOL owner.

## Depots nets

### les-bergeronnes
- Source officielle: https://www.bergeronnes.com/urbanisme
- PDFs officiels trouves: Plan de zonage 1 et Plan de zonage 2, heberges sur img1.wsimg.com.
- Source servie: work/pdf-cache/les-bergeronnes-plan1.pdf.
- T1: GeoPDF, NAD_1983_MTM_7, residu max 0.978 m, echelle 8.820 m/pt.
- Labels: mode text, 523 mots, 47 codes-like, 47 codes distincts.
- Gate: spatial 4.792 km, 23 features servies, 409/577 lots assignes (70.88%), surface couverte 50.53%.
- Depot: s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-les-bergeronnes.geojson.
- Inline: lot-zone-join OK, 577 lots, assigned 70.88%; lots-enriched OK, zone_code 70.88%, normes 35.01%, adresse 82.84%, depot enrichi OK.
- Note: Plan de zonage 2 a ete teste en dry-run seulement; residu 0.474 m, 34 codes distincts, 185/577 lots assignes (32.06%). Plan 1 garde car meilleure couverture.

### lac-sainte-marie
- Source officielle: https://www.lac-sainte-marie.com/le-conseil/les-reglements
- PDFs officiels trouves: reglement-2024-08-002-zonage.pdf, reglement-2024-08-002-grilles-annexeB.pdf, reglement-2024-08-002-annexes.pdf.
- Source servie: work/pdf-cache/lac-sainte-marie-annexes-2024-08-002.pdf.
- T1: GeoPDF, NAD_1983_MTM_9, residu max 0.188 m, echelle 10.583 m/pt.
- Labels: mode text, 2156 mots, 159 codes-like, 127 codes distincts.
- Gate: spatial 1.352 km, 86 features servies, 2983/2995 lots assignes (99.60%), surface couverte 98.89%.
- Depot: s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-lac-sainte-marie.geojson.
- Inline: lot-zone-join OK, 2995 lots, assigned 99.60%; lots-enriched OK, zone_code 99.60%, normes 12.79%, adresse 85.34%, depot enrichi OK.
- Note qualite: faible taux normes attendu ici, le depot zones georeference est passe les gates.

## Echecs ou preuves consignees

### la-bostonnais
- Sources officielles inspectees: https://labostonnais.ca/accueil, /reglements-urbanisme, /urbanisme, /cartes, /zonage, /plan-urbanisme.
- PDFs officiels trouves sur la page cartes: Plan de zonage - milieu rural et recreoforestier, Plan de zonage - Perimetre urbain.
- Sources locales: work/pdf-cache/la-bostonnais-zonage-rural.pdf, work/pdf-cache/la-bostonnais-zonage-urbain.pdf.
- T1 rural: GeoPDF NAD_1983_MTM_8, residu max 0.540 m, mais labels text = 0 mot, 0 code, 0 code distinct.
- Dict: le fichier officiel /file-24449 est un DOCX codifie, pas un PDF; extraction texte ne donne que des references legales, pas une liste de zones validee.
- Normes registry: depot normes absent pour la-bostonnais.
- Conclusion: plan officiel georeference mais labels glyphes sans dictionnaire municipal valide; aucun depot fabrique.

### la-martre
- Source MAMH: aucune URL de site municipal dans le repertoire local.
- Conclusion: aucune source officielle exploitable identifiee dans ce passage.

### la-morandiere-rochebaucourt
- Sources officielles inspectees: http://www.lamorandiere.ca, pages documents, cartes et plan.
- Resultat: pages HTML capturees, mais aucun lien direct vers un PDF de plan de zonage.
- Conclusion: source plan PDF non trouvee.

### la-patrie
- Sources officielles inspectees: https://www.lapatrie.ca/fr/municipalite/reglement-numero-193-26 et page d'accueil.
- Resultat: page de reglement HTML sans lien PDF de plan de zonage; carte.htm reperee comme carte de situation, pas plan de zonage.
- Conclusion: source plan PDF non trouvee.

### labelle
- Source locale work/zonage-plans/labelle-plan.pdf: document HTML 404, pas un PDF.
- Source locale work/zonage-plans/labelle-reglement.pdf: vrai PDF de reglement, aucun georef embarque.
- Inspection texte: references au plan et annexes, mais pas de page cartographique exploitable localisee dans ce passage.
- Conclusion: source plan PDF non trouvee.

### lac-des-aigles
- Preuves relues: work/gcp/lac-des-aigles.autogcp.shard4.report.json et work/gcp/lac-des-aigles.autogcp.sim.shard4.report.json.
- Resultat: pass=false; orientation ambigue avec deux fits plausibles en desaccord de 90 degres; derniere raison = seulement 4 matches independants.
- Conclusion: pas de depot sans GCP manuel ou preuve de rotation.

### lac-edouard
- Preuves relues: work/gcp/lac-edouard-main.autogcp.shard4.report.json et work/gcp/lac-edouard-plan1.autogcp.shard4.report.json.
- Resultat: pass=false, svg_points=0, aucune seed residual+holdout.
- Conclusion: plan raster/non vectoriel; T3 ou GCP manuel requis.

### lac-poulin
- Sources officielles inspectees: https://www.lacpoulin.ca, pages reglements-municipaux et urbanisme, listes GestionWebLex.
- PDFs officiels telecharges: reglement de zonage 82-06, plan des reglements MAJ, plan d'urbanisme 2006.
- T1 sur reglement de zonage: aucun georef embarque.
- Inspection texte: mention CARTE DE ZONAGE En pochette; page 88 ANNEXES / Plan de zonage.
- T2 autogcp page 88: work/gcp/lac-poulin.autogcp.report.json, pass=false, svg_points=0, aucune seed.
- T3: impossible sans GCP seed initial >=3 points.
- Conclusion: aucun depot.

### lamarche
- Sources officielles tentees: https://www.ville.lamarche.qc.ca, https://ville.lamarche.qc.ca, http://www.ville.lamarche.qc.ca.
- Resultat: certificat invalide ou reponse vide dans le passage; aucun PDF officiel recupere.
- Conclusion: source plan PDF non trouvee.

### lantier
- Preuves relues: work/gcp/lantier.autogcp.shard4.report.json et work/gcp/lantier.autogcp.sim.shard4.report.json.
- Resultat: pass=false; svg_points=22; trop peu de matches independants, aucune seed residual+holdout exploitable.
- Conclusion: T3 ou GCP manuel requis.

## Artefacts crees ou utilises

- work/gcp/lac-poulin.autogcp.report.json
- work/zones-recalage/shard0of2/gestionweblex-doc-list-scripts.js
- work/zones-recalage/shard0of2/la-bostonnais-*.html
- work/zones-recalage/shard0of2/la-morandiere-*.html
- work/zones-recalage/shard0of2/la-patrie-*.html
- work/zones-recalage/shard0of2/lac-poulin-*.html
- work/zones-recalage/shard0of2/lac-poulin-doclist-*.js
- work/zones-recalage/shard0of2/lac-sainte-marie-*.html
- work/zones-recalage/shard0of2/lamarche-home-http.html
- work/zones-recalage/shard0of2/les-bergeronnes-*.html
