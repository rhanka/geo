# geo-qa → conductrice — réponse job col-1 corroboration (2026-08-09)

**De** : `claude:qa:0a1b30fcb635` (garant, canal GIT) · **livrable** : commit `754f5d97`
(`scripts/generate-col1-corroboration-manifest.mjs` + `work/coverage/col1-corroboration-manifest-20260809.json`).

## Fait

Manifeste de corroboration col-1 généré pour les **163 villes matchées**, sémantique
ratifiée appliquée, générateur committé déterministe/local (aucun S3, rejouable).

| Mesure | Valeur |
|---|---|
| complete (matrice 07-23) | **106** |
| — dont `source_origin=q` (orphelin-356) | 80 |
| — dont `source_origin=h` (historique-515) | 22 |
| — dont `source_origin=v` (vecteur-natif servi) | **4** |
| `v2-served` | **4** (saint-charles-sur-richelieu, contrecoeur, saint-pie, saint-dominique) |
| readiness `unknown` (complete non prouvé v2) | **102** |
| fresh_v2_deposit_pending | saint-michel, saint-patrice-de-sherrington |
| attested_but_held | saint-bernard-de-michaudville, saint-jude |

## 2 findings pour toi (décision)

1. **Écart 106 vs 109.** Tu cites col-1 complete = 109/163 ; la source autoritaire
   que tu m'as désignée (`completion-1-zones-matrix-20260723`, brute) en donne **106**.
   L'écart = la réconciliation slug `normSlug` double-tiret (`d79698f4`) que le palier
   folddé applique mais PAS la matrice zones brute. → décide laquelle fait foi pour la
   corroboration ; si c'est le palier folddé, il me faut la liste des slugs re-mappés
   (je régénère sur cette base).

2. **Qualité ≪ présence.** 102/106 cellules complete sont `readiness=unknown` :
   collections historiques/orphelines JAMAIS évaluées v2. La col-1 « présence » (66,9%)
   masque une col-1 « provenance v2 » à **4/163 (2,5%)**. La re-mesure S3 fraîche +
   les 6 dépôts vecteur-natif (dont 2 pending) sont le seul levier pour monter ce chiffre.
   Anti-invention : je n'ai PAS gonflé v2-served — 4 est le plancher prouvé.

## Suite

Prêt à : (a) régénérer sur le palier folddé si tu me passes le mapping normSlug ;
(b) étendre la corroboration aux prochains dépôts vecteur-natif (arcgis/jmap/wfs) à
mesure qu'ils sont servis+attestés ; (c) écrire le générateur du manifeste de
provenance S3 (SPEC_COL1_REMEASURE_CHAIN) quand un run S3 est autorisé. Assigne via
commit `qa-job-*` (mon inbound h2a reste cassé ; le canal GIT marche).
