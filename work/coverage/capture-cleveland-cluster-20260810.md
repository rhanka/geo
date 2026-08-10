# Capture zones Cleveland — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-009.json`
  (cible unique `cleveland`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t035748z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t035748z-0-c57st` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T035748Z-0-8812c8d0-c2bb-4fe8-8f5f-ea3f9121c797` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T03:58:09.407Z` ;
- CAS : `raw/zones-v1-proof-url/cas/7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd.json` ;
- `5193517` octets, SHA-256
  `sha256:7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `403`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
