# SPEC EVOL — Mesure rejouable de provenance des zones servies

## Intention

Le KPI portefeuille de provenance mesure à nouveau le contenu réellement servi
depuis S3. Il ne dépend ni de `zonage-enrichment` ni d'un artefact produit hors
du dépôt. Une matrice locale datée est le seul intrant du rapport, mais elle est
reconstruite par un runner TypeScript committé et lecture seule sur S3.

## Décisions

### D1 — Univers et layout effectif

Le runner liste seulement les clés canoniques sous
`normalized/ca-qc-zonage/`. Pour un slug ayant les deux layouts, il lit le
sous-dossier, car c'est celui que geo-api sert. Les clés sans ville canonique
restent des diagnostics sans crédit dans la partition des 1 106 villes.

### D2 — Partition des villes

Une ligne est émise pour chacun des 1 106 slugs du catalogue committé. Les
buckets exclusifs sont `acceptable`, `candidate`, `orphan`, `unknown` et `v2`.
Une collection absente, illisible, ambiguë ou sans niveau de source uniforme
est `unknown`.

### D3 — Preuve v2 vérifiée

`v2` exige la preuve collection et les preuves de toutes les features valides
et identiques, plus un rattachement exact et verbatim
`(url, retrieved_at, sha256)` à une ligne valide de
`capture/_runs/*/manifest.jsonl`. Le CAS déclaré doit exister et ses octets
doivent rehasher vers le même SHA-256. Une preuve sans ce rattachement ne vaut
jamais `v2`; elle est seulement classée par le niveau de source effectivement
servi, au mieux `acceptable`.

### D4 — Matrice et rapport

Le runner écrit une matrice nouvelle sous
`work/coverage/zone-provenance-quality-matrix-YYYYMMDD-<hash>.json`, sans
écraser une matrice existante. Le rapport choisit le nom conforme le plus grand
lexicographiquement; sans matrice il rend les KPI concernés `unknown`. La
qualité compte `acceptable + v2` comme complet, afin que la partition reste
fermée à 1 106.

### D5 — Observabilité et reprise

Le runner écrit un checkpoint local atomique après chaque lot de lectures S3;
`--resume` relit ce checkpoint. Les détails retiennent des valeurs observées
verbatim ou `null`, jamais une URL, un horodatage ou un SHA reconstitué.

## Gates

- le runner n'écrit jamais sous `normalized/`, `raw/` ni `capture/`;
- les cinq buckets ferment à 1 106;
- les tests couvrent une v2 complète et les absences de SHA, URL et preuve;
- `node scripts/portfolio-city-report.mjs --check` reste vert;
- le chiffre publié est issu d'un run S3 complet, pas d'un fichier local de
  travail.

## Revue contradictoire

- Pair correctness : requiert égalité stricte du triplet de preuve, sélection
  nested-then-flat et CAS rehashé.
- Pair contrat : requiert une résolution lexicographique sans fallback et
  signale que `v2` doit être inclus dans la partition qualité.
- Réconciliation : les deux avis sont retenus; les diagnostics de preuve non
  rattachable sont conservés pour traiter le gisement suivant sans promotion.
