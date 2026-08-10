# Capture zones Deschaillons-sur-Saint-Laurent — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-012.json`
  (cible unique `deschaillons-sur-saint-laurent`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t043400z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t043400z-0-w9xhc` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T043400Z-0-fe33e667-6a68-41c3-9c2e-42339423f236` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T04:33:10.700Z` ;
- CAS : `raw/zones-v1-proof-url/cas/82d3ccf8bf8440344d22b2028d4d109d198e97cd1a24f965838c7b59270c5aa1.bin` ;
- `199241` octets, SHA-256
  `sha256:82d3ccf8bf8440344d22b2028d4d109d198e97cd1a24f965838c7b59270c5aa1`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
