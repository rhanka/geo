# normes-job — QC zonage-norms pipeline as a Scaleway Serverless Job

Runs the `qc-zonage-norms-<slug>` extraction pipeline **remotely and durably**
(survives the laptop being off), mirroring `deploy/pmtiles/`. The image is baked
with `poppler-utils` (`pdftotext` / `pdfinfo` / `pdftoppm`, required by the
parsers and the Mistral-vision page renderer) and the `acquisition/` +
`packages/qc-sources/` TypeScript run via `tsx`.

The job deposits `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`
(+ refreshes `registry/qc-zonage-norms/manifest.json`) on S3. **Idempotent**: it
HEAD-skips any slug already deposited, so a re-run never redoes a paid vision pass.

---

## Two modes

| Mode | `MODE` | What runs | Network egress | Use when |
|------|--------|-----------|----------------|----------|
| **EXTRACT-ONLY** (default, recommended) | `extract` | pull staged PDFs + manifest from `s3://$S3_BUCKET/sources/qc-zonage-grilles/` → route → extract → deposit | **S3 + api.mistral.ai only** (no municipal sites) | normal production runs |
| **FULL** | `full` | province discovery (crawl muni sites, download PDFs, route-guess) → extract → deposit | **+ outbound to municipal websites** | only if Scaleway job egress to arbitrary sites is confirmed |

**Recommended default: `extract`.** Scaleway Serverless Jobs *do* have outbound
internet (so the Mistral API + S3 always work), but crawling ~1100 municipal
sites from inside a job is slow, fragile (per-site timeouts, robots delays,
2h job timeout) and re-fetches what we already stored. The robust split is:
run discovery **once** locally (or on a long-lived box) and `npx tsx
acquisition/src/stage-grilles-s3.ts` to push the confirmed PDFs +
`munis.json`/`discovered.json` to `s3://$S3_BUCKET/sources/qc-zonage-grilles/`;
then the job in `extract` mode only does the deterministic, resumable
extraction. If you confirm egress is fine and want the job to do everything, set
`MODE=full` (optionally `LIMIT` to cap the muni count).

> Staging step (run anywhere with the creds, before the first extract run):
> `cd acquisition && npx tsx src/stage-grilles-s3.ts`

---

## Credentials (NAMES only — never commit values)

Injected as job **environment variables / secrets**. Nothing is written to disk;
`lib/s3.ts` reads `S3_*` straight from `process.env` when no `s3.env` file is
present, and `zonage-norms-batch.ts` reads `MISTRAL_API_KEY` from the env too.

| Var | Purpose |
|-----|---------|
| `S3_ENDPOINT` | Scaleway S3 endpoint, e.g. `https://s3.fr-par.scw.cloud` |
| `S3_BUCKET` | `sentropic-geo` |
| `S3_REGION` | `fr-par` |
| `S3_ACCESS_KEY` | S3 access key (secret) |
| `S3_SECRET_KEY` | S3 secret key (secret) |
| `MISTRAL_API_KEY` | Mistral key for vision/multizone routes (secret) |

Optional tunables: `MODE` (`extract`\|`full`), `LIMIT` (full-mode discovery cap),
`NORMS_BUDGET_USD` (per-muni $ cap, default 4), `DELAY_MS` (full-mode politeness,
default 2000), `NORMS_MANIFEST` (override manifest path).

---

## Build & push

```sh
# from the repo root (build context = repo root; --network=host: buildkit DNS is flaky)
docker build --network=host \
  -f deploy/normes-job/Dockerfile \
  -t rg.fr-par.scw.cloud/sentropic-geo/normes-job:0.1.0 .

# login (credentials out-of-repo) then push
docker login rg.fr-par.scw.cloud -u nologin --password-stdin   # paste a SCW secret key
docker push rg.fr-par.scw.cloud/sentropic-geo/normes-job:0.1.0
```

---

## Create & run the Scaleway Serverless Job (CLI)

```sh
# Create the definition. memory: gros PDF rendered at 200 DPI by pdftoppm ⇒ ~4 Gi.
# local-storage MAX = 10240 MiB (hard limit); PDFs are pulled one tree-slug at a time.
scw jobs definition create \
  name=normes-job \
  image-uri=rg.fr-par.scw.cloud/sentropic-geo/normes-job:0.1.0 \
  cpu-limit=2000 \
  memory-limit=4096 \
  local-storage-capacity=10240 \
  job-timeout=2h \
  environment-variables.MODE=extract \
  environment-variables.S3_ENDPOINT=https://s3.fr-par.scw.cloud \
  environment-variables.S3_BUCKET=sentropic-geo \
  environment-variables.S3_REGION=fr-par \
  environment-variables.NORMS_BUDGET_USD=4

# Secrets (S3 keys + Mistral) — set out-of-band, NEVER in this file or git:
scw jobs definition update <definition-id> \
  environment-variables.S3_ACCESS_KEY=<value> \
  environment-variables.S3_SECRET_KEY=<value> \
  environment-variables.MISTRAL_API_KEY=<value>
# (Prefer Scaleway Secret Manager refs over plaintext env if available.)

# Start a run + follow it
scw jobs definition start <definition-id>
scw jobs run list definition-id=<definition-id>
scw jobs run get <run-id>
```

`job-timeout` wants a Go duration string (`2h`, `30m`) — **not** a bare integer.

### Schedule (optional cron)

```sh
scw jobs definition update <definition-id> cron.schedule="0 6 * * 1" cron.timezone="America/Toronto"
```

---

## Resources & limits

- **Memory** — `pdftoppm` renders pages to PNG at 200 DPI; large/scanned grilles
  are memory-hungry. Start at **4096 MiB**, raise to 8192 if a run OOMs.
- **Local storage** — hard cap **10240 MiB**. EXTRACT-ONLY pulls PDFs per slug;
  if the staged corpus is huge, lean on the idempotent skip across several runs.
- **Timeout** — `2h` default. The idempotent deposit-skip makes the job
  fully resumable: re-running continues where the previous run stopped.
- **Cost** — only the `vision`/`multizone` routes call Mistral; `native` is $0.
  `NORMS_BUDGET_USD` caps **per-muni** spend; each per-muni JSON logs `visionUsd`
  and the final line is `=== FIN BATCH NORMES (ok=.. fail=.. skip=..) ===`.
- **Egress** — Mistral + S3 are always reachable. **Municipal-site crawling
  (`MODE=full`) is the fragile part**; prefer `extract` against pre-staged PDFs.
- **Secrets** — names only here; values live in the job env / Secret Manager and
  are never logged (entrypoint prints `set`/`MISSING`, never the value).
```
