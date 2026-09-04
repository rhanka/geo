# OWNERSHIP — registre d'adressage lane ↔ path (repo geo)

> **But.** Carte **autoritaire** path → workpackage → lane, pour que les lanes s'adressent
> **par le registre, jamais par inférence de nom/chemin**. Corrige le défaut d'adressage
> systématique (ex. « renderer » résolu vers la lane *graphify* par homonymie, 2026-09).
> Compagnon d'[ADR-0022] (définitions WP) et d'[ADR-0001] (gouvernance-en-fichiers).
>
> **Mapping ratifié par geo-cond** (RACI, à la revue de cette PR). **Format + record tenu par geo-archi** (wp6).

## Règle d'usage

- Pour savoir qui possède un path : **consulter CE fichier** — ne jamais déduire une lane d'un
  nom de package/branche/socket.
- **Statut** par entrée : `stable` (ratifié) · `provisional` (hypothèse de travail + trigger de
  revisite) · `superseded` · `gap` (non assigné — geo-cond à ratifier).
- **lane** = une session Claude ; **ref** = son `[id]`. **wp** = le workpackage ([ADR-0022]).
- Frontière structurelle : **wp6 = CONTRATS/règles (le *quoi*), PAS le code/build** ; **wp7 =
  BUILD** (le *comment*). Un même package peut donc être **split** (contrat wp6 / build wp7).

## WP → lane (ADR-0022, RACI gravé)

| wp | domaine | lane | ref |
|----|---------|------|-----|
| wp1 | cadastre / lots | geo-lot | `[b6f1b6]` |
| wp2 | zones | geo-zones | `[92bce8]` |
| wp3 | reglements | reglements | `[6b93e9]` |
| wp4 | pv | pv | `[a5326b]` |
| wp5 | jointures | geo-jointures | `[5b9c9a]` |
| wp6 | archi — CONTRATS/règles (pas code/build) | geo-archi | `[de1aca]` (ce registre) |
| wp7 | socle — BUILD + API OGC + npm + pmtiles + adaptateur §5 | geo-socle | `[8d8e2f]` |
| — | conductor (transverse) | geo-cond | `[077cfd]` |
| — | qa (transverse) | geo-qa | `[81858e]` |

*(Les `ref` sont indicatifs — une lane est une session Claude qui se recrée ; le mapping wp↔domaine est
l'invariant, pas le socket.)*

## path → wp (mapping)

| path | wp | lane | statut | note |
|------|----|----|--------|------|
| `docs/spec/**` | wp6 | geo-archi | stable | contrats + specs |
| `docs/decisions.md` | wp6 | geo-archi | stable | journal ADR |
| `docs/OWNERSHIP.md` (ce fichier) | wp6 | geo-archi | stable | format tenu wp6 ; mapping ratifié geo-cond |
| `packages/geo-map-engine/` **CONTRAT public** (types/seam : BasemapSpec, RasterSource, AttributionSpec, SourcePolicy, TokenMap, GeoMapError, ResolvedRasterSource) | wp6 | geo-archi | stable | **ratification du seam** ; toute évolution = semver + ADR ([ADR-0026]/[ADR-0029]) |
| `packages/geo-map-engine/` **adaptateur §5 agnostique** (raster-source mount, session/clé/résolution, transform-request, google-2d adapter) | wp7 | geo-socle | stable | frontière `SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D` §2.5 |
| `packages/geo-map-engine/` **BUILD engine-core** (compileBasemap dispatch, cases v1, machinerie W1–W10, mount) | wp7 | geo-socle | **provisional** | foldé dans wp7 (2026-09, geo-cond) ; **revisiter → lane engine dédiée si la charge engine-core grandit** au-delà du §5 |
| `packages/geo/**` (acquire / storage / API OGC / CLI / basemap mint) | wp7 | geo-socle | stable | socle |
| `packages/geo-core/**` (modèle/types, browser-safe) | wp7 | geo-socle | stable | socle |
| `packages/geo-ui-svelte/` (composant svelte legacy, pré-ADR-0025) | — | design-system | **superseded** | **SUPERSEDED** par `design-system-geo-svelte` (`packages/components-geo-svelte`, **repo DS**) — [ADR-0025] : l'adaptateur framework DS-owned vit **dans le repo DS**, pas dans le repo geo. Le **canonique** = repo-DS (hors ce registre). Retirement/migration = conditionné au fait de conso immo (vues, i-cond) — ne pas casser la page vivante. Split : logique adaptateur AGNOSTIQUE (closures/resolver, plain TS) = **wp7/geo-socle** ; wiring framework = DS-repo (ou bespoke immo sous Path B), **zéro-copie** |
| `deploy/**` | wp7 | geo-socle | stable | (exécution = owner/k8s ; author = geo-socle) |
| `.github/workflows/**` | wp7 | geo-socle | stable | CI/CD |
| `docs/ops/gcp-3dtiles/**`, `docs/ops/cap-billing/**` (guardrail §5) | wp7 | geo-socle | stable | author geo-socle ; exécution owner/k8s ; co-val geo-archi + i-infra |
| `acquisition/src/constraints/cptaq.ts` (§9 runner) | wp2 + wp7 | geo-zones + geo-socle | stable | acquire-authority geo-zones ; build geo-socle ; ratif wp6 |
| `acquisition/**` (autres data-runners) | wp1–wp5 | data lanes | **gap** | path↔wp fin **à ratifier par geo-cond** (ne PAS inférer) |
| `work/coverage/**` (rapports portfolio) | — | — | **gap** | à ratifier |

## Gaps ouverts (geo-cond ratifie / comble)

1. **engine-core BUILD** = `provisional` wp7/geo-socle → confirmer, ou créer une lane engine dédiée
   si la charge grandit.
2. **`acquisition/**` fin** (wp1–wp5 par runner/famille) = `gap` → RACI geo-cond (aujourd'hui inféré
   par nom = le défaut à tuer).
3. **`work/**`, `scripts/**`** = `gap` → à assigner.

## Note sur `CODEOWNERS` (GitHub)

Un `.github/CODEOWNERS` GitHub route des **review-requests vers des utilisateurs/teams GitHub**.
Or **toutes les lanes committent sous le seul compte `rhanka`** → un CODEOWNERS ne peut PAS
distinguer les lanes (il serait `@rhanka` partout = bruit). ⟹ **la substance du registre est CE
fichier** (`docs/OWNERSHIP.md`). **Recommandation geo-archi : omettre le CODEOWNERS** (inutile pour
le lane-routing) ; ce registre EST le fix. À confirmer par geo-cond.

---
*Provisoire/gap = explicite par construction. Anti « vert par omission » : un path non listé =
`gap` à ratifier, jamais un owner deviné.*
