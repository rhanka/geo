# Éval des modèles vision/OCR pour l'extraction des grilles de normes

_Statut : rapport d'évaluation. Branche `feat/cadre-acquisition`, HEAD `b926314`.
Date 2026-07-04._

Ce rapport évalue **par modèle** les moteurs de lecture de grilles de normes
(`qc-zonage-norms-<slug>`), sur trois axes : **correctness** (recoupement SIG, champs
publiés, hallucinations), **consommation** (tokens, coût API-équivalent, coût RÉEL sur
le compte) et **projection sur le résidu** (~434 zones + ~632 normes ≈ 1066 tâches-muni).

Le pendant « méthodes par cas » (quel parser/route pour quelle grille) est
[`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md). La règle
transverse verbatim-ou-null (`buildVisionField`) est **héritée par tous les moteurs** :
l'invention est structurellement impossible quel que soit le modèle — la comparaison
ci-dessous ne porte donc PAS sur la sécurité (0 fausse valeur partout) mais sur le
recall, la robustesse, le coût et la latence.

## 1. Synthèse par modèle

| Modèle | Route (code) | Correctness | Conso / muni | Coût API-équiv | Coût RÉEL | État |
|---|---|---|---|---|---|:--:|
| **Claude Opus 4.8** (xhigh) | `lib/grille-claude-cli.ts` (`claude -p`, OAuth) | recoupE 0.866 · fieldPct 45.2% · lit glyphes+scans | ~90,4k in / ~17,4k out | $0,884/muni | **0 $** (abonnement, borné fenêtre 5 h) | ✅ mesuré |
| **Mistral-OCR-4** | `lib/ocr.ts` (`/v1/ocr`) | fort recall multizone · **casse sur transposé** | ~pages | ~$0,001/page | crédits Mistral | ✅ mesuré |
| GPT-5.5-xhigh | `lib/grille-gpt55-codex.ts` | — | — | — | crédits GPT | ⏳ en attente |
| GPT-5.4-xhigh | `bench/run-gpt55-ocr-bench.ts` | — | — | — | crédits GPT | ⏳ en attente |
| Gemini-3.5-high / agy | (bench en cours) | — | — | — | crédits Gemini | ⏳ en attente |
| Mistral-instruit (schéma) / Pixtral | (test en cours) | — | — | — | crédits Mistral | ⏳ en attente |

---

## 2. Claude Opus 4.8 (xhigh) — chiffres RÉELS du bench

Source : `work/bench/claude48-normes-bench.md`, `work/bench/claude48-cost-projection.md`,
`work/bench/claude48-results.json` (généré 2026-07-04, modèle `claude-opus-4-8`, effort
`xhigh`, route Engine-B `claude -p` OAuth `apiKeySource:none`, fenêtre ≤6 pages/ville,
DPI 200). Producteur : `acquisition/src/bench/run-claude48-normes-bench.ts` +
`analyze-claude48.ts`. Échantillon : `work/bench/sample-20.json` (20 villes, layouts
mixtes), fenêtres `work/bench/windows.json`.

### 2.1 Correctness

Définitions : `recoupExtracted` = overlap / codes-lus (**précision**, équitable-fenêtre) ·
`recoupSig` = overlap / codes-SIG (**rappel**, borné par la fenêtre ≤6p) · `fieldPct` =
champs-normes publiés verbatim-ou-null · hallucination = code lu absent du SIG.

| Agrégat (villes SIG ∧ zones lues = 11/20) | Valeur |
|---|---|
| recoupExtracted moyen (précision) | **0.866** |
| recoupSig moyen (rappel, borné-fenêtre) | 0.21 |
| publishedFieldPct moyen | **45.2 %** |
| Overlap total / codes-SIG total | 281 / 5415 |
| Codes-lus total | 305 |
| Hallucinations (codes lus hors-SIG) | 24 / 305 (7.9 %) |

**Lecture rigoureuse des 97.6 % / « 0 hallucination ».** Les 24 codes hors-SIG se
concentrent sur **east-broughton** (17/17), un **scan-image** où la lecture a échoué en
bloc (overlap=0, fieldPct=0) : c'est une non-lecture, pas une invention de valeur. En
écartant ce raté-scan, la précision **pondérée par overlap** est **281/288 = 97.6 %**, et
il reste 7 codes hors-SIG (baie-comeau 4, ferme-neuve 1, levis 2) — plausiblement des
codes réels absents de la couche SIG plutôt que des inventions. Surtout, le **dépôt** est
filtré par le gate crossval (`shouldRejectForZeroOverlap`, pont numérique) : **aucun code
hors-SIG n'est servi**. Les champs publiés servis passent tous `buildVisionField`
(verbatim-ou-null) → **0 fausse valeur servie**. La fourchette « 50-55 % champs » citée en
objectif reste au-dessus du **45.2 % mesuré** ici : on retient le chiffre mesuré.

Extrait par ville (les productives ; artefact complet dans `claude48-normes-bench.md`) :

| ville | layout | overlap/SIG | recoupE | fieldPct | halluc | dépôt (codes/pub%) |
|---|---|--:|--:|--:|--:|--|
| baie-comeau | override | 80/237 | 0.952 | 37.9 | 4/84 | 257 / 45.8 |
| ferme-neuve | override (texte) | 34/112 | 0.971 | 48.6 | 1/35 | — |
| girardville | override | 48/105 | 1.0 | 62.5 | 0/48 | — |
| saint-gabriel-de-rimouski | override | 65/66 | 1.0 | 0 | 0/65 | — |
| sept-iles | override | 30/667 | 1.0 | 50 | 0/30 | 640 / 55.4 |
| east-broughton | **image-scan (raté)** | 0/78 | 0 | 0 | 17/17 | 0 / 0 |

### 2.2 Consommation & coût

Prix liste Opus 4.8 : **$5.00 / 1M in · $25.00 / 1M out**. `in total` inclut les tuiles
image (`cache_creation` + `cache_read`). `API-$` = `total_cost_usd` rapporté par le CLI
(fait foi, tarifie correctement les tokens-image cachés).

| Métrique / muni (villes productives) | Valeur |
|---|---|
| Tokens in (incl. image) | **90 429** |
| Tokens out (gonflé par le raisonnement xhigh) | **17 449** |
| **API-$ / muni** (équivalent-API) | **$0.884** |
| Temps / muni | 152 s (sur 20) · 249 s (sur 11 productives) |
| Total 20 villes | API-$ = $12.08 · out = 202 139 tok |

**Coût RÉEL = 0 $.** Engine-B est servi par l'**abonnement Claude OAuth** : le CLI
rapporte `apiKeySource: none` et une fenêtre de rate-limit `five_hour` avec dépassement
**REJETÉ** (jamais de facturation silencieuse) — vérifié dans `lib/grille-claude-cli.ts`.
Le `total_cost_usd` est donc un **équivalent-API « fantôme »**, pas une dépense. La seule
contrainte est la **fenêtre glissante 5 h** : ~**114.6 munis / fenêtre** (hypothèse
2 000 000 tokens-out/fenêtre ÷ 17 449 out/muni — **à calibrer sur un vrai
`rate_limit_event`**), soit le résidu normes en ~**5.5 fenêtres ≈ 1.1 jour** (@ ~5
fenêtres/jour).

> Note : le `out` élevé (raisonnement xhigh) domine à la fois l'API-$ (×$25/1M) ET la
> conso d'abonnement. Baisser l'effort (`high`) réduirait fortement les deux, au prix
> d'un peu de qualité.

### 2.3 Projection sur le résidu

| modèle | tokens/muni (in/out) | API-$/muni | $ / 632 normes | $ / 1066 (est.) | conso réelle |
|---|---|--:|--:|--:|---|
| **Claude Opus 4.8** | 90 429 / 17 449 | $0.884 | **$559** | ~$942 | **0 $** ; ~5.5 fenêtres 5 h (~1.1 j) |
| Mistral-OCR-4 | ~pages | $0.001/page | ~$3.79 (6p/muni) | ~$6.4 | crédits Mistral |

La projection **632 normes = $559** est la plus fondée (le bench mesure des grilles de
NORMES). Le **1066** réutilise le même coût/muni comme **borne haute** : les 434 tâches
ZONES (lecture de glyphes de plans) sont plus légères et coûteraient moins.

---

## 3. Mistral-OCR-4 — fast-path des grilles simples, casse sur transposé

Source : `work/coverage/BENCH-OCR.md` (2026-06-23, 8 villes) + code
(`lib/ocr.ts`, `grille-ocr-extractor.ts`). Coût : **~$0,001/page** (`lib/ocr.ts`) —
~$0.0020/ville à 2 pages, **5–10× moins cher** et **3–10× plus rapide** que le
chat-vision (5–9 s vs 12–79 s). **0 fausse valeur** (garde `buildVisionField` partagé).

**Là où il gagne — multizone dense (zones-en-colonnes).** Recall égal ou supérieur au
chat-vision (saint-raymond 60 vs 44 champs publiés ; sutton 6 zones vs 0 ; stratford 26
zones vs chat-vision **en erreur JSON**), et **plus robuste** : le chat-vision
`mistral-medium` renvoie du JSON malformé sur les grilles 13 colonnes ; l'OCR Document-AI
ne casse pas. → route `ocr` primaire pour N-h.

**Là où il casse — grilles TRANSPOSÉES.** La linéarisation markdown de l'OCR **perd
l'association colonne-zone ↔ valeur** : le mapper lit alors la colonne d'USAGES
(`H1/C1/I3…`) comme codes de zone → overlap=0, et fieldPct s'effondre. Illustration
**ferme-neuve** : en OCR-nu, 106 codes lus / ~88 % overlap **mais fieldPct = 0** (valeurs
non associées), contre **48.6 %** de champs publiés par Claude 4.8 sur la même grille.
Or ferme-neuve avait en réalité une **couche texte native** → le vrai correctif est le
**parser natif $0** (route `override`/`native-text`, cf.
[`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md) §2.1),
pas un LLM. C'est pourquoi les parsers transposés natifs (N-e/N-f) passent **avant** l'OCR.

**Scan vertical 1-zone/page.** L'OCR aplatit la fiche et sur-segmente : saint-stanislas
**3.6 %** publiés (2/56) contre **100 %** (14/14) au chat-vision. → route `vision` pour N-i.

**Limite d'instruction.** L'endpoint `/v1/ocr` **n'a pas de canal de prompt** : on ne
peut pas lui donner de schéma ni d'instruction anti-invention en amont — toute la garde
est appliquée **en aval** (`findGrilleTables` + `buildVisionField`). C'est la différence
structurelle avec un LLM instruit (§4).

---

## 4. ⏳ EN ATTENTE — modèles à benchmarker (placeholders)

À compléter avec les VRAIS chiffres quand les benchs finissent (mêmes PDFs/pages que
Claude-4.8, mêmes métriques recoupE/fieldPct/halluc/tokens/coût pour une comparaison
symétrique).

| Modèle | Harnais | À remplir |
|---|---|---|
| **GPT-5.5-xhigh** | `acquisition/src/bench/run-gpt55-ocr-bench.ts` (+ `lib/grille-gpt55-codex.ts`) | recoupE · fieldPct · halluc · tokens in/out · crédits GPT · casse-t-il aussi sur transposé ? |
| **GPT-5.4-xhigh** | bench codex (en cours) | idem |
| **Gemini-3.5-high / agy** | bench (en cours) | idem + coût crédits Gemini |
| **Mistral-instruit (schéma) / Pixtral** | test (en cours) | est-ce qu'un canal de prompt corrige la casse transposée de l'OCR-nu ? |

> Rappel de rigueur : l'équivalence Claude 4.8 / Codex GPT-5.5 démontrée pour la
> **génération de code** T1/T2 ([`../spec/zonage-georeferencement-gcp.md`](../spec/zonage-georeferencement-gcp.md)
> §4) **ne vaut pas** pour la lecture OCR-vision de grilles. Aucune conclusion
> GPT-5.5/Gemini OCR-vision avant un bench symétrique.

---

## 5. Verdict & recommandation

- **Workhorse = Claude Opus 4.8** sur l'abonnement OAuth : **coût réel 0 $**, lit les
  glyphes ET les scans, 0 fausse valeur servie, résidu normes faisable en ~1 jour sous la
  fenêtre 5 h. C'est le moteur par défaut d'Engine-B.
- **Fast-path = Mistral-OCR-4** sur les grilles multizones SIMPLES (zones-en-colonnes
  denses) : ~$0,001/page, robuste, ~12 lanes parallèles tolérables. Réservé aux cas où
  la linéarisation markdown ne casse pas l'association valeur↔zone.
- **Le goulot n'est pas le modèle** : c'est la **localisation de la page-grille** dans un
  règlement codifié (annexe enterrée) — traité par `--auto-grid-page` + fenêtres vérifiées
  ([`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md) §3), pas
  par un changement de modèle. Un meilleur modèle sur la mauvaise page reste à 0 zone.

---

## 6. Références

**Artefacts de bench** (untracked, dans le checkout) : `work/bench/claude48-normes-bench.md`,
`work/bench/claude48-cost-projection.md`, `work/bench/claude48-results.json`,
`work/bench/sample-20.json`, `work/bench/windows.json` ·
`work/coverage/BENCH-OCR.md` (Mistral-OCR vs chat-vision, suivi Git).

**Code** : `acquisition/src/bench/run-claude48-normes-bench.ts`, `analyze-claude48.ts`,
`run-gpt55-ocr-bench.ts` · `acquisition/src/lib/grille-claude-cli.ts` (`CLAUDE_MODEL`,
`CLAUDE_EFFORT`, OAuth `apiKeySource:none`, `total_cost_usd`) · `acquisition/src/lib/ocr.ts` ·
`packages/qc-sources/src/sources/grille-vision-extractor.ts` (`buildVisionField`,
`VISION_PUBLISH_CONFIDENCE=0.92`) · `acquisition/src/zonage-norms-2engine-keepbest.ts`.

**Documents liés** : [`../spec/zonage-extraction-methods.md`](../spec/zonage-extraction-methods.md)
(méthodes par cas) · [`../spec/methodes-acquisition.md`](../spec/methodes-acquisition.md)
(§NORMES N4 bi-moteur) · [`../spec/normes-extraction-retenu.md`](../spec/normes-extraction-retenu.md).
</content>
