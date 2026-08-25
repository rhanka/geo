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
  PLEIN + relecture-store + Q-CRYPTO). Le field-check RÉUTILISE les checks PARTAGÉS single-source
  (`assertSharedCampaignOwnerGoFields`, drift-proof) + dispatch sur `via` (`geo-cond` / `direct-session-chat`,
  énum FERMÉ fail-closed ; provenance REQUISE PAR MODE — §7.5) ; **seul** `crossVerifyOwnerGoInStore`
  (la relecture-store) est sauté.
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
owner-go depuis SON inbox h2a (file-channel host-writable, enveloppes non signées — §7.1), le copie
verbatim dans un fichier, puis lance le Job qui
le passe au runner via `--lane-gated-capture --owner-go-artifact <path>`. Le runner
(`assertLaneGatedCaptureAuthorized`) **RÉUTILISE `assertClaimedArtefact`** (les MÊMES field-checks que
le firewall plein — contract, role, via, `design_sha256` binding [CA-G6], `scope=capture`, bucket,
`h2a_*` REQUIS) + CA-G2 ; il **saute UNIQUEMENT** `crossVerifyOwnerGoInStore` (la relecture-store).

### 7.1 ⚠ L'ancre anti-forge est PROCÉDURALE, PAS cryptographique (décision contract explicite)

Le runner field-check un FICHIER + recalcule le design_sha. **Ni le field-check ni le design_sha ne
sont anti-forge** : le `design_sha256` est self-référentiel (il bloque la SUBSTITUTION-DE-PLAN vs un
artefact genuine, PAS la forge d'un artefact ad hoc). Quiconque peut écrire `--owner-go-artifact` +
connaît `method`/`targets`/`runner_git_sha` peut forger un artefact qui PASSE. La
**non-forgeabilité/acceptabilité EFFECTIVE** repose sur **DEUX contrôles** (PAS sur une relecture-store
cryptographique, absente ; **PAS sur l'inbox-verify** — voir plus bas, ce n'est qu'un contrôle
d'audit-trace) :

1. **Frontière RBAC de lancement** : le kubeconfig OVH est **k8s-SEUL** ; `assertDeclaredCluster`
   borne le cluster/namespace. La capacité de forger l'owner-go ≡ la capacité de lancer sur le
   cluster ≡ déjà dans la TCB cluster ⟹ **pas d'élargissement** de la surface au-delà de
   « compromis k8s ».
2. **Belt egress C2 ENFORCÉ** (CA-G9 ; **MESURÉ enforcé** — CNI Calico-Felix, probe témoin :
   kube-API + `169.254.169.254` métadonnée **BLOQUÉS**, externe + DNS préservés ; evidence
   `capture-C2-cni-enforcement-evidence-20260825.txt`) : une forge est **BORNÉE à « capture externe
   additive »** — pas de SSRF→vol-creds-métadonnée→compromis total.

**Le cross-check inbox n'est PAS un de ces contrôles — c'est de l'AUDIT-TRACE / PROVENANCE (type B).**
k8s lit l'owner-go depuis SON inbox h2a (**gaté sur mesh-UP** : mesh down → k8s ne lance PAS),
cross-check `h2a_envelope_id == le message inbox qu'il a copié` + enregistre l'enveloppe (trace C3
`[capture-orch] … h2a_envelope_id=…`). ⚠ **MESURÉ (pv + k8s)** : l'inbox est un **répertoire local
host-writable** (`drwxrwxr-x` — tout process de l'uid y écrit, = l'accès requis pour écrire
`--owner-go-artifact`) et les enveloppes sont du **JSON NON signé** (aucune signature/hmac/pubkey) —
donc **PAS crypto-authentifié**. ⟹ un adversaire host-compromis écrit **LES DEUX** (fausse enveloppe +
artefact la référençant) → le check les accepte (rien ne distingue real/forgé) : **audit-trace +
hausse-de-barre, PAS anti-forge dur.** **Valeur résiduelle (honnête)** : force la cohérence de
provenance (artefact ⟶ vraie enveloppe inbox) ⟹ attrape l'erreur ACCIDENTELLE + une forge
relais-message-only SANS accès-host, PAS un host-compromis.

> **(A) anti-forge-dur (futur, HORS SCOPE)** : atteindre une ancre inbox non-forgeable exigerait des
> **enveloppes mesh SIGNÉES au dépôt (clé OWNER)** + la **vérif d'une pubkey mesh de confiance** au
> check-0 (pas un simple JSON host-writable). À traiter avec le durcissement h2a (mcp), hors campagne.

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

- **C1** — frontière RBAC de lancement (kubeconfig k8s-seul, contrôle DUR) + discipline executor de
  provenance ÉVIDENCÉE, PAR MODE (audit-trace, PAS anti-forge) : lane-B = vérif-inbox gatée mesh-UP
  (§7.1) ; lane-A = go owner comme tour-user dans la session exécutante (§7.5).
- **C2 / CA-G9** — belt egress SSRF ENFORCÉ, re-probé au go sur le vrai label (fail-closed
  by-construction = fast-follow).
- **C3** — la trace de preuve capture la provenance PAR MODE : `h2a_envelope_id` (lane-B) OU
  `executor_session`/`received_at` (lane-A) — §7.1 / §7.5.
- **C4** — l'owner accepte SCIEMMENT l'ancre PROCÉDURALE (informed consent : « anti-forge = RBAC
  procédural + belt C2, PAS crypto ; borné additif/réversible »), pas seulement « chemin relaxé ».
- **CA-G8** — mode capture-only : un artefact de scope write → REFUS DUR (test).

### 7.4 Chemin par défaut INCHANGÉ

Sans `--lane-gated-capture`, le runner emprunte le firewall PLEIN (`assertCaptureStoreAuthorized`,
relecture-store, refuse-par-construction) — byte-inchangé. Le mode lane-gated est un branchement
explicite, jamais le défaut.

### 7.5 Deux modes de provenance (dispatch sur `via`, énum FERMÉ)

Le canal par lequel l'owner-go atteint k8s est vérifié PAR MODE (`assertLaneGatedCaptureAuthorized`
dispatch sur `via` ; un `via` inconnu → **REFUS fail-closed**, cond-3). Les checks PARTAGÉS
(contract / role / `design_sha256`-binding / scope / bucket / instances) sont **single-source**
(`assertSharedCampaignOwnerGoFields`, réutilisé par le firewall PLEIN + les deux lanes — drift-proof,
reçoit Q-CRYPTO). Seule la **provenance** diffère, chaque mode avec ses champs **REQUIS** (jamais
optionnels-pour-tous — sinon régression F2) :

- **`via=geo-cond` (lane-B)** — dépôt **h2a-inbox** : `h2a_envelope_id` / `h2a_session_id` REQUIS. La
  provenance = le cross-check inbox de k8s (audit-trace (B), host-writable / non-signé — §7.1).
- **`via=direct-session-chat` (lane-A)** — l'owner donne son go **comme tour-user DANS la session
  EXÉCUTANTE (k8s)**, comme pour scw/R2 (canal PROUVÉ). Champs REQUIS : `executor_session` (la session
  k8s), `received_at`, `owner_go_text` (le VERBATIM du go owner, jamais fabriqué). **cond-1** :
  `owner_go_text` doit **RÉFÉRENCER le design_sha S** attendu (le go autorise LE PLAN S, esprit CA-G6 —
  pas un « go capture » liable à n'importe quel S ; le runner exige `owner_go_text.includes(S)`).

**Provenance path-A ≥ path-B** : un VRAI tour-user owner dans la session exécutante (canal session
authentifié + transcript verbatim recoupable) est un meilleur ancrage d'audit qu'un fichier inbox
host-writable non-signé, et c'est **anti-laundering plus propre** (owner→executor DIRECT, zéro relais
mesh, zéro fichier host-writable comme SOURCE). **Mais les DEUX restent de la PROVENANCE / AUDIT-TRACE,
PAS de l'anti-forge** : sous host-compromis, le forgeur écrit le fichier `--owner-go-artifact` dans les
deux cas → même honnêteté qu'en §7.1. Les contrôles DURS (RBAC + belt + `design_sha`-binding + additif)
sont IDENTIQUES et INCHANGÉS. `via=direct-session-chat` = **capture lane-gated SEULEMENT** ; jamais un
write (CA-G8 refuse le scope write pour LES DEUX via).

**Discipline executor path-A (fail-closed, cond-5)** : k8s écrit l'artefact owner-go UNIQUEMENT depuis
un go owner arrivé comme **VRAI tour-user dans SA session** (comme scw/R2) ; le `design_sha256` écrit ==
le **X** que pv confirme ; `owner_go_text` = **copie VERBATIM** (jamais fabriqué) référençant S ; champ
manquant / pas-de-go-in-session → **REFUS + RECORD durable**. Un fire sans go owner réel devient ainsi
détectable. (Le SPEC executor de k8s `capture-direct-chat-ownergo-spec` porte ce gate côté k8s.)

**(A) anti-forge-dur (futur, HORS SCOPE)** — inchangé §7.1 : enveloppes mesh SIGNÉES + pubkey de
confiance (path-B) ; pour path-A, une attestation crypto de la session exécutante. Hors campagne.
