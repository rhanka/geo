# Bascule iso-prod geo — CD-native (one-time install, then automated)

Clone of `radar-immobilier:deploy/ci/bascule-preprod/CD_NATIVE_MIGRATION.md`. Owner directive:
**every production action is driven by code; the owner validates nothing per-act.** The
only human step is the one-time cluster install by the k8s lane, which is itself a committed
script (`install-cd-bootstrap.sh`).

Constraints kept: **0 Python**, secrets **never committed in plaintext** (SealedSecrets
committed by geo-cond), all fail-closed gates that apply to geo (VAP anti-RCE,
CONFIRM G3, recon-before-rollout G4, positive DB control in-cluster), runner stays
**kubectl-only + STATUS-ONLY** (no `kubectl logs`, no S3/DB creds).

## Difference vs immo (arbitrated by i-cond)

| immo | geo |
| --- | --- |
| first bundle via `gh workflow run bascule-bundle-cd.yml` from the install script | first bundle applied **owner-direct** by `install-cd-bootstrap.sh` (same steps + anti-RCE gate): the workflow is not on `main` yet |
| cleanup of v1 dormants (`radar-ci-setup-prod`, GH secrets) | N-A (no v1 bootstrap for geo) |
| run S0→S7 incl. quiesce, restore, migrate, flip, refresh | S0 → S1 dump → S3 copy `normalized/` → S3b recon → S5' rollout → S7 smoke (no preprod PG, no writer to freeze) |

## Flow — one-time install, then everything automated

```
  ┌── ONE-TIME, k8s lane (cluster-admin), install-cd-bootstrap.sh ──────────────┐
  │ prereqs: geo-db-ro-prod + geo-pra-writer-prod sealed & committed (geo-cond), │
  │          preprod readers deposited (k8s),                                    │
  │          netpol-geo-db-backup applied (postgis ingress, ns geo default-deny)  │
  │ 1. apply rbac-ci-bascule-prod.yaml (ns geo) + rbac-ci-bascule-preprod.yaml   │
  │ 2. mint tokens → GH secrets KUBE_CONFIG_DATA_PROD,                           │
  │      KUBE_CONFIG_DATA_BASCULE_PREPROD                                        │
  │ 3. FIRST bundle apply, owner-direct: SealedSecrets → RO-role Job → dormant   │
  │      CronJob → VAP → RBAC T1 → anti-RCE gate (A denied / B allowed)          │
  │ 4. mint token geo-ci-trigger-prod → GH secret KUBE_CONFIG_DATA_PROD_TRIGGER  │
  │ 5. gh variable set BASCULE_BUNDLE_CD_ENABLED true   (apply on merge)         │
  │ 6. gh variable set BASCULE_SCHEDULE_ENABLED true    (nightly run)            │
  └─────────────────────────────────────────────────────────────────────────────┘
                                   │
   ── then, 0 owner action ──      ▼
  ┌── every merge to main touching deploy/ci/bascule-preprod/** ────────────────┐
  │ bascule-bundle-cd.yml (KUBE_CONFIG_DATA_PROD, idempotent, same 6 steps)      │
  └─────────────────────────────────────────────────────────────────────────────┘
  ┌── nightly 03:17 UTC (armed) or workflow_dispatch (CONFIRM) ─────────────────┐
  │ bascule-preprod.yml: S0 → S1 dump (trigger + freshness + re-suspend) →       │
  │   S3 copy normalized/ (CopyObject, additive) → S3b recon (dest ⊇ src) →      │
  │   S5' rollout restart geo-api (G4) → S7 smoke (API: preprod ⊇ prod)          │
  └─────────────────────────────────────────────────────────────────────────────┘
```

## GitHub Actions secrets

| GH secret | Identity | Used by |
| --- | --- | --- |
| `KUBE_CONFIG_DATA_PROD` (permanent) | SA `geo-ci-bascule-prod` (ns geo) | `bascule-bundle-cd.yml` |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | name-scoped SA `geo-ci-trigger-prod` (ns geo) + VAP | `bascule-preprod.yml` S1 |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | SA `geo-ci-bascule-preprod` (ns geo-preprod) | `bascule-preprod.yml` |

Unchanged and NOT used by the bascule: `KUBE_CONFIG_DATA` (env `geo-prod`, `cd-prod.yml`),
`KUBE_CONFIG_DATA_PREPROD` (`cd-preprod.yml`), `KUBE_CONFIG_GEO` (env `geo-preprod`).

## Repo variables (non-secret; safe fallbacks built in)

- `BASCULE_BUNDLE_CD_ENABLED` — arms `bascule-bundle-cd.yml` (off by default).
- `BASCULE_SCHEDULE_ENABLED` — arms the nightly run (off by default).
- `EXPECTED_KUBE_APISERVER_HOST[_PROD]` — cluster identity (default OVH host `hlhedx.c1.bhs5.k8s.ovh.net`, same cluster as immo).
- `BASCULE_EXPECTED_DATABASE` — literal name of the geo prod DB (workflow default `geo`, from k8s).
- `BASCULE_DOCS_SYNC_GRANTEE` — canonical id OVH of the geo preprod serving identity (GrantFullControl);
  workflow default `1901410700457444:9056dbb240a04d2584ffbaec38171228` (validated with k8s).
- Overrides (defaults in the workflow): `BASCULE_PROD_DOCS_BUCKET`, `BASCULE_PREPROD_DOCS_BUCKET`,
  `BASCULE_DOCS_SYNC_PREFIX`, `BASCULE_DUMP_*`, `BASCULE_DOCS_SYNC_READ_SECRET`,
  `BASCULE_PREPROD_NAMESPACE`, `BASCULE_PREPROD_API_URL`, `BASCULE_PROD_API_URL`,
  `BASCULE_VAP_PROPAGATION_SEC`.

## Idempotency / re-runnability

- SealedSecrets: `kubectl apply` = create-or-update; the controller reconciles.
- RO-role Job: immutable → delete `--ignore-not-found` then apply, wait Complete.
- VAP / RBAC / CronJob: idempotent apply; the CronJob stays `suspend: true` until S1.
- Anti-RCE gate: non-destructive (`--dry-run=server`); on failure it empties the T1 Role rules.
- Run: copy is additive + idempotent (CopyObject same key); recon is LIST-only; rollout is a restart.
