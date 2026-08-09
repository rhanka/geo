# QC lots backfill runbook

`qc-lots` is a global dataprep product: for each municipality it materializes the presentation-ready lot layer at `normalized/qc-lots/qc-lots-<slug>.geojson` from:

1. `normalized/qc-cadastre-lots/<slug>.geojson`;
2. `normalized/ca-qc-zonage/qc-zonage-<slug>.geojson`;
3. `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet` when available;
4. optional role-foncier / FSA enrichment.

Because this is a global dataprep link, the durable target is a Kubernetes Job, not a one-off local shell. Local execution is acceptable only as an emergency repair or to validate the plan/throughput.

## Plan generation

Generate the missing/stale set from S3:

```bash
npx tsx acquisition/src/qc-lots-gap.ts --json > work/coverage/immo-qc-lots-gap.json
```

Create a plan JSON with comma-separated batches. Keep batches small enough that one city failure does not waste a large worker slot:

```json
{
  "batches": [
    "slug-a,slug-b,slug-c,slug-d,slug-e",
    ["slug-f", "slug-g", "slug-h", "slug-i", "slug-j"]
  ]
}
```

Recommended batch size:

- local 32-core repair: 5 municipalities per batch, `--workers 8..12`;
- k8s 2-4 vCPU Job: 3-5 municipalities per batch, `--workers 2..4`;
- very large cities (`laval`, `trois-rivieres`, `montreal`, etc.): isolate in their own batch when they dominate memory or wall time.

## Runner

Use the resumable runner:

```bash
npx tsx acquisition/src/qc-lots-backfill.ts \
  --plan work/coverage/qc-lots-plan.json \
  --progress work/coverage/qc-lots-progress.json \
  --workers 4 \
  --enrich-no-role \
  --log work/coverage/qc-lots-backfill.log
```

Flags:

- `--workers N`: number of batches processed in parallel.
- `--from K`: resume from batch index `K`; already completed batch ids in `--progress` are skipped.
- `--enrich-no-role`: fast presentation pass. Produces surface, zone/norms when available, and FSA postal code, but does not wait on role-foncier address matching. Run a second quality pass without this flag if addresses are required.
- `--enrich-no-fsa`: skip postal-code FSA fallback; normally keep FSA enabled.

The runner records child exit codes and keeps unrelated batches moving. A non-zero child exit is captured in `crashed_steps` in the progress JSON.

## Kubernetes job guidance

This should run as a bounded Job with S3 credentials and the acquisition image. Example shape:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: qc-lots-backfill
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backfill
          image: rg.fr-par.scw.cloud/sentropic-geo/geo-acquisition:0.1.0
          command: ["npx", "tsx", "acquisition/src/qc-lots-backfill.ts"]
          args:
            - "--plan"
            - "/work/qc-lots-plan.json"
            - "--progress"
            - "/work/qc-lots-progress.json"
            - "--workers"
            - "3"
            - "--enrich-no-role"
            - "--log"
            - "/work/qc-lots-backfill.log"
          resources:
            requests:
              cpu: "2"
              memory: 4Gi
            limits:
              cpu: "4"
              memory: 8Gi
          envFrom:
            - secretRef:
                name: sentropic-geo-s3
```

For k8s, avoid blindly using the local `--workers 12`: cluster pods often have fewer cores and lower memory than the workstation. Prefer `--workers 3` on a 4-vCPU limit and scale by launching multiple shard Jobs only if S3 and memory stay healthy.

## Completion checks

After the Job completes:

```bash
npx tsx acquisition/src/qc-lots-gap.ts --json > work/coverage/immo-qc-lots-gap.json
npx tsx acquisition/src/immo-lots-audit.ts --report work/coverage/immo-lots.report.json --apply-track
cp work/coverage/immo-lots.report.json work/coverage/immo-lots.json
npx tsx acquisition/src/sync-track-from-coverage.ts --apply
npx tsx acquisition/src/loop-supervise.ts
```

Expected progression is visible in:

- S3 count `qc_lots_deposited` from `qc-lots-gap.ts`;
- `servedMunis` in `work/coverage/immo-lots.json`;
- track coverage after `sync-track-from-coverage.ts --apply`.
