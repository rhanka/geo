# Analyse Sol — dossier pipelines de données geo

> Track : `01M0GWZW2753PV92WJ2PGX5GS2`
>
> Commission : `docs/spec/COMMISSION_PIPELINES_DOSSIER.md` @ `08381c8c`
>
> Analyse arrêtée le : 2026-08-20 (America/Toronto)
> Statut : **entrée Sol complète pour la double revue**. Ce document n'est pas la synthèse owner finale : la commission prévoit encore la revue indépendante `claude-fable-5`, la réconciliation par `geo-archi`, puis la présentation par `geo-cond`.

## 1. Conclusion exécutive

### FACTS

1. La couverture est réelle mais ne signifie pas que les chaînes sont « au carré ». Le rapport frais donne PV `1062/1106`, zones `868/1106`, règlement `815/1106`, usage dominant `710/1106`, normes `502/1106`, effet densifiant `5/1106`, lot-zone `342/1100`, normes pliées `52/1100`, adresse civique `22/1100`. La preuve zones v2 exacte est `48/1106`, et non zéro. Source : `node scripts/portfolio-city-report.mjs --stdout`, exécuté frais le 2026-08-20.
2. Ce rapport est une **recomposition fraîche d'artefacts locaux**, pas une lecture S3 live : ses propres sources sont principalement datées de juin-juillet 2026. Il est donc la meilleure mesure reproductible présente dans le dépôt, mais pas une garantie de fraîcheur opérationnelle. Source : section « Sources locales, as-of et empreintes » du même rapport.
3. Il existe déjà trois bons noyaux transverses : capture typée et content-addressed (`packages/qc-sources/src/capture/manifest.ts:25-54`, `worklist.ts:1-145`, `capturedFetch.ts:203-496`), jointure lot-zone/normes déterministe (`packages/geo/src/zonage/lotZoneJoin.ts:78-225,227-343`) et serving S3/OGC sur Kubernetes (`packages/geo/src/api/providers/store-provider.ts:1-24,61-105`; `deploy/k8s/geo-api-deployment.yaml:34-53`). Ils ne sont pas encore le chemin obligatoire des huit pipelines.
4. Le refresh réellement automatisé sur Kubernetes est surtout le **refresh d'index PV**, quotidien (`deploy/k8s/geo-pv-refresh-cronjob.yaml:1-51`). Le runner précise qu'il ne télécharge pas les PV eux-mêmes (`acquisition/src/pv-index-run.ts:1-32`). Le CronJob backlog cité dans la commission est une campagne terminée et suspendue (`deploy/k8s/pv-probable-backlog-cronjob.yaml:63-84`). `deploy/normes-job` est un Scaleway Serverless Job, pas Kubernetes (`deploy/normes-job/README.md:1-31,74-110`). `deploy/acquisition-job` crée des pods Kubernetes, mais son orchestrateur est lancé localement (`deploy/acquisition-job/README.md:1-7,29-40`).
5. La majorité du rattrapage reste pilotée par une flotte locale d'agents/tmux : lancement de workers locaux (`acquisition/src/geo-fleet.ts:106-145`), backfill local (`:232-245`), boucle permanente locale (`:329-349`) et synchronisation Track avec `--apply` (`:314-318`). Cette flotte utilise Claude/Codex pour règlement, usage, normes et recalage (`acquisition/config/fleet.json:7-24`).
6. Le dépôt ne contient pas l'automatisation owner demandée pour preprod/prod. Un merge sur `main` lance seulement CI (`.github/workflows/ci.yml:3-40`); un tag construit/pousse des images (`.github/workflows/docker-publish.yml:3-13,95-108`), sans reset preprod, upgrade, backup prod, exécution des pipelines ni promotion atomique. Track maintient l'item preprod `01M041WM9ZVYC1NJVDY2QB769D` à faire, tandis que la commission affirme qu'une première instance est déployée et synchronisée.

### JUDGMENT

La bonne cible n'est ni une réécriture big-bang ni la continuation de scripts par ville. C'est une **migration incrémentale par strangulation** : un contrat commun de refresh devient le seul chemin de production; chaque famille de source apporte des données/configurations; capture, extraction et jointure produisent des artefacts versionnés; Kubernetes exécute les lots; preprod et prod ne changent de version servie qu'après gates.

Le paquet recommandé comporte quatre décisions liées :

1. adopter un moteur commun de refresh par manifestes;
2. faire de Kubernetes l'unique lieu d'exécution des refreshs de production;
3. imposer une cascade LLM-minimal — natif, texte, OCR, puis modèle multimodal seulement sur résidu mesuré;
4. automatiser le cycle merge/tag avec miroir exact prod→preprod, pruning contrôlé, backup/restauration prod et promotion atomique.

Confiance : **0,78 (modérée-haute)** sur l'architecture cible; plus faible sur l'état cross-repo de preprod et sur quatre mappings de conductors restés inconnus.

## 2. Méthode, vocabulaire et limites

### Commandes de grounding exécutées

- `node scripts/portfolio-city-report.mjs --stdout`, frais le 2026-08-20. `--stdout` a été utilisé pour respecter l'interdiction de modifier tout autre fichier; le script indique lui-même « généré localement, sans réseau, S3, déploiement, Track ni commit ».
- `track report --period all --format md`. Résultat global : `6160/8739 (70%)`; WP1 `4/4`, WP2 `916/1130`, WP3 `2350/2959`, WP4 `1065/1106`, WP5 `1822/3518`. L'item du dossier est `in-progress` et l'item preprod est `to-do`.
- Lecture du code réel sous `acquisition/src/`, `packages/`, `deploy/` et `.github/workflows/`.
- Consultation de `geo-cond` par h2a pour les quatre mappings non confirmés. Aucun retour n'était disponible au gel de l'analyse; ils restent donc `unknown`.

### Définition de « au carré »

Un verdict `oui` exige simultanément : logique capitalisée/rejouable depuis un checkout propre, entrée capturée durablement sur stockage objet, exécution de production versionnée, résultat prouvé avec états fermés (y compris refus/unknown). `partiel` signifie que des briques existent mais qu'au moins un de ces invariants ou une part matérielle de la couverture manque. `non` signifie qu'un chemin observé repose encore sur du local, du bespoke ou un artefact non capturé. `unknown` est utilisé quand la preuve n'existe pas dans les sources consultées.

### Sémantique JSON

- `specificite`: `data` = variation portée par les données; `config` = paramètres déclaratifs, même si certains sont encore encodés dans TypeScript; `bespoke` = logique/script ou artefact façonné par ville; `unknown` = non établi.
- `refresh`: mode **observé pour cette couche**, pas le runtime du service. `absent` signifie qu'aucun refresh de cette couche n'est câblé; `unknown` est une extension nécessaire à la règle « manquant → unknown » de la commission.
- Le champ JSON littéral `requis|remplacable` contient un JUDGMENT. `absent` y signifie qu'aucun LLM runtime n'a été trouvé; l'OCR Mistral est signalé séparément comme modèle Document-AI, pas assimilé à un LLM conversationnel.
- Les couvertures ne sont pas propagées artificiellement : `PV 1062` prouve l'index, pas l'extraction du contenu; `zones 868` ne prouve pas les jointures lots; `lots servis 874` ne prouve pas l'adresse ni les normes pliées.

## 3. FACTS — matrice 8 × 6

Le bloc suivant est du JSON valide. Les valeurs de `requis|remplacable` et les segments explicitement marqués `[JUDGMENT]` sont les seuls jugements inclus dans la matrice; les verdicts et localisations sont factuels selon la définition ci-dessus.

```json
{
  "zones": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 868/1106 zones complètes mais 48/1106 seulement avec preuve capture+CAS v2; packages/qc-sources/src/capture/manifest.ts:25-54; acquisition/src/zones-wfs-run.ts:225-297"},
      "llm": {"ou": "absent dans capturedFetch/WFS/ArcGIS", "requis|remplacable": "absent", "comment": "[FACT] capture HTTP déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/zones-wfs-run.ts:153-206 et zones-arcgis-replace.ts:88-116,198-296 capitalisent des familles de sources, mais le dépôt contient encore de nombreux runners par source/ville et la preuve v2 ne couvre que 48/1106 [RPT]"},
      "llm": {"ou": "absent des normaliseurs WFS/ArcGIS", "requis|remplacable": "absent", "comment": "[FACT] validation de champs et codes déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 868/1106; acquisition/src/zones-wfs-run.ts:199-297; acquisition/src/t2-autogcp.ts:234-307 montre encore PDF local et labels vision optionnels"},
      "llm": {"ou": "labels de géoréférencement t1/t2: acquisition/src/t2-autogcp.ts:234-307 et lib/t1-labels-claude", "requis|remplacable": "remplacable", "comment": "[FACT] les chemins SIG/WFS/ArcGIS sont déterministes; la vision intervient sur les glyphes de plans PDF. [JUDGMENT] texte/vector/cadastre d'abord, modèle seulement sur résidu glyphique validé."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] cohérence lot-zone 713/1106; packages/geo/src/zonage/lotZoneJoin.ts:227-343 moteur commun; acquisition/src/lot-zone-join-run.ts:573-625 dépôt S3"},
      "llm": {"ou": "absent de lotZoneJoin", "requis|remplacable": "absent", "comment": "[FACT] intersection, majorité surfacique et fallback centroïde déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 868 jointures de provenance mais 538/871 collections seulement avec URL source http; packages/geo/src/api/providers/store-provider.ts:1-24,86-105; deploy/k8s/geo-api-deployment.yaml:34-53"},
      "llm": {"ou": "absent du serving OGC", "requis|remplacable": "absent", "comment": "[FACT] lecture S3 et streaming déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "absent"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "aucun CronJob zones armé trouvé; acquisition/src/geo-fleet.ts:329-349 maintient une boucle locale et acquisition/config/fleet.json:15 affecte un agent de recalage"},
      "llm": {"ou": "agent Claude/Codex de recalage dans la flotte locale", "requis|remplacable": "remplacable", "comment": "[FACT] l'agent est un opérateur local, pas un moteur de prod versionné. [JUDGMENT] réserver la vision au résidu des plans; refresh de source et gates sans LLM."},
      "specificite": "bespoke",
      "refresh": "local"
    }
  },
  "normes": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "packages/qc-sources/src/capture/manifest.ts:26-35 accepte la lane normes; deploy/acquisition-job/README.md:9-20 exécute discovery/extraction en Jobs mais deploy/normes-job/README.md:22-34 requiert encore un staging local recommandé"},
      "llm": {"ou": "absent de la capture; le routage ultérieur choisit native/vision/multizone", "requis|remplacable": "absent", "comment": "[FACT] le fetch ne requiert pas de LLM; [JUDGMENT] classification format par signatures déterministes."},
      "specificite": "bespoke",
      "refresh": "onk8s-job"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "packages/qc-sources/src/sources/grille-ocr-extractor.ts:1-50 contient un backend OCR commun et des parsers gardés; [RPT] seulement 502/1106 complètes"},
      "llm": {"ou": "OCR Mistral Document-AI, pas LLM conversationnel", "requis|remplacable": "absent", "comment": "[FACT] OCR requis pour scans/texte pauvre, parser natif possible pour PDF textuels. [JUDGMENT] OCR conditionnel, jamais par défaut universel."},
      "specificite": "bespoke",
      "refresh": "onk8s-job"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 502/1106; acquisition/src/zonage-norms-2engine-keepbest.ts:6-31,364-384 lance par défaut OCR+Claude local; packages/qc-sources/src/sources/vision-engine-policy.ts:21-54 interdit Mistral vision-chat"},
      "llm": {"ou": "Claude CLI dans zonage-norms-2engine-keepbest; vision-chat Mistral historiquement dans grille-vision, désormais interdite; OCR Mistral séparé", "requis|remplacable": "remplacable", "comment": "[FACT] le mode par défaut 'both' paie deux moteurs; OCR gagne les égalités. [JUDGMENT] aucun LLM n'est prouvé strictement nécessaire hors résidu visuel mesuré; garder un modèle fort seulement derrière un gate d'incertitude."},
      "specificite": "bespoke",
      "refresh": "onk8s-job"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "packages/geo/src/zonage/lotZoneJoin.ts:152-225 fournit exact+bridge numérique doublement unique; [RPT] normes pliées 52/1100 et 1041867/3389752 lots"},
      "llm": {"ou": "absent de enrichWithNorms", "requis|remplacable": "absent", "comment": "[FACT] canonicalisation et garde d'unicité déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 502/1106 normes; acquisition/src/fold-reglement-to-zonage.ts:71-79 lit le registre normes S3 et lots-enriched-run.ts:1-24 sert les normes pliées via qc-lots"},
      "llm": {"ou": "absent du serving", "requis|remplacable": "absent", "comment": "[FACT] serving/fold déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "deploy/normes-job/README.md:1-31 est Serverless et recommande staging local; deploy/acquisition-job/README.md:29-40 lance l'orchestrateur local; aucun CronJob Kubernetes normes armé trouvé"},
      "llm": {"ou": "Mistral/Claude dans l'extraction, agent Claude de flotte acquisition/config/fleet.json:14", "requis|remplacable": "remplacable", "comment": "[FACT] coût et reprise existent mais pas une cascade LLM-minimal. [JUDGMENT] refresh déterministe et OCR conditionnel; modèle fort sur queue d'exception."},
      "specificite": "bespoke",
      "refresh": "onk8s-job"
    }
  },
  "PV": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] index PV 1062/1106; deploy/k8s/geo-pv-refresh-cronjob.yaml:1-51 actif; acquisition/src/pv-index-run.ts:9-13 dit que les documents ne sont pas téléchargés; backlog de capture suspendu deploy/k8s/pv-probable-backlog-cronjob.yaml:76-84"},
      "llm": {"ou": "absent de l'index/capture", "requis|remplacable": "absent", "comment": "[FACT] parse HTML, robots, hash et CAS sont déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "onk8s-cron"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "packages/qc-sources/src/sources/proces-verbaux-generic.ts:73-145 fournit un adaptateur commun; le registre de villes reste un fichier TS de plus de 4500 lignes, :4520-4529"},
      "llm": {"ou": "absent du parse d'index et de proces-verbaux-parser", "requis|remplacable": "absent", "comment": "[FACT] parsing dates/liens/texte par code; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "onk8s-cron"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "packages/qc-sources/src/sources/proces-verbaux-parser.ts:987-1119 détecte les changements par règles; acquisition/src/pv-graphify-semantic-run.ts:1-8 offre pdftotext déterministe; acquisition/src/lib/pv-ocr-artifact.ts:1-35 rend l'OCR durable, mais les graphify runners restent locaux"},
      "llm": {"ou": "OCR Mistral pour PDF scannés; aucun LLM nécessaire au parseur sémantique déterministe", "requis|remplacable": "absent", "comment": "[FACT] l'OCR est un modèle Document-AI et un artefact S3; [JUDGMENT] OCR seulement si pdftotext est insuffisant, LLM conversationnel non requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "unknown", "source": "aucun moteur commun prouvé de jointure événement PV -> règlement/version -> zones n'a été trouvé dans les fichiers audités; le parseur extrait des numéros/codes mais la couverture PV ne mesure pas cette jointure"},
      "llm": {"ou": "unknown", "requis|remplacable": "remplacable", "comment": "[FACT] preuve manquante. [JUDGMENT] une jointure sur identifiants/citations doit être déterministe; le modèle peut proposer un candidat, jamais promouvoir."},
      "specificite": "unknown",
      "refresh": "absent"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/pv-index-run.ts:26-32 sert des manifestes registry/qc-pv sur S3; le StoreProvider OGC ne sert que les GeoJSON normalized (packages/geo/src/api/providers/store-provider.ts:10-24)"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] manifeste d'index déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "onk8s-cron"
    },
    "refresh": {
      "au_carre": {"verdict": "partiel", "source": "deploy/k8s/geo-pv-refresh-cronjob.yaml:11-51 est actif; acquisition/src/pv-refresh-cron.ts:137-177 borne les lots; acquisition/src/pv-index-run.ts:9-13 limite le refresh à l'index"},
      "llm": {"ou": "absent du refresh d'index", "requis|remplacable": "absent", "comment": "[FACT] le CronJob planifie/revalide jusqu'à 10 villes par lot. [JUDGMENT] étendre capture document + extraction conditionnelle sans LLM par défaut."},
      "specificite": "config",
      "refresh": "onk8s-cron"
    }
  },
  "reglement": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "la lane existe dans packages/qc-sources/src/capture/manifest.ts:26-35, mais acquisition/config/fleet.json:10 décrit encore lecture PDF -> registre curé par agents locaux; aucun workload k8s règlement trouvé"},
      "llm": {"ou": "agent Claude/Codex de flotte, hors runtime stable", "requis|remplacable": "remplacable", "comment": "[FACT] le fetch lui-même n'a pas besoin de LLM. [JUDGMENT] capture URL/CAS par moteur commun."},
      "specificite": "config",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-reglement-to-zonage.ts:32-62 définit registre, veto explicite et quatre champs; [RPT] 815/1106 complètes"},
      "llm": {"ou": "absent du normaliseur/fold", "requis|remplacable": "absent", "comment": "[FACT] schéma et veto déterministes; [JUDGMENT] aucun LLM runtime requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 815/1106; acquisition/config/fleet.json:10 indique une lecture PDF par agent vers un registre curé; aucune extraction commune déployée règlement n'est prouvée"},
      "llm": {"ou": "Claude/Codex via geo-fleet pour lire les PDF", "requis|remplacable": "remplacable", "comment": "[FACT] usage actuel d'agent local. [JUDGMENT] numéro/millésime/citation par texte+regex+OCR; modèle fort uniquement sur résidu ambigu, avec revue."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-reglement-to-zonage.ts:82-96 traite les deux layouts et :119-157 plie avec veto et putServedZoneAdditive; couverture 815/1106 [RPT]"},
      "llm": {"ou": "absent du fold", "requis|remplacable": "absent", "comment": "[FACT] copie contrôlée et idempotente; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-reglement-to-zonage.ts:3-22 sert les champs sur qc-zonage; API S3/Kubernetes deploy/k8s/geo-api-deployment.yaml:34-53; [RPT] 815/1106"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] serving déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "acquisition/config/fleet.json:10 et acquisition/src/geo-fleet.ts:106-145,329-349 montrent le refresh par agents/tmux locaux; aucun CronJob règlement trouvé"},
      "llm": {"ou": "agents Claude/Codex locaux", "requis|remplacable": "remplacable", "comment": "[FACT] le LLM est aujourd'hui l'opérateur principal du rattrapage. [JUDGMENT] en faire un fallback de classification, pas le moteur de refresh."},
      "specificite": "bespoke",
      "refresh": "local"
    }
  },
  "usage_dominant": {
    "capture": {
      "au_carre": {"verdict": "non", "source": "la lane est déclarée packages/qc-sources/src/capture/manifest.ts:26-35, mais les sources de légende deviennent des configs par slug dans acquisition/src/fold-usage-dominant.ts:9-25,41-63 sans chaîne de capture k8s prouvée"},
      "llm": {"ou": "agent de flotte pour lire les légendes acquisition/config/fleet.json:11", "requis|remplacable": "remplacable", "comment": "[FACT] capture durable du document source non établie. [JUDGMENT] LLM inutile au fetch; conserver la citation capturée."},
      "specificite": "config",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-usage-dominant.ts:46-97 valide cinq catégories et null explicite; :117-190 gère plusieurs familles de codes"},
      "llm": {"ou": "absent du normaliseur", "requis|remplacable": "absent", "comment": "[FACT] mapping déterministe et fermé; [JUDGMENT] aucun LLM runtime requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 710/1106; acquisition/src/fold-usage-dominant.ts:350-426 applique prefix_map/attribute_map; la production des maps reste assistée localement acquisition/config/fleet.json:11"},
      "llm": {"ou": "Claude/Codex lit actuellement la légende pour produire le config; aucun appel modèle dans le fold", "requis|remplacable": "remplacable", "comment": "[FACT] le résultat runtime est déterministe. [JUDGMENT] extraire texte/OCR et proposer un map, avec validation humaine seulement pour ambiguïtés."},
      "specificite": "config",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-usage-dominant.ts:350-426 plie toutes les features via putServedZoneAdditive; [RPT] 710/1106"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] longest-prefix/attribut déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-usage-dominant.ts:4-25 sert sur qc-zonage avec null explicite; [RPT] 710/1106; API S3/Kubernetes"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] serving déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "acquisition/config/fleet.json:11 et acquisition/src/geo-fleet.ts:329-349 montrent une boucle locale; aucun CronJob usage dominant trouvé"},
      "llm": {"ou": "agents Claude/Codex locaux", "requis|remplacable": "remplacable", "comment": "[FACT] LLM opérateur actuel des nouveaux maps. [JUDGMENT] refresh sur changement de source; modèle seulement pour nouvelle nomenclature ambiguë."},
      "specificite": "config",
      "refresh": "local"
    }
  },
  "effet_densifiant": {
    "capture": {
      "au_carre": {"verdict": "non", "source": "acquisition/src/fold-effet-densifiant.ts:83-108 lit un artefact local work/effet-densifiant/<slug>.json; aucun workload de capture/refresh k8s dédié trouvé"},
      "llm": {"ou": "agent 4a de flotte configuré mais à 0 shard acquisition/config/fleet.json:13", "requis|remplacable": "remplacable", "comment": "[FACT] les deux documents avant/après ne sont pas capturés par un moteur commun prouvé. [JUDGMENT] capture sans LLM."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-effet-densifiant.ts:118-194 valide schéma, citations, statut légal et dérive le signe des deux compteurs; seulement 5/1106 [RPT]"},
      "llm": {"ou": "absent du validateur", "requis|remplacable": "absent", "comment": "[FACT] invariants déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "non", "source": "[RPT] 5/1106; acquisition/src/fold-effet-densifiant-scaffold.ts:8-13 laisse honnêtement inconnu; aucun moteur commun avant/après n'est prouvé"},
      "llm": {"ou": "lecture agent possible dans la lane 4a locale, actuellement désactivée", "requis|remplacable": "remplacable", "comment": "[FACT] le fold refuse d'inventer mais ne produit pas les compteurs. [JUDGMENT] extraire chaque version via le moteur normes, puis diff numérique; modèle seulement sur cellule illisible."},
      "specificite": "bespoke",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/fold-effet-densifiant.ts:202-216,219-293 traite deux layouts et putServedZoneAdditive; couverture utile 5/1106 [RPT]"},
      "llm": {"ou": "absent du fold", "requis|remplacable": "absent", "comment": "[FACT] jointure par zone_code déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] 5/1106 complètes; scaffold inconnu explicite acquisition/src/fold-effet-densifiant-scaffold.ts:78-92; serving via qc-zonage"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] tri-état anti-invention; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "aucun CronJob/Job k8s effet densifiant trouvé; acquisition/config/fleet.json:13 fixe la lane à 0 shard; résultat 5/1106 [RPT]"},
      "llm": {"ou": "agent 4a local non actif", "requis|remplacable": "remplacable", "comment": "[FACT] aucun refresh automatique. [JUDGMENT] déclencher sur nouveau règlement/version et utiliser un diff déterministe."},
      "specificite": "bespoke",
      "refresh": "absent"
    }
  },
  "cadastre_role": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "packages/geo-sources-americas/src/ca-qc-cadastre/cadastre/crawl.ts:1-24,108-151 capitalise le crawl provincial; packages/geo-sources-americas/src/ca-qc-civic/role/fetcher.ts:1-24,145-205 fournit un fetcher brut, mais aucun refresh k8s ni couverture par ville n'est établi"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] ArcGIS/XML structurés; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "packages/geo-sources-americas/src/ca-qc-cadastre/cadastre/normalizer.ts:78-132 normalise NO_LOT; le rôle est volontairement fetch-only pour Loi 25, fetcher.ts:68-76"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] normalisation cadastre déterministe; rôle non normalisé dans la lib par frontière PII. [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "unknown", "source": "le package rôle interdit le parsing dans geo (fetcher.ts:5-15), tandis que acquisition/src/lots-enriched-run.ts:81-91 importe parseRole et :432-489 traite le rôle; la frontière owner/PII et la couverture de cette couche ne sont pas réconciliées"},
      "llm": {"ou": "absent du code trouvé", "requis|remplacable": "absent", "comment": "[FACT] XML/GeoJSON structurés. [JUDGMENT] aucun LLM requis; décision de frontière Loi 25 requise avant industrialisation."},
      "specificite": "unknown",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/lots-enriched-run.ts:26-50 décrit jointure rôle par lot avec garde d'overlap; [RPT] adresse civique 22/1100 seulement"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] lot/municipalité/overlap déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "[RPT] qc-lots servis 874/1106, surface 868/1100, adresse 22/1100; acquisition/src/lots-enriched-run.ts:1-50,93-97; API S3/Kubernetes"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] champs servis avec null honnête. [JUDGMENT] aucun LLM requis; filtrage PII contractuel obligatoire."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "aucun CronJob cadastre/rôle dédié trouvé; lots-enriched-run est un CLI local et le mapping conductor cadastre/rôle n'a pas été confirmé"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] sources structurées à cadence provinciale/annuelle. [JUDGMENT] refresh k8s événementiel/calendaire sans LLM."},
      "specificite": "config",
      "refresh": "absent"
    }
  },
  "immo_lots": {
    "capture": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/lot-zone-join-run.ts:195-243 résout les entrées S3; acquisition/src/lots-enriched-run.ts:93-111 lit cadastre/rôle/FSA; aucun job de refresh immo-lots k8s trouvé"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] données structurées; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "normalisation": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/lots-enriched-run.ts:242-280 stabilise lot_id et préserve les attributs; aliases encore codés :99-104; [RPT] lots servis 874/1106"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] normalisation déterministe; [JUDGMENT] déplacer aliases et maps en config."},
      "specificite": "config",
      "refresh": "local"
    },
    "extraction": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/lots-enriched-run.ts:26-50,590-664 calcule surface et joint adresse/FSA; [RPT] surface 868/1100, postal 867/1100, adresse 22/1100"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] géométrie/XML/point-in-polygon déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "jointure": {
      "au_carre": {"verdict": "partiel", "source": "moteur commun packages/geo/src/zonage/lotZoneJoin.ts:152-343 et dépôt S3 acquisition/src/lot-zone-join-run.ts:573-625; [RPT] lot-zone 342/1100, normes 52/1100, 1093464/3371939 lots sans code_zone"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] jointure spatiale et normes déterministes; [JUDGMENT] aucun LLM requis."},
      "specificite": "config",
      "refresh": "local"
    },
    "serving": {
      "au_carre": {"verdict": "partiel", "source": "acquisition/src/lots-enriched-run.ts:1-24,770-795 dépose qc-lots avec garde; [RPT] 874/1106; StoreProvider S3 et geo-api Kubernetes"},
      "llm": {"ou": "absent", "requis|remplacable": "absent", "comment": "[FACT] serving OGC déterministe; [JUDGMENT] aucun LLM requis."},
      "specificite": "data",
      "refresh": "local"
    },
    "refresh": {
      "au_carre": {"verdict": "non", "source": "acquisition/config/fleet.json:18-22 maintient qc-lots-backfill dans une session locale; acquisition/src/geo-fleet.ts:232-245 le relance localement; aucun CronJob k8s immo-lots trouvé"},
      "llm": {"ou": "absent du backfill déterministe; une lane agent immo est configurée à 0 shard", "requis|remplacable": "absent", "comment": "[FACT] le backfill est déterministe mais local. [JUDGMENT] le déplacer tel quel dans un Job k8s avant de le généraliser."},
      "specificite": "config",
      "refresh": "local"
    }
  }
}
```

### Lecture synthétique de la matrice

- Aucun des huit pipelines n'est au carré de capture à refresh.
- PV est le plus avancé en automatisation, mais seulement pour l'index. Zones est le plus avancé en moteurs source-family et serving, mais faible en preuve v2 et automatisation. Normes a le plus gros risque coût/LLM. Règlement et usage ont de bons folds mais une production de config locale et agentique. Effet densifiant est encore un pilote. Cadastre/rôle a un bon socle provincial mais une frontière Loi 25 contradictoire. Immo-lots a le meilleur moteur de jointure commun, mais les faibles ratios prouvent que l'orchestration/invalidation manque.
- L'inventaire du worktree contient `1137` fichiers TypeScript sous `acquisition/src`, dont `541` préfixés `_`. Ce comptage par nom n'est pas une mesure sémantique de dette, mais c'est un signal de surface opérationnelle et de scripts circonstanciels (`rg --files acquisition/src`).

## 4. FACTS — moteurs transverses à traiter séparément

### 4.1 Extraction

Le dépôt contient plusieurs moteurs réutilisables mais pas une cascade unique :

- sources structurées : ArcGIS/WFS/GDAL, XML/GeoJSON, parseurs déterministes;
- PDF natifs : `pdftotext` et parseurs de grille/PV;
- OCR : artefacts Mistral OCR durables pour normes et PV;
- vision/LLM : Claude CLI et anciens chemins Mistral vision-chat pour grilles; Claude/GPT pour labels t1/t2.

Le garde de politique est explicite : Mistral vision-chat est interdit, seul Mistral OCR est sanctionné (`packages/qc-sources/src/sources/vision-engine-policy.ts:21-54`). Pourtant `zonage-norms-2engine-keepbest` choisit encore `both` par défaut et lance Claude via CLI locale (`acquisition/src/zonage-norms-2engine-keepbest.ts:364-384,492-548`). Il n'existe pas encore de routeur commun fondé sur un score d'insuffisance du texte/OCR.

### 4.2 Jointure

`lotZoneJoin` est le meilleur noyau existant : normalisation commune des codes, pont numérique seulement quand le numéro est unique des deux côtés, intersection surfacique, fallback centroïde et état `unassigned` (`packages/geo/src/zonage/lotZoneJoin.ts:78-225,227-343`). Les folds règlement, usage et effet utilisent `putServedZoneAdditive`, qui protège la géométrie et limite les propriétés autorisées.

Le manque n'est donc pas d'abord algorithmique. Il est orchestrationnel : pas de graphe d'invalidation par hash des entrées, pas de contrôleur commun, pas de staging/version de sortie par run, pas de promotion atomique, et pas de partition fermée 1106 pour chaque produit dérivé.

## 5. JUDGMENTS — recommandations par pipeline et couche

| Pipeline | Capture | Normalisation | Extraction | Jointure | Serving | Refresh |
|---|---|---|---|---|---|---|
| zones | Déclarer chaque endpoint/layer/field dans un manifeste de famille de source et imposer `capturedFetch`. | Réduire les runners à ArcGIS, WFS, JMap, fichier vectoriel et plan PDF; les slugs ne portent que config. | Vectoriel/natif d'abord; géoréférencement déterministe; labels vision seulement sur résidu. | Industrialiser `lotZoneJoin` avec hashes d'entrée et partition fermée. | Refuser une nouvelle version sans receipt+CAS+preuve v2; corriger les 329 null et 4 unstamped. | CronJob de détection de staleness, Jobs par worklist, jamais boucle tmux. |
| normes | Capturer règlement/grille une fois, avec type/version/page ranges et CAS. | Route native texte → OCR conditionnel, schéma unique. | Retirer `both` par défaut; benchmark du résidu et budget explicite. | Recalcul incrémental via le moteur transversal quand normes ou zones changent. | Versionner le registre et servir citations/page/méthode avec la valeur. | CronJob conditionnel ETag/Last-Modified; Jobs k8s, sans staging local ni Serverless hors cluster. |
| PV | Sortir le registre de villes du gros TS vers données validées; capturer index **et documents**. | Normaliser date/type/source depuis le manifeste capturé. | `pdftotext` → OCR si score texte faible → parseur sémantique; garder l'OCR en S3. | Construire événement→règlement/version→zone avec candidat/refus explicite. | Servir index et événements immuables, pas seulement un manifeste interne. | Étendre le CronJob existant jusqu'aux documents/extractions; nouveau `run_id` par campagne. |
| règlement | Worklist des documents officiels et versions; CAS obligatoire. | Schéma `numero/millesime/url/page/statut` et veto fermé. | Regex/parser texte, OCR sur scan; modèle seulement si ambigu et revu. | Conserver le fold commun, déclenché par hash de registre. | Version/citation visibles dans qc-zonage et qc-lots. | Refresh à changement de document, Job k8s commun. |
| usage dominant | Réutiliser la capture du règlement/légende, pas une source parallèle implicite. | Garder vocabulaire fermé et null explicite; configs JSON validées. | Générer les candidats de map par parser; revue seulement des libellés ambigus. | Garder longest-prefix/attribute fold commun. | Servir source, version de map et taux de null. | Rejouer seulement si légende, zones ou map changent. |
| effet densifiant | Capturer les deux versions juridiques et leur date d'effet. | Réutiliser le schéma de normes pour `avant/après`; conserver `inconnu`. | Moteur de diff numérique commun; aucune déduction LLM du signe. | Joindre zone+version+règlement+événement PV avec citations doubles. | Servir méthode explicit/déduit, deux sources et statut légal. | Déclenchement par nouvelle version de règlement; Job k8s, pas grind agent. |
| cadastre/rôle | Cadastre provincial et rôle annuel dans worklists séparées; raw durable. | Cadastre dans la lib; décider explicitement la frontière PII du rôle. | Parse XML déterministe sous le gardien `lot`, avec allowlist Loi 25. | Identité lot canonique et rapport de collisions/overlap fermé. | Servir seulement les champs autorisés, avec millésime et source. | Cadastre selon publication; rôle annuel/événementiel; Jobs k8s. |
| immo-lots | Consommer uniquement des versions immuables cadastre/zones/normes/TOD/rôle. | Déplacer aliases et mappings hors code. | Garder surface/FSA/XML déterministes. | Faire du moteur transversal un produit versionné et incrémental. | Promotion atomique de qc-lots; conserver null et quality status. | Porter le backfill actuel en Job k8s, puis déclencher par hashes amont. |

## 6. JUDGMENT — recommandation cible 1 : moteurs communs de refresh

### Décision proposée

Créer un **Refresh Controller** commun. Il lit un manifeste de lane versionné contenant : inventaire de sources, politique de staleness, adaptateur de capture, route de normalisation/extraction, dépendances de jointure, ressources, budget, gates et clé de sortie. Le contrôleur crée des Jobs; le code municipal est interdit. Une exception source-family est une implémentation de moteur dans `packages/`, jamais un script par slug.

Le premier canari doit être PV index+documents, car un CronJob existe déjà. Zones WFS/ArcGIS vient ensuite; règlement et usage réutilisent leurs folds; normes migre après la cascade LLM-minimal; effet/cadastre/immo terminent le parcours.

### Case FOR

- Le contrat de worklist existe déjà pour les huit lanes (`CAPTURE_LANES`) et découpe les shards de façon déterministe.
- Centralise receipts, retries, robots, quotas, états fermés, hashes, invalidation et coûts.
- Transforme la variation municipale en données/config et rend mesurable le « bespoke restant ».
- Permet de remplacer progressivement la flotte sans arrêter les progrès de couverture.

### Case AGAINST — objection la plus forte

Les municipalités ne sont pas seulement des configurations : CMS, portails, PDF cartographiques et géoréférencements forment plusieurs familles réellement différentes. Un moteur trop abstrait peut devenir un « framework universel » plus complexe que les scripts, ralentir les cas rares et cacher du code dans du JSON.

Cette objection renverse la recommandation si, après PV + deux familles zones, plus de **15 % des sources actives** exigent un escape hatch exécutable par ville ou si le temps médian d'ajout d'une ville augmente de plus de 50 %.

### Pré-mortem

Échec probable : en six mois, le manifeste contient des expressions, hooks et branches spécifiques; les agents continuent à créer des scripts `_ville`; le contrôleur n'est qu'une couche de plus.

Signaux précoces : hausse du nombre de hooks, configs non validables, mêmes slugs cités dans le code, ratio de runs hors contrôleur, temps d'onboarding par source-family.

Mitigation : schéma fermé; seulement des identifiants de moteurs enregistrés; revue WP6 pour toute nouvelle capacité; métrique CI `city_slug_in_runtime_code`; registre d'exceptions avec owner et échéance; dual-run puis suppression du chemin local.

### Gates d'acceptation

- 100 % des runs de production ont `run_id`, image digest, worklist S3, manifest, receipt et état terminal.
- Aucun nouveau runner par ville pendant deux cycles de livraison.
- PV complet et au moins ArcGIS+WFS passent par le contrôleur, avec résultats équivalents ou meilleurs.
- Chaque lane expose `complete|incomplete|unknown|N/A` sur son univers fermé.

## 7. JUDGMENT — recommandation cible 2 : refresh-on-k8s

### Décision proposée

Kubernetes devient l'unique plan d'exécution de production : CronJobs détectent le travail; Jobs effectuent capture/extraction/jointure; l'état durable vit sur S3. Les images sont construites en CI et épinglées par digest. Les gates sont eux-mêmes des Jobs on-cluster; aucune étape de build, staging ou orchestration nécessaire à la production ne part d'un laptop.

Les Jobs qui doivent interroger geo-api utilisent le service `ClusterIP` (`deploy/k8s/geo-api-service.yaml:1-17`), par exemple `http://geo-api.geo.svc.cluster.local`, jamais le LoadBalancer public en hairpin.

### Case FOR

- Survit à l'arrêt du poste, rend les versions/logs/ressources observables, respecte l'objectif owner.
- Reprise, quotas, timeouts, concurrence et sécurité sont explicites.
- Ferme la dérive déjà documentée d'images construites à la main (`.github/workflows/docker-publish.yml:123-138`).
- S'aligne sur le bon exemplar `capture-worklist-run`: pod GET-only, CAS et manifest durable.

### Case AGAINST — objection la plus forte

Le cluster a une faible marge de quota (`deploy/acquisition-job/README.md:75-98`); les gros PDF/OCR peuvent OOM, certains sites municipaux bloquent les IP datacenter, et Kubernetes ajoute un coût d'exploitation. Serverless ou un worker long-lived pourrait être plus adapté à certaines charges sporadiques.

Cette objection renverse le « tout k8s » si une famille ne peut pas atteindre 95 % de succès après deux options d'egress sanctionnées, ou si le coût complet k8s dépasse durablement de 2× une alternative également reproductible et sous contrôle owner. Une exception demanderait alors décision owner explicite; elle ne justifie pas un laptop.

### Pré-mortem

Échec probable : les manifests existent mais sont `suspend:true`, les images sont obsolètes, les Jobs OOM, et un opérateur relance les scripts localement « temporairement ».

Signaux : âge du dernier run par lane, CronJobs suspendus sans échéance, image tag mutable, `local` dans le portfolio, pods pending/OOM, divergences entre manifest Git et cluster.

Mitigation : GitOps/readback du cluster; digest obligatoire; alerte de staleness; quota par lane; chunking S3; egress direct/proxy sanctionné; interdiction CI des commandes de production locales; runbook de reprise uniquement par création de Job.

### Gates d'acceptation

- Zéro refresh de production lancé depuis `geo-fleet`, tmux ou un poste pendant 30 jours.
- Tous les manifests Git sont reconciliés et leur image existe dans le registry.
- SLO par lane : dernier succès, durée, coût, queue, échecs fermés.
- Les tests d'acceptance interrogent le service in-cluster et comparent l'objet S3 produit.

## 8. JUDGMENT — recommandation cible 3 : LLM-minimal

### Décision proposée et plan de réduction

Adopter cette cascade unique :

1. **structuré/natif** : ArcGIS, WFS, GeoJSON, XML, HTML, vectoriel PDF;
2. **texte déterministe** : `pdftotext`, regex, tables, dictionnaires, validations de schéma;
3. **OCR Document-AI** seulement si un score objectif montre texte absent/insuffisant;
4. **LLM/multimodal fort** seulement sur un résidu borné, avec entrée CAS, sortie en artefact, coût, confidence et validation contre SIG/dictionnaire;
5. `unknown` si le gate échoue — jamais une seconde passe modèle pour fabriquer un vert.

Plan : instrumenter d'abord chaque appel; changer `zonage-norms-2engine-keepbest` de `both` à `native|ocr` par défaut; migrer labels t1/t2 vers extraction vectorielle/OCR/cadastre; conserver l'OCR PV pour scans; supprimer les chemins vision-chat interdits; benchmark mensuel du résidu sur un corpus gelé.

| Pipeline | Politique LLM-minimal |
|---|---|
| zones | Aucun LLM sur SIG; modèle seulement pour glyphes de plans non résolus après texte/vector/cadastre. |
| normes | Natif puis OCR; modèle fort seulement sur cellules/tables résiduelles, jamais double-engine universel. |
| PV | `pdftotext` puis OCR pour scans; parseur sémantique déterministe; LLM non requis par défaut. |
| règlement | Regex/structure/OCR; modèle propose seulement sur numéro/millésime ambigu, avec citation obligatoire. |
| usage | Parser + map contrôlé; modèle peut proposer le premier map, revue et exécution déterministe. |
| effet | Réutiliser les extractions de normes et comparer numériquement; aucun LLM ne décide le signe. |
| cadastre/rôle | Données structurées; aucun LLM. |
| immo-lots | Géométrie et identifiants; aucun LLM. |

### Case FOR

- Réduit coût, variance, dépendance fournisseur et difficulté de replay.
- Le dépôt possède déjà les alternatives déterministes et un garde interdisant le modèle Mistral défaillant après une facture de 480 €.
- Les outputs peuvent être comparés bit-à-bit et les refus restent honnêtes.
- Concentre le modèle là où sa valeur marginale est mesurable.

### Case AGAINST — objection la plus forte

Les scans, tableaux complexes et glyphes de plans sont précisément les cas où les parseurs échouent; minimiser trop agressivement le modèle peut augmenter `unknown`, le bespoke humain et le temps total, tout en donnant une fausse impression d'économie.

Cette objection renverse la réduction sur une famille si, à qualité égale, le chemin déterministe+OCR coûte plus cher en ingénierie/exécution que le modèle et si le modèle maintient sur corpus gelé une précision ≥ 99 %, une traçabilité cellule/page et un budget borné. Il resterait néanmoins un fallback, pas une source de vérité non vérifiée.

### Pré-mortem

Échec probable : l'organisation annonce « zéro LLM », la couverture normes chute, les opérateurs recopient à la main, et le bespoke réapparaît hors métriques.

Signaux : hausse de `unknown`, temps humain par ville, appels non instrumentés, outputs sans page/citation, différence entre factures et compteur interne.

Mitigation : budget de résidu explicite; corpus golden par famille; comparaison coût/recall/precision; cache S3 de chaque appel; revue des faux positifs; limite mensuelle et kill switch; aucun modèle non sanctionné.

### Gates d'acceptation

- 100 % des appels modèle ont provider/model/prompt-version/input-hash/output-key/coût.
- Zéro appel sur les quatre pipelines structurés cadastre, immo, jointures et serving.
- `both` n'est plus le défaut; le taux de recours modèle et son gain marginal sont publiés.
- Aucun dépôt ne franchit les gates de citation, dictionnaire ou cohérence SIG grâce à la seule confiance du modèle.

## 9. JUDGMENT — recommandation cible 4 : cycle preprod ↔ prod automatisé

### Décision proposée

#### Merge sur `main`

1. CI vérifie et construit les images, publie des digests immuables.
2. Un Job **dans le cluster** prend un snapshot manifesté de la version prod courante et réalise un **miroir exact allowlisté** vers un préfixe/bucket baseline preprod. Il supprime les objets destination absents du snapshot source dans ce seul préfixe. Une sync additive est refusée : elle conserve les reliquats et augmente l'entropie.
3. Le Job produit avant/après : inventaire, compte, octets, hashes, liste prunée et receipt signé. Les raw/CAS globaux ne sont jamais prunés par ce reset.
4. Preprod déploie le digest du merge et applique les migrations/upgrades.
5. Les essais pipeline écrivent dans `preprod/runs/<merge-sha>/<run-id>/`, jamais directement dans le baseline ni prod.
6. Gates on-cluster; promotion d'un pointeur `preprod/current.json` seulement si verts. Les artefacts d'essai sont conservés avec TTL pour diagnostic.

#### Tag de production

1. Le tag doit référencer un digest déjà passé en preprod; aucune reconstruction différente.
2. Avant mutation : inventaire/version des objets prod, snapshot DB s'il existe, sauvegarde du pointeur courant et **test de restauration automatisé**.
3. Déployer le digest, puis exécuter les vraies captures/normalisations/extractions/jointures dans `prod/releases/<tag>/<run-id>/` via Jobs k8s.
4. Les gates vérifient partition fermée, non-régression, provenance, budget, receipts et API via `ClusterIP`.
5. Promotion atomique du pointeur `prod/current.json`; rollback = repointer l'ancienne release, pas recopier des millions d'objets.
6. **Aucune donnée calculée en preprod n'est copiée en prod.** Preprod prouve le code; le tag rejoue les sources réelles et produit les données prod, conformément à l'objectif owner.

### Case FOR

- Traduit littéralement merge→reset+upgrade et tag→réel+backup, avec une frontière anti-contamination.
- Miroir exact+pruning réduit l'entropie, contrairement à une sync additive.
- Staging versionné + pointeur atomique évite un serving à moitié migré.
- Backup testé et rollback par pointeur rendent les actions destructives récupérables.

### Case AGAINST — objection la plus forte

Écraser preprod à chaque merge détruit des preuves de debug et des calculs coûteux; copier prod peut importer des données sensibles; un tag qui attend tous les pipelines peut durer des heures et rendre le release fragile. Le mécanisme de pruning est lui-même dangereux.

Cette objection renverse le reset systématique si les pipelines nécessitent des jeux synthétiques persistants non reconstructibles, ou si la classification PII interdit de dupliquer une classe de prod. Dans ce cas, la baseline reste un snapshot prod **filtré et versionné**, tandis que les datasets de test vivent dans un préfixe séparé jamais reset.

### Pré-mortem

Échec probable : une allowlist mal résolue prune le mauvais préfixe, le backup n'est pas restaurable, un tag déploie l'image mais échoue au milieu des données, et l'API sert un mélange de versions.

Signaux : commande avec bucket/root non borné, absence de dry-run diff, backup sans restore, writes vers `current`, tag d'un SHA non testé, appel au LoadBalancer public depuis les Jobs, objets orphelins après reset.

Mitigation : comptes/IAM séparés; destination préprod impossible à confondre avec prod; refus de cible vide/root; allowlist compilée; dry-run obligatoire; seuil de suppression et approbation owner au-delà; object versioning; restore drill; outputs sous release immutable; pointeur atomique; policy réseau vers service in-cluster.

### Gates d'acceptation

- Deux drills successifs merge→reset preprod avec inventaire exact et pruning borné.
- Un drill backup→restore prod sur environnement isolé, RTO/RPO mesurés.
- Un tag canari produit une release complète, puis rollback par pointeur.
- Aucun build local, aucun accès LB hairpin, aucun write direct à `prod/current`.
- Le dépôt et Track documentent l'ADR réelle; le numéro ADR-0027/0028 est réconcilié avant mise en œuvre.

## 10. Options de mise en œuvre et recommandation

### Option A — big-bang plateforme

FOR : cible homogène plus vite, moins de coexistence.

AGAINST : risque élevé de bloquer la couverture, migration simultanée de huit chaînes mal connues, rollback difficile.

Pré-mortem : le contrôleur reste inachevé et la flotte locale continue en parallèle sans ownership clair.

### Option B — strangulation par lanes, recommandée

FOR : le CronJob PV et les moteurs capture/jointure offrent des points d'entrée; mesure équivalence et coût à chaque lane; permet de retirer le local progressivement.

AGAINST : coexistence temporaire, double-run et discipline de suppression nécessaires; bénéfice complet plus tardif.

Pré-mortem : les anciens chemins ne sont jamais coupés et deviennent une seconde production.

### Option C — améliorer les scripts actuels

FOR : débit immédiat, peu de changement infrastructure.

AGAINST : ne satisfait ni tout-k8s, ni replay propre, ni dé-entropie; maintient LLM comme opérateur et le laptop comme scheduler.

Pré-mortem : nouvelle panne de quota/session/image manuelle, sans preuve reproductible.

### Séquence proposée pour B

1. **Lot sécurité** : ADR cycle preprod/prod, préfixes/IAM, release pointer, CI images digest, gates on-cluster.
2. **Canari PV** : index + capture documents + extraction texte/OCR + serving d'événements, sous contrôleur commun.
3. **Zones** : ArcGIS/WFS puis autres familles; preuve v2 obligatoire; lot-zone incrémental.
4. **Règlement + usage** : documents capturés, production de configs/folds par Jobs.
5. **Normes** : cascade LLM-minimal et suppression du défaut `both`/staging local.
6. **Cadastre/rôle + immo + effet** : décision Loi 25, refresh provincial, jointures versionnées, diff avant/après.
7. À chaque lot : dual-run, comparaison, bascule, suppression du chemin local et mise à jour du portfolio.

Coût du délai : chaque mois sans décision prolonge un système dont les résultats dépendent de tmux, de quotas d'agents et de scripts locaux; augmente le risque qu'une donnée fraîche ne soit ni rejouable ni attribuable. Le coût d'une mauvaise décision big-bang est toutefois supérieur à quelques semaines de dual-run mesuré.

## 11. Désaccords et inconnues à préserver pour `claude-fable-5`

1. **Preuve v2** — commission/seed : `0/1106`; rapport frais : `48/1106` (`+12` par rapport à 36), CAS rehashé. Ne pas conserver le zéro dans la synthèse.
2. **Sources coverage prétendues absentes** — le rapport frais lit bien `completion-regdens`, `immo-lot-zone-assignment-matrix` et `immo-folded-normes`, avec hashes. Elles étaient peut-être absentes au moment du seed, mais ne le sont plus dans ce worktree.
3. **Fraîcheur** — le rapport a été exécuté frais le 2026-08-20, mais ses inputs portent des as-of du 2026-06-23 au 2026-07-28. La synthèse doit dire « calcul frais sur snapshots datés », pas « état S3 live ».
4. **Preprod** — commission : serving preprod déployé + sync prod→preprod, « première instance » C1+C2+C3; Track : item preprod encore `to-do`; dépôt : aucune workflow reset/upgrade/backup/promotion. Cette instance peut être cross-repo/cluster, mais elle est `unknown` ici tant qu'une preuve externe n'est pas fournie.
5. **ADR** — prompt owner mentionne ADR-0027; commission committée mentionne ADR-0028 (`COMMISSION_PIPELINES_DOSSIER.md:49-50`); aucune entrée correspondante n'a été trouvée dans `docs/decisions.md`. Numéro et contenu à réconcilier.
6. **On-k8s** — le seed classe `normes-job`, `acquisition-job` et le backlog PV comme refresh on-k8s. Réalité du code : normes-job est Serverless; acquisition-job a des pods k8s mais un orchestrateur local; backlog PV est suspendu; seul `geo-pv-refresh` est un CronJob actif et il ne rafraîchit que l'index.
7. **LLM ~37 fichiers** — la concentration normes/PV/labels est confirmée, mais un compte par nom de fichier mélange tests, wrappers, OCR et vrais appels fournisseur. La synthèse ne doit pas transformer `~37` en métrique d'usage ou de coût sans instrumentation runtime.
8. **Cadastre/rôle Loi 25** — la lib déclare fetch-only et interdit le parser dans geo, alors que `lots-enriched-run` parse et joint l'adresse dans ce dépôt. Cette contradiction doit être arbitrée par `role:lot`/owner avant migration k8s.
9. **Mappings de conductors** — confirmés par la commission : zones→`geo-zones`, PV→`pv`, règlement→`reglements`, immo-lots→`geo-lot`. Normes, usage dominant, effet densifiant et cadastre/rôle restent **unknown** malgré consultation; les noms internes `geo-nm`, `geo-usage-dom`, `geo-4a` ne sont pas promus en mappings de conductor.

## 12. Biais, intérêt owner et décision attendue

Le biais naturel de l'architecte/agent est de préférer l'uniformité et de sous-estimer les sources municipales réellement atypiques. L'intérêt owner est plus large : données fraîches et exactes, cadence de livraison, coût borné, capacité de rollback et absence de dépendance à une machine. C'est pourquoi la recommandation garde des moteurs par **famille de source**, des critères de renversement et une migration incrémentale; elle ne postule pas un moteur universel unique.

Décision attendue après revue :

1. ratifier ou rejeter le paquet Option B et les quatre décisions cibles;
2. fixer le niveau de risque acceptable pour le pruning preprod et le tag prod;
3. arbitrer la frontière Loi 25 du rôle;
4. fournir la preuve cross-repo de l'ancrage preprod et réconcilier ADR-0027/0028;
5. nommer les quatre conductors encore unknown.

Ce document ne modifie pas Track : la commission impose un commit du seul présent fichier; l'item de décision existe déjà et reste `in-progress` pour la suite fable-5 → geo-archi → geo-cond.
