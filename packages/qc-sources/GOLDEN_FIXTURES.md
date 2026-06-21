# Golden PV fixtures — structural-family taxonomy (Lot L5)

Reference: `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md` §3.

> **Principle (spec §3):** Git keeps a small set of **golden** procès-verbaux
> fixtures — one per **structural family** of municipal site — truncated to the
> minimum that exercises the parser, with an honest provenance header. The
> extended corpus lives on S3 (`fixtures/{family}/…`). **A golden is born from a
> parser failure, not from onboarding.**

## 1. Structural families

A *structural family* is a recurring municipal-site **index** layout (the HTML
the parser must walk to enumerate PV PDF links). The promotion heuristic
(`src/scripts/fixture-promote.ts` → `STRUCTURAL_FAMILIES`) classifies a new
capture by CSS/markup markers, most specific first:

| Family id | What it is | Representative city (golden) |
|---|---|---|
| `wordpress-elementor-accordion` | WordPress + Elementor accordion (`elementor-accordion*`) | **beloeil** (also: saint-remi) |
| `wordpress-fusion-accordion` | WordPress + Avada/Fusion panels (`fusion-panel`, `panel-collapse collapse`) | **saint-damase** |
| `wordpress-visual-composer` | WPBakery Visual Composer (`vc_tta-accordion` + `sc_button`) | **mcmasterville** |
| `wp-block-collapsible` | Gutenberg blocks + `act-collapsible` (`wp-block-file`) | **delson** |
| `october-cms-document-card` | October-CMS municipal theme document cards (`c-document-card`, `c-small-document-card`) | **laprairie** (also: lorraine, boisbriand, mascouche, deux-montagnes, sainte-therese, saint-eustache) |
| `bootstrap-panel` | Bootstrap panel accordion (`panel panel-default`, `download.php`) | **lassomption** |
| `custom-accordion` | Hand-rolled accordion (`accordeon__*` / `accordion__*` / `seances-conseil-list`) | **sainte-julie** (also: mont-saint-hilaire, rosemere) |
| `custom-session-list` | Custom session/PV lists (`session-item`, `seances-list`, `pv-list`, `avis_public_item`) | **boucherville** (also: candiac, varennes, saint-jacques-le-mineur) |
| `drupal-files-table` | Drupal `<table>` + `/sites/default/files/` relative links | **les-cedres** (also: hemmingford) |
| `static-table` | Static HTML `<table>` of PDF links, no CMS classes | **mirabel** |
| `youtube-paired` | PV index pairing PDF links with YouTube session videos (`youtu.be`) | **saint-alexandre** |
| `flat-html-list` | Flat `<a>` PDF list, no recognisable CMS structure (catch-all) | **vaudreuil-dorion** (also: chateauguay, saint-constant, sainte-catherine, charlemagne, henryville, lavaltrie, pincourt, coteau-du-lac, les-coteaux, sainte-martine, saint-valentin) |

12 families cover the 36 PV fixtures currently in git.

## 2. What is kept, what was removed — and why

### Decision

The spec target ("6–10 goldens, the ~40 city fixtures re-scraped to S3 then
removed from git") assumes the city fixtures are **redundant structural
samples**. They are not. Auditing the unit tests shows each city fixture carries
**unique semantic regression assertions** on top of its structural sample:

- **143** semantic assertions across the regional tests (exact `reglementNumbers`,
  `zoneRefs`, `densiteAutorisee`, `changementZonage`);
- **13** *honest false-negative* cases (`changementZonage === false` on a real
  PV that has an avis de motion but no zonage change) — the anti-false-positive
  backbone of the detector;
- each `toContain("X-YY")` pins a specific regex behaviour won by a prior parser
  fix: prefix extraction (`05-384` from `05-384-26-27`), modified-bylaw exclusion
  (`1667-00` vs `1667-127`), letter prefixes (`Z-3001`, `U-2300`, `URB-400`),
  no-hyphen capture (`1767`, `1998`), V-prefix (`V654-2026-33`), 4-digit-prefix
  rejection (`1008-00-50`), paragraph-boundary window cap (Vaudreuil-Dorion), etc.

Deleting a city fixture therefore deletes real regression protection (and breaks
its test at compile time, since fixtures are imported at the top of each regional
spec). Lot L5 is explicit: **"NE CASSE AUCUN test"** and *"keep it, or move the
assertion to a golden."* Mechanically collapsing 36 → 10 would mean **re-homing
~143 hand-verified assertions** into a handful of files — a large, error-prone
rewrite with **no behavioural benefit** and a real risk of silently dropping
regression coverage. That is out of scope for L5 and against its own guardrail.

**Adopted approach — surgical, non-destructive:**

1. **Removed dead code** (genuine redundancy, zero coverage loss):
   - `AVIS_SAINT_CONSTANT_INDEX_HTML` in
     `src/sources/proces-verbaux-saint-constant.fixture.ts` — exported but
     imported by **no** test (verified across `packages/` and `api/`). This is
     the *only* unused fixture export in the package. Removed, with its header
     mention.

2. **Froze the taxonomy** (this document) and **labelled** every family with its
   representative golden, so future captures are checked against an existing
   family before any new git fixture is added.

3. **Shipped `fixture promote`** (`src/scripts/fixture-promote.ts` +
   `make fixture-promote`), which materialises the rule "a golden is born from a
   parser failure": it runs the **real** parser against a candidate and records
   the observed outcome verbatim in an honest provenance header.

4. **Anti-pattern gate (going forward):** no new `proces-verbaux-*.fixture.ts`
   may be hand-authored from onboarding. New goldens are produced **only** via
   `make fixture-promote`, and **only** for a family not already represented in
   the table above, or for a detection edge case no existing golden exercises.
   Everything else stays on S3 (`fixtures/{family}/…`, spec §1.4) for the
   optional `make test-corpus` integration suite.

### Net change

| | Before | After |
|---|---|---|
| PV fixture files in git | 36 | 36 |
| Unused fixture exports | 1 (`AVIS_SAINT_CONSTANT_INDEX_HTML`) | 0 |
| Documented structural families | 0 | 12 |
| `fixture promote` script | none | `src/scripts/fixture-promote.ts` + `make fixture-promote` |

The migration of the *extended* corpus to S3 (re-scrape the city captures, then
prune git down to one golden per family) is a follow-up that depends on spec
steps 1–4 (Storage port + CAS keys + worker writes S3) being live. Until the S3
corpus + `make test-corpus` exist, removing the city fixtures would be a **net
loss of regression coverage with no replacement** — so they are kept, exactly as
L5 instructs.

## 3. Promoting a new golden

```sh
# From a local capture (developer working from a saved page + extracted text):
make fixture-promote \
  CITY=ma-ville CITY_LABEL="Ma-Ville" \
  INDEX_URL="https://ma-ville.qc.ca/proces-verbaux/" INDEX_HTML=/tmp/index.html \
  PV_URL="https://ma-ville.qc.ca/.../pv-2026-05.pdf"  PV_TEXT=/tmp/pv.txt \
  STDOUT=1   # print to stdout instead of writing the fixture file
```

The script prints the detected family + the live parser outcome to stderr, e.g.:

```
[fixture-promote] family=wordpress-elementor-accordion indexItems=7 \
  avisDeMotion=true changementZonage=true
```

If `family=` is one already in the table and the detection matches an existing
golden, **do not** commit a new fixture — the candidate belongs on S3. Promote
only when the family is new or the parser outcome reveals an uncovered edge case;
then pin the companion test to the **observed** outcome recorded in the header.

S3 keys (`raw/…`, `parsed/…`) are not yet read directly: download the object
first and pass the local path. `readSource()` is the single seam to wire the
`ObjectStore` port into when S3-direct reads are needed.
