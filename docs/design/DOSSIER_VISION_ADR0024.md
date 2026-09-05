# Dossier de décision — route VISION d'extraction (ADR-0024) — **reformulé sur directive owner**

> **Type** : present-decision (agent→owner, via i-cond). **Auteur** : geo-archi (wp6, owner ADR-0024).
> **⚠ Reformulé (directive owner)** : l'owner **REJETTE le benchmark-de-sélection** et **résout le candidat** —
> verbatim : « *un enrôlement codex avec llm mesh (éventuellement via cluster mesh) avec un codex 5.3* ». ⟹ la route
> vision = **Codex 5.3 (owner-directed) enrôlé via `llm-mesh`** (éventuellement via cluster-mesh). **PLUS de sélection.**
> Ce dossier ne re-litige PAS le candidat — il traite ce qui RESTE : **la VALIDATION (ADR-0024) ≠ la sélection** +
> la **dépendance egress/hosting**. Coordination : **mesh [8f35d4]** (autorité `llm-mesh`).

## 1. Décision demandée
La route vision (résidu de cellules de grille que natif+OCR ne résolvent pas) est **bannie/inopérante** depuis
ADR-0024. L'owner a **tranché le candidat** (Codex 5.3 via llm-mesh). Restent **2 questions owner** : **(1)** la
**validation-qualité ADR-0024** s'applique-t-elle à Codex 5.3 (confirmer, ou waive explicite) ? **(2)** l'**intérim**
jusqu'à ce que la route soit validée + le LLM-serving bâti ?

## 2. Contexte — FAITS / JUGEMENTS
- **[FAIT]** ADR-0024 **BANNIT** `mistral-medium-latest`/vision-chat. **Cause (verbatim ADR-0024, `docs/decisions.md:483-489`)** : modèle « **codé en dur comme défaut** », jamais le vision-chat sanctionné → « **dérive de code au-delà du décidé** », **non détectée avant la facture €480** (319 munis, preuve `work/coverage/normes-provenance.json`). Garde `vision-engine-policy.ts` live + CI ; seul `mistral-ocr-latest` (`/v1/ocr`) sanctionné.
- **[FAIT — geo-confirmé]** Route vision **INOPÉRANTE par construction** : `grille-vision-extractor.ts:351` → `assertVisionModelAllowed` **throw** sans modèle sanctionné ; **aucun câblé** ; aucun ADR de suivi.
- **[FAIT — directive owner]** Candidat **résolu = Codex 5.3**, mécanisme = **enrôlement via `llm-mesh`** (éventuellement via cluster-mesh). **PLUS de benchmark-de-sélection.**
- **[FAIT]** Cascade extraction (`SPEC_PIPELINES_TARGET_ARCH` stage 5) = **LLM-minimal** : natif → `pdftotext` → OCR conditionnel → **modèle fort SUR RÉSIDU MESURÉ seulement**. Le « modèle fort » résiduel = cette route.
- **[FAIT]** Corpus de **grilles DÉJÀ extraites (gold)** existe → **validation SANS re-payer Mistral**.

## 3. ⚠ Ce qui RESTE après la directive owner (distinction d'intégrité)
- **SÉLECTION = résolue owner** (Codex 5.3). Je **ne re-litige pas**.
- **VALIDATION ≠ sélection.** Le **cœur d'ADR-0024** = la leçon €480 : **un modèle utilisé sans PROUVER qu'il marche → dérive non-détectée → facture**. Donc, sur Codex 5.3 : **valider qu'il extrait les grilles correctement** (sur grilles-gold, 0-Mistral) + **gardes** (Codex-5.3 ajouté à l'allowlist `vision-engine-policy` = sanctionné explicite ; prompt JSON strict par cellule + anti-décalage ; **échec = `unknown`, jamais un vert fabriqué**). **« Pas de benchmark » (owner) = pas de SÉLECTION, PAS « pas de VALIDATION ».** La validation est le garde-fou qui **a MANQUÉ en 2024**, pas un choix de modèle. *(Surface owner en CLARIFICATION, pas re-litige : l'owner confirme la validation, ou la waive explicitement — son call — avec le risque €480 exposé.)*
- **DÉPENDANCE egress/hosting** : « Codex 5.3 **via llm-mesh (via cluster-mesh)** » = **le LLM tourne quelque part = le dossier egress/hosting ORPHELIN/PENDING** (`llm-mesh` = lib sans service ; cluster-mesh = 0-LLM ; per mesh). ⟹ la route vision **n'est PAS livrable indépendamment** — **GATÉE sur GATE #2** (LLM-serving décidé + bâti) + le **pilote egress** (à désigner par l'owner).

## 4. Options (ce qui reste à trancher)
| id | option | POUR | CONTRE |
|----|--------|------|--------|
| **(A)** | **VALIDER Codex 5.3 sur grilles-gold (0-Mistral) avant reliance** + gardes/allowlist ; **intérim OCR-only** (résidu→`unknown`) jusqu'à validation + LLM-serving bâti | honore le cœur ADR-0024 (€480-safety) sans re-litiger le candidat ; 0 re-paiement Mistral ; intérim sûr | reliance sur Codex 5.3 **plus tard** (après validation + egress) |
| **(B)** | **reliance sur Codex 5.3 SANS validation** (waive owner explicite) | immédiat si egress prêt | **rouvre le risque €480** (un modèle non-prouvé peut dériver non-détecté) — **owner-waive explicite requis, risque exposé** |
| **(C)** | **OCR-only** si le **résidu mesuré est négligeable** | 0 modèle vision | perd le résidu que seul le modèle fort résout — **mesurer le résidu d'abord** |

## 5. Recommandation (fidèle)
**[JUGEMENT] (A)** : **valider Codex 5.3** (validation, PAS sélection) sur grilles-gold + gardes/allowlist ; **intérim OCR-only**. **Mesurer le résidu réel d'abord** : si négligeable → (C) (LLM-minimal au bout). Le candidat (Codex 5.3) **n'est pas rediscuté** — seule la **preuve-qu'il-marche** l'est.

## 6. Réversibilité / coût / ⚠ BLOCKERS
- **Réversible** : modèle **swappable derrière la garde** (`vision-engine-policy`).
- **Coût** : validation = **0 Mistral** (grilles-gold) + usage Codex via llm-mesh ; intérim OCR = faible. **Budget/quota par-appelant first-class** (le risque €480/€50 — porté dans le dossier egress).
- **⚠ BLOCKER #1 (Codex down)** : Codex **down →6/09** → **design + critères de validation MAINTENANT** ; **run validation post-gateway**.
- **⚠ BLOCKER #2 (egress)** : la route est **GATÉE sur GATE #2** (LLM-serving via llm-mesh **décidé + bâti**) + pilote egress. **Pas d'industrialisation avant.**

## 7. Attendus owner
No-Mistral-vision (ADR-0024) · **Codex 5.3 explicitement sanctionné** (allowlist) · **qualité validée sur grilles-gold** (exactitude cellule, 0 re-paiement) · gardes (JSON-strict-par-cellule, anti-décalage, `unknown`-on-failure) · budget/quota borné (egress) · route **gatée** (GATE#2 + Codex-restauré).

## 8. Ce que je demande + disclosure
**Ce que je demande** : **(1)** confirmer que la **validation ADR-0024 s'applique** à Codex 5.3 (le candidat est acquis ; la **preuve-qu'il-marche** reste requise) — **ou** waive explicite (risque €480 exposé) ; **(2)** intérim OCR-only ; **(3)** acter que la route est **gatée** sur le LLM-serving (egress/GATE#2, pilote à désigner) + Codex-restauré. **Coordination mesh [8f35d4]** (mécanisme d'enrôlement llm-mesh).
**Disclosure intérêt-agent** : je **n'ai aucun intérêt** à re-débattre le candidat (owner-résolu) ; je porte **uniquement** la validation-€480-safety (mon rôle ADR-0024). Intérêt owner = ne pas re-vivre 2024 (un modèle non-prouvé en prod) — **distinct** d'une préférence de modèle (je n'en ai pas).
