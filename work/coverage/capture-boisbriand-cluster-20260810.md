# Capture zones Boisbriand — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-004.json`
  (cible unique `boisbriand`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t033321z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t033321z-0-2fvv4` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T033321Z-0-26b1c620-0fcb-48c9-994c-3815efc7b502` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T03:33:47.911Z` ;
- CAS : `raw/zones-v1-proof-url/cas/5a97c5d4ca325a3de28404d466031d15c7c6ee2a83fcf34e50c1615fe4d02fe4.json` ;
- `439787` octets, SHA-256
  `sha256:5a97c5d4ca325a3de28404d466031d15c7c6ee2a83fcf34e50c1615fe4d02fe4`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `403`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
