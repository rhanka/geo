# SPEC — Gate owner-go de la campagne object-store (par construction, par l'exécutant)

Le gate d'autorisation des ÉCRITURES IRRÉVERSIBLES de la campagne object-store tout-geo
(captures pv cluster + writes `sentropic-geo` : re-key + legacy-merge). **Mirror** du pattern
Model A L4 (`assertOwnerGoInH2a`) mais **gate NEUF** (contrat `object-store-campaign-owner-go/v1`) —
**pas** de refacto du module #258 partagé (isolement campagne ↔ Model A/Q-CRYPTO-HARDEN).

Principe : **l'EXÉCUTANT (le runner) vérifie l'artefact owner-go LUI-MÊME, PAR CONSTRUCTION,
et REFUSE d'écrire/capter sans.** Un relais conducteur (« l'owner a dit go ») ne satisfait
JAMAIS le gate. Field-bound sur reader h2a injecté (comme L4) — PAS crypto-signé (le
durcissement crypto = **Q-CRYPTO-HARDEN**, lot owner distinct, §2.3-pt6 du doc-model, pas ici).

## 1. Artefact owner-go — `object-store-campaign-owner-go/v1`

Enveloppe h2a émise **DIRECTEMENT par l'owner** (dans la session geo-cond), liée au design revu :

- `contract`  = littéral `"object-store-campaign-owner-go/v1"`
- `actor.role` = littéral `"OWNER"` (signé OWNER, PAS geo-cond)
- `via`        = littéral `"geo-cond"` (convoyé, pas autorisé, par geo-cond)
- `owner_go_direct` = littéral `true`
- `design_sha256`   = sha256 du **design revu** (contenu de la branch/PR des runners que la
  revue ≥2-pairs a approuvé) — `/^sha256:[0-9a-f]{64}$/`
- `scope`      = énum `"capture" | "write-rekey" | "write-legacy-merge"` (une émission par
  périmètre d'action ; un go capture n'autorise pas un write)
- `bucket`     = littéral `"sentropic-geo"`
- `owner_instance`, `geo_cond_instance`, `h2a_envelope_id`, `h2a_session_id` = non vides

## 2. Vérification — `assertObjectStoreCampaignOwnerGo(envelope, expected, readEnvelope, readSession)`

Appelée par le runner AVANT toute capture/écriture ; **throw** (refus) si un seul point échoue :

1. `envelope.contract === "object-store-campaign-owner-go/v1"`
2. `actor.role === "OWNER"` — l'OWNER a signé (relais geo-cond insuffisant)
3. `via === "geo-cond"` ∧ `owner_go_direct === true`
4. **`design_sha256 === expected.designSha256`** où `expected.designSha256` = le sha256 que le
   runner recalcule sur SON PROPRE design/plan → l'owner autorise CE design exact, pas un
   blanc-seing ; un design modifié ⇒ re-revue + nouvel artefact.
5. `scope === expected.scope` (l'action du runner : capture | write-rekey | write-legacy-merge)
6. `bucket === "sentropic-geo"`
7. `readSession(h2a_session_id).state ∈ {live, closed, draining}`
8. **Lecture via `readEnvelope`/`readSession` INJECTÉS** (depuis le store h2a) — jamais depuis
   un message conducteur. Le runner lit l'artefact lui-même.

Field-bound (mirror L4) : l'authenticité est déléguée au store h2a + aux readers injectés ; le
durcissement en vérif de signature = Q-CRYPTO-HARDEN, hors campagne.

## 3. Gate par runner (bâti DEDANS, par construction)

- **Capture-runner (pv, adapte `k8s-capture-run.ts`)** : avant `store:true`, asserter
  (a) `CaptureRunHeader.execution === "cluster"` **ET** (b) l'artefact (`scope="capture"`).
  **JAMAIS local** (execution=cluster only). Preuve-v2 par construction (`captureProofFields`).
- **Write-runners (k8s : re-key + legacy-merge)** : avant toute écriture `sentropic-geo`,
  asserter l'artefact (`scope="write-rekey"` / `"write-legacy-merge"`).
  - **legacy-merge = ADDITIF-TAGGÉ** : écrit de NOUVEAUX objets taggés, ne **DROP** ni
    n'écrase JAMAIS un objet existant.
  - **re-key = additif** (copie vers la nouvelle clé) ; la suppression éventuelle de l'ancienne
    clé = étape DESTRUCTIVE **hors campagne**, owner-gated séparément.

## 4. Critères d'acceptation (vérifiés en revue ≥2-pairs)

- **CA-G1 — gate PAR CONSTRUCTION** : le runner refuse de capter/écrire sans artefact valide.
  Tests : pas d'artefact → throw ; `design_sha256` faux → throw ; `actor.role≠OWNER` → throw ;
  un message-relais ≠ un artefact (non accepté).
- **CA-G2 — JAMAIS local** : `store:true` exige `execution==="cluster"`.
- **CA-G3 — legacy-merge ADDITIF-TAGGÉ, JAMAIS drop** : objets existants inchangés ; seuls de
  nouveaux objets taggés ajoutés (test byte-pour-byte sur un fixture).
- **CA-G4 — SCW intacte** : aucune écriture/suppression SCW ; l'éradication SCW = hors campagne,
  owner-gated séparément.
- **CA-G5 — proof-v2 par construction** (captures) : `captureProofFields` passe sur chaque ligne.
- **CA-G6 — binding design_sha** : l'artefact n'autorise QUE le design revu ; un changement de
  design ⇒ re-revue + nouvel artefact.

## 5. Frontière (ce que ce gate N'AUTORISE PAS)

Le **repoint immo→geo** et l'**éradication SCW** = DESTRUCTIFS → restent owner-gated
SÉPARÉMENT (mot direct owner distinct), **jamais** autorisés par l'artefact de CETTE campagne
(non-destructive reconciliation).

## 6. Flux

1. pv/k8s bâtissent les runners CONTRE ce spec (gate dedans, tests CA-G1..G6).
2. Revue ≥2-pairs (geo-archi + adversarial) → **SHA-design** (sha du contenu revu).
3. L'owner émet l'artefact `object-store-campaign-owner-go/v1` (DIRECT session geo-cond, lié au
   SHA-design), par scope.
4. Le runner VÉRIFIE l'artefact par construction → capture/écriture fire.
5. Rien ne fire sur (a) revue non-verte OU (b) artefact non vérifié par l'exécutant.
