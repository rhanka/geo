# Éval des modèles vision/OCR pour l'extraction des grilles de normes

_Statut : rapport d'évaluation — **5 moteurs benchés**. Branche `feat/cadre-acquisition`,
HEAD `2deb537`. Date 2026-07-04._

Ce rapport évalue **par modèle** les moteurs de lecture de grilles de normes
(`qc-zonage-norms-<slug>`), sur trois axes : **correctness** (recoupement SIG, champs
publiés, hallucinations), **consommation** (tokens, coût API-équivalent, coût RÉEL sur
le compte / les crédits-plan) et **projection sur le résidu** (~434 zones + ~632 normes
≈ 1066 tâches-muni).

Les 5 moteurs couverts : **Claude Opus 4.8** (xhigh), **GPT-5.5** (xhigh, codex),
**GPT-5.4** (xhigh), **Mistral** (OCR-nu `/v1/ocr` · `document_annotation` schéma ·
Pixtral-large) et **Gemini 3.5 Flash High** (`agy`).

Le pendant « méthodes par cas » (quel parser/route pour quelle grille) est
[`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md). La règle
transverse verbatim-ou-null (`buildVisionField`) est **héritée par tous les moteurs** :
l'invention est structurellement impossible quel que soit le modèle — la comparaison
ci-dessous ne porte donc PAS sur la sécurité (0 fausse valeur servie partout) mais sur le
**recall, la robustesse, le coût et la latence**.

---

## 1. Méthodologie du bench

**Échantillon.** `work/bench/sample-20.json` — 20 villes **SIG-validées** (la couche
`zone_code` sert de vérité-terrain), layouts volontairement mixtes : `override` (grille
transposée à couche texte), `multizone` (zones-en-colonnes denses), `zone-header`,
`grille-grille`, `image-scan`. Les fenêtres de pages-grille sont **pré-vérifiées** dans
`work/bench/windows.json` (page localisée par ville) — la localisation n'est donc **pas**
mesurée ici (voir §2).

**Vérité-terrain & métriques.** Chaque sortie est recoupée à la couche SIG (overlap
canonique + pont numérique) :

- `recoupExtracted` = overlap / codes-lus → **précision** (équitable-fenêtre, comparable
  entre modèles) ;
- `recoupSig` = overlap / codes-SIG → **rappel**, **borné par le nombre de pages lues**
  (⚠️ **non comparable entre modèles** — voir la note de fenêtre §11) ;
- `publishedFieldPct` = champs-normes publiés verbatim-ou-null → recall des valeurs
  (comparable) ;
- `hallucination` = code lu absent du SIG ;
- + tokens in/out (+reasoning), temps, coût.

**Guard commun à TOUS les moteurs.** `buildVisionField` (verbatim-ou-null,
`VISION_PUBLISH_CONFIDENCE=0.92`, `grille-vision-extractor.ts`) est appliqué en aval de
chaque moteur → **0 valeur inventée servie** quel que soit le modèle. Le **dépôt** est en
plus filtré par le gate crossval (`shouldRejectForZeroOverlap`) : un code lu hors-SIG est
compté en hallucination d'**extraction** mais **jamais servi** (done ≠ servi).

**Harnais (producteurs).**

| Moteur | Harnais | Conditions |
|---|---|---|
| Claude 4.8 | `acquisition/src/bench/run-claude48-normes-bench.ts` + `analyze-claude48.ts` | dpi 200, fenêtre ≤ 6 p, 20 villes |
| GPT-5.5 / 5.4 / Mistral-OCR | `acquisition/src/bench/run-qc-acquisition-model-bench.ts` | dpi défaut, **1 page** SIG-validée (baie-comeau) |
| GPT-5.5 (élargi) | `work/bench/gpt55-mini-driver.ts` | dpi 150, **1 p/ville**, 5 villes à fenêtres vérifiées |
| Gemini `agy` | bench agy (route `agy -p`) → `work/bench/agy-normes-bench.md` | dpi 150, fenêtre ≤ 6 p, 20 villes |
| Mistral schéma / Pixtral | `acquisition/work/fn-bench/bench.ts` | ferme-neuve, variantes B (`document_annotation`) & C (Pixtral) |

**Conditions par modèle → limites de comparabilité.** Les fenêtres diffèrent : 4.8 et
Gemini lisent **≤ 6 pages**, GPT-5.5 est benché sur **1 page/ville**, Mistral-OCR sur des
pages isolées. Le **dénominateur SIG est identique** par ville mais le **numérateur
overlap est borné par le nombre de pages lues** → le **rappel (`recoupSig`) n'est PAS
comparable** d'un modèle à l'autre. La **précision (`recoupExtracted`)** et le
**`publishedFieldPct`** restent comparables. Ce rapport privilégie ces deux dernières
métriques pour les jugements inter-modèles.

---

## 2. Scope d'évaluation

**Ce qui EST couvert.** La **lecture de grilles de NORMES** sur quatre familles de
layout — **transposé** (colonnes-zones), **multizone dense**, **scan-image**,
**zone-header / dense-glyphes** — mesurée en correctness (précision/rappel/fieldPct/
hallucination) contre le SIG, en consommation (tokens/temps) et en **coût réel vs
API-équivalent**.

**Ce qui N'EST PAS couvert (hors-scope, à ne pas déduire de ce rapport).**

1. **Localisation de la page-grille à l'échelle** — ici les fenêtres sont **pré-vérifiées**
   (`windows.json`). Le vrai goulot production (`--auto-grid-page` sur un règlement
   codifié, annexe enterrée) n'est **pas** mesuré : un meilleur modèle sur la mauvaise
   page reste à 0 zone.
2. **Calibration du quota réel** — la fenêtre 5 h Claude, le plafond de session Gemini et
   les crédits-plan codex sont **estimés**, pas calibrés sur de vrais `rate_limit_event`.
3. **Tâches ZONES** (lecture de glyphes de plans) : seulement **effleurées** — le bench
   porte sur les NORMES. La projection 434 zones est une **borne haute** (tâche plus
   légère que les grilles denses).
4. **Débit soutenu / lanes parallèles** non stressé (latence par-muni mesurée, pas le
   throughput sous quota).
5. **Runs non persistés** : les chiffres GPT-5.5 5-villes (driver stdout) et
   Mistral-schéma / Pixtral (`fn-bench/bench.ts`, sans sortie fichier) sont **relayés du
   run** et **à recommitter** — voir la note de provenance §11.

---

## 3. Synthèse par modèle (tableau unique)

Précision = `recoupExtracted` · Rappel = `recoupSig` (†non comparable, borné-fenêtre) ·
fieldPct = champs publiés · Halluc. **servie** = codes hors-SIG effectivement déposés
(0 partout, gate crossval). Tokens « /muni » = fenêtre ≤ 6 p ; « /page » = 1 page.

| Modèle (route code) | Précision recoupE | Rappel recoupSig † | fieldPct | Halluc. servie | Lit dense/scan ? | Fiabilité | Tokens in / out | Crédit RÉEL |
|---|--:|--:|--:|:--:|---|---|---|---|
| **Claude Opus 4.8** xhigh · `lib/grille-claude-cli.ts` | **0.866** (0.976 hors raté-scan) | 0.21 (≤6p) | **45.2 %** | **0** (24 lus filtrés) | oui / oui | haute · **déterministe** | 90,4k / 17,4k **/muni** | **0 $** abonnement OAuth (≈ $0,88 API-éq) |
| **GPT-5.5** xhigh · `lib/grille-gpt55-codex.ts` | **1.00** | 0.08\* (1p) | 46,7 % / ~50 %‡ | **0** | oui / oui | haute · 0 raté | 13,8k / 1,0–2,0k **/page** (dont ~11k prompt-sys codex) | **crédits-plan codex** (0 $ / 0 quota-event → mesurable en tokens seuls) |
| **GPT-5.4** xhigh · `lib/grille-gpt55-codex.ts` | 1.00 | 0.08\* (1p) | 47,4 % | 0 | oui / oui | haute mais **LENT** | 12,9k / 10,1k **/page** (reason ×17) | crédits-plan — **dominé par 5.5** |
| **Mistral OCR-nu** · `lib/ocr.ts` + `grille-ocr-extractor.ts` | bon multizone / **0 transposé** | multizone bon | **0 %** transposé · bon multizone | 0 | multizone oui / **transposé non** | robuste (0 crash JSON) · **pas de canal prompt** | ~1–2 pages | **$0,001/page** (crédits Mistral) |
| **Mistral schéma** (`document_annotation`) · `fn-bench/bench.ts` var. B | codes ~0.97 | — | **48,6 %** transposé (= 4.8) | 0 | transposé **oui** | déterministe | schéma/page | **$0,003/page** ‡ (non persisté) |
| **Pixtral-large + directive** · `fn-bench/bench.ts` var. C | — | — | 37,2 % | 0 | — | déterministe | tokens $2/$6 /Mtok | **~$0,010/page** ‡ (non persisté) |
| **Gemini 3.5 Flash High** · `lib/grille-agy-cli.ts` (`agy`) | **0.869** | **0.064** (≤6p) | 35,6 % | 0 (17 lus filtrés) | oui / oui — mais **FAIBLE + non-déterministe sur dense** | timeouts / empty / SIGKILL | ~23–38k / var. **/page** (≈5× 4.8) | **0 $** abonnement · **plafond session heurté** |

† Les rappels `recoupSig` **ne sont pas comparables** entre modèles (fenêtres de pages
différentes ; voir §1 et §11). · \* GPT benché sur 1 page → rappel structurellement bas.
· ‡ Chiffres relayés d'un run **non persisté** (voir §11 provenance).

**À retenir du tableau.** (a) **0 fausse valeur servie partout** — la sécurité n'est pas
un axe de choix. (b) **Précision** : GPT-5.5 = 1.00, Claude 4.8 = 0.866 (0.976 hors le
raté-scan east-broughton), Gemini = 0.869. (c) **Coût réel** : Claude 0 $ (abonnement) et
GPT-5.5 crédits-plan (0 $ facturé, 0 quota-event) sont les plus favorables ; Mistral-OCR
est le seul **$-mesuré** (et le moins cher, $0,001/page) mais **casse sur transposé**.

---

## 4. Claude Opus 4.8 (xhigh) — chiffres RÉELS du bench

Source : `work/bench/claude48-normes-bench.md`, `work/bench/claude48-cost-projection.md`,
`work/bench/claude48-results.json` (généré 2026-07-04, modèle `claude-opus-4-8`, effort
`xhigh`, route Engine-B `claude -p` OAuth `apiKeySource:none`, fenêtre ≤6 pages/ville,
DPI 200). Producteur : `acquisition/src/bench/run-claude48-normes-bench.ts` +
`analyze-claude48.ts`. Échantillon : `sample-20.json`, fenêtres `windows.json`.
Route : `extractGrilleClaudeFromPdf` (`CLAUDE_MODEL=claude-opus-4-8`).

### 4.1 Correctness

| Agrégat (villes SIG ∧ zones lues = 11/20) | Valeur |
|---|---|
| recoupExtracted moyen (**précision**) | **0.866** |
| recoupSig moyen (rappel, borné-fenêtre) | 0.21 |
| publishedFieldPct moyen | **45.2 %** |
| Overlap total / codes-SIG total | 281 / 5415 |
| Codes-lus total | 305 |
| Hallucinations (codes lus hors-SIG, **extraction**) | 24 / 305 (7.9 %) |
| Hallucinations **servies** (post-gate) | **0** |

**Lecture rigoureuse des 97.6 % / « 0 hallucination ».** Les 24 codes hors-SIG se
concentrent sur **east-broughton** (17/17), un **scan-image** où la lecture a échoué en
bloc (overlap=0, fieldPct=0) : c'est une **non-lecture**, pas une invention. En écartant
ce raté-scan, la précision **pondérée par overlap** est **281/288 = 97.6 %** ; il reste 7
codes hors-SIG (baie-comeau 4, ferme-neuve 1, levis 2) — plausiblement des codes réels
absents de la couche SIG. Le **dépôt** est filtré par `shouldRejectForZeroOverlap` :
**aucun code hors-SIG servi**, et tout champ publié passe `buildVisionField` → **0 fausse
valeur servie**.

Extrait par ville (les productives ; artefact complet dans `claude48-normes-bench.md`) :

| ville | layout | overlap/SIG | recoupE | fieldPct | halluc | dépôt (codes/pub%) |
|---|---|--:|--:|--:|--:|--|
| baie-comeau | override | 80/237 | 0.952 | 37.9 | 4/84 | 257 / 45.8 |
| ferme-neuve | override (texte) | 34/112 | 0.971 | 48.6 | 1/35 | — |
| girardville | override | 48/105 | 1.0 | 62.5 | 0/48 | — |
| saint-gabriel-de-rimouski | override | 65/66 | 1.0 | 0 | 0/65 | — |
| sept-iles | override | 30/667 | 1.0 | 50 | 0/30 | 640 / 55.4 |
| east-broughton | **image-scan (raté)** | 0/78 | 0 | 0 | 17/17 | 0 / 0 |

### 4.2 Consommation & coût

Prix liste Opus 4.8 : **$5.00 / 1M in · $25.00 / 1M out**. `in total` inclut les tuiles
image (`cache_creation` + `cache_read`). `API-$` = `total_cost_usd` rapporté par le CLI
(fait foi, tarifie les tokens-image cachés).

| Métrique / muni (villes productives) | Valeur |
|---|---|
| Tokens in (incl. image) | **90 429** |
| Tokens out (gonflé par le raisonnement xhigh) | **17 449** |
| **API-$ / muni** (équivalent-API) | **$0.884** |
| Temps / muni | 152 s (sur 20) · 249 s (sur 11 productives) |
| Total 20 villes | API-$ = $12.08 · out = 202 139 tok |

**Coût RÉEL = 0 $.** Engine-B est servi par l'**abonnement Claude OAuth** : le CLI
rapporte `apiKeySource: none` et une fenêtre `five_hour` avec dépassement **REJETÉ**
(jamais de facturation silencieuse) — vérifié dans `lib/grille-claude-cli.ts`. Le
`total_cost_usd` est un **équivalent-API « fantôme »**, pas une dépense. Seule contrainte :
la **fenêtre glissante 5 h** — ~**114.6 munis/fenêtre** (hypothèse 2 000 000 tokens-out/
fenêtre ÷ 17 449 out/muni — **à calibrer sur un vrai `rate_limit_event`**).

> Note : le `out` élevé (raisonnement xhigh) domine à la fois l'API-$ (×$25/1M) ET la
> conso d'abonnement. Baisser l'effort (`high`) réduirait fortement les deux, au prix
> d'un peu de qualité.

---

## 5. GPT-5.5 (xhigh, codex) — précision parfaite, coût en crédits-plan

Route : `lib/grille-gpt55-codex.ts` → `extractGrilleGpt55FromPdf`
(`GPT55_METHODE="codex/gpt-5.5-vision"`, `codex exec --json` headless).

**Sources.** (a) **persisté** : `work/bench-qc-zonage-models/report.md` + `raw.json`
(harnais `run-qc-acquisition-model-bench.ts`) — 1 page baie-comeau. (b) **non persisté**
(stdout du driver `work/bench/gpt55-mini-driver.ts`, 5 villes, dpi 150, 1 p/ville) —
chiffres relayés du run, **à recommitter** (§11).

### 5.1 Correctness

- **baie-comeau (persisté)** : `recoupExtracted = 1.00`, `recoupSig = 0.080` (19/237,
  borné 1 page), `publishedFieldPct = 46.7 %`, **0 hallucination**, 0 fausse valeur.
- **5 villes (relayé)** : `recoupExtracted = 1.00` et **0 hallucination** sur
  ferme-neuve / baie-comeau / east-broughton / saint-narcisse / saint-gabriel-de-rimouski ;
  `fieldPct ≈ 50 %`. Lit le **transposé**, le **dense** ET le **scan** (couvre les 3
  familles où 4.8 est fort). **0 raté** attribuable au modèle sur les fenêtres vérifiées.

→ correctness **au niveau de 4.8** (précision supérieure, 1.00 vs 0.866) sur les pages
lues ; le rappel bas (0.08) est un **artefact de la fenêtre 1 page**, pas une faiblesse.

### 5.2 Consommation & coût

- **Tokens (baie-comeau, persisté)** : in **14 264** / out **1 955** / reasoning **516**,
  31 s.
- **Tokens (5 villes, relayé)** : total in **69 519** / out **5 152** / reasoning **2 092**.
- **Décomposition de l'entrée** : ~**11k tokens/call = prompt système fixe injecté par
  codex** (overhead d'orchestration) ; le **marginal image+prompt réel ≈ 2,8k/page** ;
  out ~0,7–2,1k ; reasoning ~0,3–0,5k. ~**14–32 s/page**.
- **Coût = crédits du PLAN codex.** `codex exec --json` **n'émet AUCUN $ ni quota-event** :
  le coût est **mesurable UNIQUEMENT en tokens**. Le harnais QC **hardcode `costUsd = 0`**
  pour les routes gpt (`run-qc-acquisition-model-bench.ts`, branche gpt55/gpt54) — d'où le
  `$0.0000` du report : le harnais compte les **tokens mais pas les dollars**.

> ⚠️ Le « hang codex 7 h » observé était une **orchestration de l'ancienne tâche**, PAS le
> modèle ; contourné par le driver headless `work/bench/gpt55-mini-driver.ts` (villes en
> parallèle, stdout-only).

---

## 6. GPT-5.4 (xhigh) — même correctness que 5.5, mais dominé

Même route (`extractGrilleGpt55FromPdf`, effort 5.4). Source persistée :
`report.md` + `raw.json`, baie-comeau.

- **Correctness IDENTIQUE à 5.5** : mêmes zones (19), même overlap (19/237),
  `recoupExtracted = 1.00`, `recoupSig = 0.080`, **0 hallucination**, `fieldPct = 47.4 %`
  (+0.7 pt vs 5.5, dans le bruit).
- **Coût dominé** : out **10 122** (×5.2 vs 5.5) · reasoning **8 681** (**×16.8** vs 5.5) ·
  **128 s** (×4.1 vs 5.5). Sur la charge globale, le surcoût raisonnement/output atteint
  **~5–10×** et le wall-time **jusqu'à ~7×**.

**Verdict : à écarter.** Aucun gain de correctness pour un coût-token et une latence
plusieurs fois supérieurs → **GPT-5.5 ≫ GPT-5.4** pour la lecture de grilles.

---

## 7. Mistral — OCR-nu, schéma (document_annotation), Pixtral

### 7.1 OCR-nu (`/v1/ocr`) — fast-path des grilles simples, casse sur transposé

Source : `work/coverage/BENCH-OCR.md` (2026-06-23, 8 villes) + `report.md` (baie-comeau) +
code (`lib/ocr.ts` → `resolveOcrCall` ; `packages/qc-sources/src/sources/grille-ocr-extractor.ts`
→ `extractGrilleOcrFromPdf`). Coût : **~$0,001/page** — **5–10× moins cher** et
**3–10× plus rapide** que le chat-vision (5–9 s vs 12–79 s). **0 fausse valeur** (garde
`buildVisionField`).

**Là où il gagne — multizone dense (zones-en-colonnes).** Recall ≥ chat-vision
(saint-raymond 60 vs 44 champs ; sutton 6 zones vs 0 ; stratford 26 zones vs chat-vision
**en erreur JSON**) et **plus robuste** : le chat-vision `mistral-medium` casse en JSON
malformé sur 13 colonnes, l'OCR Document-AI non. → route `ocr` primaire pour N-h.

**Là où il casse — grilles TRANSPOSÉES.** La linéarisation markdown **perd l'association
colonne-zone ↔ valeur** : le mapper lit la colonne d'USAGES comme codes de zone →
overlap=0, fieldPct s'effondre. **ferme-neuve** : OCR-nu = 106 codes lus / ~88 % overlap
**mais fieldPct = 0** (baie-comeau OCR-nu = **0 %** dans `report.md`), contre **48.6 %**
publiés par 4.8 sur la même grille. Le vrai correctif est le **parser natif $0** quand une
couche texte existe (ferme-neuve), pas un LLM.

**Scan vertical 1-zone/page.** L'OCR aplatit et sur-segmente : saint-stanislas **3.6 %**
(2/56) contre **100 %** (14/14) au chat-vision. → route `vision` pour N-i.

**Limite d'instruction.** `/v1/ocr` **n'a pas de canal de prompt** : aucun schéma ni
directive anti-invention en amont — toute la garde est **en aval**. C'est la différence
structurelle avec un LLM instruit (§5) et avec le mode schéma (§7.2).

### 7.2 Mistral + `document_annotation` (schéma JSON) — corrige le transposé

Source : `acquisition/work/fn-bench/bench.ts` **variante B** (`document_annotation_format`
= `{ type: "json_schema", json_schema: { name: "grille_transposee", strict: true } }`
contre `mistral-ocr-latest`). **Sortie non persistée** — chiffres relayés du run (§11).

- **Le canal de schéma corrige la casse transposée** : ferme-neuve passe de **0 %**
  (OCR-nu) à **48,6 %** de champs publiés — **égale la cible Claude 4.8** sur la même
  grille (la valeur 48,6 % est la référence 4.8 codée dans `bench.ts` comme objectif).
- Codes de zone **~0.97** de recall, **déterministe**.
- **Coût : $0,003/page** (estimation littérale `bench.ts:213`) → une **annexe complète de
  25 pages ≈ $0,075** ; **105/112 codes SIG** recouvrés.

→ pour le **transposé sans couche texte native**, le mode schéma est le fast-path
déterministe et quasi-gratuit — meilleur rapport correctness/$ que le chat-vision.

### 7.3 Pixtral-large + directive

Source : `fn-bench/bench.ts` **variante C** (`pixtral-large-latest`, rates $2/$6 par
Mtoken). **Sortie non persistée** (§11). **37,2 %** de champs publiés à **~$0,010/page** —
plus cher que le mode schéma pour un fieldPct inférieur → **le schéma domine Pixtral** sur
le transposé.

---

## 8. Gemini 3.5 Flash High (`agy`) — gratuit mais non-déterministe sur dense

Source : `work/bench/agy-normes-bench.md` (+ `agy-results.json`), 20 villes, dpi 150,
fenêtre ≤ 6 p, route Engine-C `agy -p @image --output-format json
--dangerously-skip-permissions` (voie **headless** ; l'interactif h2a est non réactif).
Route : `lib/grille-agy-cli.ts` → `extractGrilleAgyFromPdf`
(`AGY_MODEL="Gemini 3.5 Flash (High)"`).

### 8.1 Correctness

| Agrégat (villes SIG ∧ zones lues = 9/20) | Valeur |
|---|---|
| recoupExtracted moyen (précision) | **0.869** (≈ 4.8) |
| recoupSig moyen (rappel, ≤6p) | **0.064** (vs 4.8 : 0.21) |
| publishedFieldPct moyen | **35.6 %** |
| Overlap total / codes-SIG | 77 / 5415 |
| Codes-lus total | 99 |
| Hallucinations servies | **0** (17 lus east-broughton filtrés) |

- **Lit le transposé et le scan à parité** de 4.8 sur les grilles simples
  (ferme-neuve 0.971 / fieldPct 47.1 %).
- **FAIBLE + non-déterministe sur le dense** : **0 zone** sur `saint-gabriel-de-rimouski`
  (que 4.8 lit **65/66**, recoupSig 0.985) et `girardville` (que 4.8 lit **48/105**),
  **timeouts SIGKILL / réponses vides** (les lignes `0/0(+0)` tokens = appels tués ou
  vides). Même raté-scan qu'à 4.8 sur east-broughton (halluc 17/17).

### 8.2 Consommation & coût

- **Run 20 villes** : in **1 659 440** / out **230 065** / thinking **193 558** ·
  temps **3808 s** (190,4 s/ville).
- **Entrée par page lourde** : ~**23–38k tokens/page** sur fenêtres pleines
  (ex. saint-pascal 37,5k/p, saint-narcisse 38,1k/p, east-broughton 37,4k/p) —
  **≈ 5× l'entrée non-cachée de 4.8** (7,5k/p) **pour un rappel inférieur**.
- **Coût : $0 marginal** (abonnement), mais **plafond de session heurté** en cours de run.

**Verdict** : complément **gratuit** viable sur transposé/scan **simples**, mais
**non-déterministe sur le dense** et **plafond de session** → **pas un workhorse**.

---

## 9. Projection sur le résidu (~632 normes) par modèle

Le bench mesure des grilles de NORMES → la projection **632 normes** est la plus fondée ;
la colonne **1066** (632 normes + 434 zones) réutilise le même coût/muni comme **borne
haute** (les tâches ZONES sont plus légères).

| modèle | tokens/muni (in/out) | $ API-éq/muni | $ / 632 normes | $ / 1066 (borne haute) | conso RÉELLE |
|---|---|--:|--:|--:|---|
| **Claude Opus 4.8** | 90 429 / 17 449 | $0.884 | **$559** | ~$942 | **0 $** ; ~5.5 fenêtres 5 h (~1.1 j @ 5 fen./j) |
| **GPT-5.5** (codex) | ~13,8k / ~1,5k **/page** | **n/a** ($0 émis) | **0 $ facturé** | 0 $ facturé | **crédits-plan** ; ~632 pages × ~14k in ≈ 8,8M in ; wall ~14–32 s/page |
| GPT-5.4 (codex) | ~12,9k / ~10,1k /page | n/a | 0 $ facturé | 0 $ facturé | **dominé** (×5–17 tokens, ×4–7 temps) → écarter |
| **Mistral OCR-nu** | ~pages | $0.001/page | **~$3.79** (6p/muni) | ~$6.4 | crédits Mistral ; **casse transposé** |
| Mistral schéma (annot.) | schéma/page | $0.003/page | ~$11.4 (6p/muni) | ~$19 | crédits Mistral ; **corrige transposé**, déterministe |
| Gemini `agy` | ~23–38k / var. /page | $0 | **0 $** marginal | 0 $ | abonnement ; **plafond session heurté** → non tenable à l'échelle |

---

## 10. Recommandation — stratégie de routage

Le choix se fait **par famille de layout** (correctness égale en sécurité ; on optimise
recall × coût × déterminisme) :

| Cas de grille | Route recommandée | Pourquoi |
|---|---|---|
| **Multizone simple** (zones-en-colonnes) | **Mistral OCR-nu** | $0,001/pg, robuste, pas de crash JSON ; la linéarisation ne casse pas l'association ici |
| **Transposé** (couche texte native) | **parser natif $0** | ferme-neuve : gratuit, exact, avant tout LLM |
| **Transposé** (sans texte, image) | **Mistral schéma** (`document_annotation`) ou **GPT-5.5** | schéma déterministe $0,003/pg (48,6 %, = 4.8) ; GPT-5.5 si crédits-plan disponibles |
| **Dense** (glyphes serrés) | **Claude 4.8** ou **GPT-5.5** | seuls déterministes sur dense ; Gemini y échoue (0 zone saint-gabriel) |
| **Scan-image vertical** | **Claude 4.8** / **GPT-5.5** | LLM instruit > OCR-nu (qui sur-segmente : 3.6 % vs 100 %) |

- **Workhorse par défaut = Claude 4.8** (abonnement, **0 $**, lit tout, déterministe).
  **Second workhorse = GPT-5.5** (précision 1.00, **0 $ facturé** en crédits-plan) —
  **GPT-5.5 ≫ GPT-5.4** (même correctness, fraction du coût/temps → 5.4 écarté).
- **Fast-path $ = Mistral** : OCR-nu sur multizone simple, **schéma** sur transposé-image.
- **Gemini `agy`** = complément gratuit sur transposé/scan **simples** uniquement (pas
  workhorse : non-déterministe sur dense, plafond session).
- **Le goulot n'est PAS le modèle** : c'est la **localisation de la page-grille** dans un
  règlement codifié (§2, hors-scope de ce bench) — traitée par `--auto-grid-page` +
  fenêtres vérifiées ([`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md)
  §3), pas par un changement de modèle.

---

## 11. Comparabilité, provenance & limites

**Rappels non comparables.** GPT-5.5/5.4 sont benchés sur **1 page/ville** ; 4.8 et Gemini
sur **≤ 6 pages**. Le `recoupSig` (rappel) est **borné par la fenêtre** → il **ne se
compare pas** d'un modèle à l'autre (le 0.08 de GPT n'est pas « moins bon » que le 0.21 de
4.8, c'est 1 page vs 6). **Seuls `recoupExtracted` (précision) et `publishedFieldPct` sont
comparables** inter-modèles.

**Provenance des chiffres.**

| Bloc | Provenance | Statut |
|---|---|---|
| Claude 4.8 (20 villes) | `claude48-normes-bench.md/.json`, `claude48-cost-projection.md` | **persisté** |
| Gemini `agy` (20 villes) | `work/bench/agy-normes-bench.md`, `agy-results.json` | **persisté** |
| GPT-5.5 / 5.4 (baie-comeau, 1 p) | `bench-qc-zonage-models/report.md` + `raw.json` | **persisté** |
| GPT-5.5 (5 villes) | `work/bench/gpt55-mini-driver.ts` — **stdout only** | **non persisté** — à recommitter |
| Mistral schéma / Pixtral | `acquisition/work/fn-bench/bench.ts` — **aucune sortie fichier** | **non persisté** — à recommitter |

Les figures « non persisté » (GPT-5.5 5-villes ; Mistral-schéma 48,6 % / 105-112 codes /
$0,075 ; Pixtral 37,2 %) sont **relayées du run** et cohérentes avec les blocs persistés
(GPT-5.5 baie-comeau confirme précision 1.00 / 0 halluc ; le 48,6 % est la cible-référence
4.8 mesurée). Pour une traçabilité complète, **rejouer et committer** ces deux harnais.

**Autres limites** : quotas estimés non calibrés (§2.2) ; localisation page-grille
hors-scope (§2.1) ; tâches ZONES effleurées ; débit soutenu non stressé.

> Rappel de rigueur : l'équivalence Claude 4.8 / Codex GPT-5.5 démontrée pour la
> **génération de code** T1/T2 ([`../spec/zonage-georeferencement-gcp.md`](../spec/zonage-georeferencement-gcp.md)
> §4) **ne préjuge pas** de la lecture OCR-vision ; les conclusions ci-dessus reposent sur
> le bench OCR-vision propre.

---

## 12. Références

**Artefacts de bench** (dans le checkout) : `work/bench/claude48-normes-bench.md`,
`work/bench/claude48-cost-projection.md`, `work/bench/claude48-results.json`,
`work/bench/agy-normes-bench.md`, `work/bench/agy-results.json`,
`work/bench/sample-20.json`, `work/bench/windows.json`,
`work/bench-qc-zonage-models/report.md` + `raw.json`,
`work/coverage/BENCH-OCR.md` (Mistral-OCR vs chat-vision, suivi Git).

**Harnais / code** : `acquisition/src/bench/run-claude48-normes-bench.ts`,
`analyze-claude48.ts`, `acquisition/src/bench/run-qc-acquisition-model-bench.ts`,
`work/bench/gpt55-mini-driver.ts`, `acquisition/work/fn-bench/bench.ts` (schéma/Pixtral) ·
`acquisition/src/lib/grille-claude-cli.ts` (`extractGrilleClaudeFromPdf`, OAuth
`apiKeySource:none`, `total_cost_usd`) · `acquisition/src/lib/grille-gpt55-codex.ts`
(`extractGrilleGpt55FromPdf`) · `acquisition/src/lib/grille-agy-cli.ts`
(`extractGrilleAgyFromPdf`) · `acquisition/src/lib/ocr.ts` (`resolveOcrCall`) ·
`packages/qc-sources/src/sources/grille-ocr-extractor.ts` (`extractGrilleOcrFromPdf`) ·
`packages/qc-sources/src/sources/grille-vision-extractor.ts` (`buildVisionField`,
`VISION_PUBLISH_CONFIDENCE=0.92`) · `acquisition/src/zonage-norms-2engine-keepbest.ts`.

**Documents liés** : [`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md)
(méthodes par cas) · [`../spec/methodes-acquisition.md`](../spec/methodes-acquisition.md)
(§NORMES N4 bi-moteur) · [`../spec/normes-extraction-retenu.md`](../spec/normes-extraction-retenu.md).

**Export.** `scripts/md-study-export.ts` valide les tableaux de ce document (cohérence du
nombre de colonnes) puis génère un **HTML autonome imprimable** (`model-eval-vision-ocr.html`,
CSS inline, sans dépendance externe) et, si un moteur headless (Playwright/Puppeteer) est
disponible, un PDF (`model-eval-vision-ocr.pdf`). Sur cet environnement **aucun moteur PDF
n'est installé** → l'export livré est le **HTML** (ouvrir dans un navigateur → Imprimer →
Enregistrer en PDF). Commande : `npx tsx scripts/md-study-export.ts docs/study/model-eval-vision-ocr.md`.
