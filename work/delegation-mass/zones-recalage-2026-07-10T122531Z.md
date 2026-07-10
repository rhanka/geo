# Recalage PDF zones — shard 3/6 — 2026-07-10T122531Z

Shard: slugs dont index alpha courant % 6 == 3. Mission: servir de vrais zonages municipaux par recalage PDF officiel, sans AGOL owner harvest.

## Résultat

- Dépôts nets: 2
  - `saint-liboire`: T1 GeoPDF embarqué multisheet + lectures glyphes Claude/dict. Upload `qc-zonage-saint-liboire`; jointure lots et lots enrichis OK.
  - `barkmere`: T2 GCP autonome existant, 36 GCP indépendants, labels texte. Upload `qc-zonage-barkmere`; jointure lots et lots enrichis OK.
- Échecs ou rejets consignés: 7
  - `frampton`: GeoPDF réel, résidu 2.23 m, mais labels glyphes et aucun dictionnaire local autoritatif trouvé; pas de dépôt.
  - `saint-michel-des-saints`: T1 absent; T2 précédent rejeté par iso-gate anisotropie, relance interrompue avant 6 min sans nouveau rapport.
  - `saint-zotique`: T2 précédent rejet orientation/anisotropie; relance désambiguïsation interrompue avant 6 min sans nouveau rapport.
  - `yamachiche`: T1 absent sur rural/centre; T2 rural rejeté, anisotropie 1.52–1.68 > gate.
  - `massueville`: T1 absent; T2 rejeté, `svg_points=0`.
  - `chertsey`: T1 absent; rapport T2 existant `svg_points=0`.
  - `upton`: T1 absent; rapport T2 existant `svg_points=0`.

## Dépôts

### saint-liboire

- Source: plans officiels Annexe A feuillets 01/02 et 02/02, règlement 370-23, fichiers locaux `work/pdf-cache/saint-liboire.pdf` et `work/pdf-cache/saint-liboire-f2.pdf`.
- Méthode: `t1-build-multisheet-claude.ts`, GeoPDF NAD83 CSRS / MTM 8, résidu 0.00 m sur les deux feuillets.
- Labels: 66 lectures Claude validées, 0 rejet, 65 codes distincts; `H-20` ajouté au dict depuis le feuillet 02/02 visible.
- Sortie: 64 features servies, 1858/1864 lots assignés (99.68%), spatial centroid 0.569 km.
- Immo: `lot-zone-join-run` OK 1864 rows, `lots-enriched-run` OK, `zone_code=99.68%`, adresse 93.03%, dépôt enrichi OK.

### barkmere

- Source: plan de zonage officiel local `work/pdf-cache/barkmere-plan-zonage.pdf`.
- Méthode: `t2-build.ts` avec `work/gcp/barkmere.shard1.autogcp.json`, gate `--require-independent-gcps`.
- GCP: 36 indépendants, 0 bbox-derived; résidu max 13.444 m, RMS 5.435 m.
- Labels: 27 codes texte réels, 27 in-frame, spatial centroid 0.680 km.
- Sortie: 23 features servies, 549/549 lots assignés (100%).
- Immo: `lot-zone-join-run` OK 549 rows, `lots-enriched-run` OK, `zone_code=100%`, adresse 99.82%, dépôt enrichi OK.

## Anti-invention

Aucun code séquentiel, affectation régionale, SAD/PMAD/CMM ou bbox-only n’a été publié. Les rejets sont conservés avec la raison de gate; les deux dépôts reposent sur labels verbatim et cadastre réel.

