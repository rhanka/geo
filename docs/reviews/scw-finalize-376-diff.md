---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: 1208030953417d9ce531719d8994670e882732b0
scope: runtime, manifests, workflows, Dockerfiles and registry guard diff against main
verdict: GO
---

Revue demandée par le propriétaire, exécutée via `geo-scw-376-gemini-diff`,
sur le diff fourni directement au modèle. Les documents étaient résumés ;
le modèle n'a pas validé le cluster ni effectué les builds.

Réconciliation avant merge : la garde CI est déplacée après `setup-node`.
Les trois pins sont remplacés par les digests du build final `34758292002`,
vérifiés anonymement avec HTTP 200 ; les 45 tests ciblés passent. L'observation
sur un résumé vide avec `push: false` ne concerne aucun déclencheur actuel :
ce workflow accepte uniquement les tags de release et les dispatchs explicites,
pour lesquels `push` est vrai. Aucun changement n'est requis sur ce point.
L'accès public aux quatre packages a été vérifié indépendamment de la revue.

Le verdict original est reproduit ci-dessous. Il s'agit de la revue Gemini
demandée, sans revendication d'un consensus entre deux pairs.

### Verdict : **GO** *(avec réserves et limites de la revue statique)*

---

### Synthèse de la revue statique

Le diff réalise de manière propre et cohérente le désengagement de Scaleway (SCW) au profit de GHCR et la suppression des `imagePullSecrets` obsolètes (`geo-registry-pull`). Aucun défaut bloquant d'exécution n'est identifié dans le code fourni.

---

### Analyse détaillée par composant

1. **Workflows GitHub Actions (`ci.yml`, `docker-publish.yml`)** :
   - **Garde de politique (`ci.yml`)** : L'ajout de l'exécution de `check-registry-policy.mjs` verrouille la non-réintroduction des URLs et secrets SCW.
   - **Matrice de build d'extraction (`docker-publish.yml`)** : Le nouveau job `build-and-push-extraction` mutualise proprement la construction de `geo-acquisition` et `normes-job`. L'usage des permissions (`packages: write`), du cache GHA et des métadonnées OCI est conforme aux standards GHCR.
   - **Isolation du runner de capture** : `geo-capture` reste isolé dans son propre job, évitant un couplage prématuré avec les cycles d'extraction.

2. **Script de garde (`scripts/check-registry-policy.mjs` et test)** :
   - La détection via regex décomposée (`retiredHost`, `retiredPullSecret`, `forbidden`) évite habilement de s'auto-détecter.
   - Le filtrage exclut correctement les fichiers de test, commentaires Markdown/YAML/JS et fixtures historiques.
   - L'idiome ESM pour l'exécution directe (`resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)`) est robuste.

3. **Manifestes et lanceurs Kubernetes (`acquisition/src/k8s-*.ts`, YAML)** :
   - Suppression systématique de `imagePullSecrets` sur l'ensemble des workloads (`geo-api`, jobs d'acquisition, de capture et de contraintes).
   - Les digests par défaut pour `DEFAULT_IMAGE` dans `k8s-captured-normes-run.ts` et `k8s-shard-run.ts` sont bien au format immuable `@sha256:<64 hex>`.
   - Dans `s3dag/emit-manifests.ts`, la variable `S3DAG_PULL_SECRET` passe par défaut à une chaîne vide `""`, neutralisant l'injection de secret sans casser la signature du manifest builder.

4. **Dockerfiles (`deploy/acquisition-job/Dockerfile`, `deploy/normes-job/Dockerfile`)** :
   - L'ajout du lien symbolique `ln -s /geo/acquisition/node_modules /geo/node_modules` et la copie complète de `packages/geo/` résolvent élégamment la résolution ESM des dépendances partagées (ex. `zod`) sans nécessiter d'espace de travail npm racine.
   - L'étape de validation statique (`tsx -e 'import { depositZonageNorms }...'`) garantit dès le build la résolution effective des imports.

---

### Points d'attention et observations concrètes (non bloquants)

1. **Ordre d'exécution dans `ci.yml`** :
   ```yaml
   - name: Guard registry migration
     run: node scripts/check-registry-policy.mjs
   - uses: actions/setup-node@v4
   ```
   L'étape est exécutée *avant* `setup-node`. Sur les runners hébergés GitHub (`ubuntu-latest`), un binaire Node est présent dans le PATH par défaut et exécute le script sans souci. Cependant, par convention et pour garantir la version exacte de Node (v22), il est généralement préférable de positionner ce step *après* `setup-node`.
2. **Sortie dans `$GITHUB_STEP_SUMMARY` si `push: false`** :
   Dans `docker-publish.yml`, l'étape `Report immutable digest` s'exécute même si la condition `push` est fausse (ex. build de validation sans tag). Dans ce cas, `steps.build.outputs.digest` peut être vide, produisant une ligne du type `ghcr.io/rhanka/<image>@` dans le résumé. Cela ne fait pas échouer le job, mais l'affichage est tronqué.
3. **Mise à jour des digests post-publication** :
   Comme spécifié dans le contexte, les pins `@sha256:...` actuels dans les lanceurs TS pointent vers les builds publics préalables. La republication en cours nécessitera la mise à jour de ces deux digests pour sceller les images contenant le retrait final des secrets.

---

### Limites de la revue statique

- **Visibilité effective du registre GHCR** : La revue statique valide la suppression des secrets dans les manifests, mais suppose strictement que les packages GHCR (`geo-api`, `normes-job`, `geo-acquisition`, `geo-capture`) ont bien leur visibilité configurée en **Public** dans l'UI GitHub Packages, sous peine d'`ImagePullBackOff` au déploiement.
- **Ressources K8s in-cluster** : Absence de validation dynamique sur le cluster (aucun test d'application effective des manifests ni de validation du webhook d'admission).
