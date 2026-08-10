# Capture zones Dégelis — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-011.json`
  (cible unique `degelis`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t043100z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t043100z-0-jl6m5` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T043100Z-0-60e23815-77eb-4768-a7e3-3f9736d8cc53` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T04:28:58.121Z` ;
- CAS : `raw/zones-v1-proof-url/cas/48d3d00d5e640dce7849e85a7eb1efb3984c15c9152bc2220c3380dec69a3f39.json` ;
- `7879248` octets, SHA-256
  `sha256:48d3d00d5e640dce7849e85a7eb1efb3984c15c9152bc2220c3380dec69a3f39`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `403`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
