# Protocole de VALIDATION / BENCHMARK — route vision-résidu + route OCR (ADR-0024, ré-ouverture)

> **Type** : protocole QA-rules / contrat (wp6). **Auteur** : geo-archi (owner ADR-0024). **Amont** : l'owner a
> **nommé le pool** de candidats et **sanctionné le benchmark OCR** (verbatim relayés via i-cond → geo-cond). Ce
> document est **le PROTOCOLE de validation**, PAS la sélection : l'owner a désigné le pool ; la validation **gate
> quels candidats qualifient**. **Corrections mesh/owner intégrées** : **coût/page = critère premier-rang** (route OCR), **coordination
> cross-lane = geo-cond**. **⚠ Statut de résolution (mesh set-wide 2026-09-05)** : **RÉSOLU-PRÊT** {luna, terra,
> sonnet-5} ; **SLOTS GATÉS** codex-spark (codex-restore 6/09) + gemini (**non-résolu** : AGY sans flash → owner).
> **`gemini-3.8-flash` et `codex-5.3` ne sont PAS écrits en dur** (anti-id-fantôme). **Statut : DRAFT `proposed`.** Le **flip ADR-0024 → `accepted`** ride sur le **record owner-direct
> capté** (i-cond) — verbatim + session-id + timestamp + question exacte ; le relais verbatim est une preuve forte,
> mais le flip d'un doc à historique €480 ride sur le record réel, pas sur un résumé.

> **✅ FINALISÉ (2026-09-06) — reframe owner appliqué + benchmark intégré.** Coût/page **retiré** (OCR/vision via CLI
> enrôlée = **gratuite**, coût **subsumé par la containment ADR-0032** ; **4 protections €480 maintenues** : ban
> `mistral-medium` + id-vision-explicite `vision-engine-policy` + containment-quota ADR-0032 + validation-QUALITÉ).
> **Axe unique = QUALITÉ.** Autorité = ce doc + le dossier pipeline (§2.6 / §7-GATE#1).
>
> **RÉSULTATS BENCHMARK** — corpus GOLD `sample-20` (≤2 pages/ville), transport **codex-CLI** (gratuit, **pas gateway**) ;
> runner + rapport committés `bd010c90` :
>
> | modèle | villes | zones | publiés ≥0.85 | anti-invention | recoupSig | vitesse |
> |---|---|---|---|---|---|---|
> | **`gpt-5.6-luna`** | 16/20 | 333 | **1083/2331 = 46.5 %** | **0 fabriqué ✅** | 0.216 | **~2.5× terra** |
> | `gpt-5.6-terra` | 16/20 | 329 | 747/2303 = 32.4 % | 0 fabriqué ✅ | 0.216 | 1× |
>
> **VERDICT geo-archi** : **`gpt-5.6-luna` = défaut vision-résidu** — net supérieur (46.5 % vs 32.4 %, **same-corpus**),
> correctness SIG **égale** (recoupSig 0.216 les 2, overlap 313≈314), **~2.5× plus rapide**, **0 anti-invention** (les 2
> passent). **Caveat mesuré** : recoupSig absolu bas (~0.22) = **artefact de fenêtre** (≤2 pages vs SIG complet),
> identique aux 2 → **pas un échec modèle**. **vs `mistral-ocr` = DIRECTIONNEL seulement** (`BENCH-OCR.md` = 8 villes
> **DIFFÉRENTES**, 27.3 %, pas same-corpus, pas 1:1) — **ne pas sur-affirmer**.
> **RATIFICATION** : geo-archi **ratifie `luna` comme MODÈLE** (délégation ADR-0024 « à ratifier par geo-archi » +
> benchmark `bd010c90`) ; l'**ACTIVATION de la route vision** reste **gatée sur GATE#1 owner** (dossier §7). **ADR de
> suivi (decisions.md) à graver post-merge #363** (headroom PR + numérotation).

## 0. Disciplines qui cadrent ce protocole
- **[FAIT]** ADR-0024 = doc gouvernance **à historique €480** (`docs/decisions.md:483-489`). Cause verbatim : modèle
  cher « **codé en dur comme défaut** » des 3 classes vision, jamais le vision-chat sanctionné → « **dérive de code
  au-delà du décidé** », **non détectée avant la facture** (€480, 319 munis, preuve `work/coverage/normes-provenance.json`).
- **[FAIT]** **0-Mistral** : la validation tourne sur **grilles-gold déjà extraites** — **aucun re-fetch, aucun
  re-paiement**.
- **[JUGEMENT]** **Nommer ≠ waiver la validation.** L'owner a dit validation **OUI** + a nommé le pool. La validation
  ne re-sélectionne pas ; elle **prouve que le candidat marche** avant de le laisser servir. C'est le cœur d'ADR-0024.

## 1. Candidats résolus + **3 chemins d'invocation** (⚠ 2 hors-garde)

| candidat | chemin d'invocation | gardé par | résolution (mesh set-wide, 2026-09-05) |
|----------|--------------------|-----------|----------------------------------------|
| `gpt-5.6-luna` | gateway-catalogue | `assertVisionModelAllowed` ✓ | **RÉSOLU-PRÊT** (`catalog.ts:285`) |
| `gpt-5.6-terra` | gateway-catalogue | `assertVisionModelAllowed` ✓ | **RÉSOLU-PRÊT** (`catalog.ts:277`, OCR) |
| `claude-sonnet-5` | gateway-catalogue | `assertVisionModelAllowed` ✓ | **RÉSOLU-PRÊT** (`catalog.ts:345`) |
| **codex-spark** (« codex 5.3 ») | **codex CLI** (h2a enroll, quota-compte) | ⚠ **HORS garde gateway** | **SLOT — GATÉ codex-restore** : mesh ne résout pas (CLI `-m string`→provider) ; `codex exec -m spark` sous compte enrôlé confirme post-6/09 |
| **gemini** (« 3.8 flash ») | **gemini-agy CLI** *(si elle existe)* (quota-compte) | ⚠ **HORS garde gateway** | **SLOT — NON-RÉSOLU** : l'AGY-mesh-transport ne porte **aucun flash** (`providers.ts:93-99` = `gemini-3-pro-high/low`). Résolution owner (d), 3 voies : **(i)** gemini-agy CLI si elle existe (bypass provider comme codex-spark → provider-confirm) · **(ii)** `gemini-3-pro` (catalogue) · **(iii)** étendre la flotte (acte) ; + **agy-fix `8aee7f615`** |

- **[FAIT — groundé]** La garde `assertVisionModelAllowed` (`packages/qc-sources/src/sources/vision-engine-policy.ts:45`)
  garde **uniquement les 3 constructeurs vision gateway** (`grille-vision-{extractor,multizone,zoneheader}.ts`), sur une
  **chaîne model-id**. `git grep codex(exec|spark|cli)` en geo = **0**.
- **[JUGEMENT — catch ①, le trou réel]** Les **2 chemins enroll** (codex-spark CLI, gemini-agy CLI) **ne traversent
  aucun** de ces constructeurs → **la garde anti-€480 ne les couvre pas**. Ce n'est plus 1 modèle mais **2** qui
  bypassent la garde. Ils exigent un **point d'enforcement SÉPARÉ** (§6), sinon on **ré-ouvre le mode-de-défaillance
  €480 sur les chemins non-gardés**.

## 2. L'invariant €480 (pourquoi la validation existe)
**[JUGEMENT]** Un modèle **utilisé sans PROUVER qu'il marche** → dérive non-détectée → facture. L'invariant
s'applique à **chaque candidat**, **chaque chemin d'invocation**, **chaque route** (vision ET OCR). Aucune exception
« il est nommé par l'owner » — nommé = candidat, pas prouvé.

## 3. Corpus grilles-gold (0-Mistral) + **précondition de reproductibilité**
- **[FAIT]** Truth-set = grids **déjà extraites** avec valeurs **par-cellule connues-correctes** (natif + OCR + un
  sous-ensemble vérifié). Ancrage : `work/coverage/normes-provenance.json` (×319). **Aucun re-paiement Mistral.**
- **[JUGEMENT — précondition wp6, non-optionnelle]** Le corpus-gold **doit être committé ou S3-capté**, jamais
  local. Un gold-set local = « **vert par omission = rouge** » : la validation **ne prouve rien** si son propre
  truth-set n'est pas reproductible sur un checkout propre. Le build-lane **pin le gold-subset depuis un URI
  documenté** avant d'exécuter le harness.

## 4. Deux routes, deux profils de scoring (un seul harness)

### Route A — VISION-résidu (validation **qualité-gatée**)
- **Rôle** : modèle-fort **sur le résidu mesuré seulement** (cellules non résolues par natif+OCR). **Cascade-LLM-minimal.**
- **Critères** : (i) **exact-match par-cellule** vs gold ; (ii) **no-drift** (JSON-strict-par-cellule, **anti-décalage**
  ligne/colonne) ; (iii) **`unknown`-on-failure** (jamais deviner — anti-invention ; un silent-guess = **échec**).
- **Barre** : le candidat doit **BATTRE ce que natif+OCR font déjà sur le résidu** — sinon il ajoute du coût **sans
  gain**. (Barre exacte = §9a, owner-ratifiable.)
- **Candidats** : **`{luna, terra}`** — **défaut = `gpt-5.6-luna`** (benchmark `bd010c90`, voir en-tête). *(`sonnet-5` =
  alias→luna ; `gemini` gaté Cloud Code ; `codex-spark` gaté codex-restore.)*

### Route B — OCR (**UNIFIÉE avec Route A : axe QUALITÉ, coût RETIRÉ**)
- **[FINALISÉ — reframe owner]** Le « coût/page premier-rang » **est RETIRÉ** : OCR/vision via **CLI enrôlée = gratuite**
  (quota-compte, coût **subsumé par ADR-0032**). ⟹ **Route B se confond avec Route A** — un seul axe = **QUALITÉ**
  (exact-match/cellule, no-drift, `unknown`-on-failure). Le mécanisme est **extraction vision-chat** (pas `/v1/ocr`
  dédié) — **assumé** (gratuit via CLI, qualité **mesurée** : voir en-tête, luna 46.5 % vs terra 32.4 %).
- **Défaut = `gpt-5.6-luna`** (benchmark) ; **`mistral-ocr`** reste disponible (cheap, dédié) comme fallback OCR-natif.
- *(PÉRIMÉS par le reframe : l'ancien « catch② coût 100–1000× » et le « garde-fou-amont pro-vs-flash » — **moot** sous CLI
  gratuit + containment ADR-0032. La comparaison vs mistral-ocr reste **directionnelle** — corpus différent, voir en-tête.)*

## 5. Gate coût (go-live) — **SUBSUMÉ par ADR-0032** (estimation coût/page retirée)
- **[FINALISÉ]** L'estimation coût/page-avant-activation **est retirée** (moot : CLI enrôlée **gratuite**). Le gate coût
  go-live **= la containment ADR-0032** (compte-par-lane : **quota externe = cap** · **révocation-compte = kill-switch** ·
  **429 fail-closed**). C'est le pattern **€50/GATE** (`GATE.md:10-14` : cap **externe** prouvé-par-refus) porté au
  niveau **compte-par-lane** — structurel, **pas** un émetteur coût/page. Le scénario €480 (facturation métrée
  emballée) **ne peut pas se produire** sur le chemin CLI enrôlé (quota capé, fail-closed).

## 6. Carte des points d'enforcement (contrat) — **le livrable central wp6**
- **gateway vision** (`gpt-5.6-luna`, `gpt-5.6-terra`, `claude-sonnet-5`) → `assertVisionModelAllowed` : **ajouter les
  ids résolus à la VALIDATION RÉUSSIE** (jamais avant — un id non-validé dans l'allowlist = régression).
- **enroll** (codex-spark CLI, gemini-agy CLI) → **ENFORCEMENT SÉPARÉ (catch ①)** : **cap quota-compte** + **gate DAG
  `needs_llm`** + **kill-switch** + **pas-de-défaut-silencieux**. **PAS l'allowlist gateway** (ils ne la traversent
  pas). ⟹ **nouvel invariant à graver dans l'ADR** : « tout chemin LLM hors-gateway porte son propre plafond
  quota-compte + kill-switch ; un chemin d'invocation non-plafonné est un défaut, pas un livrable ».
- **OCR** → backend `OCR_PROVIDER`/`OCR_MODEL` + gate coût §5. **mistral-ocr reste sanctionné (baseline)** TANT QUE
  l'owner ne le déprécie pas **explicitement** avec (a)(b)(c) visibles.

## 7. Séquencement (blocker Codex → 6/09)
- **MAINTENANT** : ce protocole + critères + **ADR-proposed** + précondition gold-corpus. **[FAIT]** host-side
  (codex-CLI-spark, enroll **déjà satisfait host-side** per mesh) → **le run de validation est possible dès Codex
  restauré**, sans attendre l'egress.
- **POST-restauration** : RUN validation/benchmark (host-side). **In-cluster (Act 2)** = **owner-gated**
  (credential-location + egress) — hors de ce protocole.

## 8. wp6 / build-lane split
- **MOI (wp6)** : ce **protocole** (QA-rules/contrat), la **carte d'enforcement** (§6), les **barres** (§9), le
  **nouvel ADR** (proposed). **Actes de contrat, pas de code.**
- **BUILD-LANE** (geo-zones extraction / geo-socle host) : le **harness** (exécute le scoring), **l'ajout des
  ids-passants** à la policy, **le run**, le câblage host-side/CLI. **Ne prend pas le protocole.**
- **Flip ADR → accepted** : record owner-direct capté (i-cond).

## 9. Ce qu'il reste à l'owner (surface de décision résiduelle)
- **(a) Barre-de-passage qualité** (ratifier le seuil). Proposition geo-archi : Route A « **≥ baseline natif+OCR sur
  résidu** » ; Route B « **coût/page justifié vs $0.001 mistral-ocr** + qualité ≥ baseline ».
- **(b) Route B, post-chiffré** : trancher **luna-vs-terra** + **garder/éteindre mistral-ocr** (avec (a)(b)(c)).
- **(c) Précondition gold-corpus reproductible** (committé/S3) — **pas optionnelle** (§3).
- **(d) Gemini** : ⚠ **NON-RÉSOLU** — l'AGY-mesh-transport ne porte **aucun flash** (`providers.ts:93-99` =
  `gemini-3-pro-high/low`). Résolution owner, **3 voies** : **(i)** une **gemini-agy CLI** si elle existe (bypass
  provider comme codex-spark → **provider-confirm** requis) ; **(ii)** **`gemini-3-pro`** (→ §4B garde-fou pro-coût) ;
  **(iii)** **étendre la flotte AGY** (acte). + **agy-enroll fix `8aee7f615`**. **Ne pas écrire `gemini-3.8-flash`**
  (id-fantôme tant que non-résolu).

## 10. Disclosure d'intérêt-agent
**0 intérêt** à choisir un modèle (je n'en ai pas) ni à re-débattre le pool (owner-nommé). Je porte **uniquement** :
la **validation-€480-safety**, l'**anti-id-fantôme**, la **carte d'enforcement** (les 2 chemins enroll **hors-garde**),
et la **reproductibilité du gold**. Intérêt **owner** = ne pas re-vivre €480 **sur un chemin non-gardé** (le risque que
les 2 chemins enroll introduisent s'il n'est pas plafonné).
