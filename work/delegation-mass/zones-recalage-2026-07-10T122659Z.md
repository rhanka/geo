# Recalage PDF zones — shard 1/6 — 2026-07-10T122659Z

Shard traite: slugs dont `(index trie) % 6 == 1`.

## Depot net

### barkmere — SERVI

- Source officielle: `https://barkmere.ca/wp-content/uploads/2020/08/Annexe_1_Plan_de_zonage.pdf`
- Voie: T2 autogcp, affine avec arbitrage anisotropie par couverture-lots.
- GCP: 36 points reels cadastre/linework, residu max `13.444 m`, RMS `5.435 m`, holdout max `13.649 m`.
- Labels: `27` codes reels textuels, `27` in-frame, `0` rejet hors cadre.
- Spatial gate: `0.68 km` entre centroide labels et cadastre.
- Sortie: `23` features, `549/549` lots assignes, couverture `100%`, aucun code invente.
- Depot S3: `normalized/ca-qc-zonage/qc-zonage-barkmere.geojson`.
- Downstream:
  - `lot-zone-join-run.ts --slugs barkmere`: OK, `549` lignes, `100%` assigne, parquet/stats verifies, match normes `11.11%` (warning normes).
  - `lots-enriched-run.ts --slugs barkmere`: OK, depot `qc-lots`, zone_code `100%`, surface `100%`, code_postal `100%`, adresse `99.82%`.

## Echecs consignes

| slug | verdict | preuve |
|---|---|---|
| alma | non servi | T1: pas de `/VP /Measure /GEO`; T2 autogcp: PDF AutoCAD geant, `ERR_STRING_TOO_LONG` pendant extraction SVG. |
| austin | non servi | T1 georef OK `0.16 m`, lectures Claude `125/125` dict-validees, mais cadastre S3 absent: `normalized/qc-cadastre-lots/austin.geojson` retourne `NoSuchKey`. |
| blanc-sablon | non servi | Scan site officiel `13` pages: aucun PDF plan/zonage exploitable. |
| brome | non servi | Scan site officiel `25` pages: aucun PDF plan/zonage exploitable. |
| cacouna | non servi | Cache local invalide (`ASCII text`, 16 octets); site officiel retourne erreur SSL/525 sur pages directes; scan `11` pages sans hit PDF zonage. |
| cap-chat | non servi | Carte officielle `CARTECap-Chat.pdf` T1 georef OK `2.96 m`, mais `pdftotext` lit `0` codes; crop Claude montre une carte imagerie/contraintes littorales sans labels de zone. Dict reglement extrait mais non utilise pour servir faute de labels positionnes. |
| clarendon | non servi | Scan site officiel `24` pages: aucun PDF plan/zonage exploitable. |
| dolbeau-mistassini | non servi | Scan officiel trouve seulement plans non-zonage (parcs, hierarchie des rues, PAE/PIIA); matrice indiquait deja mauvais document plan d'urbanisme non georeference. |
| eastman | non servi | T1: pas de georef embarque; T2 autogcp interrompu au-dela du budget par slug, aucun rapport exploitable. |
| gaspe | non servi | T1: pas de georef embarque; T2: `13` seeds passent residu/holdout mais aucun ne passe orientation/isotropie, donc rejet. |
| gracefield | non servi | Scan officiel trouve des reglements de zonage texte, pas de plan PDF georeferencable; pas de depot. |

## Repioche

Apres relance `loop-supervise`, le prochain lot shard 1/6 commence a `grande-vallee`, `hebertville-station`, `kazabazua`, `lac-bouchette`, `lac-sergent`, `laforce`, `lascension-de-notre-seigneur`, `laurierville`, `lebel-sur-quevillon`, `lisle-verte`, `longue-rive`, `massueville`.

