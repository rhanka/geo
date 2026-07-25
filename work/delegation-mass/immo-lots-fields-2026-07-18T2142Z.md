# IMMO LOTS — finalisation des champs (shard 0/1) — 2026-07-18T21:42Z

Mesure **S3 fraîche** via `immo-lots-audit.ts` (lit les sidecars `qc-lots-<slug>.stats.json`,
ZÉRO LLM, chiffres réels). Dénominateur réel = **874 munis servis / 1106 · 3 401 026 lots**
(les chiffres de la mission — adresse 2 %, folded 3 %, denom 821 — sont **PÉRIMÉS**, cf. mémoire
`immo-lots-field-residuals-are-upstream`, re-confirmée 5× ce jour).

## AVANT / APRÈS **par champ** (lot-pondéré, source = audit S3)

| champ | AVANT | APRÈS | numWith / denom | Δ |
|---|---|---|---|---|
| surface_m2 | 100 % | 100 % | 3 401 026 / 3 401 026 | 0 |
| code_postal | 100 % | 100 % | 3 401 025 / 3 401 026 | 0 |
| adresse | 75.66 % | 75.66 % | 2 573 212 / 3 401 026 | 0 |
| folded-normes | 25.81 % | 25.81 % | 877 653 / 3 401 026 | 0 |
| in_tod | 100 % (scopé) | 100 % (scopé) | 28 431 / 28 431 (4 munis) | 0 |

**APRÈS ≡ AVANT par construction : aucune mutation S3 n'a été déposée.** Tout enrichissement
aurait été un re-broyage de cibles déjà prouvées terminales (interdit par la mémoire + inutile).

## Pourquoi aucun run — triage exhaustif des cibles

### adresse (75.66 %) — plafond du rôle partout
Enumération **complète** des munis `adresse=0 %` (13, via `_immo-lots-field-targets.ts adresse --min 0.01`) :
- **7 avec lots>0 = set terminal connu** (garde anti-régression `address-regression-guard` conserve null) :
  `saint-pierre` (238<639 overlap), `saint-louis-de-gonzague-du-cap-tourmente` (1<98),
  `saint-felix-de-dalquier` (nom absent de l'index rôle/SDA),
  `franquelin` (43), `saint-gabriel-de-valcartier` (23), `saint-eugene-de-ladriere` (5),
  `remigny` (1) — tous < plancher `minMatch=max(30, 3 %)` (`lots-enriched-run.ts:449`).
  Prouvé 0-gain 5× (passes T13:22, T14:04, T17:38, T18:21).
- **6 avec lots=0 = cadastre vide amont** : `aguanish`, `caniapiscau`,
  `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`, `lile-danticosti`, `metis-sur-mer`.
  Rien à enrichir (numLots=0).

Gros manquants adresse (`verify-only`, lecture sidecar déposé — **déjà joints au rôle**) :
- **montreal** 41.05 % (code=66023) — **OOM XML string-limit** (`role-foncier.ts:318`,
  `xmlBytes.toString()` dépasse `0x1fffffe8`). Aucun re-run ne marche → parseur streaming (hors scope).
- **laval** 34.18 % (code=**65005**) — **DÉJÀ role-joint**, 34.18 % est le résultat déposé,
  PAS une victime `--no-role`. Plafond de correspondance rôle (re-join déterministe = même 34.18 %),
  et giant OOM-risque (401k lots). ⚠️ NOUVELLE PREUVE : la mémoire listait « montreal+laval = 33 %
  du parc » sans avoir tranché laval ; le sidecar prouve que laval adresse est un **plafond**, pas un stale.
- `quebec` 90.10, `longueuil` 92.73, `trois-rivieres` 91.11, `sherbrooke` 90.72, `gatineau` 93.70,
  etc. = plafond rôle (lots vacants/non-civiques). Re-enrich = même chiffre (millésime 2026).

### folded-normes (25.81 %) — gated AMONT (normes+jointure zone)
Gate `_immo-lots-folded-gain --auto` (5ᵉ passe) : **1 seul REJOUABLE-GAIN = laval (+34.81), OOM**
(join 401k lots × 2657 zones tué ~30 min). Les 30 autres (`gatineau` 0.12, `trois-rivieres` 6.78,
`sherbrooke` 0, `longueuil` 48.47, `levis`, `drummondville`…) = **STÉRILE/REGRESSIF** : la grille
normes ne couvre qu'une fraction des zones → folded plafonné. Ceux à `normes=to-research` (ex.
`yamaska`, `saguenay`) = lane **normes/zonage**, PAS immo-lots → skip.

### surface_m2 / code_postal (100 %)
Résidu code_postal = **1 lot** (`pierreville`, centroïde hors polygone RTA — structurel).
Résidus surface = munis `numLots=0` (Anticosti / Côte-Nord, FeatureCollection vide amont).

## Villes traitées / skippées
- **Traitées (enrichissement déposé)** : **aucune** — 0 cible légitime (toutes terminales/OOM/amont).
- **Skippées avec raison** :
  - adresse-zero ×7 (set terminal < plancher rôle) → garde conserve null, 0-gain prouvé 5×.
  - adresse-zero ×6 (numLots=0, cadastre vide amont).
  - montreal (OOM string-limit), laval (plafond rôle 34.18 % déjà joint + OOM-risque).
  - adresse 88-93 % ×N (plafond rôle, lots vacants).
  - folded-normes ×30 (STÉRILE/REGRESSIF, grille couvre fraction) + laval (OOM) + `to-research` (lane normes).
  - code_postal `pierreville` (1 lot hors-FSA structurel) ; surface `numLots=0`.

## Verdict
Lane champs LOT immo (shard 0/1) = **SATURÉE** (6ᵉ confirmation indépendante). Seul gain résiduel
théorique = **laval** (folded +34.81 et adresse ~+55pp) mais **OOM** → LEAD run dédié haute-mémoire
+ parseur XML streaming (montreal). Hors périmètre d'un enrich 6-min/slug ; non re-broyé.
