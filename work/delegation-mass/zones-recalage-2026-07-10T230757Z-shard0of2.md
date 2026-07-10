# Zones recalage - shard 0/2 - 2026-07-10T230757Z

Shard applique: slugs dont l'index dans la liste triee verifie `index % 2 == 0`.
Mode: plans PDF municipaux officiels ou caches locaux deja presents; aucun harvest AGOL owner.

## Depots nets

### louiseville
- Source officielle locale: `work/pdf-cache/louiseville-zonage-agricole-622.pdf`, plan de zonage agricole reglement 622.
- T2 autogcp existant: `work/gcp/louiseville-zonage-agricole-622.gcp.json`, 45 GCPs.
- Build: `t2-build.ts --labels text`, residu max 9.345 m, RMS 4.003 m, spatial 2.012 km.
- Resultat: 26 codes distincts, 24 features servies, 3967/4141 lots assignes (95.8%).
- Depot: `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-louiseville.geojson`.
- Inline: `lot-zone-join-run` OK, 4141 lots, assigned 95.8%, match normes 100%, parquet/stats OK.
- Enrichissement: `lots-enriched-run` OK, `zone_code=95.8%`, `norms=95.8%`, depot OK.

### peribonka
- Sources officielles locales: `work/zonage-plans/peribonka-plan.pdf` et `work/zonage-plans/peribonka-zone-urbaine-1.pdf`.
- Dictionnaire: `work/zonage-dicts/peribonka.codes.json`, 73 codes.
- Voie: T1 GeoPDF multi-feuillets + lectures Claude deja presentes (`peribonka-fullpage.reads.json`, `peribonka-zone-urbaine-1-fullpage.reads.json`).
- Georef: NAD_1983_MTM_8, residus 0.169 m et 0.302 m.
- Labels: 30 lectures, 30 validees, 27 codes distincts.
- Resultat: 25 features servies, 526/952 lots assignes (55.25%), spatial 1.597 km.
- Depot: `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-peribonka.geojson`.
- Inline: `lot-zone-join-run` OK avec avertissement qualite (assigned 55.57% < 70%, normes 0%).
- Enrichissement: `lots-enriched-run` OK, `zone_code=55.57%`, `norms=0%`, depot OK.

## Echecs gates / preuves consignees

### maniwaki
- Source: `work/pdf-cache/maniwaki-zonage-2025.pdf`, reglement 142 pages avec Annexe 2 plan de zonage.
- T1: ABORT, aucun `/VP /Measure /GEO`.
- T2 preuves existantes: `work/gcp/maniwaki-p84.autogcp.report.json` et `work/gcp/maniwaki-p85.autogcp.report.json`.
- Resultat T2: p84 `svg_points=0`; p85 `svg_points=14`; aucune seed residual+holdout.

### matagami / montcalm / montebello / montpellier / north-hatley / noyan / saint-adelphe
- Tests T1 directs sur PDFs locaux.
- Resultat: ABORT anti-invention, aucun georeferencement embarque parseable (`/VP /Measure /GEO` absent).

### notre-dame-de-bonsecours
- Source locale testee: `work/zonage-plans/notre-dame-de-bonsecours.pdf`.
- Resultat: le fichier est du HTML sous extension `.pdf`; T1 ABORT, aucun georef parseable.

### rougemont
- Source: `work/zonage-plans/rougemont-urbain-2026.pdf`.
- T1 texte: GeoPDF detecte mais 0 code in-frame; codes glyphes numeriques.
- Dictionnaire: `work/zonage-dicts/rougemont.codes.json`.
- Voie Claude/dict tentee avec `work/zonage-dicts/rougemont.reads.json`, 49 lectures toutes validees et relaxation numerique dict-gatee OK.
- Rejet strict: gate spatial echoue, labels a 2571.03 km du cadastre; pas de depot.
- T2 autogcp: 16 seeds passent residual+holdout, mais aucune ne passe orientation/isotropie; pas de depot.

### sainte-louise
- Source: `work/pdf-zonage/sainte-louise.pdf`.
- T1: aucun georef embarque.
- T2 autogcp: `svg_points=0`, aucune seed residual+holdout.

### sainte-anne-de-la-pocatiere
- Source: `work/pdf-zonage/sainte-anne-de-la-pocatiere.pdf`.
- T1: aucun georef embarque.
- T2 autogcp + `--aniso-lot-arbitrate`: 19 seeds passent residual+holdout, mais aucune ne passe orientation/isotropie.
- Arbitrage anisotropie: meilleur candidat `density+10%/rot0`, serving coverage 76.45% < 85%; SKIP.

### saint-telesphore
- Source: `work/pdf-zonage/saint-telesphore.pdf`.
- T1: aucun georef embarque.
- T2 autogcp + `--rotation-disambig lots --aniso-lot-arbitrate`: orientation non decisive, gagnant rot180 vs rot0 avec marge tight 0.1 pt < 15 pt.
- Arbitrage anisotropie: serving coverage 78.65% < 85%; SKIP.

## Hors shard

`alma` a ete verifie car focus-30 manquant, mais son index trie est 7 donc `7 % 2 == 1`; il appartient a l'autre shard et n'a pas ete traite.

