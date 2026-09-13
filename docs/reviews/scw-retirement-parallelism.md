---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: c3596511
lens: bounded archive concurrency
---

# Revue du parallélisme final de l'archive

Revue statique unique demandée via H2A, run
`geo-retirement-final-parallelism-review-20260913`. Le manifeste exact est
fourni dans le prompt ; aucun accès au cloud ni test d'exécution par le relecteur.
Pas de prétention de consensus ou d'attestation du modèle effectivement routé.

Verdict : **GO** sur le delta du manifeste depuis `35ebd09` : nom v4, 32
contrôleurs de métadonnées, 16 lecteurs pour la comparaison des octets. Les
8 transferts, buffers, limites CPU/mémoire et garde `--immutable` sont conservés.
La validation serveur Kubernetes a réussi avant application. Les tentatives
précédentes ont été arrêtées et leurs logs conservés ; seules les preuves
complètes du Job final pourront autoriser la suppression source.

Les estimations RAM/débit du relecteur sont indicatives, pas des mesures ni des
bornes prouvées. En particulier, `--buffer-size` n'est pas la taille des chunks
multipart S3 ; les observations runtime et le succès de la comparaison intégrale
sont autoritaires. Une tentative préalable de revue avec commandes s'est
arrêtée sans verdict, ses permissions headless ne les autorisant pas ; cette
revue ne nécessite aucun élargissement de permissions.

## Réponse intégrale

### Decision: **GO**

---

### 1. Scope & Delta Review

Review of the combined delta `origin/main (35ebd09)..c3596511` applied to the manifest:

| Parameter | Previous Value | New Value (v4) | Assessment |
| :--- | :--- | :--- | :--- |
| **Job Name** | `...-v2` | `geo-retirement-bucket-archive-20260913-v4` | Conforms to clean replacement naming convention. |
| **Copy Checkers** | `8` | `32` | Increases metadata traversal concurrency 4× without altering stream buffers. |
| **Check Checkers** | `4` | `16` | Increases download/byte-verification concurrency 4×. |
| **Transfers** | `8` | `8` (Unchanged) | Keeps data transfer concurrency steady. |
| **Upload Concurrency** | `2` | `2` (Unchanged) | Multipart chunk concurrency preserved. |
| **Buffer Size** | `4M` | `4M` (Unchanged) | Memory buffer per stream held constant. |
| **Resource Limits** | `500m` / `512Mi` | `500m` / `512Mi` (Unchanged) | Maintained within previous envelope. |

---

### 2. Concrete Findings

1. **Memory Budget & OOM Safety**:
   * **Copy Phase**: Memory is dominated by transfers: $8\text{ transfers} \times 2\text{ concurrency} \times 4\text{ MiB} \approx 64\text{ MiB}$. Checkers ($32$) primarily execute HTTP `HEAD`/`LIST` requests with negligible per-worker buffers ($<1\text{ MiB}$ each). Including the 45,378 object metadata index ($\sim 15\text{–}20\text{ MiB}$) and Go runtime baseline, peak usage remains well under $\sim 150\text{ MiB}$.
   * **Check Phase (`--download`)**: With `--checkers 16` and `--buffer-size 4M`, simultaneous streaming from both source and destination requires $16 \times 2 \times 4\text{ MiB} = 128\text{ MiB}$ allocated to buffer pools. Combined with Go runtime overhead and the object directory index, total peak memory is projected at $\sim 200\text{–}260\text{ MiB}$, leaving $\sim 250\text{ MiB}$ of headroom below the `512Mi` limit.

2. **Data Integrity & Non-Destructive Invariant**:
   * `rclone copy` retains `--immutable`: Any target collision with mismatched size/hash will fail immediately rather than overwrite.
   * `rclone check` retains `--download`: Full byte-stream hash verification across both endpoints is enforced.
   * Execution shell has `/bin/sh -ec`: A non-zero exit code from either `rclone copy` or `rclone check` immediately aborts the container prior to outputting `ARCHIVE_VERIFIED_BY_DOWNLOAD`.
   * The manifest contains **no delete or sync-delete operations**, upholding source preservation prior to independent retirement confirmation.

3. **Deadline Feasibility**:
   * At 4,400 files/min listing baseline, directory listing of 45,378 objects requires $\sim 10.3$ minutes.
   * Full data volume is 48.94 GB. Initial transfer ($\approx 49\text{ GB}$) plus verification download from both endpoints ($\approx 98\text{ GB}$) totals $\sim 147\text{ GB}$ transit through the pod.
   * At a conservative sustained throughput of $20\text{ MB/s}$ aggregate, pipeline transfer and verification phases require $\approx 120\text{–}150\text{ minutes}$, comfortably within `activeDeadlineSeconds: 14400` (4 hours).

4. **Security & Configuration**:
   * Pinned image digest: `rclone/rclone@sha256:c08f5e100e1c4fa4deb1315b56a47c0cc0e765222b7c0834bc93305f2e4d85c0`.
   * Security hardening in place: `automountServiceAccountToken: false`, `allowPrivilegeEscalation: false`, `drop: [ALL]`.
   * Source/destination credentials isolated in separate secrets (`geo-retirement-source` vs `geo-s3-credentials`) with `/dev/null` config path override.

---

### 3. Bounded Residual Risks

1. **S3 Endpoint Rate Limiting (HTTP 429/503)**:
   * 32 checkers during copy and 16 dual-stream checkers during check increase TPS on Scaleway and OVH. If either provider enforces aggressive burst rate-limiting, rclone's built-in low-level retry backoff could add latency.
2. **CPU Throttling during Check**:
   * Streaming 16 concurrent hash calculations under a `500m` CPU limit may incur CFS quota throttling if network throughput is exceptionally high, extending verification time.
3. **Bandwidth Degradation / Deadline Expiry**:
   * If inter-cloud throughput drops below $10.2\text{ MB/s}$ average, total transfer and check times could approach the 14,400s threshold, triggering pod termination by Kubernetes.

---

### 4. Limitations of Review

* Static manifest and delta inspection only.
* Does not certify live cloud provider status, endpoint reachability, secret existence/validity in namespace `geo`, or underlying node network throughput.
* No live runtime tests or cluster commands were executed during this review.

