# Capture zones ArcGIS — Audet — 2026-08-10

## Portée

Cette passe capture uniquement les octets bruts et leur reçu de provenance. Elle
n'écrit aucun objet `normalized/` et ne crédite donc aucune cellule de la
matrice palier avant le dépôt servi distinct.

## Soumission cluster

- Cible vérifiée : cluster OVH déclaré `poc-ca`, namespace `geo`.
- Worklist mono-ville :
  `work/coverage/zones-arcgis-recapture-20260810-qa-001.json`, déposée sous
  `s3://sentropic-geo/registry/capture-worklists/zones-20260810T021800Z.json`.
- Job : `geo-capture-zones-20260810t021800z` ; pod terminé `Succeeded`, exit
  code 0 à `2026-08-10T02:16:43Z`.

## Reçu S3 vérifié

- Run effectivement écrit :
  `zones-20260810T021800Z-0-61c3a460-3e7d-468c-af3c-f46d9ac19528`.
- Les trois objets de run sont présents sous `capture/_runs/<run-id>/` :
  `manifest.jsonl`, `run.json`, `run.log`.
- La tentative `https://services6.arcgis.com/robots.txt` a reçu HTTP 403 et
  reste journalisée, sans octet ni preuve inventée.
- La requête Audet a reçu HTTP 200 avec `robots: "allowed"`,
  `retrieved_at=2026-08-10T02:16:39.510Z`, et la preuve v2 :
  `sha256:b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226`.
- Son CAS de 8 245 960 octets est présent, hashé et accompagné d'un sidecar
  cohérent. `dedup=true` désigne un octet identique déjà conservé ; le reçu du
  run, lui, est frais et durable.

Vérification exécutée en lecture seule :

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/_capture-e2e-probe.ts \
  --run zones-20260810T021800Z-0-61c3a460-3e7d-468c-af3c-f46d9ac19528 \
  --type arcgis --raw
```

Résultat : `E2E OK`, 1 preuve v2 valide sur 2 lignes de manifeste ; l'autre
ligne est le 403 `robots.txt` conservé comme tentative.
