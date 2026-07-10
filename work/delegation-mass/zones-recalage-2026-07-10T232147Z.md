# Zones recalage PDF - shard 1/2 - 2026-07-10T232147Z

Shard applique: slugs dont l'index dans la liste triee verifie `index % 2 == 1`.
Mode: PDF municipaux officiels / caches locaux officiels, sans AGOL owner harvest.
Regle anti-invention: aucun depot sans `zone_code` verbatim, vrais GCP/cadastre, gates T1/T2 stricts.

## Reprise de file

Le premier lot courant du selecteur strict etait deja consigne dans
`work/delegation-mass/zones-recalage-2026-07-10T224039Z.md`:
`aguanish, alma, ange-gardien, austin, baie-johan-beetz, begin, blanc-sablon,
boileau, bois-franc, bonne-esperance, bowman, brome`. Je l'ai relu et je n'ai
pas relance ces echecs deja prouves.

## Depot net

### herouxville - SERVI

- Source officielle: page municipale
  `https://www.municipalite.herouxville.qc.ca/gestion-municipale/urbanisme-et-permis/`.
- PDF officiel utilise: `work/zones-recalage/shard1of2/herouxville-zonage-village.pdf`
  (`CARTO-EXTRAIT_PU_203-2011-a-303-2023-omni.pdf`, lien "Zonage - Village").
- T1: rejet honnete, aucun `/VP /Measure /GEO`.
- T2 auto-GCP: `work/gcp/herouxville-village.shard1of2.autogcp.report.json`.
  8 GCP independants, residu max `7.339 m`, holdout max `9.622 m`.
  Anisotropie moderee arbitree par couverture lots: `97.62%` a 1500 m, 40 codes.
- Build: `t2-build.ts --labels text --min-codes 3`, 40 codes reels, 31 features,
  `1352/1385` lots assignes (`97.62%`), gate spatial `0.33 km`, aire couverte `98.02%`.
- Depot S3: `normalized/ca-qc-zonage/qc-zonage-herouxville.geojson`.
- Downstream:
  - `lot-zone-join-run.ts --slugs herouxville`: OK, 1385 lots, `97.98%` assignes,
    parquet/stats verifies, normes match `82.83%`.
  - `lots-enriched-run.ts --slugs herouxville`: OK, depot lots enrichis,
    `zone_code=97.98%`, `norms=81.16%`, `surface=100%`, `code_postal=100%`.

## Echecs / preuves consignees

| slug | verdict | preuve |
|---|---|---|
| eastman | timeout T2 | `work/pdf-cache/eastman.pdf` et `work/pdf-cache/eastman-ensemble.pdf`: T1 rejette absence de `/VP /Measure /GEO`. T2 auto-GCP sur `eastman-ensemble.pdf` a atteint la borne `360s` sans rapport exploitable. Aucun depot. |
| dolbeau-mistassini | echec T2 | `work/zones-recalage/shard1of2/dolbeau-mistassini-regl-1870-22.pdf`: T1 sans georef; T2 `work/gcp/dolbeau-mistassini-regl-1870-22.shard1of2.autogcp.report.json` avec `svg_points=0`, aucun seed. |
| egan-sud | echec T2 | Source officielle page reglements/permis; PDF local `work/zones-recalage/shard1of2/egan-sud-reglement-zonage.pdf`. T1 sans georef; T2 `work/gcp/egan-sud.shard1of2.autogcp.report.json` avec `svg_points=0`, aucun seed. |
| gracefield | echec T2 | Page officielle liste surtout reglements et matrice Geocentriq. `work/pdf-cache/gracefield-zonage-reglement.pdf`: T1 sans georef; T2 `work/gcp/gracefield-zonage-reglement.shard1of2.autogcp.report.json` avec `svg_points=0`, aucun seed. |
| hampden | echec T2 | `work/zones-recalage/shard5/hampden-1.pdf` et `hampden-2.pdf`: T1 sans georef sur les deux; T2 `work/gcp/hampden-1.shard1of2.autogcp.report.json` et `work/gcp/hampden-2.shard1of2.autogcp.report.json` avec `svg_points=0`, aucun seed. |
| herouxville-globale | echec gate, feuillet alternatif servi | Carte globale officielle `work/zones-recalage/shard1of2/herouxville-zonage-globale.pdf`: T2 `work/gcp/herouxville-globale.shard1of2.autogcp.report.json`, 2 seeds passent residu/holdout mais rejets anisotropie forte (`~1.68-1.75`), pas servi. Feuillet Village servi a la place. |

## Superviseur

Relance `loop-supervise.ts` apres depot: `zones=811 (+0 affiche par cache, mais scoreboard total passe a 811)`;
focus-30 toujours manquant: `alma`, `saint-boniface`.

## Bilan

- Slugs avec action nouvelle dans cette passe: 6 (`eastman`, `dolbeau-mistassini`,
  `egan-sud`, `gracefield`, `hampden`, `herouxville`).
- Depots nets: 1 (`herouxville`).
- Echecs gates/source consignes: 5, plus `herouxville-globale` non servi.
- Aucun commit effectue dans cette passe avant revue de l'etat git, car le worktree
  contient de nombreuses modifications preexistantes hors scope.
