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

## Run 4 — PROPRE 7 villes (sans westmount) — `20260803T133000Z`
- Worklist `work/coverage/pv-cohorte-vides-20260803-capture-lot-0003-pvindex-7.json`
  (`source=pv-index`), `--shards 7 --concurrency 2 --memory-limit-mi 384`.
- **Job** : `geo-capture-pv-20260803t133000z` — 7/7 shards `Completed`, run.json
  terminal pour chacun (le run 3 avait un shard westmount OOM sans run.json qui
  bloquait le classifieur sur `NoSuchKey`).

## Résultat classification (`capture-octets-classification --lane=pv`)
Rapport : `work/coverage/pv-capture-octets-20260803T133000Z.json`.
21 tentatives → 12 `PV_LISIBLE_PROPRIETAIRE_CONFIRME` (propriétaire imprimé
confirmé par extraction de texte natif) :
- **INDEXED (4 villes)** : boucherville, hampstead, longueuil, varennes (3 docs
  chacune). → verdict `pv-lecture-visuelle-cohorte-vides-lot-05-20260803T133000Z.json`.
- **candiac** : 3 scans `PDF_SANS_COUCHE_TEXTE` → lecture visuelle requise (octets
  présents, à traiter dans un prochain lot).
- **saint-basile-le-grand, saint-bruno-de-montarville** : 3 `HTTP_AUTRE` chacune,
  `detail=robots-disallowed`, http_status null (aucun fetch : gate robots au
  moment de la capture). Diagnostic robots.txt (lecture seule) :
  - `www.villesblg.ca` : `User-agent: * / Disallow: /wp-content/uploads/` — or
    TOUS ses PV sont sous `/wp-content/uploads/` → **mur robots réel** (pas un
    faux-positif). N-A documenté sauf source alternative.
  - `saintbruno-site.s3.ca-central-1.amazonaws.com` : `Disallow: /` global sur le
    CDN S3 → mur pour cet hôte. Mais le site muni `saintbruno.ca` peut servir les
    PV par un chemin non interdit → **candidat re-sourcing**.
  On ne contourne PAS robots (capture polie, principe fondateur).
- **westmount** : hors run (doc annuel « MINUTES » > 512Mi ; re-sourcer une séance
  unique, doc plus léger).

## Résiduels → prochain beat (re-sourcing / N-A documenté)
- saint-bruno-de-montarville : découvrir les URLs PV sur `saintbruno.ca` (hors CDN
  S3 interdit) → worklist pv-index → capture cluster.
- westmount : découvrir un PV de séance unique (pas la compilation annuelle).
- saint-basile-le-grand : chercher une source alternative hors
  `/wp-content/uploads/` ; sinon **N-A « mur robots documenté »** (le palier
  accepte un mur tracé comme N-A).

Couverture recomptée : **666 → 670/1106** (+4 villes, +12 clés CAS) —
`work/coverage/pv-couverture-municipale-20260803T134500Z.{json,md}`.

## Cohorte
boucherville, candiac, hampstead, longueuil, saint-basile-le-grand,
saint-bruno-de-montarville, varennes, westmount.

## Run 5 — RE-SOURCING des 3 résiduels — `20260803T150000Z`
Découverte read-only (agent, périmètre strict 3 slugs) : re-vérification robots
verbatim par hôte + URLs PDF octet-vérifiées.
- **saint-bruno-de-montarville → CAPTURABLE.** L'hôte officiel
  `www.ville.saint-bruno.qc.ca` a un robots OUVERT (`User-agent: * / Disallow:`
  vide) et sert les MÊMES PV sous `/wp-content/uploads/` (chemin autorisé). 3 PV
  séance-unique octet-vérifiés `application/pdf`, 220–285 Ko. Le CDN
  `saintbruno-site.s3…` (`Disallow: /`) était la MAUVAISE source — corrigée.
- **westmount → CAPTURABLE.** robots n'interdit que `/administration` ;
  `/storage/app/media/` est autorisé. 3 PV séance-**individuelle** trouvés
  (2025-09-08 3,5 Mo, 2025-12-08 1,3 Mo, 2025-05-05 >10 Mo) — PAS les
  compilations annuelles `*-PROCES-VERBAL-MINUTES.pdf` qui OOMaient.
- **saint-basile-le-grand → N-A DOCUMENTÉ (mur robots).** `villesblg.ca` interdit
  `/wp-content/uploads/` où sont TOUS les PV ; ancien `.qc.ca` 301→villesblg.ca ;
  MRC ne sert que ses PV régionaux ; aucune visionneuse/extranet. Absence de
  source robots-autorisée TRACÉE → `pv-na-saint-basile-le-grand-20260803T150000Z.json`.
  On ne contourne PAS robots (principe fondateur). Cadrage owner « murs → N-A
  documenté ».

Worklist corrigée (2 villes capturables) :
`work/coverage/pv-cohorte-vides-20260803-capture-lot-0004-pvindex-resource.json`
(`source=pv-index`). Prochain beat : capture cluster (1 ville/shard,
`--memory-limit-mi 512`) → classifier → recompter.

## Run 6 — CAPTURE cluster saint-bruno + westmount — `20260803T173311Z`
- **Job** : `geo-capture-pv-20260803t173311z` (OVH `poc-ca`, ns `geo`).
- **Worklist S3** : `s3://sentropic-geo/registry/capture-worklists/pv-20260803T173311Z.json`.
- `--shards 2 --concurrency 2 --memory-limit-mi 512` (1 ville/pod). Cluster =
  cible déclarée `acquisition/config/k8s-target.json` (garde anti-mauvais-cluster
  PASS). Aucun polling local. CAS attendu sous `raw/pv-index/cas/<sha>.<ext>`.
- Suite : `capture-octets-classification --lane=pv` → si `INDEXED` (propriétaire
  imprimé confirmé) câbler le verdict → recompter (`pv-couverture-municipale`).

## Suite (capture ≠ couverture)
Capturer les octets NE bouge PAS le chiffre : `pv-couverture-municipale` lit des
snapshots verdict committés, pas S3 en vif. Il faut ensuite classifier/lire les
octets → verdict `INDEXED` (propriétaire imprimé confirmé) → câbler le fichier
verdict dans la mesure → recompter → committer. Le delta committé seul est
remonté à claude:geo.
