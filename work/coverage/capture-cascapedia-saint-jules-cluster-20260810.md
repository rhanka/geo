# Capture zones Cascapédia–Saint-Jules — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-007.json`
  (cible unique `cascapedia-saint-jules`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t034454z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t034454z-0-c4nvr` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T034454Z-0-99e235ce-30c4-480d-a83c-fdceb721b1c3` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T03:45:15.590Z` ;
- CAS : `raw/zones-v1-proof-url/cas/888c307c99737ecb7a8143cd2b8ef6e63d81f67cfb68647ee46aab8c4b9a61e9.bin` ;
- `458298` octets, SHA-256
  `sha256:888c307c99737ecb7a8143cd2b8ef6e63d81f67cfb68647ee46aab8c4b9a61e9`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
