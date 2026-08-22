# DOSSIER (present-decision) — 2 décisions moteur jumelles : orchestrateur DAG & placement LLM

> **Préparé par geo-archi (WP6)** pour l'owner, **présenté via geo-cond** (AskUserQuestion). **Statut : dossier
> d'ANALYSE, en attente de ratification owner** (l'outcome sera appendé + gravé Track après décision). Track
> décision parente `01M0N6JM8TPN5WXVVG9QQ6PEHP` (Option B go, mergée #243 `a0cc7226`) ; WP
> `01M0N6J2S8J7P68AQERKTPCMZM`. Entrées : convergence `SPEC_PIPELINES_MIGRATION.md` (2 passes indépendantes sol
> xhigh + fable xhigh) ; formalisme §A `SPEC_PIPELINES_TARGET_ARCH.md` ; découpe socle `833a04e7` ; **vérification
> cross-repo indépendante geo-archi** sur `sentropic@97fe9f53e` + `h2a@a1e17b69` (**5/5 claims CONFIRMÉS**, §2).
> Méthode : FACT/JUGEMENT tagués ; désaccords préservés ; strongest-case-against non vide ; agent-interest divulgué.
>
> **UN dossier, DEUX décisions jumelles.** L'owner peut trancher les deux, ou n'en trancher qu'une.

---

## OUTCOME — redirection owner (2026-08-22, via geo-cond)

**L'owner REDIRIGE les deux décisions (ne ratifie ni l'une ni l'autre).**

**D-moteur-2 — l'owner pose un RÔLE CIBLE pour cluster-mesh** (verbatim) : « *cluster mesh est censé wrapper les
API llm-mesh et gw. si c'est pas le cas ça doit le devenir* ». Donc :
- Mon `[FAIT]` « cluster-mesh ne route aucun LLM » reste vrai comme **ÉTAT COURANT** (vérifié §2) — mais le **RÔLE
  CIBLE** posé par l'owner = cluster-mesh devient le **wrapper unifié** au-dessus de `llm-mesh` (control-plane,
  enrollment) **+** `llm-gateway` (data-plane) pour les consommateurs k8s comme geo. Le gap n'est **pas une
  confusion à écarter** (mon cadrage `~M` §4b est **corrigé** par l'owner) : c'est un **build cross-owner à
  commander**.
- **Réconciliation avec la reco §5** : la gateway (Mode 3) reste le **data-plane** ; cluster-mesh la **fronte**.
  geo appelle **cluster-mesh** (identité de workspace, **zéro cred en pod**), qui wrappe l'enrollment llm-mesh +
  le routage gw. `crossUserPoolEnabled` reste **OFF**. → « cible = gateway sanctionnée » devient « cible =
  **cluster-mesh-as-wrapper(llm-mesh + gw)**, dont la gateway est le data-plane ».
- **Action** : *(corrigée après retour `mesh`/WP14)* — **l'attribution de `@sentropic/cluster-mesh` est OUVERTE**
  (arbitrage owner en cours, porté par **h-cond** ; des sessions `agent:cluster-mesh` tournent dans
  `sentropic/tmp/cluster-mesh` branche `feat/cluster-mesh-v1`, pilote inconnu). **Ne PAS figer d'attribution.**
  geo = consommateur ; intérim local borné jusqu'à livraison.

**Retour `mesh` (WP14 — propriétaire des CONTRATS `llm-mesh` + `llm-gateway`, PAS de cluster-mesh) :**
- **Le lot est un ORDRE DE GRANDEUR plus gros que « wrapper 2 APIs ».** Le « zéro cred en pod » **force le chemin
  RÉSEAU** : wrapper l'in-process (llm-mesh en lib) mettrait la mesh **et les creds DANS le pod** (contraire à la
  directive). Le wrap doit être **au-dessus du data-plane réseau (le gateway)**. Or **aucun service gateway n'est
  déployé ni déployable côté sentropic aujourd'hui** (aucune cible Makefile, aucune app exécutable ; le seul
  gateway sur la machine = le daemon `@sentropic/h2a-runtime`, actuellement **DOWN**). ⟹ vrai lot = **lever un
  data-plane réseau côté sentropic**, PUIS le fronter — pas un simple wrapping.
- **push-cluster supprimé = ALIGNÉ, pas un manque** : ce pont mettait des creds dans le pod = exactement ce que la
  directive écarte. Ne PAS le restaurer. Si le gateway détient les comptes, le Job geo n'a besoin que d'une
  **identité de workspace**. *(Corrige mon §2/§4b : je le portais comme dépendance — c'est cohérent avec la cible.)*
- **Précision consommateurs** : `llm-mesh` **A** un consommateur applicatif (l'`api` sentropic, in-process, 5+
  imports) ; c'est le **gateway** qui a **zéro** consommateur dans le dépôt (mon « live = mesh-direct in-process »
  reste exact ; l'attribution « zéro consommateur » va au gateway, pas à llm-mesh).
- **Contraintes contrat mesh (côté enveloppé, non négociables)** : (1) l'attestation `X-Sentropic-Served:
  provider/model/transport` émise par le gateway **doit traverser le wrapper verbatim** (jamais avalée ni
  fabriquée) ; (2) personal-passthrough / `crossUserPoolEnabled` OFF = déjà le mode v0 du gateway (le besoin geo
  colle au **gateway**, pas à un wrapper qui réimplémenterait la sélection) ; (3) **ne pas redéclarer le routage**
  — le gateway expose `createCanonicalTargetResolver()` / `describeCanonicalTargetRoutes()` ; le wrapper LIT, ne
  recopie pas ; (4) toute évolution de surface llm-mesh/llm-gateway passe par l'adjudication mesh.
- **Reco process mesh (avant tout build)** : owner arbitre dans l'ordre — (a) qui possède `cluster-mesh` ; (b)
  coordonner avec les agents de `tmp/cluster-mesh` (sinon double-écriture) ; (c) acter que le lot = « lever un
  data-plane sentropic », pas « wrapper 2 APIs ». mesh adjuge le contrat + spécifie la surface consommée, **ne
  porte pas le paquet**.

**D-moteur-1 — ROUVERT.** L'owner (« pas assez instruit ») ajoute un **critère décisif** : la **supervision du
scraping doit être exposée via une API geo consommable par immo**. Argo le permet-il sans usine à gaz ? sinon
**DAG-S3 custom** avec **étude SOTA** d'autres libs + **lib publiable réutilisable** (`@sentropic/…`) si custom.
2 passes (sol 5.6 + gemini 3.7) relancées par geo-cond avec ces 3 exigences → re-synthèse → re-AskUserQuestion.
**Ma reco A1 (Argo) devient un input à RÉ-ÉVALUER** contre le critère API-supervision-immo (cf. note geo-archi :
le critère favorise plutôt un DAG-S3 geo-shaped, l'état étant déjà en S3 et déjà servi à immo).

**Seuil pruning** : geo-cond fixe **10 % réversible** par défaut (sauf objection owner).

*(Le corps ci-dessous = l'analyse pré-décision, conservée telle quelle pour audit.)*

---

## 1. Décision demandée

- **D-moteur-1 — Orchestrateur DAG (T5)** : quel moteur exécute les 8 DAGs de refresh sur k8s ?
  `A1 = Argo Workflows` · `A2 = DAG-S3-state maison` (étendre `lib/pv-capture-backlog.ts`).
- **D-moteur-2 — Chemin d'egress LLM** des Jobs geo (comptes enrôlés codex+claude+gemini de l'owner). **Le
  mandat posait « cluster-mesh vs sentropic-sentech » ; la vérification montre que c'est une fausse alternative
  (§2)** → re-cadré en : `G = gateway centrale sentropic (Mode 3, llm.sent-tech.ca)` · `L = in-process
  mesh-direct (Mode 1, sur cluster de l'owner)` · `~M = cluster-mesh` **(RÉFUTÉ, hors décision)**.

**Scope** : infra cross-owner (sentropic/h2a/poc-k8s) ; conditionne netpols, sécurité (creds), ToS, coût,
latence. À trancher **avant l'industrialisation de l'extraction LLM** (lane normes/grilles).

---

## 2. Contexte — faits vérifiés (la vérification a changé le tableau)

**[FAIT]** Les 2 passes **nomment toutes deux Argo** pour D-moteur-1 (`_SOL §A`, `_FABLE §A.4`).

**[FAIT — vérifié 5/5, fichier:ligne]** Sur D-moteur-2, la **réfutation cross-repo de fable est CONFIRMÉE**, et
va plus loin que ce que la synthèse portait :
1. **`@sentropic/cluster-mesh` ne route AUCUN LLM** — contrats de fédération d'**identité/trust/device/
   tenant-boundary** (`cluster-mesh/README.md:1-3,17-35`, `src/mesh.ts:20-34` ; `grep llm|inference|model` sur le
   paquet = **vide**). Le mesh porteur d'inférence est **`llm-mesh`**, un paquet **distinct**. → **« cluster-mesh »
   du mandat = confusion de nommage** entre deux meshes.
2. **`llm-mesh` = control-plane** (enrollment PKCE/keyring) ; **`llm-gateway` = data-plane** ; **zéro consommateur
   applicatif** aujourd'hui ; chemin live = **mesh-direct in-process** (`DECISION_LLM_EGRESS_STANDARD_PATH.md
   §3.1:26-34`).
3. **`push-cluster`** (comptes enrôlés → Secret k8s, le SEUL mécanisme « comptes → Job k8s ») est **supprimé
   SANS remplacement** dans le cutover courant (`h2a/.track/events.jsonl:1180` ; code figé
   `h2a-runtime/src/index.ts:9820`).
4. **`DECISION_LLM_EGRESS_STANDARD_PATH.md` = préconisation Option C split-by-mode** : `caller==provider ⇒
   in-process` ; `cross-user/metered ⇒ gateway` (`:142-146,169`). **Pooling cross-user OFF/fail-closed** par
   défaut, kill-switch `crossUserPoolEnabled` (`:83-92,198-200` ; `llm-gateway/README.md:66-69`).
5. **« sentropic-sentech » ne nomme aucun artefact** (`grep` = vide 2 repos) ; domaine réel = `sent-tech.ca` ;
   lecture cohérente = **gateway centrale Mode 3 `llm.sent-tech.ca`** + control-plane `sentropic.sent-tech.ca`
   (`h2a/apps/llm-gateway/SPEC.md:72-79`).

**[FAIT — conclusion décisive]** **Aucun chemin d'egress LLM mutualisé (batch k8s, hors poste) n'est aujourd'hui
SANCTIONNÉ *et* CÂBLÉ.** Seul mode débloqué = **personal-passthrough** (caller == provider == comptes de l'owner,
sur *un cluster que l'owner possède*), servi **in-process**. La gateway centrale (Mode 3) est la **porte
désignée** pour la classe cluster mais **zéro consommateur / non câblée pour geo**. Le pont `push-cluster`
disparaît **sans successeur**. ⟹ **geo ne peut pas débloquer ce chemin seul : dépendance cross-owner (sentropic/
h2a).**

**[FAIT]** Rien d'industrialisé côté LLM dans **geo** (`git grep llm-mesh` geo = 0) → sunk cost nul.
**[HYPOTHÈSE]** Quota ns geo contraint (~6 pods). **[INCONNUE]** latence/coût gateway vs in-process — non chiffrés.

---

## 3. Enjeux (pourquoi dossier-level)

- **Cross-owner + non-débloquable par geo** : le chemin LLM dépend de sentropic/h2a (livrer la gateway Mode 3
  pour geo, ou un successeur à push-cluster). L'owner doit **séquencer** cette dépendance.
- **Sécurité / ToS gravés** : creds fournisseurs **jamais** dans un pod ; `crossUserPoolEnabled` **OFF**
  (personal-passthrough, comptes de l'owner) ; tokens jamais en argv/logs. Fail-closed.
- **ADR-0029** gravera orchestration + placement → durable, coûteux à réverser.
- **Le mandat repose sur une confusion de nommage** (cluster-mesh) → à lever explicitement avec l'owner.

---

## 4. Options

### 4a. D-moteur-1 — Orchestrateur DAG (T5)

| id | choix | strongest FOR | strongest AGAINST | réversibilité | ce qui le fait gagner |
|---|---|---|---|---|---|
| **A1** | **Argo Workflows** | k8s-natif/déclaratif (`when:`/retry/timeout/sémaphores-quota sans écrire un scheduler) ; artefacts S3 natifs ; install cluster-level poc-k8s ; **chaque nœud reste un Job k8s → repli CronJobs** | 1 composant cluster de plus à opérer ; couplage poc-k8s ; courbe Argo | **haute** (repli CronJobs sans réécrire les nœuds) | les 2 passes le nomment ; le besoin épouse Argo |
| **A2** | **DAG-S3-state maison** (`pv-capture-backlog.ts`) | pattern **déjà éprouvé** ; **zéro dépendance** ; 100 % TS | **réinvente un orchestrateur** (pré-mortem « framework universel ») ; pas de `when`/exit-handlers natifs | moyenne | si Argo indisponible/interdit sur poc-k8s |

**[JUGEMENT] Reco D-moteur-1 = A1 (Argo).** Convergence 2-passes + réversibilité (repli CronJobs) ; la logique
métier reste en TS dans les conteneurs (Argo **n'orchestre que**). A2 seulement si Argo indisponible sur poc-k8s
(**question plateforme à confirmer**).

### 4b. D-moteur-2 — Chemin d'egress LLM *(re-cadré après vérification)*

| id | choix | strongest FOR | strongest AGAINST | statut réel |
|---|---|---|---|---|
| **G** | **Gateway centrale (Mode 3, `llm.sent-tech.ca`)** | **aucun cred dans les pods** (JWT workspace) ; enrollment une fois côté plateforme ; budget/kill-switch/audit centraux ; **porte SANCTIONNÉE** pour la classe cluster (Option C) ; aligne geo au lieu de forker | **zéro consommateur / non câblée pour geo** → **dépendance cross-owner** à livrer ; latence/SLO à prouver | *désignée mais pas live* |
| **L** | **In-process mesh-direct (Mode 1, cluster de l'owner)** | sanctionné pour **personal-passthrough** ; appel local, pas de frontière distante | **exige le keyring enrôlé DANS les pods** — or `push-cluster` (le mécanisme) est **supprimé sans remplacement** | *sanctionné en principe, mécanisme creds retiré* |
| **~M** | **cluster-mesh** | — | **RÉFUTÉ** : ne route aucun LLM (confusion avec llm-mesh) | **hors décision** |

**[JUGEMENT] Reco D-moteur-2** : **cible architecturale = G (gateway centrale Mode 3)** — porte sanctionnée,
posture sécurité la plus propre (zéro cred en pod), alignée Option C. **MAIS elle n'est pas livrée** → la vraie
action owner = **commander à sentropic/h2a le câblage de la gateway pour le workspace geo** (personal-passthrough
JWT). **Intérim borné** jusque-là : nœuds LLM → file d'exception (artefacts CAS) → **inférence locale
lecture-seule sur octets déjà captés** (personal-passthrough, légitime `SPEC_CAPTURE_ON_CLUSTER §4.2`) —
**time-boxé + mesuré** (KPI `appels LLM hors-gateway`, date de bascule), jamais permanent. **Contraintes dures** :
`crossUserPoolEnabled` **OFF** ; tokens jamais en argv/logs ; **cluster-mesh hors du chemin LLM**. **À clarifier
owner** : « cluster-mesh » du mandat = confusion de nommage (le mesh LLM est `llm-mesh`).

### 4c. Interaction des 2 décisions

**[JUGEMENT]** Décisions **largement indépendantes** : Argo (ou le maison) orchestre ; le nœud LLM appelle G (ou
l'intérim) via garde `when:`, **sans que l'orchestrateur dépende du chemin LLM**. Seule interaction = **cohérence
« plateforme-managée »** : `A1 (Argo) + G (gateway)` minimisent ce que geo **opère** et **détient comme secrets**
(poc-k8s gère Argo ; sentropic gère la gateway ; geo ne détient aucun cred) = quadrant cohérent recommandé. Le
quadrant « tout-maison-in-cluster » suppose un mécanisme creds in-cluster **qui n'existe plus** → non recommandé.

---

## 5. Recommandation + rationale

- **D-moteur-1 = A1 (Argo)** — convergence + réversibilité + métier hors du moteur. *À confirmer : Argo sur poc-k8s.*
- **D-moteur-2 = cibler G (gateway Mode 3)** comme chemin sanctionné durable, **+ commander sa livraison à
  sentropic/h2a** (dépendance cross-owner), **+ intérim local borné/mesuré**. **Rejeter le cadrage « cluster-mesh »**
  (confusion vérifiée) ; `crossUserPoolEnabled` reste OFF. Rationale décisive : la vérification (5/5) montre que
  cluster-mesh ne route pas de LLM et que la gateway est la porte sanctionnée **mais non-livrée** — donc D-moteur-2
  n'est **pas** un choix d'implémentation geo, c'est un **arbitrage de dépendance plateforme** que seul l'owner
  peut séquencer.

---

## 6. Réversibilité / coût

- **A1** réversible (repli CronJobs). **G** : le nœud LLM bascule intérim→gateway **sans changer le DAG**.
  **Intérim local** : borné, mesuré, à date de bascule. **Sunk cost LLM geo = nul**.
- **Coût principal = calendrier de dépendance** (quand sentropic livre la gateway pour geo), pas du code geo.

---

## 7. Attendus (critères owner)

| critère | source (vérifiée) | couvert par | gap |
|---|---|---|---|
| Zéro cred fournisseur dans un pod | Option C ; `llm-gateway/README.md:10-13` | **G** (JWT) | **L** échoue (creds-in-pod, push-cluster retiré) |
| `crossUserPoolEnabled` OFF (ToS) | `DECISION §3.5:83-92,§7:198-200` | condition dure G+L | — |
| LLM piloté par le DAG | §A.1 | nœud gated `when:` | — |
| Tout sur k8s | §A.4 | Argo + nœud LLM (gateway/intérim) | intérim local hors cluster, **borné** |
| Chemin sanctionné *et* disponible | vérification §A | **aucun aujourd'hui** → dépendance | **owner doit commander la gateway** |
| Réversibilité | harness | A1 (CronJobs) ; G (bascule sans changer le DAG) | — |

---

## 8. Ce dont j'ai besoin de l'owner (plus petite décision valide)

1. **D-moteur-1** : ratifier **A1 (Argo)** — ou A2 si contrainte poc-k8s connue.
2. **D-moteur-2** : ratifier **« cible = gateway centrale Mode 3, intérim local borné, cluster-mesh écarté »**,
   ET **autoriser la commande cross-owner** à sentropic/h2a (câbler la gateway pour geo, ou fournir un successeur
   sanctionné à push-cluster). Confirmer `crossUserPoolEnabled` **OFF**. **Acter que « cluster-mesh » était une
   confusion de nommage.** (Ou **déférer** en attendant un chiffrage/roadmap plateforme.)
3. Graver **ADR-0029** (orchestration + egress LLM) **après** ces choix, pas avant.

---

## SELF-AUDIT (present-decision gate)

- **FACT/JUGEMENT** tagués. **D-moteur-1 ET D-moteur-2 COMPLETS** — les [FAIT]s cross-repo **re-vérifiés
  indépendamment (5/5, fichier:ligne)**, aucun [VERIF] pendant.
- **Count-symmetry** : A1/A2 équilibrés ; G/L présentent chacun leur FOR réel et leur AGAINST factuel ; ~M
  honnêtement marqué réfuté avec sa raison, pas caché.
- **Strongest-case-AGAINST ma reco** : *contre A1* = 1 composant cluster de plus + couplage poc-k8s ; un besoin
  trivial ne le justifierait pas. *Contre « cibler G »* = on recommande un chemin **non encore livré** → dépendance
  calendaire ; si sentropic tarde, l'**intérim local risque de s'installer en prod de fait** (LLM durablement hors
  chemin sanctionné) — vrai risque, adressé par le time-box + le KPI.
- **Ce qui renverserait la reco** : Argo interdit sur poc-k8s ; OU sentropic livre un successeur in-cluster propre
  à push-cluster (**L** redevient viable et plus souverain) ; OU la gateway Mode 3 trop lente/chère au chiffrage.
- **Pré-mortem (6 mois)** : « la gateway n'a jamais été câblée pour geo, l'intérim local est devenu la prod, le
  LLM tourne hors chemin sanctionné, personne ne mesure » → antidotes : intérim **borné + daté**, KPI `appels LLM
  hors-gateway` au portfolio, commande gateway **dans le premier lot** de la lane normes.
- **Agent-interest (divulgation)** : *le plus facile POUR MOI (geo-archi)* aurait été de **relayer** le « penche
  vers service central » de la synthèse sans vérifier — je l'ai **refusé** (vérification lancée), elle a changé le
  tableau (ni cluster-mesh, ni « gateway dispo » : une **dépendance non-livrée**). Recommander « cible la
  plateforme » me décharge d'un design LLM in-cluster côté geo — **mais** je signale explicitement le coût caché
  (dépendance calendaire + risque d'intérim permanent) = l'**intérêt owner** (chemin sanctionné réel, ToS respecté,
  optionalité, pas de dérive hors-gateway). Le dossier ne **vend** pas G : il montre que G est la cible propre
  **conditionnée à une livraison que l'owner doit commander**.
