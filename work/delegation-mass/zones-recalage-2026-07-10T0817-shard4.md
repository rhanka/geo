# Zones recalage PDF - shard 4/6 - 2026-07-10T0817

Shard: slugs dont l'index trie modulo 6 vaut 4.
Lot traite: 12 slugs PDF prioritaires depuis `work/coverage/coverage-matrix.json`.

## Depots

### lac-tremblant-nord

- Index shard: 292
- Source officielle: `https://lac-tremblant-nord.qc.ca/wp-content/uploads/2026/04/ZONAGE_LAC_TREMB_NORD_2026_03.pdf`
- Fichier local: `work/zonage-plans/lac-tremblant-nord-plan.pdf`
- Methode: T1 GeoPDF embarque, labels `text`
- Georef: `NAD_1983_MTM_8`, residu 0.29 m, echelle 3.528 m/pt
- Labels: 29 codes-like, 28 codes distincts in-frame
- Sortie: `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-lac-tremblant-nord.geojson`
- Resultat gate: 27 features servies, 336/336 lots assignes, surface couverte 100 %
- Inline immo: `lot-zone-join-run.ts` OK, `lots-enriched-run.ts` OK

## Echecs consignes

### belcourt

- Index shard: 46
- Sources officielles:
  - `http://munbelcourt.ca/documents/medias/BELCOURT_PLAN-ZONAGE-RURAL_2016.pdf`
  - `http://munbelcourt.ca/documents/medias/BELCOURT_zonage_urbain_adopté_2013.pdf`
- T1: aucun georeferencement embarque detecte.
- T2 rural: rejet orientation/isotropie; des candidats existent mais aucune orientation decisive. Meilleur arbitrage rot90: tight 3.55 %, serving 53.85 %, 47 codes, spatial 2.361 km, gap 0 pt.
- T2 urbain: 3 correspondances independantes maximum apres pruning, seuil minimal non atteint.
- Preuves: `work/gcp/belcourt-rural.autogcp.shard4.report.json`, `work/gcp/belcourt-urbain.autogcp.shard4.report.json`.

### bethanie

- Index shard: 52
- Source officielle trouvee: `https://municipalitedebethanie.ca/wp-content/uploads/2023/10/Reglement-Zonage-Bethanie.pdf`
- T1: aucun georeferencement embarque.
- Blocage: la source officielle expose le reglement texte; l'annexe B mentionne un plan de zonage mais aucun PDF de plan georeferencable n'a ete trouve dans les pages publiques consultees.

### bonaventure

- Index shard: 64
- Source officielle: `https://villebonaventure.ca/wp-content/uploads/2021/07/PZ_PLAN-complet_REG2006-543_REG2021-745_Mai.2021.pdf`
- T1: GeoPDF embarque detecte (`NAD_1983_MTM_5`, residu 0.31 m, 19 codes distincts), mais gate spatial strict echoue.
- Rejets:
  - toutes pages: spatial 8.64 km > seuil 8 km
  - page 1: 8.40 km > 8 km
  - page 2: 8.88 km > 8 km
  - page 3: 8.29 km > 8 km
  - page 4: 8.14 km > 8 km
- Decision: pas de relaxation du seuil, donc pas de depot.

### charette

- Index shard: 100
- Sources consultees: site officiel, page urbanisme, page documentation.
- Blocage: aucune source PDF de plan de zonage trouvee dans les pages officielles consultees; la page urbanisme expose seulement les contacts/formulaires.

### fassett

- Index shard: 172
- Source officielle: `http://www.village-fassett.com/wp-content/uploads/Carte-urbanisme-_Zonage-2023.pdf`
- T1: aucun georeferencement embarque.
- T2: aucun point SVG/vectoriel exploitable (`svg_points=0`).
- T3: plan raster/scan sans seed GCP cadastre local disponible dans la boucle courte; pas de depot.
- Preuve: `work/gcp/fassett.autogcp.shard4.report.json`.

### grand-remous

- Index shard: 196
- Sources consultees: site officiel, variantes avec et sans `www`, pages urbanisme/reglements.
- Blocage: pages publiques recuperees sous forme de coquille sans liens PDF ni contenu zonage exploitable; aucun plan officiel statique trouve dans le delai par slug.

### la-martre

- Index shard: 250
- Source MAMH: aucun site web municipal renseigne dans le repertoire local.
- Tentatives directes: `lamartre.ca` et `www.lamartre.ca` resolvent en erreur DNS.
- Blocage: aucun plan PDF officiel trouve; pas de builder lance.

### lac-des-aigles

- Index shard: 274
- Source officielle: `https://www.lacdesaigles.ca/images/stories/Urbanisme/13060_ZONAGE_TOUT.pdf`
- T1: aucun georeferencement embarque.
- T2 affine: candidats forts, mais rejet par ambiguite d'orientation. Une tentative `full rot0` passe localement le gate affine (8 GCP, residu max 9.843 m, holdout 10.479 m, anisotropie 1.057), mais le rapport global detecte deux fits plausibles divergeant de 90 degres.
- T2 similarite: aucune graine etendue/rotation ne passe.
- Decision: pas de depot sans orientation decisive.
- Preuves: `work/gcp/lac-des-aigles.autogcp.shard4.report.json`, `work/gcp/lac-des-aigles.autogcp.sim.shard4.report.json`.

### lac-edouard

- Index shard: 280
- Sources officielles:
  - `https://www.lacedouard.ca/file-12435`
  - `https://www.lacedouard.ca/file-12436`
- T1: aucun georeferencement embarque.
- T2: aucun point SVG/vectoriel exploitable (`svg_points=0`) sur les deux plans.
- T3: plans raster/scan sans seed GCP cadastre local disponible dans la boucle courte; pas de depot.
- Preuves: `work/gcp/lac-edouard-main.autogcp.shard4.report.json`, `work/gcp/lac-edouard-plan1.autogcp.shard4.report.json`.

### lantier

- Index shard: 304
- Sources locales officielles deja presentes: `work/zonage-plans/lantier-plan.pdf`, `work/zonage-plans/lantier-reglement.pdf`.
- Dictionnaire reel: `work/zonage-dicts/lantier.codes.json` (`A-19`, `C-61`, `F-14`, `H-3`, `P-41`, `Q-2`, `R-13`).
- T1: aucun georeferencement embarque.
- T2 affine/similarite: 5 correspondances independantes maximum apres pruning, seuil minimal non atteint.
- Preuves: `work/gcp/lantier.autogcp.shard4.report.json`, `work/gcp/lantier.autogcp.sim.shard4.report.json`.

### lingwick

- Index shard: 340
- Source officielle: `https://www.lingwick.ca/_files/ugd/d481fd_af3d20b415374fcf85b250b795f87b90.pdf`
- T1: aucun georeferencement embarque.
- T2: nombreux candidats GCP, mais extraction labels/code coverage a 0; rejet par ambiguite d'orientation et arbitrage aniso insuffisant (`serving=0 %`).
- Decision: pas de depot sans codes verbatim assignables.
- Preuve: `work/gcp/lingwick.autogcp.shard4.report.json`.

## Bilan lot

- Slugs traites: 12
- Depots reussis: 1 (`lac-tremblant-nord`)
- Echecs consignes: 11
- Aucun zonage fabrique; les gates stricts ont ete conserves.
