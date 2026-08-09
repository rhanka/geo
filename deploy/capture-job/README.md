# capture-job — fetch durable sur cluster

Ce Job lit une worklist JSON S3 :

```json
[
  {
    "slug": "mont-saint-hilaire",
    "source": "zones-arcgis",
    "urls": ["https://services5.arcgis.com/.../query?f=geojson"]
  }
]
```

Chaque URL est un `GET` via `capturedFetch`, avec `robots.txt`, délai de
politesse, CAS et manifeste. Le pod écrit uniquement :

```
raw/<source>/cas/<sha256>.<ext>
raw/<source>/cas/<sha256>.<ext>.meta.json
capture/_runs/<run-id>/manifest.jsonl
capture/_runs/<run-id>/run.log
capture/_runs/<run-id>/run.json
```

La worklist elle-même est déposée par l'orchestrateur sous
`registry/capture-worklists/<lane>-<stamp>.json`. C'est du contrôle de run,
pas une sortie du pod; le pod n'écrit jamais `normalized/`.

## Préparation par l'opérateur cluster

Construire/pousser l'image, puis lancer une worklist courte avec le programme
committé (il applique un Job Indexed et se termine immédiatement — aucun
polling local) :

```bash
docker build --network=host -f deploy/capture-job/Dockerfile \
  -t rg.fr-par.scw.cloud/sentropic-geo/geo-capture:<tag> .
docker push rg.fr-par.scw.cloud/sentropic-geo/geo-capture:<tag>

NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/k8s-capture-run.ts \
  --kubeconfig "$HOME/.kube/ovh.conf" --namespace geo \
  --lane zones --worklist /path/to/targets.json --shards 1 --concurrency 1 \
  --image rg.fr-par.scw.cloud/sentropic-geo/geo-capture:<tag>
```

Secrets requis (noms seulement) : `geo-s3-credentials` avec `S3_ENDPOINT`,
`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, et
`geo-registry-pull` pour l'image. Aucun secret de modèle n'est requis.

`job-capture.yaml` est le lot de contrôle PV réel (200 URL du snapshot
`b32de19169bc907c`), à publier d'abord avec
`pv-capture-worklist-publish.ts`. `cronjob-capture-refresh.yaml` est la
campagne restante, volontairement appliquée seulement après le verdict du lot
de contrôle.

## Arriéré continu des PV

L'arriéré PV est distinct du CronJob mensuel `cronjob-capture-refresh.yaml` :
celui-ci reste exclusivement un mécanisme de détection de changement.

`pv-capture-backlog-bootstrap.ts` publie d'abord toutes les worklists sous S3,
puis un manifeste immuable de campagne et un état CAS. Avec `--apply`, il crée
un CronJob de ticks courts : chaque tick prend un Lease Kubernetes, relève le
quota et les Jobs `app=geo-capture`, soumet des Jobs mono-pod, écrit son
avancement puis sort. Il commence à un pod et n'augmente qu'après des lots
settled sans échec; le CronJob se suspend après le rapport terminal.

```bash
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
npx tsx acquisition/src/pv-capture-backlog-bootstrap.ts \
  --id pv-YYYYMMDD-<snapshot> \
  --worklist-prefix acquisition/config/pv-capture-YYYYMMDD-<snapshot>-lot- \
  --image rg.fr-par.scw.cloud/sentropic-geo/geo-capture:<tag> --apply
```

Un 404 reste dans le manifeste de run et règle le lot (il ne boucle pas). Un
Job Failed, en particulier `OOMKilled`, bloque la campagne et la suspend : il
n'est jamais assimilé à une source absente ni relancé à l'aveugle. Une requête
interrompue entre son GET et l'écriture de son manifeste demeure ambiguë; le CAS
évite de perdre les octets, mais une relance HTTP peut être nécessaire pour ne
pas la sauter. Le contrôleur ne resoumet jamais un lot terminalement observé.
