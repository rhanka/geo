# Dossier de décision — route VISION d'extraction (ADR-0024) — **reformulé sur directive owner**

> **Type** : present-decision (agent→owner, via i-cond). **Auteur** : geo-archi (wp6, owner ADR-0024).
> **⚠ Reformulé (directive owner)** : l'owner **REJETTE le benchmark-de-sélection** et **résout le candidat** —
> verbatim : « *un enrôlement codex avec llm mesh (éventuellement via cluster mesh) avec un codex 5.3* ». Ce dossier
> ne re-litige PAS le candidat — il traite ce qui RESTE : **la VALIDATION (ADR-0024) ≠ la sélection**, la
> **résolution de l'id modèle**, et les **variantes de livraison**. **Corrections mesh [8f35d4] (mesuré) intégrées**
> (gate, id-catalogue, attribution enrôlement).

## 1. Décision demandée
La route vision (résidu de cellules de grille que natif+OCR ne résolvent pas) est **bannie/inopérante** depuis
ADR-0024. L'owner a **tranché le candidat** (Codex 5.3 via llm-mesh). Restent **3 questions owner** : **(1)** la
**validation-qualité ADR-0024** s'applique-t-elle (confirmer, ou waive explicite) ? **(2)** **quel id modèle** «
codex 5.3 » désigne (voir §3) ? **(3)** l'**intérim** jusqu'à validation ?

## 2. Contexte — FAITS
- **[FAIT]** ADR-0024 bannit `mistral-medium-latest`/vision-chat. **Cause (verbatim, `docs/decisions.md:483-489`)** : modèle « **codé en dur comme défaut** », jamais le vision-chat sanctionné → « **dérive de code au-delà du décidé** », **non détectée avant la facture €480** (319 munis, preuve `work/coverage/normes-provenance.json`). Garde `vision-engine-policy.ts` live + CI ; seul `mistral-ocr-latest` sanctionné.
- **[FAIT — geo-confirmé]** Route vision **INOPÉRANTE par construction** (`grille-vision-extractor.ts:351` → `assertVisionModelAllowed` throw ; aucun modèle câblé ; aucun ADR de suivi).
- **[FAIT — directive owner]** Candidat résolu = **Codex 5.3**, mécanisme = enrôlement codex via llm-mesh (éventuellement cluster-mesh). Plus de benchmark-de-sélection.
- **[FAIT]** Cascade extraction (`SPEC_PIPELINES_TARGET_ARCH` stage 5) = **LLM-minimal** : modèle fort **sur résidu mesuré seulement**. **[FAIT]** Corpus **grilles-gold** existe → validation SANS re-payer Mistral.

## 3. ⚠ Ce qui RESTE (distinctions d'intégrité — corrections mesh)
- **SÉLECTION = résolue owner** (Codex 5.3). Je **ne re-litige pas**.
- **VALIDATION ≠ sélection.** Cœur d'ADR-0024 = la leçon €480 : **un modèle utilisé sans PROUVER qu'il marche → dérive non-détectée → facture**. Donc, sur le modèle retenu : **valider qu'il extrait les grilles-gold correctement** (0-Mistral) + gardes (JSON-strict-par-cellule, anti-décalage, **`unknown`-on-failure**). **« Pas de benchmark » (owner) = pas de SÉLECTION, PAS « pas de VALIDATION ».** *(Surface owner en CLARIFICATION, pas re-litige : confirmer la validation, ou waive explicite — risque €480 exposé.)*
- **⚠ ID MODÈLE : « codex 5.3 » NE RÉSOUT PAS au catalogue** (mesh mesuré : `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4-nano`, `gpt-4.1-nano` ; aucun `5.3` ; CLI = `codex-cli 0.153.4`). ⟹ **NE PAS écrire `codex-5.3` dans l'allowlist `vision-engine-policy`** — un id qui ne résout pas = **contrôle-fantôme** (apparence de contrôle, correspond à rien, ou pire à autre chose si résolveur permissif) = le défaut que la maison démonte. **Résoudre AVANT tout id** : soit un **modèle catalogue réel** (owner désigne : `gpt-5.6-*` ?), soit — si « codex 5.3 » = un modèle fournisseur réel que le catalogue ignore — un **ACTE DE CONTRAT (décision D3 : addition = update conseil d'équivalence OU exclusion explicite justifiée)**, **owner-décidé**. **Tant que non-résolu, la route reste inopérante (garde), pas un id-fantôme.**
- **ENRÔLEMENT (attribution corrigée)** : « llm-mesh enroll » n'est PAS une commande mesh. La **commande d'enrôlement = h2a-runtime** (`account enroll`, `packages/h2a-runtime/src/index.ts`) ; la **logique = lib `@sentropic/llm-mesh`** (`src/enrollment/codex.ts`, ids `enr_codex_*`). L'acte opérationnel d'enrôler un compte appartient à **h2a**.

## 4. ⚠ VARIANTES DE LIVRAISON (correction gate — la route N'est PAS bloquée)
« Codex via llm-mesh » a **2 variantes**, et **une est livrable AUJOURD'HUI** :
- **(a) HOST-SIDE** = le **chemin de PRODUCTION ACTUEL** (pipeline citations : `codex exec -m <model>` → mesh → pool, host-side). **L'instruction owner est DÉJÀ satisfaite host-side** → **variante livrable maintenant, 0 dépendance au dossier egress**.
- **(b) IN-CLUSTER** (le pod appelle le mesh) = **la jambe qui n'existe pas** → **GATÉE sur GATE#2/egress** (LLM-serving in-cluster décidé+bâti + pilote egress).
⟹ **La route vision N'est PAS bloquée derrière l'egress** : host-side dispo now ; l'in-cluster (cible full-auto k8s) est gatée. *(J'avais over-gaté « pas livrable avant » — corrigé par mesh.)*

## 5. Options (ce qui reste à trancher)
| id | option | POUR | CONTRE |
|----|--------|------|--------|
| **(A)** | **résoudre l'id + VALIDER sur grilles-gold (0-Mistral)** + gardes/allowlist ; livrer **host-side** ; **intérim OCR-only** jusqu'à validation | honore ADR-0024 (€480-safety) sans re-litiger le candidat ; host-side dispo now ; 0 re-paiement | in-cluster (full-auto) plus tard (egress) |
| **(B)** | **reliance SANS validation** (waive owner explicite) | immédiat | **rouvre le risque €480** — waive explicite requis, risque exposé |
| **(C)** | **OCR-only** si **résidu mesuré négligeable** | 0 modèle vision | perd le résidu — **mesurer d'abord** |

## 6. Recommandation (fidèle)
**[JUGEMENT] (A)** : **résoudre l'id** (owner/D3) → **valider** (validation, PAS sélection) sur grilles-gold + gardes ; **livrer host-side** (dispo now) ; **intérim OCR-only** ; l'in-cluster suit l'egress. **Mesurer le résidu réel d'abord** (si négligeable → C). Candidat non-rediscuté — seule la **preuve-qu'il-marche** l'est.

## 7. Réversibilité / coût / BLOCKERS + Attendus
- **Réversible** (modèle swappable derrière la garde). **Coût** : validation 0-Mistral + usage Codex via mesh ; **budget/quota par-appelant first-class** (risque €480/€50 — porté au dossier egress).
- **⚠ BLOCKER (Codex down →6/09)** : design + critères de validation **maintenant** ; **run validation post-gateway**. *(Ne bloque PAS le host-side une fois Codex revenu ; n'attend PAS l'egress.)*
- **Attendus** : no-Mistral-vision · **id modèle résolu** (owner/D3, PAS fantôme) · qualité validée grilles-gold · gardes (`unknown`-on-failure) · budget/quota borné.

## 8. Ce que je demande + disclosure
**Ce que je demande** : **(1)** confirmer que la **validation ADR-0024 s'applique** (ou waive explicite, risque €480 exposé) ; **(2)** **résoudre « codex 5.3 »** (modèle catalogue réel OU acte-de-contrat D3) — **avant tout id d'allowlist** ; **(3)** intérim OCR-only. **Coordination : mesh [8f35d4]** (logique enrôlement `llm-mesh` + catalogue) **+ h2a** (commande `account enroll`).
**Disclosure intérêt-agent** : **0 intérêt** à re-débattre le candidat (owner-résolu) ni à choisir un modèle (je n'en ai pas) ; je porte **uniquement** la validation-€480-safety + l'anti-id-fantôme (mon rôle ADR-0024). Intérêt owner = ne pas re-vivre 2024.
