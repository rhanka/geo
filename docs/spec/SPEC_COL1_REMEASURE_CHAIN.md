# SPEC — Re-mesure de la colonne 1 du palier (zones servies) & trou de repro

Découverte QA (garant/mesure) : faire « tiquer » la col 1 du palier (présence zones)
après un dépôt frais sur S3 exige une chaîne à 3 maillons, dont **un maillon n'a
aucun générateur committé** — c'est un trou de reproductibilité au sens du principe
fondateur (artefact vivant sur une seule machine, non rejouable).

## 1. La chaîne réelle

1. **(acquisition, S3)** `acquisition/src/coverage-reconcile.ts`
   (`npx tsx src/coverage-reconcile.ts`, creds S3) — liste
   `normalized/ca-qc-zonage/qc-zonage-<slug>` (plat + sous-dossier) et flippe
   `zones.status="done"` dans `work/coverage/coverage-matrix.json`.
   ⚠️ `coverage-matrix` ne porte QUE `status/candidateTracks/doneTrack/lastResearchAt` —
   PAS l'identité de la collection servie (collection_key/layout/features).

2. **(MAILLON MANQUANT)** `work/coverage/zone-provenance-status-manifest-<date>.json`
   (contrat `zone-provenance-status-manifest/r2`) — corroboration locale exigée par
   le maillon 3 : une ville n'est `complete` que si un `row` existe pour son slug
   (`generate-completion-1-zones-normes.mjs:200-216`, `evidence !== undefined`).
   **Aucun générateur committé** : le fichier `20260722` a été introduit par un
   commit docs one-shot (`1e55ea44`), réconcilié À LA MAIN, `s3_reads:0`. Ni
   `coverage-reconcile` ni le maillon 3 ne le rafraîchissent. ⇒ après un dépôt frais,
   la ville reste `unknown` (`matrix_done_but_unconfirmed_by_local_served_collection`),
   PAS `complete`.

3. **(qa, local)** `scripts/generate-completion-1-zones-normes.mjs`
   (`node scripts/...`) — produit `completion-1-zones-matrix-<date>.json` (col 1).
   `complete` ⇔ maillon1 `status=done` ET maillon2 `row` présent pour le slug.

## 2. Contrat du générateur à écrire (maillon 2)

`scripts/generate-zone-provenance-manifest.mjs` (à créer, committé) :

- **Entrées (faits vérifiables uniquement — anti-invention)** :
  - baseline = dernier `zone-provenance-status-manifest-*.json` (préserve la
    réconciliation historique h/q ; on AUGMENTE, on ne régénère pas de zéro — les
    origines historiques ne sont pas dérivables de S3).
  - **S3 read-back** : liste réelle des `qc-zonage-<slug>` servis (collection_key,
    layout plat/sous-dossier, features) — la GROUND TRUTH « réellement servi ».
  - **attestation(s)** `vecteur-natif-attestation-*.json` / `recalage-attestation-*`
    — pour la provenance VÉRIFIÉE des dépôts frais (source_url, sha256, retrieved_at,
    zone_field, feature_count, verdict PASS-BANC).
- **Sortie** : même schéma `zone-provenance-status-manifest/r2` (`row_fields` +
  `rows` positionnels ; champs requis exacts en `generate-completion-1-...:85-99`).
- **Règle d'or** : n'AJOUTE/n'UPGRADE une row QUE pour un slug **réellement servi
  sur S3** (read-back) ET couvert par une attestation PASS. Pas de row sur la parole
  d'un dépôt — vert par omission = rouge.

## 3. Décision à ratifier (conducteur / zones) — sémantique de provenance

Le catalogue actuel ne définit `source_origin` que `h` (historique-515) / `q`
(orphelin-356), et `v2_acquisition_readiness` que `not-assessed`. Un dépôt frais
**v2 vecteur natif attesté** ne rentre dans aucun. Proposition (valeurs HONNÊTES,
définies au value_catalog, traçant des faits vérifiés — pas de l'invention) :

- `source_origin: "v"` = *v2-served-attested: collection servie dont la provenance
  v2 (url+retrieved_at+sha256) est portée par une attestation qa PASS-BANC.*
- `v2_acquisition_readiness: "v2-served"` = *octets v2 réels servis et attestés.*
- `registry_status: "served"`, `rollout_policy: "none"` (déjà servi),
  `source_identity_ref`/`evidence_refs` = pointeurs vers l'attestation (sha256+url).

À trancher : ces valeurs, ou une autre convention. Sans ratification, je n'écris pas
de provenance inventée — le générateur reste à l'état de contrat.

## 4. Portée & garde-fous

- Le maillon 1 (S3) est de l'outillage acquisition existant ; le maillon 2 est
  mesure/qa (mien) mais LIT S3 (creds `--dns-result-order=ipv4first
  AWS_MAX_ATTEMPTS=10`) ; le maillon 3 est local qa.
- Les 5 dépôts GOnet (documented) sont RÉELS et attestés (`63a2bb7f`) indépendamment
  de cette chaîne ; la col 1 ne les reflètera qu'une fois le maillon 2 committé et
  la chaîne rejouée. Aucune donnée fabriquée entre-temps.
