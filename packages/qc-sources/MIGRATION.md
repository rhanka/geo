# Migration — `@geo/qc-sources` (from immo `@radar/sources`)

> **Date**: 2026-06-21
> **Decision basis**: `docs/spec/normes-reglements-decisions.md` (geo), decision #5
> ("Transférer le scraper d'immo vers geo — déplacer + adapter, pas réécrire").
> **Mode**: MOVE + ADAPT. No rewrite. Golden fixtures and tests preserved verbatim.

This package is the migrated Québec source-adapter / bylaw-parser toolkit. It is
the foundation of the future **bylaw-orchestrator** (parsing QC zoning bylaws:
`LOT → ZONE → NORMS`).

## Origin

| | |
|---|---|
| Source repo | `radar-immobilier` (`/home/antoinefa/src/radar-immobilier`) |
| Source package | `packages/radar-sources/` — npm name `@radar/sources` (v0.0.0) |
| Source commit (HEAD of `main`) | `c51ed026c038ddaeee8caaa056e8ddb2217e76ca` (2026-06-21) |
| Worktree branch compared | `feat/radar-scraping-sources` @ `cb72469` (2026-06-06) |

### Why `main`, not the worktree branch

The task flagged that a possibly-newer copy lived in the branch worktree
(`tmp/feat-radar-scraping-sources/packages/radar-sources/`). It was diffed and is
**strictly older / a subset**: its `src/` held only `SourceAdapter`,
`prioritySources`, a 2-line `index.ts` and an empty `sources/_spikes/`, whereas
`main` carries the full adapter + parser + golden-fixture corpus (the parser of
record, all PV/avis/rôle/adresses adapters, 42 test files). `main` wins on every
common file. The migration source is therefore `packages/radar-sources/` @ `main`.

## Target location & why

`geo/packages/qc-sources/`, npm name **`@geo/qc-sources`**.

The geo decision doc (#5 / migration plan) names the target explicitly:
"déplacer `packages/radar-sources/**` → `geo/packages/qc-sources/` (ou sous-module
`qc/`)". The existing `geo/packages/*` directories (`geo`, `geo-core`,
`geo-sources-americas`, `geo-sources-europe`, `geo-ui-svelte`) are **vendored
`dist/` build outputs of published `@sentropic/*` packages** — they contain no
`src/`, no `package.json`, and are not editable source. So integrating the QC
adapters "into geo-sources-americas" was not possible (nothing to integrate
into), and a fresh first-party source package `qc-sources/` — exactly as the doc
prescribes — is the correct home. QC = Amériques is still respected conceptually;
the package is province-scoped (`qc-`) and Canada-extensible, matching decision #3
(QC-first, Canada-ready interfaces).

## What was migrated

Whole `src/**` of `@radar/sources`, **minus** the dev `_spikes/` exploratory tree
(900 KB of spike scratch), **plus** the two `_spikes/.../samples/` sub-folders
that the kept fixtures/tests read at runtime (tiny public open-data bytes, see
below). Specifically:

- **Contracts**: `SourceAdapter.ts`, `RawDocument.ts`, `prioritySources.ts`,
  `index.ts` (barrel), `municipalities.ts` (+ `geo/municipalities.qc.json`,
  ~1 106 QC municipalities).
- **Core parser (priority of the chantier normes)**:
  `sources/reglements-urbanisme-parser.ts` + adapter
  `sources/reglements-urbanisme-valleyfield.ts` + golden fixture
  `sources/reglements-urbanisme-valleyfield.fixture.ts` + tests.
- **Other adapters/parsers**: `role-evaluation-mamh.ts`,
  `role-evaluation-parser.ts`, `adresses-quebec.ts`, `adresses-quebec-parser.ts`,
  `avis-publics-*` (valleyfield / beauharnois / generic + parser),
  `proces-verbaux-parser.ts`, `proces-verbaux-generic.ts`,
  `youtube-seances.ts`, `voxtral-transcriber.ts`, `pdf-ocr.ts`.
- **Golden fixtures**: all `proces-verbaux-*.fixture.ts` (one per structural
  family of municipal site — see `GOLDEN_FIXTURES.md`), plus avis / rôle /
  adresses / reglements fixtures. 43 `*.fixture.ts` in total.
- **Tests**: all 42 `*.test.ts` files, verbatim.
- **Inventory/priority helpers**: `geo/geo-source-inventory*.ts`,
  `geo/geo-vertical-priority.ts`, `geo/geo-fetch-utils.ts`.
- **Scripts**: `scripts/fixture-promote.ts` (+ test).
- **Doc**: `GOLDEN_FIXTURES.md`.

### `_spikes/` samples retained (and why)

Three fixtures/tests read **real committed open-data sample bytes** lazily from
`_spikes/.../samples/` via `readFileSync` (this is the boot-safety contract — see
`fixture-boot-safety.test.ts`). To keep those green, only the two needed sample
folders were carried over (all public open data, no secrets):

- `_spikes/roles-evaluation-fonciere-mamh/samples/` — MAMH rôle XML excerpts
  (`RL70052_2026.first-record.xml`, `RL70022_2026.first-record.xml`,
  `indexRole2026.excerpt.csv`).
- `_spikes/adresses-quebec-igo-geocoder/samples/` — terrAPI / Adresses Québec
  JSON excerpts (Salaberry, Beauharnois).

The remaining ~39 spike folders were intentionally dropped (exploratory scratch,
not part of the adapter contract or any test).

## How the `@radar/domain` dependency was handled

`@radar/sources` imported a **tiny** surface from `@radar/domain`, found by
grepping every import:

| Symbol | Source in immo | Used by |
|---|---|---|
| `SourceKind` (type) | `radar-domain/src/source-kind.ts` | every adapter (`.kind`) |
| `MunicipalityT`, `PrioritizedCitiesOptionsT` (types) | `radar-domain/src/schemas/municipality.ts` | `municipalities.ts` |
| `Municipality` (zod schema) | same | `municipalities.test.ts` |

No other immo-domain types were used. The MINIMUM was brought across into a new
local module **`src/domain.ts`** holding exactly those four/seven symbols
(`SOURCE_KINDS`, `SourceKind`, `isSourceKind`, `Municipality`, `MunicipalityT`,
`PrioritizedCitiesOptions`, `PrioritizedCitiesOptionsT`), copied verbatim from
immo. The rest of the immo domain (opportunity, scoring, signal, journal, …) was
**not** dragged in.

**Why not map to geo-core**: geo-core (`packages/geo-core/dist`) does export a
`SourceKind`, but it means something different —
`"administrative" | "statistical" | "postal"` (geospatial dataset families),
whereas immo's `SourceKind` is the **ingestion-source** taxonomy
(`"avis-publics" | "pv" | "reglement" | "role-evaluation" | …`). Merging them
would be a semantic error, so the immo enum was kept local. `domain.ts` documents
this divergence inline so a future reviewer does not "helpfully" unify them.

Imports were rewritten:
`@radar/domain` / `@radar/domain/schemas` → relative `./domain.js` /
`../domain.js` (Bundler module resolution, `.js` extension specifiers, matching
the package's existing ESM style). The package name `@radar/sources` in code
comments / test descriptions was updated to `@geo/qc-sources` (cosmetic only).

## Build / test tooling

- `package.json` renamed to `@geo/qc-sources`; runtime dep `zod` only
  (`@radar/domain` removed). devDeps `typescript`, `vitest` unchanged.
- `tsconfig.json` inlined the former `../../tsconfig.base.json` options (geo has
  no root tsconfig base), kept `noEmit`, Bundler resolution, strict.
- `vitest.config.ts` unchanged (`src/**/*.test.ts`).
- Self-contained `node_modules/zod` (v3.25.76, copied from the immo install).
  `vitest` / `tsc` are run from geo's root `node_modules`
  (`vitest@4.1.8`, `typescript@5.9.3`).

## Test status

Run: `vitest run` (geo root `vitest@4.1.8`), from `packages/qc-sources/`.

```
Test Files  42 passed (42)
     Tests  1218 passed (1218)
```

**42/42 test files, 1218/1218 tests passed. 0 failed.**
`tsc --noEmit` (geo `typescript@5.9.3`): **clean (exit 0)**.

## Known scope notes / risks

- The `reglements-urbanisme-parser` parses **bylaw numbers + zone codes** from
  amendment-bylaw text, NOT the normative grid values per zone (usages, density,
  heights, setbacks, frontage, area). Extending it to the full "grille des
  spécifications" is the next chantier (see the geo bylaw-orchestrator spec and
  the migration report). Table-aware PDF extraction + a per-`zone_code` norm
  schema are required and do not exist yet.
- Live-fetch adapters (`reglements-urbanisme-valleyfield`, PV generic, adresses,
  rôle MAMH) depend on `pdftotext` (poppler) on PATH for the PDF→text step; the
  parsers themselves are pure and fully tested against fixtures.
- `youtube-seances` / `voxtral-transcriber` read `YOUTUBE_API_KEY` /
  `MISTRAL_API_KEY` from `process.env` at call time. No secrets are committed.
