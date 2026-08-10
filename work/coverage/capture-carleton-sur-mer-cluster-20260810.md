# Capture zones Carleton-sur-Mer — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-006.json`
  (cible unique `carleton-sur-mer`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t034115z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t034115z-0-2m7qc` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T034115Z-0-d762ccd2-596c-437d-82dc-4c4cf813dc43` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T03:41:40.775Z` ;
- CAS : `raw/zones-v1-proof-url/cas/62743b1a132015391b8f34c0347d8b33eb59c657b5dda51d4e56fcf61cd7d8d1.bin` ;
- `315147` octets, SHA-256
  `sha256:62743b1a132015391b8f34c0347d8b33eb59c657b5dda51d4e56fcf61cd7d8d1`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
