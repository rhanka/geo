# Zones recalage - shard 0/2 - 2026-07-10T224607Z

Shard applique: slugs dont l'index dans la liste triee verifie `index % 2 == 0`.
Mode: plans PDF municipaux officiels seulement; aucun harvest AGOL owner.

## Depot net

### louiseville
- Source officielle deja telechargee: `work/pdf-cache/louiseville-zonage-agricole-622.pdf` (Plan de zonage reglement 622 agricole, 1 page, depuis `https://www.louiseville.ca`).
- T1 texte: echec attendu sur `louiseville-zonage-622-mai2024.pdf` et `louiseville-zonage-agricole-622.pdf`, aucun `/VP /Measure /GEO`.
- T2 sur le plan 2024: `work/gcp/louiseville-mai2024.autogcp.report.json`, `svg_points=0`, aucune seed residual+holdout.
- T2 sur le plan agricole: `work/gcp/louiseville-agricole.autogcp.report.json`, `pass=true` apres arbitrage anisotropie.
- Preuves GCP: 45 GCP independants, residu max 9.345 m, holdout max 7.778 m, anisotropie moderee 1.280 confirmee par couverture service 95.8%, spatial 2.012 km.
- Build: `t2-build.ts --labels text --require-independent-gcps`, 26 codes distincts, 24 features servies, 3967/4141 lots assignes (95.8%), depot `s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-louiseville.geojson`.
- Inline: `lot-zone-join-run` OK, 4141 lots, assigned 95.8%, match 100%, parquet/stats verifies; `lots-enriched-run` OK, `zone_code=95.8%`, `norms=95.8%`, `adresse=99.47%`, `code_postal=100%`, depot enrichi OK.

## Echecs ou preuves consignees

### lot initial relu
- Les slugs `alleyn-et-cawood`, `amherst`, `aumond`, `belcourt`, `bethanie`, `bonaventure`, `bouchette`, `charette`, `chartierville`, `chertsey`, `chibougamau` et `colombier` ont ete relus depuis `work/delegation-mass/zones-recalage-2026-07-10T164228Z-shard0of2.md`.
- Conclusion conservee: aucun depot net sans fabriquer de georef, de GCP ou de source; les raisons principales sont scan/raster sans vecteur, absence de plan PDF officiel, ou gates spatial/orientation refuses.

### colombier
- Site officiel MAMH: `https://www.colombierhcn.com`.
- Reverification curl: timeout de connexion apres 35 s, identique a la preuve partielle anterieure.
- Conclusion: aucun PDF officiel recuperable dans la fenetre; aucun depot.

### maniwaki
- Sources officielles deja telechargees depuis `https://www.ville.maniwaki.qc.ca`: `work/pdf-cache/maniwaki-zonage-2025.pdf` et `work/pdf-cache/maniwaki-plan-urbanisme-2025.pdf`.
- `pdfinfo`: le reglement de zonage est un export Word, 142 pages, letter; l'annexe 2 "Plan de zonage" est localisee autour de la page 84.
- T2 page 84: `work/gcp/maniwaki-p84.autogcp.report.json`, `svg_points=0`, aucune seed residual+holdout.
- T2 page 85: `work/gcp/maniwaki-p85.autogcp.report.json`, `svg_points=14`, au plus 3 matches independants apres pruning, donc < seuil.
- T3: non lance, car `t2-raster-register.ts` exige un seed GCP local >=3 controles + cadastre local; aucun seed fiable n'existe ici. Conclusion: raster/scan a seed manuel requis, aucun depot fabrique.

### longue-pointe-de-mingan
- Site officiel: `https://longuepointedemingan.ca`.
- Reverification avec `curl -k`: page officielle accessible; la page `documentation-et-formulaires` est une interface dynamique sans lien statique PDF de plan de zonage visible dans la capture texte.
- Conclusion: source plan PDF non trouvee dans la fenetre; aucun depot.

### marsoui
- Site officiel attendu: `https://marsoui-village.ca`.
- Reverification curl: DNS impossible (`Could not resolve host`).
- Conclusion: aucun PDF officiel recuperable dans la fenetre; aucun depot.

## Artefacts crees

- `work/gcp/louiseville-agricole.autogcp.json`
- `work/gcp/louiseville-agricole.autogcp.report.json`
- `work/gcp/louiseville-mai2024.autogcp.report.json`
- `work/gcp/maniwaki-p84.autogcp.report.json`
- `work/gcp/maniwaki-p85.autogcp.report.json`
- `work/zones-recalage/shard0of2/louiseville-agricole-t2-dry/qc-zonage-louiseville.geojson`
- `work/zones-recalage/shard0of2/louiseville-agricole-t2-dry/qc-zonage-louiseville.stats.json`
- `work/zones-recalage/shard0of2/louiseville-agricole-t2-deposit/qc-zonage-louiseville.geojson`
- `work/zones-recalage/shard0of2/louiseville-agricole-t2-deposit/qc-zonage-louiseville.stats.json`
- `work/delegation-mass/zones-recalage-2026-07-10T224607Z-shard0of2.md`
- `work/delegation-mass/zones-recalage-2026-07-10T224607Z-shard0of2.json`

