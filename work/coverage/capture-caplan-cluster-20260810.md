# Capture zones Caplan — reçu cluster — 2026-08-10

## Exécution de production

- Worklist : `work/coverage/zones-arcgis-recapture-20260810-qa-005.json`
  (cible unique `caplan`).
- Préflight puis Job OVH : `geo-capture-zones-20260810t033742z`, avec
  `--kubeconfig /tmp/ovh.kubeconfig`, 1 shard et l'image
  `rg.fr-par.scw.cloud/sentropic-geo/geo-capture:0.1.1`.
- Le pod `geo-capture-zones-20260810t033742z-0-fr6nq` a terminé
  `Succeeded`, code de sortie `0`.

## Dépôt S3 et preuve relue

La sonde E2E a relu le run
`zones-20260810T033742Z-0-bede3313-aeea-4fa9-813b-61b0d57d7404` depuis S3 :

- cible ArcGIS : HTTP `200`, `robots=allowed`, récupérée le
  `2026-08-10T03:38:05.937Z` ;
- CAS : `raw/zones-v1-proof-url/cas/6ec996bbb1dbdfdf5319f6602bd7cc436dba4adcadde797594285ac484501a33.bin` ;
- `206747` octets, SHA-256
  `sha256:6ec996bbb1dbdfdf5319f6602bd7cc436dba4adcadde797594285ac484501a33`,
  vérifié par la sonde ;
- méta CAS et preuve v2 valides (`arcgis` / `natif` / `directe`), avec
  `dedup=true` ;
- la lecture de `robots.txt` a reçu HTTP `404`, conservé dans le manifeste
  sans octets ; elle n'affecte pas la cible autorisée.

Il s'agit d'une capture brute capitalisée dans S3. Aucun objet `normalized/`
ne lui est attribué ici : aucune ville ni cellule Palier n'est déclarée complète
par ce reçu seul.
