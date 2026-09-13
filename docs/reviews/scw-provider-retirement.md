---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: 5a92dc14
lens: correctness, supply chain, preservation of operational capabilities
---

# Revue du complément de décommission GEO

Revue statique Gemini 3.8 high, selon le modèle demandé par le propriétaire
pour cette reprise. Il s'agit d'une revue indépendante unique, sans prétention
de consensus à deux pairs ni d'attestation du routage effectif du modèle.
Le reçu H2A atteste seulement le lancement demandé.

Cible : changements de code, bootstrap, workflow et README PMTiles de `5a92dc14`.
La revue ne certifie pas les suppressions provider ou le contenu S3.

Validation préalable : 14 tests scripts, typecheck qc-status-report, garde
anti-réintroduction, syntaxe Bash ; build PMTiles réussi et outils exécutés
avec `--network none`. Aucune capture ni écriture de données de production.

## Réconciliation

Verdict statique reçu : **GO**, aucun blocage relevé.
Les observations de portabilité GNU et de normalisation du chemin exporté sont
non bloquantes dans le contrat Linux et `git ls-files` actuel.
Les formulations globales du relecteur sur l’éradication et la sécurité ne valent
pas certification exhaustive : le provider reste à purger, et un contexte dédié
ne protège pas à lui seul contre un secret placé dans ce sous-répertoire.
Le Dockerfile copie uniquement le script suivi ; le checkout CI est propre.

## Réponse intégrale du relecteur

# Static Review — Commit `5a92dc14`

**Verdict**: **GO**

---

### Executive Summary

Commit `5a92dc14` successfully eliminates Scaleway (SCW) runtime and configuration dependencies from the GEO pipeline (PMTiles build job, container registry policy, capture image pinning, and operator bootstrap documentation/scripts), switching to Kubernetes Jobs and OVH Object Storage (S3-compatible) while leaving TEM, MatchID, and unrelated resources entirely unaffected.

---

### Detailed Findings Grounded in Diff

#### 1. GitHub Docker Context & File Semantics (`.github/workflows/docker-publish.yml`, `deploy/pmtiles/`)
- **Matrix Isolation**: Introducing `context: ${{ matrix.context }}` with `context: .` for `geo-acquisition` / `normes-job` and `context: deploy/pmtiles` for `pmtiles-builder` restricts the build context for PMTiles to its dedicated subdirectory.
- **Security & Hygiene**: Preventing the repository root from being sent as the build context for `pmtiles-builder` guarantees that local files, `.env` files, or unrelated code never leak into the image layers.
- **Dockerfile Pathing**: In `docker/build-push-action@v6`, specifying `file: deploy/pmtiles/Dockerfile` alongside `context: deploy/pmtiles` correctly resolves the Dockerfile relative to the repository workspace while resolving context-scoped instructions (`COPY build-pmtiles-job.sh ...`) strictly within `deploy/pmtiles`.
- **Contract Clarity**: `deploy/pmtiles/README.md` documents offline verification (`docker build ...` and container checks with `--network none`) and clarifies that building/publishing does not trigger executions.

#### 2. Restrictive Read-Only Bootstrap & Regional Guards
- **Fail-Fast Regional Binding** (`deploy/pmtiles/build-pmtiles-job.sh`):
  - Replacing `${S3_REGION:-fr-par}` with `${S3_REGION:?S3_REGION required}` eliminates the silent default fallback to Scaleway's Paris region (`fr-par`). Any execution without an explicit region (e.g. OVH `bhs`) will immediately abort.
- **Principle of Least Privilege** (`docs/ops/gcp-3dtiles/OWNER-BOOTSTRAP.md`):
  - Replaces Scaleway-specific IAM policies with OVH S3 preproduction read-only constraints (`s3:GetObject`, `s3:ListBucket`, optional `s3:GetBucketLocation` on `sentropic-geo-preprod`).
  - Explicitly documents the guardrail prohibiting write permissions, prod access, or reuse of serving credentials (`geo-s3-credentials`).
- **Secret Ingestion Encoding** (`docs/ops/gcp-3dtiles/50-owner-bootstrap-all.sh`, `OWNER-BOOTSTRAP.md`):
  - Commands updated to pipe `base64 -w0` into `gh secret set GEO_S3_ENV`, matching the decoding expectations of downstream workflows (`geo-jobs.yml`).

#### 3. Registry Policy Guard Regression Coverage (`scripts/check-registry-policy.*`)
- **Expanded Detection Pattern**:
  - `forbidden` regex now guards against:
    - Provider name variations: `\bscaleway\b` (via `['scale', 'way'].join('')`)
    - Retired domains and pull secrets: `scw\.cloud`, `geo-registry-pull`
    - Any SCW CLI command: `\bscw\s+[a-z][a-z0-9-]*\b` (generalizing beyond `jobs|registry` to capture `scw iam`, `scw instance`, etc.)
    - Environment credentials: `\bSCW_[A-Z_]+\\b`
- **Tracked Scope Expansion**:
  - `git ls-files` search includes `acquisition/scripts`, `docs/ops`, and root `Dockerfile`.
- **Test Matrix Completeness**:
  - `check-registry-policy.test.mjs` verifies both positive detection and rejection across `.sh` scripts, CLI commands, Dockerfiles, and JSON configurations.

#### 4. Historical JSON Prose Preservation (`acquisition/config/capture-image.json`)
- **Targeted JSON Validation**:
  - `check-registry-policy.mjs` inspects only `image` and `registry` keys from parsed JSON.
  - Non-executable descriptive/rationale fields (e.g. `_pourquoi: ["Old Scaleway registry", ...]`) are exempted from string line matching, preventing false positives on historical commentary.
  - Dedicated test in `check-registry-policy.test.mjs` asserts that historical notes mentioning retired providers in JSON do not fail policy enforcement.

#### 5. Preservation of Unrelated Resources (TEM / MatchID)
- All modifications are strictly confined to `.github/workflows/docker-publish.yml`, `acquisition/`, `deploy/pmtiles/`, `docs/ops/gcp-3dtiles/`, `packages/qc-status-report/`, and `scripts/check-registry-policy*`.
- No TEM, MatchID, or unrelated application resources were modified, deleted, or constrained.

---

### Non-Blocking Observations & Pre-existing Context

1. **Operator Portability (`base64 -w0`)**:
   - `50-owner-bootstrap-all.sh` and `OWNER-BOOTSTRAP.md` use `base64 -w0`. This is standard GNU coreutils syntax (Linux). If an operator runs this guided bootstrap command on macOS (BSD `base64`), `-w0` is unrecognized (BSD base64 does not wrap by default). *Pre-existing context: ops tooling targets Linux/cloud runners.*
2. **Defensive Path Matching in `registryViolations`**:
   - `if (path === 'acquisition/config/capture-image.json')` relies on exact string equality. It works as intended because `git ls-files` returns paths normalized from repo root. If the function is ever exported and called with `./acquisition/config/capture-image.json`, it would fall through to extension filtering. Normalizing via `path.replace(/^\.\//, '')` could be considered in future refactors.
3. **Status of Cloud Provider Deletion**:
   - As indicated in the objective, this commit removes code/configuration coupling and adds regression guards; physical deletion of legacy cloud provider buckets/tenants remains an external lifecycle task once cutover verification is complete.

---

### Conclusion

The changes in `5a92dc14` are correct, minimal, well-tested, and satisfy all security and architectural requirements. **GO for merge/deployment.**

## Revue complémentaire du Job d’archivage — eb2361f6

Même modèle demandé, effort high, run H2A `geo-scw-archive-review-20260913`.
Verdict : GO. Ajustement opérationnel retenu : limite mémoire 512 Mi, CPU 500m,
buffer de vérification 4M et parallélisme borné, après observation de la première
copie. Les estimations de durée du relecteur sont hypothétiques. La preuve finale
reste le résultat du Job et la relecture de l’archive.

# VERDICT: GO

The Job manifest in commit `eb2361f6` is syntactically and semantically sound. It introduces no bugs that would block data preservation or harm live serving data.

---

### 1. Write Scope & Serving Safety
- **Prefix Isolation**: The target path is strictly confined to `dst:sentropic-geo/ops/decommission/20260913/scw-sentropic-geo`. It operates in an isolated namespace within the destination bucket and does not overlap with live serving paths.
- **Non-Destructive Operation**: Uses `rclone copy` (not `sync`), ensuring no deletion or eviction of objects on the destination bucket.
- **Immutability Guard**: `--immutable` guarantees that rclone will abort rather than overwrite any destination object if an existing object differs.
- **Serving RW Safety**: Although the destination secret (`geo-s3-credentials`) holds full RW privileges on the serving bucket, the manifest limits its write blast radius strictly to the timestamped decommissioning prefix.

---

### 2. Rclone Command Semantics & Verification
- **Full Bucket Preservation**: `source=src:sentropic-geo` correctly targets the entire 45,378-object source to capture all pre-divergence objects.
- **Bit-for-Bit Verification**: Because S3 multipart ETags diverge between providers (Scaleway vs. OVH), `rclone check "$source" "$archive" --download` correctly downloads and verifies byte streams directly without relying on mismatched ETags or metadata hashes.
- **Verification Gate**: With shell `-e`, any mismatch, checksum failure, or missing file during `rclone check` immediately aborts the pipeline with exit code `1` before reaching the `ARCHIVE_VERIFIED_BY_DOWNLOAD` marker.

---

### 3. Retry Behavior & Idempotency
- **Pod Restarts (`restartPolicy: Never`, `backoffLimit: 1`)**: If Pod 1 fails mid-run, Kubernetes launches exactly one retry pod.
- **Idempotency with `--immutable`**: In S3, completed objects are immutable and atomic. On restart, `rclone copy` compares existing identical objects and skips them without triggering `--immutable` errors. Incomplete multipart uploads from a failed attempt remain invisible/uncommitted.

---

### 4. Actionable Findings & Operational Considerations

1. **Tight Active Deadline vs. Transatlantic Latency**:
   - **Observation**: Transferring 48.94 GB across 45,378 small objects (~1 MB avg) from Scaleway Paris (`fr-par`) to OVH Beauharnois (`bhs`) with `--transfers 2` will take ~60–90 minutes. The subsequent `rclone check --download --checkers 2` must download ~98 GB aggregate over only 2 checker streams, taking ~90–120 minutes.
   - **Risk**: Total runtime will hover around 2.5–3.5 hours. If transatlantic transit degrades or latency spikes, the job risks hitting `activeDeadlineSeconds: 14400` (4 hours) and terminating with `DeadlineExceeded`.
   - **Recommendation**: If execution allows adjustment, increase `activeDeadlineSeconds` to `21600` (6 hours) or bump `--transfers` and `--checkers` to `4`.

2. **Memory Limit vs. Unset Check Buffer Size**:
   - **Observation**: `rclone copy` sets `--buffer-size 4M`, but `rclone check` omits `--buffer-size`, defaulting to rclone's `16M` buffer per stream.
   - **Risk**: 2 checkers reading both source and destination generate 4 concurrent download streams (64 MiB in stream buffers alone) plus directory metadata for 45k objects. Inside `limits.memory: 256Mi`, Go runtime GC spikes could push close to the OOM threshold.
   - **Recommendation**: Explicitly pass `--buffer-size 4M` to `rclone check` as well, or increase container memory limit to `512Mi`.

3. **CPU Throttling**:
   - **Observation**: `limits.cpu: 200m` (0.2 cores) will throttle concurrent TLS decryption and byte/hash stream comparisons during the dual download check phase, extending runtime. Raising the limit to `500m`–`1000m` is recommended if node capacity permits.

---

### Coordinator Record
- **Target File**: `docs/reviews/scw-provider-retirement.md`
- **Result**: `GO` — Authorized for execution in namespace `geo`. Write scope confirmed isolated; non-destructive to live serving.
