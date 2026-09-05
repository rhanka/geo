# Dossier de décision — remplaçant de la route VISION d'extraction (ADR-0024)

> **Type** : present-decision (agent→owner, via i-cond). **Auteur** : geo-archi (wp6, owner ADR-0024).
> **Nature** : approuver le **PROCESS de remplacement** (candidat → benchmark → ratif → nouvel ADR) + l'**intérim**,
> pour débloquer la couche vision-résidu de l'extraction full-auto. **Lien hosting (question egress OUVERTE, pas
> une décision rendue)** : le modèle vision sanctionné **tournera À TRAVERS le LLM-serving** dont la FORME est traitée
> dans l'**enrichissement du dossier egress** (`DECISION_LLM_EGRESS_STANDARD_PATH`, pending) ; le **budget/quota
> par-appelant first-class** y est porté et **s'applique aussi ici** — c'est le même risque-facture.

## 1. Décision demandée
Comment débloquer la **route vision d'extraction** (résidu de cellules de grille que natif+OCR ne résolvent pas),
**bannie et inopérante** depuis ADR-0024 ? Approuver **(1) le process de sélection d'un modèle vision sanctionné**
+ **(2) l'intérim** en attendant.

## 2. Contexte — FAITS / JUGEMENTS
- **[FAIT]** ADR-0024 **BANNIT** `mistral-medium-latest`/vision-chat (incident **€480**, « n'a jamais fonctionné ») ; garde `vision-engine-policy.ts` **live** + CI-test ; **seul `mistral-ocr-latest` (`/v1/ocr`) sanctionné**.
- **[FAIT — geo-confirmé]** Route vision **INOPÉRANTE par construction** : `grille-vision-extractor.ts:351` → `assertVisionModelAllowed(model)` **throw** sans modèle sanctionné explicite ; **aucun modèle remplaçant câblé** ; **aucun ADR de suivi**.
- **[FAIT]** La cascade d'extraction (`SPEC_PIPELINES_TARGET_ARCH` stage 5) = **LLM-minimal** : natif → `pdftotext` → **OCR conditionnel** → **modèle fort UNIQUEMENT sur résidu mesuré**. Le « modèle fort » résiduel EST la route vision à remplacer.
- **[JUGEMENT]** Candidat *a priori* (ADR-0024) : **modèle vision fort derrière gateway** (`gpt-5.6-terra`/`luna` xhigh), **prompt JSON strict PAR CELLULE** + **gardes anti-décalage** conservées.
- **[FAIT]** Un corpus de **grilles DÉJÀ extraites** (gold) existe → **benchmark SANS re-payer Mistral**.

## 3. Enjeux
Le full-auto de l'extraction **dépend** de la route vision-résidu (feed graphe des normes/grilles). **Coût** = le risque récurrent (**€480 Mistral**, **€50/mois §5**) → un mauvais modèle/absence de garde = **une facture**. **Précédent ADR-0024** : tout modèle vision doit être **explicite + sanctionné + double-consensus + ratif geo-archi**.

## 4. Options
| id | option | POUR | CONTRE |
|----|--------|------|--------|
| **(A)** | **process : benchmark candidats sur grilles-gold (0-Mistral) → double-consensus + ratif geo-archi → nouvel ADR** ; **intérim = OCR-only** (résidu → `unknown`) | respecte ADR-0024 (sanctionné, prouvé, ratifié) ; 0 re-paiement Mistral ; intérim sûr (LLM-minimal, jamais un vert fabriqué) | débloque le résidu **plus tard** (après benchmark) |
| **(B)** | **câbler un candidat *a priori* MAINTENANT** (sans benchmark) | rapide | **VIOLE ADR-0024** (pas de double-consensus/benchmark) → **REJETÉ** |
| **(C)** | **OCR-only permanent** (pas de modèle fort) | 0 modèle vision à gérer | perd le résidu que seul un modèle fort résout ; acceptable **SEULEMENT si le résidu mesuré est négligeable** |

## 5. Recommandation (fidèle)
**[JUGEMENT] (A)** : approuver le **process** (benchmark grilles-gold → double-consensus → **ma ratif** → nouvel ADR) + **intérim OCR-only** (résidu = `unknown`, jamais inventé). **Le candidat est CHOISI PAR le benchmark**, pas *a priori* — `gpt-5.6-terra/luna` est l'hypothèse de départ, à **prouver sur gold**, pas à graver. **Mesurer d'abord le résidu réel** : si négligeable, (C) suffit et 0 modèle-fort n'est nécessaire (LLM-minimal poussé au bout).

## 6. ⚠ Réversibilité / coût / BLOCKER honnête
- **Réversible** : le modèle est **swappable derrière la garde** (`vision-engine-policy`) — un choix de modèle, pas d'architecture.
- **Coût** : benchmark = **0 Mistral** (grilles-gold) + usage gateway des candidats ; intérim OCR-only = faible. Le modèle-fort retenu passe par le **LLM-serving D-moteur-2** → **budget/quota par-appelant first-class** s'applique (anti-facture).
- **⚠ BLOCKER RUN (honnête, à graver dans l'escalade)** : l'**exécution du benchmark exige le gateway/Codex** (candidats `gpt-5.6-*` derrière gateway) — **actuellement DOWN (crédits Codex →6/09)**. ⟹ **design + critères de ratif MAINTENANT ; run du benchmark APRÈS gateway**. L'owner approuve le **principe** (process + intérim) maintenant ; le run suit dès gateway rétabli.

## 7. Attendus owner (critères de ratif geo-archi)
- **No-Mistral-vision** (ADR-0024, garde live) · **modèle explicite + sanctionné** · **qualité prouvée sur grilles-gold** (IoU/exactitude cellule vs Mistral-gold, sans re-payer) · **double-consensus** (2 passes indép.) · **budget/quota borné** (lié D-moteur-2 #5) · **prompt JSON strict par cellule + gardes anti-décalage** · **échec = `unknown`, jamais un vert fabriqué**.

## 8. Ce que je demande + pré-mortem + disclosure
**Ce que je demande** : approuver **(A)** — le process + l'intérim OCR-only. Le **run** attend le gateway ; le **candidat** attend le benchmark ; **ma ratif** attend les 2. Décision de **principe** maintenant.
**Strongest-case-CONTRE (A)** : si le résidu réel est **gros** et l'OCR-only laisse trop d'`unknown`, l'intérim dégrade la couverture normes jusqu'au benchmark → mesurer le résidu **tôt** (avant de conclure que l'intérim suffit).
**Pré-mortem** : « le benchmark, une fois le gateway revenu, montre qu'AUCUN candidat gateway ne bat l'OCR sur les grilles-gold → on a attendu pour rien ». Mitigation : le **résidu mesuré** décide (si petit → (C) ; le benchmark n'est lancé que si le résidu le justifie).
**Disclosure d'intérêt-agent** : le plus facile pour moi = graver `gpt-5.6-terra` comme LE candidat. **Signalé** : je ne le grave PAS — le **benchmark tranche**, la garde reste, le résidu-mesuré gouverne. Intérêt owner = coût borné + qualité prouvée + 0 re-incident Mistral.
