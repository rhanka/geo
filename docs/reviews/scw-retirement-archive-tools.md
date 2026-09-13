---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: ca941615
lens: archival integrity and temporary credential boundaries
---

# Revue des outils de préservation avant retrait

Revue statique unique selon le modèle demandé par le propriétaire, sans
prétention de consensus ni d'attestation du modèle effectivement routé.

Cible : `scripts/archive-container-registry.mjs`, `scripts/presign-ops-archive.mjs`
et `deploy/k8s/geo-retirement-pvc-archive.yaml` à `ca941615`.
Un probe réel PUT/GET OVH via les URL signées a retourné HTTP 200 et des octets
identiques. Le Job PVC est admis par le dry-run serveur. La source PostGIS
est à zéro replica ; le volume est monté en lecture seule. Les URL ne permettent
que PUT/GET d'un objet d'archive pendant deux heures ; la clé secrète OVH reste
hors du cluster source. L'export OCI conserve tous les digests et architectures.

## Réconciliation des conditions

- Borne de 5 GB conservée : limite volontaire du PUT unique, pas une prétention de capacité complète du PVC. La sauvegarde réelle fait 196 136 960 octets et a été vérifiée. Augmenter à 5,4 GB sans multipart serait une régression.
- UID root rendu explicite ; le digest épinglé et le pod exécuté confirment déjà UID 0. Volume RO et seule capacité de lecture DAC_READ_SEARCH.
- Reprise OCI conservée : revalider chaque digest est acceptable pour 69 références ; ne pas ignorer des blobs sur la seule présence de index.json.
- Deux lectures PVC conservées : la substitution de processus proposée ne propage pas à elle seule un échec de tar. Pour 196 Mo, préserver les deux codes de sortie explicites.
- Secret temporaire des URL supprimé après succès. Le Job a confirmé SHA256 115dd8a22ec4aa7e6980ac94af540998aae01029e5b5971be8ffea231cfbea10, archive relue et structure tar valide.

## Réponse intégrale

# Review Verdict: GO (with Actionable Conditions)
**Target Commit:** `ca941615`
**Scope:** Decommission archive tooling for Scaleway container registry & PostGIS PVC retirement (`archive-container-registry.mjs`, `presign-ops-archive.mjs`, `deploy/k8s/geo-retirement-pvc-archive.yaml`).

---

## 1. Verified Safeguards & Architecture Conformance

- **Non-Destructive Guarantee**: All scripts and specs operate in read-only mode against source systems (`readOnly: true` mount and PVC declaration; Skopeo digest copy without source deletion). No source deletion commands exist in commit `ca941615`.
- **Zero Long-Term Secret Leakage**: S3 credentials remain isolated on the operator workstation (`presign-ops-archive.mjs`). Only ephemeral 2-hour presigned PUT/GET URLs are exposed to the target Kubernetes cluster via secret ref.
- **Byte-Level Verification Loop**: End-to-end checksum verification (`source.sha256` computed during upload via FIFO tee matches `download.sha256` fetched back from OVH S3), followed by structural archive parsing (`tar -tf`).
- **Standard Dependencies**: Node SDK imports (`@smithy/signature-v4`, `@aws-crypto/sha256-js`) match root package lock; container image pins immutable digest (`ghcr.io/rhanka/pmtiles-builder@sha256:b2155a...`).

---

## 2. Core Checklist Evaluation

| Checklist Item | Status | Finding |
| :--- | :---: | :--- |
| **Backup Integrity** | **PASS** | `source.sha256` is generated directly from the uploaded stream via named pipe (`/work/source-stream`). Verification compares download digest and tests tarball index parsing (`tar -tf -`). Skopeo uses `--preserve-digests` and `--all` across multi-arch tags. |
| **Curl Stream & Content-Length** | **PASS** | Exact byte count determined prior to upload via dry-run `tar -cf - . \| wc -c`. Curl uses `-H "Content-Length: $bytes" -H 'Transfer-Encoding:'`, preventing chunked encoding failure on S3 presigned PUT. |
| **Readonly PVC Permissions** | **PASS (Conditional)** | PVC and VolumeMount are strictly `readOnly: true`. Kernel bypass capability `DAC_READ_SEARCH` is added to read PostGIS `0700` files, but requires explicit root UID context (see Issue 2). |
| **Cleanup, Secrets & Expiry** | **PASS** | URLs minted with 7200s TTL; Job `activeDeadlineSeconds: 6600` guarantees execution halts before URL expiration. Ephemeral secret must be deleted post-run. |

---

## 3. Actionable Issues & Required Adjustments

### Issue 1: PVC Byte Upper-Bound Mismatch (High Priority)
- **Location**: `deploy/k8s/geo-retirement-pvc-archive.yaml:20`
- **Code**: `test "$bytes" -lt 5000000000`
- **Problem**: `5Gi` = $5 \times 1024^3 = 5,368,709,120\text{ bytes}$. The upper boundary check is set to $5,000,000,000\text{ bytes}$ (~$4.65\text{ GiB}$). If the PostGIS data directory exceeds 4.65 GiB, the Job will abort before uploading.
- **Action**: Increase the upper limit to match PVC capacity with margin:
  ```bash
  test "$bytes" -lt 5400000000
  ```

### Issue 2: Ensure `runAsUser: 0` for `DAC_READ_SEARCH` (Medium Priority)
- **Location**: `deploy/k8s/geo-retirement-pvc-archive.yaml:31-33`
- **Problem**: The job specifies `capabilities: {drop: [ALL], add: [DAC_READ_SEARCH]}`. If `ghcr.io/rhanka/pmtiles-builder` runs as an unprivileged UID by default, Linux drops effective capabilities unless ambient capabilities are set. Postgres data directories (`/pg`) are mode `0700` owned by UID `999`/`postgres`.
- **Action**: Make root execution explicit in `securityContext`:
  ```yaml
  securityContext:
    runAsUser: 0
    allowPrivilegeEscalation: false
    capabilities: {drop: [ALL], add: [DAC_READ_SEARCH]}
  ```

### Issue 3: Skopeo Resume / Idempotency for Interrupted Exports (Operational)
- **Location**: `scripts/archive-container-registry.mjs:22-29`
- **Status**: 36 of 69 tags currently exported.
- **Problem**: The loop iterates unconditionally from index 0. While Skopeo deduplicates blobs already in `/archive/layout`, restarting the script without filtering forces redundant remote registry handshakes for the 36 completed tags.
- **Action**: Filter `tasks` by checking if the reference already exists in the target OCI `index.json`, or support an optional `--skip-existing` / `--offset` parameter.

### Issue 4: Dual Egress Download During Job Verification (Optimization)
- **Location**: `deploy/k8s/geo-retirement-pvc-archive.yaml:26-28`
- **Problem**: The Job downloads the ~5 GB object twice over the network:
  ```bash
  curl "$ARCHIVE_GET_URL" | sha256sum > /work/download.sha256
  curl "$ARCHIVE_GET_URL" | tar -tf - > /dev/null
  ```
- **Action**: Stream once into both verification tools to cut egress bandwidth and runtime by 50%:
  ```bash
  curl --fail --silent --show-error "$ARCHIVE_GET_URL" | tee >(tar -tf - > /dev/null) | sha256sum > /work/download.sha256
  ```

### Issue 5: Post-Execution Secret Deletion (Lifecycle)
- **Location**: Kubernetes Cluster (`geo` namespace)
- **Action**: Ensure the operator runbook includes explicit deletion of the ephemeral secret immediately following Job success:
  ```bash
  kubectl delete secret geo-retirement-archive-urls -n geo
  rm -f <outputFile.json>
  ```

---

## 4. Decommission Sequence Recommendation

1. Apply fix for **Issue 1** (`5400000000`) and **Issue 2** (`runAsUser: 0`).
2. Complete remaining 33 Skopeo tags (`archive-container-registry.mjs`). Validate OCI directory with `skopeo inspect oci:<path>:<tag>`.
3. Execute `presign-ops-archive.mjs` $\rightarrow$ create `geo-retirement-archive-urls` Secret.
4. Launch Job `geo-retirement-pvc-archive-20260913`. Monitor stdout for `PVC_ARCHIVE_VERIFIED <hash>`.
5. Delete `geo-retirement-archive-urls` Secret.
6. Verify independent Rclone bucket archive completion.
7. Only after steps 2, 4, and 6 pass: proceed to source PVC and Scaleway registry destruction.
