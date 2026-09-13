---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: 8b6ca742
lens: deletion preconditions and credential destination
---

# Revue finale des opérations GEO

Revue statique unique complémentaire, selon le modèle demandé, sans prétention
de consensus ni d'attestation du modèle effectivement routé. Cible : delta
`ca941615..8b6ca742` des scripts d'audit/purge, garde du bootstrap et test associé.

Validation réelle : 15 tests scripts réussis ; le bootstrap a renouvelé uniquement
le SA `geo-preprod/geo-ci-runner` sur le cluster OVH déclaré. Les 70 objets
historiques ont été vérifiés inactifs puis supprimés avec préconditions UID et
resourceVersion après relecture des archives S3. Zéro référence historique
résiduelle dans les inventaires `geo` et `geo-preprod` contrôlés.

## Réconciliation — deux blocages réfutés par exécution

Le relecteur rend **NO-GO** sur deux affirmations factuellement incorrectes.
Elles ne sont pas appliquées. Le verdict brut est conservé ci-dessous.

1. `kubectl delete --raw` existe dans kubectl v1.35.3 : `kubectl delete --help`
   expose `--raw=''`. La commande utilisée avec DeleteOptions a effectivement
   supprimé les objets archivés ; le contrôle suivant ne trouve aucun résidu.
   Retirer les préconditions comme proposé affaiblirait la protection contre une course.
2. Node v22.22.1 : `node -p 'JSON.stringify(process.argv)' argv-proof` produit
   `["/usr/bin/node","argv-proof"]`. Le premier argument utilisateur est bien
   `argv[1]`. La commande exacte du bootstrap lit le serveur OVH déclaré. La rotation
   réelle a réussi à 14:35 UTC, token expirant le 13 octobre 2026 à 14:35:15 UTC.
   Remplacer par `argv[2]` casserait le script. Le test négatif ne masque pas un échec
   de lecture : `set -e` arrêterait le script avant son diagnostic de cible.

Le positif est couvert ici par la rotation réelle et son self-verify RBAC ;
le test committé protège la frontière négative. Pas de modification cosmétique
`.trim()` nécessaire pour le jsonpath kubectl, qui ne produit pas de newline.
Les remarques favorables sur les autres contrôles ne constituent pas une
certification indépendante du cloud.

## Réponse intégrale

# Code Review: delta `ca941615..8b6ca742`

**Verdict: NO-GO**

Two blocking defects prevent this delta from functioning: `delete-archived-k8s-history.mjs` fails immediately on execution due to an invalid `kubectl` command, and `54-gen-kubeconfig.sh` is permanently broken on all clusters due to an argument index error in `node -p`.

---

### Blocking Findings

#### 1. Fatal CLI invocation error in [`scripts/delete-archived-k8s-history.mjs`](file:///scripts/delete-archived-k8s-history.mjs#L38)
```javascript
// scripts/delete-archived-k8s-history.mjs:38
kubectl(['delete', '--raw', `${prefix}/namespaces/${namespace}/${resource}/${name}`, '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background', preconditions: { uid, resourceVersion: live.metadata.resourceVersion } }));
```
* **Issue**: `kubectl delete` does not support a `--raw` flag (in `kubectl`, `--raw` is only supported on `get`, and only for HTTP GET). Furthermore, `-f -` expects an API resource manifest (`Pod`, `Job`, etc.), not a `DeleteOptions` meta-struct.
* **Impact**: Running with `--execute` will immediately crash via `execFileSync` on the first item with `error: unknown flag: --raw` (or `no matches for kind "DeleteOptions"`). No resources can be deleted.
* **Remedy**: To delete with preconditions from Node.js:
  1. Either issue an HTTP `DELETE` request via Node `fetch` / `https.request` directly against the Kubernetes apiserver using the cluster CA and bearer token with the `DeleteOptions` body; or
  2. If using standard `kubectl delete`: invoke `kubectl(['-n', namespace, 'delete', resource, name, '--cascade=background'])`. Note that while `kubectl delete` CLI does not expose `--uid`/`--resourceVersion` precondition flags directly, `delete-archived-k8s-history.mjs` already performs live verification (`live.metadata.uid !== uid` and `assertSafe(live)`) immediately prior to the delete call.

---

#### 2. False negative lockout in [`docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh`](file:///docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh#L37)
```bash
# docs/ops/gcp-3dtiles/54-gen-kubeconfig.sh:37
EXPECTED_SERVER="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).server' "$(dirname "$0")/../../../acquisition/config/k8s-target.json")"
[ "$SERVER" = "$EXPECTED_SERVER" ] || { echo "❌ Le kubeconfig ne cible pas le cluster GEO déclaré : aucun token généré."; exit 1; }
```
* **Issue**: When evaluating inline scripts via `node -p` (or `node -e`), `process.argv[0]` is the Node executable and `process.argv[1]` is `'[eval]'`. The script arguments passed on the CLI start at `process.argv[2]`.
* **Impact**: `readFileSync(process.argv[1])` attempts to read a file named `'[eval]'`, throwing `ENOENT` to stderr and writing nothing to stdout. `EXPECTED_SERVER` is evaluated as an empty string `""`. Consequently, `[ "$SERVER" = "$EXPECTED_SERVER" ]` fails on **every cluster**, including the valid target cluster.
* **Why the test missed it**: [`scripts/ops-bootstrap-target.test.mjs`](file:///scripts/ops-bootstrap-target.test.mjs#L22-L25) only tests the negative branch (`https://retired.invalid != ""`). Because `EXPECTED_SERVER` was empty due to the crash, it exited 1 and matched `/aucun token généré/` for the wrong reason.
* **Remedy**: Use `process.argv[2]` (or `process.argv.at(-1)`):
  ```bash
  EXPECTED_SERVER="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8")).server' "$(dirname "$0")/../../../acquisition/config/k8s-target.json")"
  ```

---

### Actionable Non-Blocking Findings

#### 3. Add positive test case to [`scripts/ops-bootstrap-target.test.mjs`](file:///scripts/ops-bootstrap-target.test.mjs)
The test suite currently only tests cluster rejection. Add a companion test asserting that `54-gen-kubeconfig.sh` succeeds and generates credentials when `cluster.server` matches `acquisition/config/k8s-target.json`.

#### 4. Defensive trimming of apiserver output in [`scripts/delete-archived-k8s-history.mjs`](file:///scripts/delete-archived-k8s-history.mjs#L17-L18)
```javascript
const server = kubectl(['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}']);
if (server.trim() !== target.server) throw new Error('Wrong cluster');
```
`execFileSync` preserves trailing newlines from process stdout. Adding `.trim()` prevents false mismatches depending on the local `kubectl` build.

---

### Commendations & Verification Notes
* **Archive & Safety Assertions**: `assertSafe` in `scripts/delete-archived-k8s-history.mjs` correctly enforces namespace isolation (`geo`, `geo-preprod`), terminal phase checks for Pods, inactive + terminal/suspended checks for Jobs, and 0-replica checks for ReplicaSets.
* **PVC Archive Job**: `deploy/k8s/geo-retirement-pvc-archive.yaml` correctly sets `runAsUser: 0` paired with `allowPrivilegeEscalation: false` and minimal capability `DAC_READ_SEARCH` to read volume contents without full root privileges. The single PUT ceiling (`5000000000`) is conservative and safe.
* **History Audit**: `scripts/audit-object-history.mjs` correctly filters out secrets from stdout and paginates versions and incomplete multipart uploads.
