# acquisition-job — QC mass-acquisition as parallel k8s Jobs

Runs the province-wide QC zonage acquisition **remotely and in parallel** on the
`poc` k8s cluster instead of the slow LOCAL sequential worker. A TypeScript
orchestrator (`acquisition/src/k8s-shard-run.ts`) splits the ~563-muni list into
N shards, turns each shard into a `batch/v1` Job (namespace `geo`) running this
image, and monitors them to completion.

Each Job, for its shard of slugs:

1. **discover** — crawl the muni sites (2-hop, robots-honoured), confirm +
   download each grille PDF, route-guess (native/vision/multizone). Writes its
   OWN manifest `discovered-shard-<i>.json` (anti-collision: shards never clobber
   a shared file).
2. **extract** — run the norms batch over that manifest (Mistral), depositing
   `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet` to S3.

`MODE` picks `discover`, `extract`, or `all` (default). **Idempotent**: the batch
HEAD-skips any slug already deposited in S3, so a re-run never redoes a paid
Mistral vision pass.

The image is `rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0` — baked
with `poppler-utils` (`pdftotext` / `pdfinfo` / `pdftoppm`, required by the
parsers and the vision page renderer) and the `acquisition/` +
`packages/qc-sources/` TypeScript run via `tsx`.

---

## Quick start

```bash
# Prove it small — 2 Jobs, ~3 munis each, discover+extract:
cd acquisition
npx tsx src/k8s-shard-run.ts --shards 2 --limit 6 --mode all --concurrency 2

# Full province — 16 shards, bounded concurrency (quota-safe):
npx tsx src/k8s-shard-run.ts --shards 16 --mode all --concurrency 2

# Inspect manifests without applying:
npx tsx src/k8s-shard-run.ts --shards 16 --mode all --dry-run
```

Watch / debug:

```bash
kubectl get jobs -n geo -l app=geo-acquisition
kubectl logs job/geo-acq-<runId>-<i> -n geo
```

---

## Credentials (NAMES only — never commit values)

Injected via `envFrom` secretRef; nothing is written to disk.

| Secret | Keys | Purpose |
|--------|------|---------|
| `geo-s3-credentials` | `S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY` | Scaleway Object Storage |
| `mistral-credentials` | `MISTRAL_API_KEY` | vision / multizone extraction |
| `geo-registry-pull` | imagePullSecret | pull the image from the Scaleway registry |

`lib/s3.ts` reads `S3_*` straight from the pod env when no `s3.env` file exists;
`zonage-norms-batch.ts` reads `MISTRAL_API_KEY` the same way. Secret values are
never printed (presence-only checks in the entrypoint).

Create `mistral-credentials` (value never echoed):

```bash
# load MISTRAL_API_KEY from sentropic/.env into a 0600 temp env-file, then:
kubectl create secret generic mistral-credentials -n geo --from-env-file=<tmp>
```

---

## TENANT QUOTA — the binding constraint

The `geo` namespace `tenant-quota` is tight. With the long-lived `geo-api` and
`postgis-0` pods already running, the headroom for acquisition Jobs is roughly:

| Resource | Quota | Used (api+postgis) | Headroom |
|----------|-------|--------------------|----------|
| pods | 6 | 2 | **4** |
| requests.memory | 1Gi | 768Mi | **~256Mi** |
| limits.memory | 4Gi | 3584Mi | **~512Mi** |
| requests.cpu | 500m | 175m | ~325m |
| limits.cpu | 1500m | 600m | ~900m |

So **at most ~2 pods fit at once** at the default per-pod limit of 256Mi
(2×256Mi = 512Mi == headroom). That is why the orchestrator defaults to
`--concurrency 2` and `--lim-mem 256Mi`. Raising shard count does NOT raise
parallelism — it only makes each Job smaller; the concurrency window stays the
quota-safe ceiling. To go wider you must raise the namespace quota first
(`kubectl edit resourcequota tenant-quota -n geo`).

Per-pod resources are overridable:
`--req-mem --lim-mem --req-cpu --lim-cpu`. 256Mi can OOM a heavy multi-page
vision render; bump `--lim-mem 512Mi --concurrency 1` for the hardest grilles
(stays within the 512Mi limit headroom).

---

## Building & pushing the image

```bash
docker build --network=host \
  -f deploy/acquisition-job/Dockerfile \
  -t rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0 .

# push using the geo-registry-pull creds in an isolated DOCKER_CONFIG
TMP=$(mktemp -d)
kubectl get secret geo-registry-pull -n geo \
  -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d > "$TMP/config.json"
DOCKER_CONFIG="$TMP" docker push rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0
rm -rf "$TMP"
```

`--network=host` works around flaky buildkit DNS. The `geo-registry-pull` secret
has push rights (despite its `nologin` username).
