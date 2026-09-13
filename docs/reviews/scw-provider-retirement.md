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
