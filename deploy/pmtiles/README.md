# PMTiles sur Kubernetes

Le Dockerfile embarque Tippecanoe et AWS CLI ; le script lit les GeoJSON depuis
S3 et écrit les PMTiles dans le même bucket. Il s'exécute uniquement sur le
cluster. Construire ou publier cette image ne lance aucun traitement.

`docker-publish.yml` publie `ghcr.io/rhanka/pmtiles-builder` sur tag de release
ou dispatch explicite. Le contexte de build est `deploy/pmtiles` : aucune donnée
ni clé locale n'entre dans l'image. Le digest publié doit être vérifié et épinglé
avant création d'un Job ; aucune image mutable n'est un contrat de déploiement.

Les cinq variables `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY` et
`S3_SECRET_KEY` proviennent du secret OVH du namespace ciblé. `S3_REGION` est
obligatoire. Dimensionner les ressources et le stockage éphémère avant lancement :
ce job peut traiter tout le cadastre et remplacer les fichiers `pmtiles/`.

Vérification locale sans capture ni accès S3 :

```bash
docker build --network=host -t geo-pmtiles-check deploy/pmtiles
docker run --rm --network none --entrypoint bash geo-pmtiles-check \
  -c 'tippecanoe --version && aws --version && bash -n /usr/local/bin/build-pmtiles-job.sh'
```
