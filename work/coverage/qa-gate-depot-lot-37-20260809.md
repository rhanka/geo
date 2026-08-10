# qa-GATE — dépôt en masse lot 37 REAL-GAIN (col-12/13)

**Gate** : `claude:qa:0a1b30fcb635` (garant, S3 qa-gated — seul gate, plus de go owner).
**Job** : `work/coverage/qa-job-20260809-2.md` · **dry-run gaté** : `781b9230`
(`work/coverage/refold-167-dryrun-20260808.json/.md`).

## VERDICT PRÉ-DÉPÔT : **GATE-PASS** (strict, non bloquant)

Le dry-run est validé sur le fond — dépôt des **37 REAL-GAIN autorisé**, sous conditions.

### Ce que j'ai vérifié (indépendant)
- **Lecture seule, pas d'invention** : `mode=lecture-s3-seule`, `s3_writes:false` ;
  `s3_head_control` (dorval) = qc_lots_geojson/stats + qc_lot_zonage parquet/stats **PRESENT**.
- **Méthode anti-invention SAINE** :
  - col-12 = lots sans code_zone dont le **centroïde shoelace tombe dans une zone
    RÉELLEMENT SERVIE** → c'est la preuve « zones suffisantes » intégrée ; hors-zone
    et sans géométrie = résidu coverage (exclu).
  - col-13 = `M=F→0` · `M>F→M−F` (gain minimal prouvé) · `M<F`/grille absente/jointure
    absente → **`null`** (aucune valeur inventée).
  - classification REAL-GAIN ssi gain col-12 ou col-13 > 0.
- **Comptes cohérents** : 37 REAL-GAIN + 1 AT-CEILING + 52 COVERAGE-BOUND = **90 mesurées**
  (90 = candidats 113 − 16 progrès − 7 exclusions). Vérifié dans le JSON.
- Gain déclaré : col-12 **+274** / col-13 **+419** — ce sont des **comptes de LOTS**
  (minimum prouvé), PAS le Δ KPI par-ville (voir conditions).

### CONDITIONS DU DÉPÔT (anti-invention — le gate porte là-dessus)
1. **Déposer UNIQUEMENT les 37 REAL-GAIN.** Les **52 COVERAGE-BOUND restent
   `unknown`/escaladés** (résidus par manque de coverage zones/normes) — JAMAIS complete.
2. **col-13 `null` ⇒ non déposable en complete.** Les villes REAL-GAIN à col-13=null
   (rosemere, la-prairie, kirkland, sainte-catherine, lavaltrie, saint-jacques,
   saint-jude, saint-mathias-sur-richelieu, saint-pie) gagnent col-12 SEULEMENT ;
   leur col-13 reste `null`/unknown.
3. **Chaque dépôt porte sa provenance** (reproductible ; preuve rattachée sur S3 —
   principe fondateur). Un lot assigné sans zone servie prouvée n'est pas déposable.
4. **Le Δ qui compte est par-VILLE dans la matrice**, pas le compte de lots. Baseline
   KPI : col-12 = 23/163 · col-13 = 4/163. Après dépôt je re-fold vague 9 et je remonte
   le nombre de villes qui basculent RÉELLEMENT complete (vérif, pas projection).

## POST-DÉPÔT (à faire par qa après le dépôt lot)
- Re-fold vague 9, committer la matrice par pathspec.
- Δ col-12/13 VÉRIFIÉ = complete réel dans `palier-matrix-30x167-20260809` (delta de
  cellules `●`), croisé au dry-run. Toute ville passée complete SANS gain prouvé au
  dry-run = anomalie → je la rejette (reste unknown).

**GO lot** : dépose les 37 sous ces conditions. Je re-fold et vérifie dès que le dépôt
est committé/servi. Réponds/committe le dépôt ; le canal git fait foi.
