# SPEC — Re-capture-avec-preuve de la grille (pipeline vision) — prérequis au benchmark de remplacement

> **Statut : DRAFT normatif — OWNER-GATED. Authoring (design), pas une capture.** Date : 2026-08-16.
> Auteur : geo-archi (`claude:archi`, WP6). GO conducteur : geo-cond (après convergence §1.5). Vocabulaire
> DOIT / NE DOIT PAS / PEUT au sens RFC 2119.
>
> **Grounding (lu) :**
> - `docs/spec/SPEC_CAPTURE_ON_CLUSTER.md` (contrat de capture général : CAS `raw/<source>/cas/<sha256>`,
>   `manifest.jsonl`, immuabilité §2.5, no-secret C-6, `proofFromFetched` §3.1, vision = inférence sur octets
>   déjà captés §4.2). **CE contrat le SPÉCIALISE pour le pipeline vision, il ne le réinvente pas.**
> - `bench/vision/BENCH_VISION_REPORT.md` (`bench/vision-replacement-20260815 @f27fc793`) — le STOP anti-invention
>   qui motive ce contrat.
> - `packages/qc-sources/src/sources/grille-vision-saint-stanislas.fixture.ts` — la baseline mistral orpheline.
> - `acquisition/src/lib/zonage-proof.ts` — le patron de preuve v2 (url/retrieved_at/sha256).
>
> **Anti-invention** : les images exactes vues par mistral sont PERDUES et irrécupérables ; ce contrat ne
> fabrique aucune liaison rétroactive. **HOLD** : rien de ratifié (allowlist candidat) sans double-consensus + OK owner.

---

## 1. Objet & constat

Le benchmark de remplacement vision (post-ban mistral-medium/pixtral, ADR-0024) est **BLOQUÉ** : la baseline
mistral existe (`grille-vision-saint-stanislas.fixture.ts`, 5 pages, 2 passes, 8 champs/page, 2026-06-21) mais
**les images EXACTES soumises au modèle n'ont jamais été capitalisées** (pas de `png_sha256`, pas de recette
de rendu). Mesurer la fidélité d'un candidat sans l'entrée exacte = **inventer l'entrée de comparaison**
(BENCH_VISION_REPORT `@f27fc793`). Même classe que « preuve-v2 exacte 0/1106 » (SPEC_CAPTURE_ON_CLUSTER §0) :
une baseline déclarative sans capture adossée est sans valeur probante.

Ce contrat **retire le blocage** en spécifiant (a) la chaîne de preuve à 3 maillons du pipeline vision et
(b) la vérité-terrain du benchmark. **Portée** : pipeline d'extraction de grille (`PDF source → PNG rendu →
cellules du modèle`), specialization de SPEC_CAPTURE_ON_CLUSTER.

## 2. La chaîne de preuve à 3 maillons *(le maillon rompu)*

| Maillon | Artefact | Clé CAS / stockage | Manifeste | Statut aujourd'hui |
|---|---|---|---|---|
| **L1 — PDF capté** | octets PDF source | `raw/normes-grille/cas/<pdf_sha256>.pdf` | ligne `manifest.jsonl` (url, retrieved_at, sha256) | partiel (PDF stagé par slug, sans sha/instant — §1.5 capture spec) |
| **L2 — RENDU** *(nouveau)* | PNG soumis au modèle, **par page** | `raw/normes-grille-render/cas/<png_sha256>.png` | recette de rendu (§3) | **absent** |
| **L3 — EXTRACTION** *(résultat)* | cellules brutes par passe | `registry/…` (c'est un **résultat**, §4.2 capture spec) | liaison (§3) | présent mais **non lié à un `png_sha256`** |

- **L1** relève du chokepoint `capturedFetch` (capture spec §5.1, C-0) — **rien à réinventer**.
- **L2** est un **parsing déterministe** (PDF→PNG) → légitime en local OU cluster (capture spec §4.2), entrée
  lue depuis `raw/`. La détermination est **exigée** : `(pdf_sha256, recette)` DOIT reproduire le **même**
  `png_sha256` (sinon l'image n'est pas re-dérivable = pas de preuve). Outil + version figés.
- **L3** est de l'**inférence sur octets déjà captés** → légitime (capture spec §4.2), entrée = `raw/…/png`.
  Sa sortie va où vont les résultats (`registry/`), **jamais** `normalized/` (C-5).

## 3. Le manifeste immuable de liaison *(le livrable clé)*

Un manifeste `grille-vision-proof`, **une entrée par (grille, page)**, liant L1+L2+L3 par le **MÊME
identifiant d'image** (`png_sha256`) :

```jsonc
{
  "grille_id": "<city_slug>/<doc>/<page>",
  "city_slug": "saint-stanislas-de-kostka",
  "page": "A-2",
  "pdf_sha256": "sha256:<hex64>",
  "pdf_capture": { "url": "<http(s) réel>", "retrieved_at": "<ISO-8601>" },   // de L1 (manifest.jsonl)
  "render_recipe": { "tool": "pdftoppm", "tool_version": "<x.y.z>", "dpi": 300, "page_index": 2 },
  "png_sha256": "sha256:<hex64>",                                             // dérivé déterministe de (pdf, recette)
  "extractions": [
    { "model": "<id>", "model_version": "<v>", "pass": 1,
      "raw_cells": { /* champs → valeur */ }, "nulls_explicit": ["<champ absent>"], "at": "<ISO-8601>" }
  ]
}
```

Règles (héritées de SPEC_CAPTURE_ON_CLUSTER, non négociables) : immuabilité **HEAD-skip + garde CAS** (§2.5),
**aucun secret** dans le manifeste ni un log (C-6), objets `raw/` **jamais supprimés** par un script (C-7).
`png_sha256` est **l'identifiant de liaison** : il rend une extraction re-jouable sur **exactement** la même image.

## 4. Vérité-terrain du benchmark *(le point délicat — anti-invention)*

**La sortie mistral historique NE PEUT PAS servir de référence de fidélité** : elle est **orpheline** (liée à
aucun `png_sha256`), et mistral est **banni** (ADR-0024) → impossible de la re-lier en re-exécutant. Donc :

- **RÈGLE V-1.** La fidélité d'un candidat se mesure contre une **vérité-terrain VÉRIFIÉE HUMAINEMENT**, liée à
  un `png_sha256`, avec **nulls explicites** — **jamais** contre une sortie de modèle non liée/non vérifiée.
- **RÈGLE V-2.** Une sortie mistral historique PEUT servir de **point de départ** à la vérification humaine, mais
  n'est la référence **qu'une fois vérifiée ET liée** à l'image captée. Sans ça, elle reste une **donnée
  déclarative** (au sens CLAUDE.md), hors métrique.
- **RÈGLE V-3.** L'échantillon = **N grilles** (critère d'échantillonnage documenté, **pas de cap silencieux**),
  chacune avec ≥1 page portant `{ png_sha256, ground_truth_cells (vérifiées, nulls explicites) }`.

## 5. Ce qu'on NE réinvente pas *(réutilisation stricte du contrat de capture)*

- **L1 fetch** = `capturedFetch` (capture spec §5.1) → `raw/normes-grille/cas/`, ligne de manifeste (C-0). Pas
  de nouvelle discipline de fetch.
- **CAS / immuabilité / no-secret / rétention** = capture spec §2 (C-3, C-6, C-7).
- **Preuve v2** de L1 = `proofFromFetched` (§3.1 capture spec) — la ligne de manifeste EST la preuve.
- **Capture sur cluster** (L1 fetch) = capture spec §4.1 ; **rendu** (L2, parsing) et **extraction** (L3,
  inférence) = légitimes hors-fetch (§4.2), entrée **lue depuis `raw/`**, jamais re-fetchée.

## 6. Ownership & séquence *(handoff BENCH_VISION_REPORT §65-82, validé WP6)*

| Étape | Propriété |
|---|---|
| Conservation de la grille source (L1) | `role:reglement` |
| Revue de la preuve / de ce contrat | `role:archi` (moi) |
| Capture PDF (L1) sur cluster | capture-job (socle/poc-k8s) |
| Rendu (L2) + harness d'extraction (L3) | lane vision / normes |
| Vérité-terrain (référence) | vérification humaine (owner / `role:reglement`) |
| Run candidats terra/luna + métriques | après vérité-terrain ; **owner-gated** |

**Séquence** : ce contrat → capture+rendu+vérité-terrain d'un échantillon → **PUIS** re-run bench terra/luna
sur les **MÊMES images liées** → métriques de fidélité réelles → gagnant provisoire → **ratification
owner-gated + double-consensus** (le ban ADR-0024 reste jusque-là).

## 7. Critère d'acceptation *(déblocage du bench — miroir du BENCH_VISION_REPORT)*

**≥1 paire `{ png_sha256, ground_truth_cells }`** (même identifiant, nulls explicites) déposée sur le stockage
objet ET référencée dans un manifeste immuable `grille-vision-proof` ⟹ le harness peut soumettre **la même
image** à terra ET luna, conserver leur sortie par cellule, et calculer la fidélité **sans réextraction
mistral ni re-capture de source**. C'est le test d'acceptation qui fait passer le bench de « bloqué » à « exécutable ».

## 8. Recoupement KPI preuve-v2

Ce défaut est la **même classe** que le 0/1106 des zones (capture spec §0) : une baseline déclarative sans
capture adossée. Le manifeste `grille-vision-proof` est au pipeline vision ce que la ligne de capture est aux
zones. Il DEVRAIT alimenter un KPI **« adossement capture grille »** (analogue K2, capture spec §6.4),
**distinct** de toute métrique de fidélité — ne pas confondre traçabilité et preuve (règle C-4).

## 9. Reste `unknown` / owner-gated (anti-invention)

- **Les images exactes vues par mistral = PERDUES**, irrécupérables. Aucune liaison rétroactive fabriquée
  (capture spec §6.3 : « prouve le contenu, jamais l'instant »). Un PDF backfillé prouve le contenu, pas l'image soumise.
- **Vérité-terrain = effort humain** (jamais auto-généré depuis un modèle).
- **Taille d'échantillon N** = décision owner/`role:reglement` (documentée, pas de cap silencieux).
- **Choix outil/DPI de rendu (L2)** = à figer par la lane vision (le contrat exige seulement le déterminisme + la trace).

---

## Références
- `docs/spec/SPEC_CAPTURE_ON_CLUSTER.md` (§0, §2, §3.1, §4.2, §6.3, §6.4, C-0..C-7).
- `bench/vision/BENCH_VISION_REPORT.md @f27fc793` ; `packages/qc-sources/src/sources/grille-vision-saint-stanislas.fixture.ts`.
- `acquisition/src/lib/zonage-proof.ts` ; `packages/qc-sources/src/RawDocument.ts`.
- Ban : `docs/decisions.md` ADR-0024.

**DRAFT normatif — OWNER-GATED — authoring pas capture. Anti-invention : images mistral perdues (pas de liaison
rétro), vérité-terrain humaine, ratification candidat owner-gated + double-consensus.**
