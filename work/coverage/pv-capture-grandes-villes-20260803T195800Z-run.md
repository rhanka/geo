# Run capture cluster — cohorte grandes villes zéro-capture

Journal de la capture PV des GRANDES villes encore zéro-capture (identifiées par
croisement `municipal_coverage.slugs` 673 committé `2a1015f8` vs référentiel
1106). Cible : Québec, Laval, Sherbrooke, Saguenay, Trois-Rivières, Terrebonne,
Saint-Hyacinthe, Rimouski — quasi-certainement membres du palier 167.

## Découverte read-only — `20260803T195800Z`
Runner `acquisition/src/pv-decouverte-worklist.ts` (voies bornées, lecture web
seule, `no_document_bytes_read`) sur les 8 slugs.
- **Résultat** : `candidate=1, no_candidate=6, indeterminate=1`. Seule
  **TERREBONNE** rend des candidats par les voies par défaut (WordPress media) :
  23 PV octet-désignés (`terrebonne.ca/wp-content/uploads/…`, séances CE + CM).
- Les 7 autres (portails propres, non-WordPress) rendent 0 par défaut →
  **seeding `--seed-pages` requis** (URL de portail PV officiel vérifiée
  read-only). Beat suivant.
- **Fix durable capitalisé** (`83f8c775`) : le piège récurrent `source=pv-discovery`
  (octets orphelins de la métrique, clé sur `raw/pv-index/cas/`) est corrigé par
  un flag `--source` (défaut `pv-index`) + `buildCaptureTargets` testé. La
  worklist terrebonne porte `source=pv-index`.
- Artefacts : `work/coverage/pv-decouverte-grandes-villes-20260803T195800Z.json`
  (+ `-capture-lot-0001.json`).

## Soumission cluster — `20260803T210500Z`
- **Job** : `geo-capture-pv-20260803t210500z` (OVH `poc-ca`, ns `geo` ; garde
  anti-mauvais-cluster PASS via `acquisition/config/k8s-target.json`).
- **Worklist S3 (contrat)** : `s3://sentropic-geo/registry/capture-worklists/pv-20260803T210500Z.json`.
- `--shards 1 --concurrency 1 --memory-limit-mi 512` (1 ville/pod). CAS attendu
  sous `raw/pv-index/cas/<sha>.<ext>`. Aucun polling local.
- **Suite** : `pv-capture-octets-classification --lane=pv` → si `INDEXED`
  (propriétaire imprimé « VILLE DE TERREBONNE » confirmé) câbler le verdict →
  `pv-couverture-municipale` recompte → commit du delta. Chaque INDEXED committé
  fait monter col-4.

## Résiduels → prochain beat
- 7 grandes villes à seeder (portails propres) : découvrir l'URL du portail PV
  officiel de chacune (read-only), `--seed-pages slug=URL`, re-découverte →
  worklist `source=pv-index` → capture cluster.
