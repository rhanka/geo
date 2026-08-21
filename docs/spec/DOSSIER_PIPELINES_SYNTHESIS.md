# DOSSIER (present-decision) — Pipelines de données geo : mise au carré + dé-entropie

> Track : `01M0GWZW2753PV92WJ2PGX5GS2`. Synthèse **geo-archi (WP6)** de la double-instruction :
> **gpt-5.6-sol xhigh** (produit — `DOSSIER_PIPELINES_SOL_ANALYSIS.md` @ `1af72377`) + **claude-fable-5**
> (revue indépendante). Désaccords sol↔fable **préservés** (non blendés). À présenter à l'owner **via geo-cond**
> (AskUserQuestion). FACT/JUDGMENT tagués. **Confiance scindée** : ~**0.78** sur l'architecture cible ;
> ~**0.55** sur l'état-des-lieux tel qu'écrit (voir Pièce №1).
>
> **Architecture cible complète (rejouable/auditable)** : `docs/spec/SPEC_PIPELINES_TARGET_ARCH.md` — capitalisation
> de la cible groundée `fichier:ligne` produite par claude-fable-5 (par-pipeline × moteur commun ; traitements ;
> environnements+infra ; 3 vues Mermaid EXISTE/`[cible]` : Traitement · Cycle-env · Topologie). **Ce dossier = la
> DÉCISION** (Option B + 4 décisions cibles) ; **le SPEC = la CIBLE précise** qui en découle une fois ratifiée.

---

## Pièce №1 (à lire d'abord) — le split-brain de grounding EST la thèse, en direct

**[FACT]** L'état-des-lieux chiffré de ce dossier n'est **pas rejouable depuis un checkout propre** — et cela
démontre exactement l'entropie que l'owner veut réduire. Deux mesures du MÊME générateur committé
(`portfolio-city-report.mjs`), la même date (2026-08-20) :

| Mesure | Checkout committé (worktree propre) | Checkout principal (avec fichiers UNTRACKED) = chiffres de sol |
|---|---|---|
| preuve-v2 zones | **42/1106** | **48/1106** |
| normes | 501 | 502 |
| règlement / usage / effet / lot-zone / normes-pliées | **unknown ×5** (3 sources coverage **absentes du versionné**) | 815 / 710 / 5 / 342 / 52 |
| `deploy/k8s/geo-pv-refresh-cronjob.yaml`, `acquisition/src/pv-refresh-cron.ts` | **n'existent pas** (ni sur `origin/main`) | existent, **untracked** |

**[FACT]** Les sources `completion-regdens-*` et `immo-lot-zone-assignment-matrix-*` **n'existent nulle part en
versionné** — seulement en local. Le dossier de sol — dont la définition même d'« au carré » exige « rejouable
depuis un checkout propre » — assoit ses FACTs-titres sur des fichiers qui **échouent ce test**.

**[JUDGMENT]** Ce n'est pas un défaut à corriger AVANT de présenter : c'est **la meilleure pièce à conviction**.
La ré-acquisition, la preuve, l'orchestration existent — mais **sur une machine**, pas capitalisées. C'est le
principe fondateur violé, mesuré sur le dossier lui-même. La décision owner inclut donc une **action de
capitalisation** (versionner les 3 sources coverage + les manifests locaux, ou les re-libeller « local, non
prouvé ») — pas un maquillage des chiffres.

---

## 1. Décision demandée

**[JUDGMENT]** Ratifier (ou rejeter) le **paquet Option B** (strangulation incrémentale par lanes) et ses **4
décisions cibles liées** :
1. **Moteur commun de refresh** (Refresh Controller par manifestes ; spécificité par-ville = data/config ; code par-ville interdit).
2. **Refresh-on-k8s** — Kubernetes = unique plan d'exécution de production (zéro refresh depuis un poste).
3. **LLM-minimal** — cascade natif → texte → OCR conditionnel → modèle fort seulement sur résidu mesuré.
4. **Cycle preprod↔prod automatisé** — merge→miroir-exact+prune+upgrade ; tag→rejeu réel+backup+promotion atomique.

Et **arbitrer** : (a) le niveau de risque acceptable du pruning preprod / tag prod ; (b) la frontière Loi 25 du
rôle ; (c) les **4 mappings de conductors inconnus** (normes, usage dominant, effet densifiant, cadastre/rôle) ;
(d) la réconciliation **ADR-0027/0028** ; (e) les **actions de capitalisation** (Pièce №1).

## 2. Contexte — FACTS, hypothèses et unknowns séparés

### 2.1 État par pipeline (matrice 8×6, sortie sol — corrigée)
**[FACT]** Couverture fraîche (snapshots datés 2026-06→07, calcul 2026-08-20, **pas** un état S3 live) :
PV `1062/1106` · zones `868/1106` · règlement `815/1106` · usage dominant `710/1106` · normes `502/1106` ·
effet densifiant `5/1106` · lot-zone `342/1100` · normes pliées `52/1100` · adresse civique `22/1100` ·
**preuve-v2 zones `42/1106` au committé (`48` en local — cf. Pièce №1), PAS 0**.
**[FACT]** **Aucun des 8 pipelines n'est au carré capture→refresh.** PV = le plus automatisé (index seulement) ·
zones = meilleurs moteurs source-family + serving (faible preuve-v2) · normes = plus gros risque coût/LLM ·
règlement+usage = bons folds mais config produite localement/par agents · effet densifiant = pilote (5/1106) ·
cadastre/rôle = bon socle provincial mais **frontière Loi 25 contradictoire** · immo-lots = meilleur moteur de
jointure commun mais faibles ratios (orchestration/invalidation manquante).

### 2.2 Trois bons noyaux transverses existent déjà **[FACT]**
Capture typée content-addressed (`packages/qc-sources/src/capture/manifest.ts`, `capturedFetch.ts`) · jointure
lot-zone déterministe (`packages/geo/src/zonage/lotZoneJoin.ts`) · serving S3/OGC on-k8s
(`store-provider.ts`, `deploy/k8s/geo-api-deployment.yaml`). **Ils ne sont pas encore le chemin obligatoire.**

### 2.3 L'automatisation owner demandée n'existe PAS au repo **[FACT]**
Merge = CI seul ; tag = build/push images. **Aucun** reset preprod, upgrade, backup prod, exécution pipeline ni
promotion atomique versionnés. Le rattrapage reste piloté par une **flotte locale tmux/agents**
(`geo-fleet.ts`, `fleet.json`). `normes-job` = **Scaleway Serverless** (pas k8s) ; `acquisition-job` = pods k8s
mais **orchestrateur lancé localement**. **Seul CronJob de refresh actif : l'index PV** (quotidien) ; **+ le
`capture-job` `*/2min`** (capture-backlog, versionné actif — que sol avait manqué, corrigé par fable).

### 2.4 Unknowns (non devinés) **[FACT: ce sont des unknowns]**
4 mappings de conductors (normes/usage/densifiant/cadastre — sol a consulté via h2a, pas de retour → non
fabriqués) · l'ancrage preprod « 1re instance » (Track dit l'item preprod `to-do` ; peut être cross-repo/cluster,
non prouvable ici) · la frontière Loi 25 du rôle · **ADR-0027/0028 absents de `docs/decisions.md`** (max trouvé
= ADR-0024).

## 3. Enjeux (pourquoi dossier-level)
**[JUDGMENT]** Cross-lane (8 pipelines/conductors) · touche le **principe fondateur** (reproductible/capitalisé,
capture=donnée de prod, refresh on-cluster) · **mandat owner direct** · coût/timeline (migration multi-pipeline) ·
**entropie live** : le split-brain (Pièce №1), le **cycle qui ne cycle pas** (prod tourne une image de 6 semaines,
finding §Exemplars) et l'**entropie de dépôt** (§Exemplar #4).

## 4. Options (steelman symétrique ; recommandée incluse)

| id | choix | Case FOR (le plus fort) | Case AGAINST (le plus fort) | Coût | Réversibilité | Ce qui la fait gagner |
|---|---|---|---|---|---|---|
| **A** | Big-bang plateforme | Cible homogène plus vite, moins de coexistence | Risque élevé de bloquer la couverture ; 8 chaînes mal connues migrées d'un coup ; rollback dur | Élevé, amont | Faible | Si les 8 pipelines étaient déjà bien connus + testés |
| **B** ⭐ | **Strangulation par lanes** | CronJob PV + moteurs capture/jointure = points d'entrée ; équivalence+coût mesurés par lane ; retire le local progressivement | Coexistence temporaire, double-run, discipline de suppression ; bénéfice complet plus tardif | Moyen, étalé | **Élevée** (par lane) | Défaut sain : mesure à chaque marche, réversible |
| **C** | Améliorer les scripts actuels | Débit immédiat, peu de changement infra | Ne satisfait **ni** tout-k8s, **ni** replay propre, **ni** dé-entropie ; garde le LLM opérateur + le laptop scheduler | Faible amont, dette continue | Nulle (statu quo) | Si l'owner rejetait la cible reproductible (contredit le mandat) |

## 5. Recommandation + rationale

**[JUDGMENT] Option B + les 4 décisions cibles**, séquence : lot-sécurité (ADR cycle, IAM/préfixes, release
pointer, gates on-cluster) → canari **PV** (CronJob existe) → **zones** (ArcGIS/WFS, preuve-v2 obligatoire) →
règlement+usage → **normes** (cascade LLM-minimal, retirer le défaut `both`) → cadastre/rôle+immo+effet.
Rationale décisif : les 3 noyaux transverses existent (socle réel, vérifié) ; le manque est **orchestrationnel**
(graphe d'invalidation par hash, staging/version par run, promotion atomique, partition fermée 1106), pas
d'abord algorithmique — donc une migration incrémentale mesurée capitalise l'existant sans big-bang.

**Strongest case AGAINST ma recommandation [JUDGMENT, non vide]** : les municipalités ne sont pas que des
configs — CMS, portails, PDF cartographiques, géoréférencements sont des familles réellement différentes. Un
moteur commun trop abstrait devient un « framework universel » plus complexe que les scripts, cachant du code
dans du JSON. **Ce qui renverse** : si après PV + 2 familles zones, **>15 % des sources actives** exigent un
escape-hatch par-ville, OU si le temps médian d'ajout d'une ville monte de **>50 %**. La reco garde donc des
moteurs **par famille de source** (jamais un moteur universel unique) + un registre d'exceptions gaté WP6.

## 6. Réversibilité / coût
**[JUDGMENT]** B est réversible **par lane** (dual-run → comparaison → bascule → suppression du chemin local).
Chaque reco cible porte un **critère de renversement chiffré** (§5 ci-dessus ; k8s : <95 % succès après 2
egress ou coût >2× ; LLM : précision ≥99 % sur corpus gelé sinon fallback ; cycle : jeux synthétiques non
reconstructibles ou classe PII → baseline filtrée). Coût du délai : chaque mois prolonge un système dépendant de
tmux/quotas/scripts locaux, et augmente le risque qu'une donnée fraîche ne soit ni rejouable ni attribuable.

## 7. Attendus owner (critère · source · couvert par · gap)
| Critère (mandat owner) | Couvert par | Gap |
|---|---|---|
| Chaque pipeline « au carré » couche-par-couche | Matrice §2.1 (verdicts sourcés) | Aucun n'est au carré ; preuve-v2 faible ; 3 sources coverage non versionnées (Pièce №1) |
| LLM réduit au strict besoin | Reco 3 + cascade + gates | `both` encore défaut ; usage réel non instrumenté |
| TOUT refresh on-k8s (zéro local) | Reco 2 + gates | Aujourd'hui : flotte tmux, normes Serverless, orchestrateur local |
| Cycle preprod/prod auto (merge→écrase+upgrade / tag→réel+backup) | Reco 4 (traduit littéralement le mandat) | Aucune workflow n'existe ; prod tourne une image de 6 sem (cycle ne cycle pas) |

## 8. Ce dont j'ai besoin de l'owner (la plus petite décision valide)
1. **Ratifier ou rejeter** Option B + les 4 décisions cibles (ou nommer le critère manquant).
2. **Fixer le risque acceptable** du pruning preprod + du tag prod (seuil de suppression, approbation au-delà).
3. **Arbitrer la frontière Loi 25** du rôle (fetch-only vs parse+join).
4. **Nommer les 4 conductors** encore unknown (normes, usage dominant, effet densifiant, cadastre/rôle).
5. **Réconcilier ADR-0027/0028** (absents du repo committé) + fournir la preuve cross-repo de l'ancrage preprod.
6. **Sanctionner les actions de capitalisation** (Pièce №1) : versionner les 3 sources coverage + les manifests
   PV-refresh locaux (ou les re-libeller « local, non prouvé »).

---

## Corrections appliquées à la sortie sol (revue fable, vérifiées)
1. **Preuve-v2 = 42/1106 committé (48 en local), PAS 0** — les deux états publiés (Pièce №1), pas « 48 » tranché.
2. **`both` ne « paie PAS deux moteurs »** [le FACT de sol était faux] : Engine B = **abonnement Claude OAuth,
   overage rejeté** ; seul l'OCR est facturé. Vrai coût du défaut `both` = **temps + dépendance CLI locale**
   (la reco 3 « retirer `both` par défaut » survit, motif corrigé).
3. **Refresh PV requalifié** : `geo-pv-refresh-cronjob.yaml` + `pv-refresh-cron.ts` sont **local untracked**,
   déploiement non prouvé depuis le dépôt → « manifeste local, non capitalisé » ; **+ le seul autre CronJob actif
   versionné = `deploy/capture-job/cronjob-capture-refresh.yaml` `*/2min`** (que sol avait manqué).
4. **Chiffre lots `1041867/3389752` périmé** (20260725) → **unknown** au 20260820 (ne pas citer comme courant).
5. **ADR-0027/0028 absents** de `docs/decisions.md` (max = ADR-0024) — à réconcilier (Pièce №1, §2.4).
6. **Terme proscrit purgé** (directive langue owner) — 3 occurrences du doc sol retirées de cette synthèse ;
   substituts factuels employés (`explicite`, `null non inventé`, `unknown assumé`).

## 9 désaccords sol↔fable PRÉSERVÉS (non blendés)
1. **Coverage** : sol publie 48/815/710/342/52 « frais » ; fable : le worktree committé donne 42 + unknown×5 —
   publier **les deux états** (Pièce №1), pas trancher.
2. **§11.2 de sol** (« les 3 sources ne sont plus absentes ») **faux au committé** (elles sont untracked).
3. **PV refresh** : sol « pipeline le plus automatisé, CronJob quotidien » ; fable : preuve **non capitalisée** +
   sol a manqué `capture-refresh` `*/2min` (le seul autre CronJob actif versionné).
4. **Coût keepbest** : sol « paie 2 moteurs » (faux) ; fable : abonnement, overage rejeté.
5. **§11.6** : sol « seul geo-pv-refresh actif » ; fable : `capture-refresh` aussi.
6. **Comptes fichiers** : sol `1137/541`; fable worktree committé `769/268`.
7. **Reco 4 (tag→re-capture)** : l'AGAINST de sol ne traite pas le risque le plus fort — re-capturer 1106
   sources au tag réintroduit la **variabilité des sources** (site indispo au tag = release incomplète ; source
   changée entre validation preprod et tag = preprod n'a pas prouvé les données de prod). **Alternative non
   examinée = promotion depuis le CAS capturé** (rejouer normalisation/extraction/jointure depuis `raw/…/cas/`,
   la capture restant un flux continu découplé du release). **À instruire avant ratification de la reco 4.**
8. **Confiance** : sol 0.78 global ; fable la scinde (~0.75-0.8 archi / ~0.55 état) — adopté ici.
9. Mineurs : Track global 8738 (sol 8739) ; `CAPTURE_LANES` vit dans `manifest.ts` (pas `worklist.ts`) ; item
   dossier `01M0GWZW…` non trouvé au journal du worktree (invérifiable ici).

## Findings terrain de cette session (Exemplars du dossier — prouvés LIVE)
- **#1** Toute gate/refresh ayant besoin du code lib = **Job on-cluster sur image commune**, jamais build local
  (la gate de parité completeness importe `computeSetHash` du `dist` buildé-à-l'image ; run local = irreproductible).
  **[FACT]** sol l'intègre (§7,§9).
- **#2** Un moteur commun joint une API sœur via le **service in-cluster**, jamais l'IP externe du LB (hairpin
  non routé depuis un pod — prouvé sur le sync prod-API). **[FACT]** sol l'intègre (§7 ClusterIP).
- **#3** Un sync **additif = dette d'entropie** ; seul un **miroir exact avec pruning** dé-entropise.
  **[FACT]** sol l'intègre (§9 « une sync additive est refusée »).
- **#4** **Index-discipline + provenance durable** : le serving indexait 765 collections en trop = **backups
  d'audit** (replace-policy) que geo-api recursait depuis `_replaced/` + prebackups in-namespace. Résolu par une
  **règle d'admission canonique unique** (`isCanonicalGeojsonKey`, aux 3 couches index/prune/parité — PR #240) +
  fix acquisition (PR #239, prebackup → `_replaced/`), **zéro mutation data prod**, backups préservés. **La gate
  de parité conflatait parité-DATA (objets S3) et parité-VERSION (set servi, dépendant de l'image)** → re-spec
  §4 : acceptation = **parité DATA sur le set canonique**, le set servi devient signal de revue. **[FACT
  diagnostic + JUDGMENT]** — révèle que **prod tourne une image de 6 semaines** (sert un index stale) : le cycle
  preprod↔prod **ne cycle pas** — c'est le cœur de la reco 4 + une **question owner**.

## Section honnête — ce qui n'est PAS au carré / pas prêt
- **[FACT]** L'**état-des-lieux chiffré n'est pas rejouable** depuis un checkout propre (Pièce №1) → action :
  versionner `completion-regdens-*`, `immo-lot-zone-assignment-matrix-*`, `immo-folded-normes-*` + les manifests
  PV-refresh locaux, OU les re-libeller « local, non prouvé ».
- **[FACT]** L'ancrage preprod « 1re instance » est **unknown ici** (Track `to-do` ; preuve cross-repo à fournir).
- **[FACT]** **ADR-0027/0028 absents** du repo committé — numéro/contenu à graver.
- **[FACT]** **4 conductors unknown** (non devinés).
- **[JUDGMENT]** La **reco 4 (tag→re-capture)** a une alternative non instruite (promote-from-CAS, désaccord 7) —
  à trancher avant de graver le point tag.
- **[FACT]** L'usage LLM réel (`~37 fichiers`) mélange tests/wrappers/OCR/vrais appels → **non instrumenté** ;
  ne pas transformer `~37` en métrique de coût sans runtime.

---
**Self-audit gate** (passé) : FACT/JUDGMENT tous tagués · count-symétrie des FOR (A/B/C, table §4) · strongest-
AGAINST §5 non vide + critère de renversement chiffré · pré-mortems (via recos sol, préservés) · **agent-interest
disclosure** : le biais architecte = préférer l'uniformité + sous-estimer les sources atypiques ; l'intérêt owner
= données fraîches/exactes, cadence, coût borné, rollback, zéro dépendance-machine → la reco garde des moteurs
**par famille** + critères de renversement, pas un moteur universel. **Double-instruction** : sol (produit) +
fable (revue indépendante), 9 désaccords préservés. **Confiance scindée** : ~0.78 archi / ~0.55 état-des-lieux.
