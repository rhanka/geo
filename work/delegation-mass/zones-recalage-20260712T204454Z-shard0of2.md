# Recalage PDF zones — shard 0/2 — 2026-07-12T20:44:54Z

## Périmètre

- Branche: `feat/cadre-acquisition`.
- Règle exclusive: liste complète triée des 1106 villes, index `mod 2 == 0`.
- Aucun AGOL owner harvest, aucun Python, aucun accès à `.claude` ou `.track`.
- Chaîne Node/TS uniquement; essais T1/T2 bornés à 300 secondes par commande.
- Supervision initiale: 821 zonages servis; après le dépôt Forestville, scoreboard `zones=823`.
- Sélection recalculée après dépôt: 146 résidus pairs, dont 138 dans les buckets PDF prioritaires.

## Dépôt réel

### Forestville — T2 auto-GCP + arbitrage anisotropie

- Source officielle locale: `work/pdf-cache/forestville-carte3.pdf`.
- T1 texte: le PDF n'est pas un GeoPDF embarqué; escalade T2 exécutée.
- `t2-autogcp`: 10 GCP indépendants; résidu max `20,245 m`; holdout max `4,999 m`.
- Iso-gate: l'affine percentile a une anisotropie `1,158`; l'arbitrage par couverture cadastrale l'a confirmée avec `98,84 %` de couverture au cutoff de serving, sans ambiguïté de municipalité (`1,837 km`).
- T2 texte: 85 codes distincts réels, 106 labels dans le cadre, 39 features servies, `1966/1989` lots affectés (`98,84 %`), couverture surfacique `90,54 %`.
- Dépôt: `normalized/ca-qc-zonage/qc-zonage-forestville.geojson`.
- Inline join lot→zone relancé avec simplification 2 m: 1 989 lignes, 99,1 % assignées, parquet et stats vérifiés.
- Inline lots-enriched relancé ensuite: `zone_code=98,89 %`, surface 100 %, FSA 100 %, adresse 87,33 %, dépôt réussi.

Artefacts:

- `work/gcp/forestville-retry2-20260712.autogcp.json`
- `work/gcp/forestville-retry2-20260712.autogcp.report.json`
- `work/zones-recalage/shard0of2/forestville-t2-live-20260712/qc-zonage-forestville.geojson`
- `work/zones-recalage/shard0of2/forestville-t2-live-20260712/qc-zonage-forestville.stats.json`

## Escalades et gates refusés

Lot initial pair prioritaire: `alleyn-et-cawood`, `amherst`, `aumond`, `belcourt`, `bethanie`, `bonaventure`, `bouchette`, `charette`, `chartierville`, `chertsey`, `chibougamau`, `colombier`.

- `amherst`, `bethanie`, `chartierville`, `montcalm`, `notre-dame-du-portage`, `saint-etienne-des-gres`, `forestville`: T1 sans `/VP /Measure /GEO`; ABORT honnête.
- `bonaventure`: variante officielle GeoPDF, résidu `0,31 m`, mais labels à `8,64 km`; ABORT spatial. La seconde variante officielle n'a pas de géoréférencement.
- `rougemont`: voie Claude exécutée avec 42 lectures validées contre le dictionnaire officiel; tous les codes sont numériques, donc ABORT anti-#74 faute de 3 codes lettrés.
- `desbiens`, `fassett`, `hébertville`: T1 sans géoréférencement embarqué.
- `duhamel`: T1 GeoPDF résidu `0,08 m`, 38 codes, mais centroïde à `9,57 km`; ABORT spatial.
- `grandes-piles`: T2 auto-seed, `svg_points=396`, mais seulement 0 à 5 GCP indépendants selon les cadrages; ABORT résidu/holdout.
- `inverness`: T2 auto-seed, `svg_points=0`, aucun cadrage exploitable.

Les autres résidus courants du shard restent couverts par les preuves antérieures auditables dans `work/delegation-mass/zones-recalage-20260712T202826Z-shard0of2.json`; Forestville remplace désormais sa preuve d'échec par un dépôt réussi. Aucun code, label ou GCP n'a été inventé.

## Commit ciblé

Les artefacts de dépôt et ce rapport sont prêts pour un commit ciblé; les modifications préexistantes de `.claude`, `.track`, `work/coverage` et des autres agents sont laissées intactes.
