# Zones recalage PDF - shard 4/6 - lot 2 - 2026-07-10T0935

Shard: slugs dont l'index trie modulo 6 vaut 4.
Lot traite apres exclusion des echecs deja consignes du lot 1: `lochaber` a `peribonka`.

## Depots

Aucun depot. Les gates stricts ou la disponibilite source ne permettent pas de servir un zonage municipal fiable sur ce lot.

## Echecs consignes

### lochaber

- Index shard: 346
- Repertoire MAMH local: aucun site web municipal.
- Decision: aucune source PDF officielle de plan de zonage trouvee. Les traces locales `Lochaber-Partie-Ouest` ont ete ignorees car elles correspondent a une autre municipalite.

### mansfield-et-pontefract

- Index shard: 364
- Site officiel: `https://www.mansfield-pontefract.com`
- Page consultee: `https://mansfield-pontefract.com/residents/reglements/`
- Resultat: la page expose des reglements generaux et un reglement de comite consultatif d'urbanisme, mais aucun plan de zonage PDF ni reglement de zonage exploitable.

### metabetchouan-lac-a-la-croix

- Index shard: 382
- Site officiel: `https://www.ville.metabetchouan.qc.ca`
- Sources trouvees:
  - `https://ville.metabetchouan.qc.ca/wp-content/uploads/2025/02/Reglement-de-zonage-22-99.pdf`
  - `https://ville.metabetchouan.qc.ca/wp-content/uploads/2025/04/Grille-1-a-9-combinees.pdf`
  - pages de plan d'urbanisme avec cartographies d'affectation
- Decision: reglement/grille et plans d'affectation seulement; aucun plan de zonage PDF officiel expose dans les pages consultees.

### montebello

- Index shard: 400
- Site officiel: `https://www.montebello.ca`
- Pages consultees: urbanisme et reglements municipaux.
- Resultat: aucun plan de zonage PDF officiel trouve. Le rapport local existant `work/gcp/montebello.autogcp.report.json` indique aussi `svg_points=0` sur une tentative precedente.

### natashquan

- Index shard: 412
- Site officiel: `https://www.natashquan.org`
- Source officielle telechargee: `https://www.natashquan.org/app/uploads/2026/03/Reglement-de-zonage-90-2-Natashquan-maj-18-decembre-2025.pdf`
- Resultat: reglement de zonage texte, 56 pages, mentionnant un plan annexe. Aucun plan de zonage PDF separe n'est expose dans la page officielle consultee; le reglement lui-meme n'est pas un plan georeferencable.

### notre-dame-de-bonsecours

- Index shard: 424
- Site officiel: `https://www.ndbonsecours.com`
- Resultat: page d'accueil recuperee comme application shell statique, sans liens HTML vers urbanisme/zonage/PDF. Aucun plan officiel exploitable trouve dans le delai par slug.

### notre-dame-de-lorette

- Index shard: 430
- Repertoire MAMH local: aucun site web municipal.
- Decision: aucune source PDF officielle de plan de zonage trouvee.

### notre-dame-des-anges

- Index shard: 436
- Repertoire MAMH local: aucun site web municipal.
- Decision: aucune source PDF officielle de plan de zonage trouvee.

### notre-dame-des-sept-douleurs

- Index shard: 442
- Site officiel: `https://www.ileverte-municipalite.com`
- Pages consultees: reglements et permis/urbanisme.
- Resultat: nombreux reglements generaux, mais aucun plan de zonage PDF officiel trouve.

### notre-dame-du-portage

- Index shard: 448
- Sources officielles:
  - `https://municipalite.notre-dame-du-portage.qc.ca/documents/pdf/2023/annexe_a_-_plan_de_zonage_-_550_dpi_--_avril_2023_-.pdf`
  - `https://municipalite.notre-dame-du-portage.qc.ca/documents/pdf/reglements/regl_2021-421_zonage_v_adm_27mai2025_refondu.pdf`
  - `https://municipalite.notre-dame-du-portage.qc.ca/documents/pdf/reglements/annexe_b_-_grille_de_specifications_-_v_2025_refondu.pdf`
- T1: aucun georeferencement embarque.
- T2: echec auto-GCP, `svg_points=0`, aucun seed residual/holdout.
- Preuve: `work/gcp/notre-dame-du-portage.autogcp.shard4.report.json`.
- Decision: plan raster/scan sans seed GCP local fiable; pas de depot.

### oka

- Index shard: 454
- Site officiel: `https://www.municipalite.oka.qc.ca`
- Source officielle reperee: page municipale de refonte du plan d'urbanisme, avec lien Calameo `https://www.calameo.com/oka/read/005443498422c7ad7db07` vers `Feuillets 1 a 15 - Reglement 2025-289 - Zonage`.
- Resultat: la page statique Calameo expose des images/lecteur et metadata, pas un PDF direct telechargeable dans le delai par slug. Pas de T1/T2 sans PDF officiel local.

### peribonka

- Index shard: 466
- Sources officielles:
  - `https://peribonka.ca/app/uploads/2024/01/Carte-Plan-de-zonage.pdf`
  - `https://peribonka.ca/app/uploads/2024/01/Plan-zone-urbaine-1.pdf`
  - `https://peribonka.ca/app/uploads/2024/01/Plan-zone-urbaine-2.pdf`
  - `https://peribonka.ca/app/uploads/2026/07/2011-05_89027F_Peribonka_Zonage_MAJ_2026_finale.pdf`
  - `https://peribonka.ca/app/uploads/2024/01/Grilles-Reglement-durbanisme.pdf`
- T1 GeoPDF: georeferencement embarque detecte sur le plan general (`NAD_1983_MTM_8`, residu 0.17 m) et le feuillet urbain 1 (`NAD_1983_MTM_8`, residu 0.30 m).
- Dict officiel: `work/zonage-dicts/peribonka.codes.json`, 73 codes extraits de la grille officielle.
- Reads filtres:
  - plan general: 4 codes valides seulement
  - feuillet urbain 1: 26 reads, 24 codes distincts
  - feuillet urbain 2: 0 read valide contre le dict
- Dry-run multisheet: 30 code-points, 27 codes distincts, spatial 1.597 km, 526/952 lots assignes (55.25 %), surface couverte 40.26 %.
- Preuve: `work/zonage-recalage/peribonka-multisheet-t1-claude-shard4/qc-zonage-peribonka.stats.json`.
- Decision: pas de depot; couverture trop partielle et coherence plan/grille insuffisante pour servir un zonage municipal complet fiable.

## Bilan lot

- Slugs traites: 12
- Depots reussis: 0
- Echecs consignes: 12
- Candidats techniques forts mais non deposes: `peribonka` (GeoPDF partiel, coverage insuffisante), `notre-dame-du-portage` (scan officiel sans GCP automatique).
