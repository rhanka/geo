# Passe Sol indépendante — plan de migration des pipelines data

> Périmètre lu le 2026-08-22. Les faits de plateforme sont vérifiés sur `origin/main@fb0f7b62` (le checkout courant est en retard sur `origin/main`); les faits de pipeline incluent le worktree demandé. Option B et les quatre décisions cibles sont ratifiées : cette passe les rend exécutables, elle ne les remet pas en discussion.

## A. Architecture cible : huit DAGs, un seul plan d'exécution

### Point de départ et invariants

- **[FAIT]** Les noyaux réutilisables existent : capture typée/CAS dans `packages/qc-sources/src/capture/{manifest,worklist,capturedFetch}.ts`, extraction de grilles dans `packages/qc-sources/src/sources/grille-*`, jointure déterministe dans `packages/geo/src/zonage/lotZoneJoin.ts`, et serving S3/OGC dans `packages/geo/src/api/providers/store-provider.ts`. Ils ne constituent pas encore un chemin obligatoire de bout en bout. Les `acquisition/src/_*.ts` restent des sondes; `fold-reglement-to-zonage.ts`, `fold-usage-dominant.ts`, `fold-effet-densifiant.ts`, `lot-zone-join-run.ts` et `lots-enriched-run.ts` sont encore des orchestrateurs CLI.
- **[FAIT]** Sur `origin/main`, aucun moteur DAG n'est déclaré. Le CronJob PV présent dans le worktree (`deploy/k8s/geo-pv-refresh-cronjob.yaml`) et son runner sont non suivis : ils ne sont donc pas capitalisés. `pv-index-run.ts` indexe les références mais dit explicitement ne pas télécharger les PV.
- **[JUGEMENT]** Retenir **Argo Workflows** : `WorkflowTemplate` versionnés pour les tâches, `CronWorkflow` pour les détecteurs de fraîcheur, fan-out par ville/source, `when` pour les branches OCR/LLM, retries/timeouts/quotas natifs et artefacts S3. Airflow/Dagster ajouteraient un control plane applicatif et une base; Temporal serait excellent pour des transactions longues, mais moins naturel pour des pods batch, des artefacts S3 et des ressources GPU/OCR. GitHub Actions construit et déclenche; **Argo décide et exécute le graphe data**.

Le `WorkflowTemplate geo-refresh-lane-v1`, possédé par **geo-socle/wp7**, compose ce tronc commun :

```text
detect-change -> plan-worklist -> capture-to-S3-CAS -> classify
  -> native/structured -> [OCR si score insuffisant] -> [LLM si résidu admissible]
  -> validate/close-partition -> materialize immutable release -> readback gates
  -> invalidate downstream joins -> promote current pointer
```

**[JUGEMENT]** Chaque nœud reçoit un manifeste immuable et produit un receipt S3 avec `run_id`, lane, slugs, hashes d'entrée/sortie, SHA Git, digest d'image, version de template/config, ressources, état terminal et coût. D2 s'applique immédiatement : captures sous `raw/<source>/cas/<sha256>`, tentatives sous `capture/_runs/<run-id>`, résultats sous `runs/<lane>/<run-id>`, releases sous `releases/<release-id>`; seul `current.json` est mutable et sa promotion est conditionnelle. Le futur `StoreProvider` résout ce pointeur (puis invalide/recharge son index); aucune migration n'écrit en place dans la release servie.

**[JUGEMENT]** La variation municipale devient une liste de **sources**, pas du code : `{slug, adapter_id, urls[], cadence, licence, selectors/field_map, strict_path, legal_context}`. Un même slug peut avoir plusieurs sources, fan-outées puis dédupliquées par URL canonique et SHA. Les adaptateurs sont mutualisés par famille : ArcGIS/FeatureServer, WFS/CKAN, HTML/PDF statique et sitemap/WordPress, navigateur Chromium pour mur JS, Obscura/GOnet, XML MAMH. Aucun hook TypeScript ni expression dans la config; un nouveau comportement répété devient un adaptateur testé dans `packages/`.

### Les huit DAGs

| DAG | **[JUGEMENT]** Enchaînement propre à la lane; dépendances publiées |
|---|---|
| **zones** | inventaire → ArcGIS/WFS/GeoJSON ou plan PDF → normalisation/GDAL → géoréférencement → preuve v2 → `qc-zonage-<slug>`. La lecture vision des glyphes n'est admissible qu'après échec texte/vectoriel/cadastre. Publie un changement de hash vers lot-zone, normes et effet. |
| **normes/grilles** | document de règlement capturé une fois → classifieur PDF → table native → OCR conditionnel (`grille-ocr-extractor`) → locate/parse zone-header → éventuel résidu LLM → validation contre les codes de zones → registre versionné. Supprime le défaut « deux moteurs partout ». |
| **PV** | index multi-source → capture des documents → `pdftotext` → OCR seulement pour scan → `proces-verbaux-parser`/graphification déterministe → événements cités. Un événement de changement de zonage déclenche les DAGs règlement, grilles et, si la géométrie est visée, zones. |
| **règlement** | découverte/capture HTML-PDF → numéro, millésime, statut adopté et citations → registre → `fold-reglement-to-zonage`. Regex/structure/OCR d'abord; LLM seulement pour une ambiguïté bornée, jamais pour décider qu'un projet est adopté. |
| **usage dominant** | réutilise grille/légende capturée → texte/OCR → `prefix_map`/`attribute_map` validé → `fold-usage-dominant`. Le LLM peut proposer un mapping pour un vocabulaire inédit; le mapping revu devient ensuite de la config déterministe. |
| **effet densifiant** | événement PV + deux versions règlement/grille → extraction commune des normes avant/après → diff numérique → gate juridique → `fold-effet-densifiant`. Aucun LLM ne choisit le signe; il n'intervient que dans une cellule amont illisible. |
| **cadastre/rôle** | branches séparées : crawl/normalisation cadastre structurée; capture XML rôle en zone restreinte → parser allowlist → produit minimisé. Aucun LLM. Les raw du rôle ne sont ni servis ni copiés en preprod. |
| **immo-lots** | hashes cadastre + zones + normes + rôle minimisé + FSA/TOD → `lotZoneJoin`/`enrichWithNorms` → audits fermés → `qc-lots-<slug>`. Aucun LLM; recalcul uniquement pour les slugs invalidés. |

**[JUGEMENT]** Le LLM n'est donc jamais scheduler, conductor ou auteur de worklist. Un nœud déterministe émet `needs_llm=true` avec motif, budget et clés CAS; Argo autorise alors le nœud mesh. La réponse est cachée par `(input_sha, prompt_version, model_policy)`, citée et revalidée; un échec ferme en `unknown`, sans seconde passe destinée à fabriquer un vert. **[FAIT]** `mistral-medium-latest`/vision-chat reste banni par ADR-0024; seul `mistral-ocr-latest` est le backend OCR sanctionné.

## B. Pattern sentropic : **cluster-mesh**, pas sentropic-sentech

**[FAIT]** Aucun déploiement `llm-mesh`/sentropic n'est capitalisé dans geo aujourd'hui; les agents de `fleet.json` et certains runners Claude sont locaux. **[JUGEMENT]** Intégrer le **cluster-mesh sentropic partagé**, géré par la plateforme et consommé via un `ClusterIP`; ne pas embarquer/forker le mesh dans geo. Les comptes Codex, Claude et Gemini sont enrôlés par `llm-mesh enroll` dans des Secrets/identités séparés, avec quotas, circuit breakers et audit par compte. Les pods Argo ne reçoivent jamais les credentials fournisseurs : seulement une identité de workload et une policy (`vision-residue`, modèles autorisés, budget).

**[JUGEMENT]** Ce choix maximise sentropic tout en gardant le DAG souverain. Le service **sentropic-sentech** introduirait une frontière distante et un moteur de service plus haut niveau alors que le besoin est un appel borné, auditable et conditionnel depuis k8s. Il ne devient pas le moteur primaire; il pourra ultérieurement être un backend derrière le mesh si son SLO, sa résidence et son contrat de replay sont prouvés, sans changer les DAGs.

## C. Strangulation old → new

**[JUGEMENT] P0 habilitant, court.** Installer Argo/artefact repository, templates versionnés, RBAC/IAM par environnement, release pointer et lease de promotion; construire les images par digest. Promouvoir les fonctions réutilisées des runners vers `packages/`. L'ancien et le nouveau chemin écrivent dans deux releases de shadow distinctes : un seul détenteur de lease peut modifier `current.json`.

**[JUGEMENT] P1 — fraîcheur à impact, priorité ratifiée.** Étrangler d'abord l'entrée PV : remplacer le scheduler local/non capitalisé par un `CronWorkflow`, puis étendre `pv-index-run.ts` à capture document + texte/OCR + événements. Pour chaque ville signalée « changement de zone », fan-out immédiat vers (1) règlement en vigueur et provenance, (2) grille/normes, (3) zones seulement si le périmètre/géométrie change, puis folds et jointures ciblés. Ordre de cutover : PV index → PV documents/événements → règlement → grilles → invalidations aval. Chaque étape fait shadow, comparaison de receipts/partitions, bascule, suspension de l'ancien schedule et reprise des unités non terminales; jamais deux writers servis.

**[JUGEMENT] P2 — étude des patterns puis consolidation totale.** Exploiter les receipts P1 pour mesurer taux de recours par `adapter_id`, exceptions, coût et échecs. Consolider d'abord les familles couvrant le plus de sources (HTTP/sitemap/WordPress, ArcGIS/WFS, navigateur JS), puis migrer zones, usage, effet, cadastre/rôle et immo-lots. Une famille reste spécifique mais mutualisée; une ville ne gagne jamais son pipeline. Sortie de P2 : zéro refresh prod via `geo-fleet`, tmux, Serverless hors cluster ou `_*.ts`; 100 % des partitions ont un état terminal et un script de mesure committé.

## D. Six arbitrages

| Arbitrage | Recommandation Sol |
|---|---|
| **1. Reco4, mécanisme tag** | **[JUGEMENT]** Tag SemVer annoté et signé `vX.Y.Z`, protégé, pointant un SHA de `main` ayant un `PREPROD_ACCEPTANCE` immuable. Le workflow `release-prod` résout les digests acceptés et soumet un DAG Argo de release; **aucun rebuild**. `workflow_dispatch` ne promeut jamais prod. |
| **2. Loi 25 / rôle** | **[FAIT]** Le rôle gelé est `role:lot`; `role:archi` possède conformité/licence. `role-evaluation-parser.ts` exclut déjà le propriétaire, tandis que `lots-enriched-run.ts` joint encore l'adresse via un parseur legacy. **[JUGEMENT]** `role:lot` possède capture, minimisation et `PII_REFUSED`; QA vérifie. Raw chiffré/restrictif, aucune copie preprod, aucun LLM, allowlist de sortie publique. `archi` fixe/valide le contrat mais ne porte aucun code. |
| **3. Seuil pruning preprod** | **[FAIT]** `DEFAULT_MAX_DELETE_FRACTION` vaut 25 %; le test encode un prune observé de 762/4647 ≈16 %. **[JUGEMENT]** Bootstrap unique : dry-run + approbation owner, plafond 20 %. Régime permanent : auto seulement si suppressions canoniques ≤2 %, ≤100 objets et ≤5 % des octets; sinon abort. Jamais de prune de `raw/`, CAS, receipts ou backups. |
| **4. Seuil tag prod** | **[JUGEMENT]** Tolérance **zéro perte implicite** : zéro collection retirée, zéro régression d'état fermé et zéro work item sans receipt. Toute suppression doit être un tombstone déclaré et approuvé owner. Une baisse >1 % des features d'une collection ou >1 % des octets d'une lane est une anomalie bloquante à expliquer, pas une tolérance de perte. |
| **5. ADR-0027/0028** | **[FAIT]** Les deux existent et sont ratifiées sur `origin/main`. **[JUGEMENT]** Amender 0027 avec releases immuables/pointeur, exclusion PII rôle et seuils prune; amender 0028 avec Argo comme data plane, exécution du reset+upgrade à chaque merge (skip interne par hash, pas path-filter silencieux), tag same-digest, backup/restore et migration atomique des schedules. Ne pas renuméroter. |
| **6. Quatre conductors manquants** | **[JUGEMENT]** Normes → `reglements`/`role:reglement`; usage dominant → `reglements`/`role:reglement`; effet densifiant → `reglements`/`role:reglement`; cadastre/rôle → `geo-lot`/`role:lot`. Les noms de sessions `geo-nm`, `geo-usage-dom`, `geo-4a` restent des lanes techniques, pas des autorités. `geo-cond` arbitre le portefeuille; Argo conduit les runs. |

## E. Lifecycle code / preprod / prod

**[FAIT]** `cd-preprod.yml` construit par digest et applique Kustomize, mais il est path-filtré et ne lance ni `geo-preprod-sync` ni verify complet; C4 prod reste à faire. Le sync existant fait copy-first, prune canonique, `coherence_id/served_count/set_hash`; `StoreProvider` cache l'index jusqu'à invalidation/redémarrage.

**[JUGEMENT] Merge `main` → preprod.** CI teste, construit toutes les images touchées avec SBOM/provenance, publie les digests et soumet `preprod-reset-upgrade`. Le DAG : verrouille un `coherence_id`; inventorie prod; copie le miroir plein dans une release preprod neuve; applique l'assainissement rôle; exécute le dry-run prune et ses seuils; déploie templates/jobs et schémas candidats; rejoue les DAGs concernés sur cette release; démarre/rafraîchit geo-api sur le pointeur candidat; vérifie via `ClusterIP` count+set-hash, partitions, provenance et tests cross-repo; puis seulement échange `preprod/current.json` et émet `PREPROD_ACCEPTANCE`. Un merge sans changement effectif est un run idempotent avec receipt `skipped-by-hash`, jamais un vert par omission.

**[JUGEMENT] Tag → prod.** La release vérifie tag/signature/SHA/acceptance et reprend exactement les digests preprod. Avant mutation : inventaire signé, version S3, sauvegarde des pointeurs et schedules, restore drill, puis lease globale. Les vraies captures sont rejouées en prod dans une nouvelle release; aucune donnée calculée preprod n'est copiée. Les gates appliquent le seuil zéro perte, puis la transaction promeut d'abord les données compatibles, déploie le serving, et bascule les schedules. Rollback = repointer l'ancienne release **et** réactiver la version précédente des `CronWorkflow`.

**[JUGEMENT]** Pour zéro perte de jobs, chaque unité porte une clé d'idempotence; l'état durable est la worklist/receipt S3, pas le Pod. Au cutover : suspendre l'ancien CronJob, attendre/réconcilier ses Jobs, réinjecter seulement les unités sans terminal receipt, installer le nouveau template suspendu, puis transférer la lease de scheduler. Images et templates N/N-1 restent disponibles pendant la fenêtre de rollback.

## F. Risques majeurs et pré-mortem

Les scénarios ci-dessous sont des **[JUGEMENTS]** de pré-mortem, non des incidents observés.

1. **Argo devient un emballage de 1 106 scripts.** Signal : slugs dans le code, hooks JSON, hausse des `_*.ts`. Mitigation : schéma fermé, registre d'adaptateurs, gate CI `city_slug_in_runtime_code`, exception expirante.
2. **Le dual-run perpétue le split-brain.** Signal : deux producteurs modifient `current`, résultats sans digest/receipt. Mitigation : releases shadow, lease unique, date de retrait et cutover obligatoire par lane.
3. **Une source municipale cassée déclenche une régression en masse.** Signal : chute de taille/feature count, 404 simultanés, changement d'owner. Mitigation : capture durable des échecs, quarantaine, seuils de delta, conservation de la dernière release prouvée; jamais promouvoir un vide.
4. **Le mesh épuise les comptes ou réintroduit l'agent comme opérateur.** Signal : taux LLM/coût croissant, prompts sans version, création de worklists par modèle. Mitigation : budget par lane, cache CAS, circuit breaker; panne mesh → `unknown`, le DAG déterministe continue.
5. **Prune ou migration de rôle divulgue/détruit.** Signal : cible S3 racine, diff > seuil, champ non allowlisté dans `qc-lots`. Mitigation : bucket/credentials séparés, raw rôle exclu du miroir, scan PII, restore drill et refus `PII_REFUSED` porté par `role:lot`.
6. **Tag partiellement réussi : nouvelles données, anciens jobs.** Signal : pointeur et schedule versions différents, pods avec tags mutables, worklists pendantes. Mitigation : release manifest unique code+données+jobs, lease, transaction de cutover, receipts et rollback conjoint.

Le succès à 30 jours se mesure sans interprétation : aucun refresh prod local, 100 % des runs avec receipt terminal, P1 PV→règlement/grille opérationnel sur les villes à changement, zéro perte implicite au tag, et restauration data+jobs démontrée.
