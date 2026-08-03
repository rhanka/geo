# Run capture cluster — cohorte zéro-capture (8 grosses villes)

Journal HONNÊTE de la campagne de capture PV de la cohorte zéro-capture sur le
cluster déclaré (OVH `poc-ca`, ns `geo`), sans polling local. Trois soumissions :
les deux premières sont des échecs/erreurs corrigés, documentés ici pour ne rien
maquiller (vert par omission = rouge).

## Run 1 — ÉCHEC (OOM) — `20260803T121500Z`
- `--shards 1 --concurrency 1`, mémoire par défaut **176Mi**.
- Un seul pod traite les 8 villes en séquence → **OOMKilled** (3 tentatives),
  Job `Failed`. Cause : `capturedFetch` retombe sur le chemin `arrayBuffer()`
  (bufferise tout le PDF) pour un PV volumineux et dépasse 176Mi.
- Job supprimé.

## Run 2 — ERREUR DE TAG (orphelin) — `20260803T124500Z`
- `--shards 8 --concurrency 1 --memory-limit-mi 384` : 7/8 villes captées,
  westmount OOM même à 384Mi (compilations annuelles « MINUTES »).
- **Défaut** : worklist taguée `source=pv-discovery` → CAS déposé sous
  `raw/pv-discovery/cas/`. Or TOUTE la chaîne PV (classifieur, lecture visuelle,
  `pv-couverture-municipale`) clé sur `raw/pv-index/cas/`. Ces octets sont
  **orphelins de la métrique** (aucun producteur de couverture ne lit
  `pv-discovery`). Job supprimé.

## Run 3 — CORRIGÉ (en cours) — `20260803T130000Z`
- Worklist corrigée `source=pv-index` :
  `work/coverage/pv-cohorte-vides-20260803-capture-lot-0002-pvindex.json`.
- **Job** : `geo-capture-pv-20260803t130000z`
- **Worklist S3 (contrat)** : `s3://sentropic-geo/registry/capture-worklists/pv-20260803T130000Z.json`
- `--shards 8 --concurrency 1 --memory-limit-mi 512` (1 ville/pod, isole toute
  ville pathologique ; westmount reste à risque à 512Mi).
- CAS attendu sous `raw/pv-index/cas/<sha>.<ext>` → visible par la chaîne de
  couverture.

## Cohorte
boucherville, candiac, hampstead, longueuil, saint-basile-le-grand,
saint-bruno-de-montarville, varennes, westmount.

## Suite (capture ≠ couverture)
Capturer les octets NE bouge PAS le chiffre : `pv-couverture-municipale` lit des
snapshots verdict committés, pas S3 en vif. Il faut ensuite classifier/lire les
octets → verdict `INDEXED` (propriétaire imprimé confirmé) → câbler le fichier
verdict dans la mesure → recompter → committer. Le delta committé seul est
remonté à claude:geo.
