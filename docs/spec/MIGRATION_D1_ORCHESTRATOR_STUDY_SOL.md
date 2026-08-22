# Étude D-moteur-1 — orchestrateur des 8 DAGs geo sur k8s

> Passe indépendante **gpt-5.6-sol**, 2026-08-22. Grounding :
> `SPEC_PIPELINES_MIGRATION.md` du checkout, `SPEC_PIPELINES_TARGET_ARCH.md` lu
> depuis le ref Git local `origin/main` (absent de l'arbre de travail, lequel est
> à `11/1015` commits de `origin/main`), et
> `acquisition/src/lib/pv-capture-backlog.ts`. Aucune capture geo ni lecture du
> cluster. Les capacités externes sont vérifiées dans les documentations
> officielles liées ci-dessous.

## Décision proposée

**[JUGEMENT] Recommander une lib publiable custom, nom de travail
`@sentropic/s3-dag`, et non Argo Workflows.** La nouvelle exigence change la
décision : Argo sert proprement l'état *technique* d'un Workflow, mais ne sert
pas directement la fraîcheur ville/lane ni l'historique métier attendu par immo.
Une façade geo et un read-model restent nécessaires. Dès lors, faire de S3 ce
read-model **et** la vérité durable, puis utiliser un réconciliateur k8s étroit,
est plus simple que maintenir CRD Argo + archive SQL + projection S3/geo.

## A. API de supervision consommable par immo

### Contrat réellement nécessaire

**[FAIT]** La cible possède déjà le bon chemin de service : `geo-api` est une
API Hono lisant S3, et `radar-immobilier-preprod` est autorisé à joindre son
Service ClusterIP. Le proto `pv-capture-backlog.ts` possède déjà manifeste
immuable, état CAS, phases, avancement, état terminal et quota observé.

**[JUGEMENT]** L'API publique ne doit exposer ni objets Kubernetes ni schéma
d'un moteur. Elle doit fournir au minimum :

- `GET /v1/refresh/overview?lane=&city=` : état courant, dernière réussite,
  fraîcheur `fresh|stale|unknown|refused`, run actif et échec bloquant ;
- `GET /v1/refresh/runs?lane=&city=&status=&cursor=` : historique paginé ;
- `GET /v1/refresh/runs/{run_id}` : DAG, nœuds/attempts, timestamps, erreurs,
  références d'artefacts et avancement `{done,total,percent}` ;
- `GET /v1/refresh/freshness?lane=&city=` : `observed_at`,
  `last_success_at`, cadence, âge et cause de staleness.

La fraîcheur doit venir du dernier artefact validé/promu, pas du dernier Job
vert. Un `skipped_unchanged` est terminal et sain ; `unknown` et `refused` sont
des états fermés, pas des absences. Les routes immo restent en lecture seule.

### Ce qu'Argo donne — et ce qu'il ne donne pas

**[FAIT]** Argo livre `argo-server` avec REST/gRPC et auth configurable. Son
[OpenAPI](https://github.com/argoproj/argo-workflows/blob/main/api/openapi-spec/swagger.json)
expose la liste/détail des Workflows et des ArchivedWorkflows. Le
[`WorkflowStatus`](https://github.com/argoproj/argo-workflows/blob/main/pkg/apis/workflow/v1alpha1/workflow_types.go)
contient `phase`, `startedAt`, `finishedAt`, `progress`, `message`, les statuts
de nœuds et outputs. Argo sait les artefacts
[S3-compatibles](https://argo-workflows.readthedocs.io/en/latest/configure-artifact-repository/),
les conditions, retries et sémaphores.

**[FAIT]** L'architecture Argo ajoute deux Deployments — controller et server,
le controller pouvant fonctionner seul. Pour une API et un historique long, le
server devient utile et le
[Workflow Archive](https://argo-workflows.readthedocs.io/en/latest/workflow-archive/)
requiert PostgreSQL/MySQL/MariaDB ; il n'archive pas les logs. Chaque tâche DAG
Argo génère normalement un Pod. Conserver les Jobs `batch/v1` autonomes exige
un [`resource template`](https://argo-workflows.readthedocs.io/en/latest/walk-through/kubernetes-resources/)
qui crée et surveille le Job.

**[JUGEMENT]** Trois intégrations sont possibles, aucune ne satisfait seule le
contrat immo : (1) geo-api proxy Argo — couplage auth/RBAC et schéma Argo ; (2)
geo-api lit les CRD — accès au control-plane et historique perdu après TTL ;
(3) un projecteur transforme Argo+S3 en index ville/lane — précisément le
read-model custom à construire. Argo n'est pas une usine à gaz en soi ;
**Argo + server + SQL d'archive + façade geo + index métier S3** le devient pour
huit DAGs fixes et un quota d'environ six pods.

Avec le custom, geo-api lit directement des snapshots/index S3 versionnés : une
seule sémantique, une seule rétention, aucune permission Kubernetes côté API, et
un contrat produit stable même si l'exécuteur change.

## B. Survol state-of-the-art

Légende : **[F]** fait documenté ; **[J]** adéquation jugée pour geo.

| Moteur | k8s, état, S3, TS | Quota, condition LLM, supervision et verdict geo |
|---|---|---|
| **Argo Workflows** | **[F]** CRD/controller k8s ; tâches en Pods, Jobs possibles via resource template ; artefacts S3 natifs ; moteur Go, workloads TS permis. | **[F]** `when`, retry, sémaphores, REST et UI solides ; archive longue en SQL. **[J]** meilleur moteur générique k8s, mais double état et deux pods de contrôle pour obtenir l'API ciblée. |
| **Temporal** | **[F]** SDK TS mature ; service auto-hébergé sur k8s via Helm, avec base Cassandra/MySQL/PostgreSQL et store de visibilité ; workers persistants, pas un Job k8s par nœud. | **[F]** gRPC/UI/search excellent pour historique durable. **[J]** surdimensionné : son event history remplace S3 comme vérité d'orchestration et impose un control-plane distribué. ([déploiement](https://docs.temporal.io/self-hosted-guide/deployment), [TS](https://docs.temporal.io/develop/typescript)) |
| **Dagster** | **[F]** Python 3.10+, daemon+webserver ; Helm et lancement de runs en Jobs k8s ; intégration S3, mais état de contrôle hors S3. | **[F]** assets/freshness et GraphQL riches, mais l'API GraphQL est annoncée évolutive et largement interne. **[J]** très bon data orchestrator, disqualifié par Python/stack et API non contractuelle pour immo. ([API](https://docs.dagster.io/api/graphql), [k8s](https://docs.dagster.io/deployment/oss/deployment-options/kubernetes/deploying-to-kubernetes)) |
| **Prefect** | **[F]** flows Python, server/API/base et workers ; worker Kubernetes lance un flow-run en Job ; S3 est une intégration, pas le store d'état. | **[F]** UI/REST, états, historique et limites ; PostgreSQL (et Redis en scale-out). **[J]** expérience agréable, mais ajoute Python+DB+workers et ne mappe pas naturellement un Job par nœud. ([self-host](https://docs.prefect.io/v3/advanced/self-hosted), [k8s](https://docs.prefect.io/integrations/prefect-kubernetes)) |
| **Windmill** | **[F]** scripts/flows TS possibles ; serveur, workers et tout l'état dans PostgreSQL ; Helm disponible. | **[F]** API/UI/flows/branches et worker groups. **[J]** plus proche côté TS, mais plateforme d'automatisation générale, workers permanents et état DB ; aucune supériorité sur le read-model immo. ([self-host](https://www.windmill.dev/docs/advanced/self_host)) |
| **Restate** | **[F]** SDK TS et durable workflows ; Operator/Helm, StatefulSets ; cluster répliqué avec metadata/snapshots S3, mais la doc réserve le metadata store à AWS S3 (pas MinIO/S3-compatible). | **[F]** Admin API et introspection SQL ; ce sont des services durables, non des Jobs k8s DAG. **[J]** technologie sérieuse, mais mauvais modèle d'exécution et risque avec l'endpoint OVH. ([k8s](https://docs.restate.dev/server/deploy/kubernetes), [workflows](https://docs.restate.dev/use-cases/workflows)) |
| **Inngest** | **[F]** SDK TS event/steps ; binaire unique en petit, PostgreSQL+Redis pour scaler, Helm ; état/historique en DB. | **[F]** concurrence, throttling, runs et observabilité ; exécute des fonctions/steps, pas des Jobs autonomes. **[J]** bon event orchestration applicatif, moins réversible et non S3-first. ([self-host](https://www.inngest.com/docs/self-hosting)) |
| **Hatchet** | **[F]** SDK TS, DAGs et durable tasks ; control-plane API + PostgreSQL, workers, Helm (RabbitMQ dans le compose production). | **[F]** REST/runs, rate limits et UI. **[J]** finaliste TS moderne, mais recrée une flotte de workers et une DB pour huit DAGs alors que les artefacts/receipts geo vivent déjà en S3. ([self-host](https://docs.hatchet.run/self-hosting), [DAGs](https://docs.hatchet.run/cookbooks/durable-tasks-vs-dags)) |

DBOS relève de la même famille « durable TS + PostgreSQL » ; il n'est pas retenu
dans les huit car son unité naturelle est la fonction transactionnelle, non le
Job k8s avec artefacts S3.

## C. Esquisse de `@sentropic/s3-dag`

**[JUGEMENT]** Ce doit être une lib étroite, Apache-2.0, SemVer, publiée avec
schémas JSON, OpenAPI, tests de conformité et adaptateurs séparés — pas un
« framework universel ». Contrat assumé : DAG acyclique connu au build, état
S3, exécution at-least-once par Jobs idempotents, pas de boucles, signaux
humains ni transactions distribuées.

```ts
const dag = defineDag({
  name: "geo-refresh-lane", version: "1.0.0",
  nodes: {
    detect: job({ image, command: ["detect-change"] }),
    extract: job({ needs: ["detect"], cacheKey: inputHash }),
    llm: job({
      needs: ["extract"], concurrencyKey: "llm", maxConcurrency: 1,
      when: receiptPredicate("extract.insufficiency", gte(0.20)),
    }),
    promote: job({ needs: ["extract", "llm?"], command: ["promote"] }),
  },
});
await createRun({ dag, scope: { lane, cities }, inputs });
await reconcileTick({ store, executor: kubernetesJobs(), quota: resourceQuota() });
const view = await supervision(store).getRun(runId);
```

**[FAIT]** Le pattern PV sépare déjà manifeste immuable et état CAS.
**[JUGEMENT]** La généralisation doit conserver cette propriété et rendre aussi
chaque révision d'état immutable :

```text
orchestration/v1/
  definitions/<dag>/<version>/<definition_sha>.json       # immuable
  runs/<yyyy>/<mm>/<run_id>/manifest.json                 # immuable : scope, inputs, images
  runs/<...>/<run_id>/nodes/<node>/<attempt>/receipt.json # immuable : outputs, coût, erreur
  runs/<...>/<run_id>/states/<state_sha>.json             # snapshot immuable agrégé
  runs/<...>/<run_id>/latest.json                         # petit pointeur CAS
  indexes/lanes/<lane>/snapshots/<sha>.json + latest.json
  indexes/cities/<slug>/<lane>/snapshots/<sha>.json + latest.json
```

Seuls les `latest.json` mutent par `If-Match`; manifeste, receipts, états et
index historiques sont immuables. Les pointeurs référencent hash, URI, révision
et timestamp. L'indexation est faite au tick, pas par `LIST` massif à chaque
requête API. Le repo possède déjà `putBytesIfMatch` et le pattern
snapshot-then-CAS dans `geo-served-contract.ts`.

Le réconciliateur est un CronJob court (lease k8s + CAS en défense), observe le
`ResourceQuota`, réserve la place de geo-api, et crée des Jobs aux noms
déterministes. Il écrit `planned` avant le POST ; après crash il réutilise le
même nom. Un nœud capture soumis puis disparu devient `blocked`, jamais relancé
aveuglément. Chaque Job écrit son receipt S3 ; le contrôleur matérialise aussi
l'échec k8s. `backoffLimit: 0` par défaut, retries explicitement sûrs seulement.
Le LLM reste un Job ordinaire, déclenché uniquement par un receipt déterministe,
avec cache `(input_sha,prompt_version,model_policy)` et budget observé.

**[JUGEMENT]** La lib bat les alternatives ici parce qu'elle ajoute zéro DB,
zéro worker permanent et zéro serveur de supervision : l'API Hono existante
monte l'adaptateur `supervision(store)`. Elle démontre un savoir-faire
réutilisable — state machine crash-safe, CAS, quotas, receipts, OpenAPI — tout en
laissant le métier geo dans geo et chaque nœud exécutable comme Job seul.

## D. Réversibilité, coût et risques

**Réversibilité. [JUGEMENT]** Le contrat S3 et les Jobs sont engine-neutral. Un
futur adaptateur peut compiler la définition vers Argo `resource` templates ;
geo-api continue de lire les mêmes receipts/index. Inversement, quitter Argo
nécessiterait d'importer CRD/archive et de reconstruire la sémantique ville. La
sortie du custom est donc moins coûteuse. Déclencheurs de réexamen : besoins de
boucles/signaux humains, multi-cluster actif, orchestration sub-seconde, ou
plus de 20 Jobs concurrents soutenus ; alors Hatchet/Temporal ou Argo redeviennent
pertinents.

**Coût. [JUGEMENT]** Ordres de grandeur, hors migration des huit lanes : Argo
canari 5–10 jours-ingénieur, puis 10–20 jours pour archive, sécurité, façade et
projection métier ; custom PV canari + cœur production 20–30 jours, puis 10–15
jours de hardening/documentation/publication. Le custom coûte davantage au
départ, mais retire l'exploitation continue d'un controller/server/DB et livre
exactement l'API décisive.

**Risques et gates.**

1. **[FAIT/JUGEMENT] CAS S3-compatible** : vérifier en canari OVH `If-None-Match`,
   `If-Match`, conflits 412 et read-after-write ; sinon refuser la prod.
2. **[JUGEMENT] bugs de scheduler** : validation acyclique, model checking des
   transitions et tests crash-injection avant/après chaque write/POST k8s.
3. **[JUGEMENT] index S3 divergent** : index reconstructible uniquement depuis
   manifestes/receipts, hashé, readback vérifié ; aucun vert par omission.
4. **[JUGEMENT] dérive vers Temporal maison** : budget de scope gelé ; toute
   demande de boucle, signal ou transaction force un nouveau dossier de décision.
5. **[JUGEMENT] sécurité** : RBAC namespace minimal (`get/list/create Jobs`,
   `get ResourceQuota`, Lease), images par digest, préfixes S3 séparés et API
   immo strictement read-only.

**Conclusion [JUGEMENT] :** ratifier **custom-lib-publiable**, avec PV comme
canari et un gate owner après démonstration de quatre preuves : reprise après
crash, respect réel du quota, read-model immo complet, et reconstruction totale
des index depuis les seuls objets immuables S3.
