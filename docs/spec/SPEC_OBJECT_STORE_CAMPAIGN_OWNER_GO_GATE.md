# SPEC — Gate owner-go de la campagne object-store (par construction, par l'exécutant) — v2

v2 = incorpore la revue CONTRAT geo-archi (2 trous firewall fermés : CA-G7 re-key copy-only +
préimage `design_sha256` canonique ; + réutilisation explicite, priorité crypto, CA-G1 scope-mismatch)
et la correction de périmètre (write-runners = domaine GEO, pas poc-k8s).

Gate d'autorisation des ÉCRITURES IRRÉVERSIBLES de la campagne object-store tout-geo (captures pv
cluster + writes `sentropic-geo` : re-key + legacy-merge). **Mirror** du pattern Model A L4
(`assertOwnerGoInH2a`) mais **gate NEUF** (contrat `object-store-campaign-owner-go/v1`) — **pas** de
refacto du module #258 partagé (isolement campagne ↔ Model A / Q-CRYPTO-HARDEN).

Principe : **l'EXÉCUTANT (le runner) vérifie l'artefact owner-go LUI-MÊME, PAR CONSTRUCTION, et
REFUSE d'écrire/capter sans.** Un relais conducteur (« l'owner a dit go ») ne satisfait JAMAIS le
gate. Field-bound sur reader h2a injecté (comme L4) — PAS crypto-signé.
⚠ Comme ce gate est LE **firewall** de la campagne (enjeu > Model A), **Q-CRYPTO-HARDEN (durcir le
field-bound en vérif de signature) y est PLUS PRIORITAIRE que sur Model A** — à noter dans le
séquençage owner (lot distinct, §2.3-pt6 du doc-model, hors campagne mais prioritaire ici).

## 1. Artefact owner-go — `object-store-campaign-owner-go/v1`

Enveloppe h2a émise **DIRECTEMENT par l'owner** (session geo-cond), liée au design revu :
- `contract` = littéral `"object-store-campaign-owner-go/v1"`
- `actor.role` = littéral `"OWNER"` (signé OWNER, PAS geo-cond)
- `via` = littéral `"geo-cond"` (convoyé, pas autorisé, par geo-cond)
- `owner_go_direct` = littéral `true`
- `design_sha256` = sha256 du **PLAN D'EXÉCUTION RÉSOLU canonique** (§1.1), PAS un manifeste
  découplé — `/^sha256:[0-9a-f]{64}$/`
- `scope` = énum `"capture" | "write-rekey" | "write-legacy-merge"` (une émission par périmètre ;
  un go capture n'autorise pas un write, ni l'inverse)
- `bucket` = littéral `"sentropic-geo"`
- `owner_instance`, `geo_cond_instance`, `h2a_envelope_id`, `h2a_session_id` = non vides

### 1.1 Préimage canonique de `design_sha256` (le binding ne vaut QUE par sa préimage)

`design_sha256 = sha256(canonicalJSON(plan))` où `plan` = objet `campaign-execution-plan/v1` :

```
{ "contract": "campaign-execution-plan/v1",
  "scope": "capture" | "write-rekey" | "write-legacy-merge",
  "bucket": "sentropic-geo",
  "runner_git_sha": "<40-hex>",   // commit du checkout DÉPLOYÉ (code complet: lib+wrapper+hardening, deploy-pin/scope)
  "method": { ... },              // params méthode (tag legacy-merge ; mapping re-key)
  "targets": [ ... ] }            // les CIBLES EXACTES, TRIÉES (clés/objets à écrire)
```

- `canonicalJSON` = clés triées, sérialisation déterministe (aucun espace superflu).
- Le runner **RECALCULE** `design_sha256` sur SON plan résolu RÉEL (les cibles qu'il va
  effectivement écrire + son `runner_git_sha`) AVANT d'écrire, et exige l'égalité avec l'artefact.
  ⟹ l'owner autorise le plan RÉELLEMENT EXÉCUTÉ (**code + méthode + CIBLES**), pas un manifeste
  découplé qu'un runner hasherait en exécutant autre chose.
- **`runner_git_sha` = le commit du checkout DÉPLOYÉ** (`git rev-parse HEAD` du pod qui exécute),
  i.e. le **code COMPLET** qui tourne : lib-runner **+ wrapper cluster + hardening** — pas le seul
  commit d'une lib. Nommer un sous-ensemble alors qu'un wrapper d'un AUTRE commit choisit les cibles
  ou alimente les octets serait un **vert-par-omission sur la provenance** (la preuve attesterait un
  code incomplet), et laisserait l'owner autoriser du code AVANT ses garde-fous de sûreté (p.ex. un
  plancher CAP large-object livré par un PR de hardening ultérieur). ⟹ le `design_sha256` se **fige
  au DEPLOY-PIN par scope** (le commit épinglé incluant le wrapper + tout hardening) ; l'owner émet
  le go APRÈS ce pin. Un `design_sha256` **draft** (calculé avec le seul commit lib) est admis pour
  lancer la **revue ≥2-pairs anticipée**, mais l'**owner-go LIANT est recalculé au deploy-pin et
  re-vérifié avant émission** — un draft ne lie jamais un run.
- Le **SHA-design** remis à l'owner (post-revue ≥2-pairs) = ce même `sha256(canonicalJSON(plan))`.

## 2. Vérification — `assertObjectStoreCampaignOwnerGo(envelope, expected, readEnvelope, readSession)`

Appelée par le runner AVANT toute capture/écriture ; **throw** (refus) si un seul point échoue :
1. `envelope.contract === "object-store-campaign-owner-go/v1"`
2. `actor.role === "OWNER"` (relais geo-cond insuffisant)
3. `via === "geo-cond"` ∧ `owner_go_direct === true`
4. **`design_sha256 === expected.designSha256`** = le sha que le runner recalcule sur SON plan
   résolu réel (§1.1) → l'owner autorise CE plan exact (cibles incluses), pas un blanc-seing.
5. `scope === expected.scope` (l'action du runner) — **scope mismatch → throw**
6. `bucket === "sentropic-geo"`
7. `readSession(h2a_session_id).state ∈ {live, closed, draining}`
8. **Lecture via `readEnvelope`/`readSession` INJECTÉS** (depuis le store h2a) — jamais depuis un
   message conducteur. Le runner lit l'artefact lui-même.

## 2.1 Réutilisation / rejeu (EXPLICITE — pas silencieux)

L'artefact est **design-bound** (`design_sha256`) et la campagne **idempotente-additive** (re-key
copy-only + legacy-merge additif-taggé → re-run = même résultat additif). ⟹ un go émis est
**RÉUTILISABLE pour le même `(design_sha256, scope)`** — INTENTIONNEL (re-run sûr, idempotent). Un
changement de design (cibles/méthode/code) ⇒ nouveau `design_sha256` ⇒ le go ne matche plus ⇒
nouveau go requis. Pas d'expiry silencieux. **Option stricte (decide owner/geo-cond)** : ajouter un
`run_id` nonce à l'artefact + le runner enregistre les run_ids consommés (single-use) — si un go
single-use est préféré au design-bound-idempotent.

## 3. Gate par runner (bâti DEDANS, par construction)

- **Capture-runner (pv, adapte `k8s-capture-run.ts`)** : avant `store:true`, asserter
  (a) `CaptureRunHeader.execution === "cluster"` ET (b) l'artefact (`scope="capture"`). **JAMAIS
  local**. Preuve-v2 par construction (`captureProofFields`).
- **Write-runners (re-key + legacy-merge) — DOMAINE GEO, bâtis par geo-socle** (poc-k8s = ops
  cluster IMMO ; il n'écrit PAS `sentropic-geo` et ne bâtit PAS ces runners) ; exécutés en Job
  cluster sous owner-go. Avant toute écriture `sentropic-geo`, asserter l'artefact
  (`scope="write-rekey"` / `"write-legacy-merge"`).
  - **legacy-merge = ADDITIF-TAGGÉ** : nouveaux objets taggés, JAMAIS drop/écrase un existant.
  - **re-key = COPY-ONLY** : copie vers la nouvelle clé ; NE SUPPRIME NI n'écrase l'ancienne (la
    suppression = étape DESTRUCTIVE hors campagne, owner-gated séparément, jamais sous `write-rekey`).

## 4. Critères d'acceptation (vérifiés en revue ≥2-pairs)

- **CA-G1 — gate PAR CONSTRUCTION** : le runner refuse de capter/écrire sans artefact valide.
  Tests : pas d'artefact → throw ; `design_sha256` faux → throw ; `actor.role≠OWNER` → throw ;
  **scope mismatch (capture-go sur un write, ou l'inverse) → throw** ; message-relais ≠ artefact.
- **CA-G2 — JAMAIS local** : `store:true` exige `execution==="cluster"`.
- **CA-G3 — legacy-merge ADDITIF-TAGGÉ, JAMAIS drop** : objets existants inchangés ; seuls de
  nouveaux objets taggés ajoutés (test byte-pour-byte).
- **CA-G7 — re-key COPY-ONLY** (symétrique de CA-G3) : le re-key NE SUPPRIME NI n'écrase JAMAIS
  l'ancienne clé ; test byte-pour-byte : après re-key, l'ancienne clé existe INCHANGÉE. Une
  suppression = destructif hors campagne (jamais sous `scope="write-rekey"`).
- **CA-G4 — SCW intacte** : aucune écriture/suppression SCW.
- **CA-G5 — proof-v2 par construction** (captures) : `captureProofFields` passe sur chaque ligne.
- **CA-G6 — binding design_sha** : l'artefact n'autorise QUE le plan résolu canonique (§1.1),
  cibles incluses ; un changement de design ⇒ re-revue + nouvel artefact.
- **CA-G8 — mode lane-gated capture-only (ancre PROCÉDURALE, capture additive SEULEMENT)** :
  voir §7. `--lane-gated-capture` ne débloque QUE `scope="capture"` ; un artefact de scope write
  → **REFUS DUR** (test `scope=write-rekey → throw`). Les writes ne sont JAMAIS lane-gated (firewall
  PLEIN + relecture-store + Q-CRYPTO). Le field-check RÉUTILISE `assertClaimedArtefact` (single-source,
  drift-proof, h2a_* REQUIS) ; **seul** `crossVerifyOwnerGoInStore` (la relecture-store) est sauté.
- **CA-G9 — belt egress C2 ENFORCÉ au go** (l'ancre étant PROCÉDURALE, le belt est LOAD-BEARING :
  il borne une forge à « capture externe additive » au lieu de SSRF→169.254 métadonnée). **Ce mode** :
  k8s **re-probe l'enforcement au go** sur le vrai label `app:geo-capture`, ÉVIDENCÉ (kubectl),
  AVANT launch — un belt non-enforçant (CNI sans egress) = **NO-GO**. **Fast-follow** (durcissement
  by-construction, re-flaggé le moment venu) : init-container self-probe dans le `jobManifest` (MÊME
  pod, sous le belt, image = digest capture PINNÉ → `method.image` stable) qui fail-close le pod si
  `169.254.169.254` / une IP RFC1918 est joignable — « belt live » garanti par construction.

## 5. Frontière (ce que ce gate N'AUTORISE PAS)

Le **repoint immo→geo**, l'**éradication SCW**, et la **suppression d'ancienne clé re-key** =
DESTRUCTIFS → restent owner-gated SÉPARÉMENT (mot direct owner distinct), **jamais** autorisés par
l'artefact de CETTE campagne (non-destructive reconciliation). L'énum `scope` EXCLUT tout scope
destructif par construction.

## 6. Flux

1. geo-socle bâtit les write-runners ; pv bâtit le capture-runner — CONTRE ce spec (gate dedans,
   tests CA-G1..G7).
2. Revue ≥2-pairs (geo-archi + adversarial) → **SHA-design** = `sha256(canonicalJSON(plan))` (§1.1).
3. L'owner émet l'artefact `object-store-campaign-owner-go/v1` (DIRECT session geo-cond, lié au
   SHA-design), par scope.
4. Le runner VÉRIFIE l'artefact par construction → capture/écriture fire.
5. Rien ne fire sur (a) revue non-verte OU (b) artefact non vérifié par l'exécutant.

## 7. Mode lane-gated capture (CA-G8) — ancre PROCÉDURALE, capture additive SEULEMENT

Chemin de fire PROPORTIONNÉ pour la **capture ADDITIVE** (create-once proof-v2) quand le
reader-store-NHI (§2 pt 8, la relecture crypto du store) n'est pas provisionné (bottleneck de
provision). L'autorisation est **relocalisée au LANE EXÉCUTANT (k8s)** : k8s lit+vérifie l'artefact
owner-go depuis SON inbox h2a authentifié, le copie verbatim dans un fichier, puis lance le Job qui
le passe au runner via `--lane-gated-capture --owner-go-artifact <path>`. Le runner
(`assertLaneGatedCaptureAuthorized`) **RÉUTILISE `assertClaimedArtefact`** (les MÊMES field-checks que
le firewall plein — contract, role, via, `design_sha256` binding [CA-G6], `scope=capture`, bucket,
`h2a_*` REQUIS) + CA-G2 ; il **saute UNIQUEMENT** `crossVerifyOwnerGoInStore` (la relecture-store).

### 7.1 ⚠ L'ancre anti-forge est PROCÉDURALE, PAS cryptographique (décision contract explicite)

Le runner field-check un FICHIER + recalcule le design_sha. **Ni le field-check ni le design_sha ne
sont anti-forge** : le `design_sha256` est self-référentiel (il bloque la SUBSTITUTION-DE-PLAN vs un
artefact genuine, PAS la forge d'un artefact ad hoc). Quiconque peut écrire `--owner-go-artifact` +
connaît `method`/`targets`/`runner_git_sha` peut forger un artefact qui PASSE. La non-forgeabilité
repose donc sur des contrôles PROCÉDURAUX/opérationnels, PAS sur une relecture-store cryptographique :

1. **k8s lit+vérifie l'owner-go depuis SON inbox h2a authentifié** puis le copie verbatim (runbook,
   **gaté sur mesh-UP** : mesh h2a down → k8s ne peut PAS vérifier → ne DOIT PAS lancer). k8s
   **cross-check `h2a_envelope_id == le message inbox qu'il a copié`** et **enregistre l'enveloppe
   vérifiée** (preuve C3, trace `[capture-orch] … h2a_envelope_id=…`) — un fire sans vérif réelle
   devient détectable.
2. **Frontière RBAC de lancement** : le kubeconfig OVH est **k8s-SEUL** ; `assertDeclaredCluster`
   borne le cluster/namespace. La capacité de forge ≡ la capacité de lancer sur le cluster ≡ déjà
   dans la TCB cluster ⟹ **pas d'élargissement** de la surface au-delà de « compromis k8s ».
3. **Belt egress C2 ENFORCÉ** (CA-G9) : une forge est BORNÉE à « capture externe additive » (deny
   RFC1918 + 169.254 métadonnée) — pas de SSRF→vol-creds-métadonnée→compromis total.

### 7.2 Risque résiduel + périmètre de la décision

**Risque résiduel** : un détenteur d'accès-launch-cluster connaissant method/targets/git-sha peut
diriger la capture vers des cibles arbitraires (bornées externes-additives par C2). C'est une
**dégradation** de l'ancre (crypto store-reread → procédural) — ACCEPTÉE par **décision contract
geo-archi (≥2-pairs)** pour la **capture ADDITIVE/create-once/RÉVERSIBLE SEULEMENT** : la forge
n'élargit pas la TCB (pt 2), l'effet est borné (pt 3) et réversible (create-once, aucun objet
existant touché). **Les scopes d'ÉCRITURE (write-rekey / write-legacy-merge) ne sont JAMAIS
lane-gated** — ils gardent le firewall PLEIN (relecture-store §2 pt 8) + Q-CRYPTO. C'est le
**graduated-by-stakes** appliqué au firewall lui-même : on relâche l'ancre à proportion de l'enjeu
(additif réversible), jamais pour l'irréversible.

### 7.3 Contrôles compensatoires (tous requis avant fire)

- **C1** — frontière RBAC de lancement (kubeconfig k8s-seul) + runbook gaté sur mesh-UP + inbox-verify
  RÉUSSI, ÉVIDENCÉ (§7.1 pt 1).
- **C2 / CA-G9** — belt egress SSRF ENFORCÉ, re-probé au go sur le vrai label (fail-closed
  by-construction = fast-follow).
- **C3** — la trace de preuve capture le `h2a_envelope_id` vérifié (§7.1 pt 1).
- **C4** — l'owner accepte SCIEMMENT l'ancre PROCÉDURALE (informed consent : « anti-forge = RBAC
  procédural + belt C2, PAS crypto ; borné additif/réversible »), pas seulement « chemin relaxé ».
- **CA-G8** — mode capture-only : un artefact de scope write → REFUS DUR (test).

### 7.4 Chemin par défaut INCHANGÉ

Sans `--lane-gated-capture`, le runner emprunte le firewall PLEIN (`assertCaptureStoreAuthorized`,
relecture-store, refuse-par-construction) — byte-inchangé. Le mode lane-gated est un branchement
explicite, jamais le défaut.
