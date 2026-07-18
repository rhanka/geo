# GEO fleet drumbeat evidence — 2026-07-18

## Fleet

- Diagnosis: `launchVerified` treated a tmux pane as a successful launch. A pane
  can exist while the CLI is idle at `›` or while prompt injection failed. The
  08:10Z timeline therefore recorded `failed=0` while its pre-launch liveness
  was only `10/15`.
- Fix: commit `521c214` makes launch verification wait for the same `esc to
  interrupt` marker used by `status`; an idle pane no longer counts as up. The
  focused regression test passes (2/2).
- Configuration at observation: committed `d972afc` caps the fleet at ten
  default-model Codex lanes. No `--model` argument is supplied and no
  `geo-api` restart was performed.
- Post-fix supervisor tick at 2026-07-18T08:15:05Z: `relaunched=0`,
  `failed=0`, `UP=10/10`; a second status snapshot 45 seconds later was also
  `10/10` active. No lane immediately died.
- Scoreboard delta over that tick: pv `1064 (+0)`, normes `775 (+0)`, zones
  `864 (+0)`, immo `842 (+0)`, cadastre `1106 (+0)`, role `1106 (+0)`, TOD
  `39 (+0)`.

## M9: live served state

`muni-status.ts` HEAD-probed live S3 for both Sutton and
Saint-Stanislas-de-Kostka: zoning, norms, PV, and cadastre are all present.
`coherence-row-summary.ts` then read the served zoning and grid surfaces.

| Municipality | Served zoning/grid | Served enrichment state | Lot rendering gap |
| --- | --- | --- | --- |
| Sutton | 95 zone codes, 166 grid codes, 94 common; strict overlap 98.95% | The S3-derived enrichment census marks `reglement=true`, `usage_dominant=true`, `effet_densifiant=real`. | 4,397 served lots: folded norms 4,172 (94.88%; **225 missing**); address 4,289 (97.54%; **108 missing**). |
| Saint-Stanislas-de-Kostka | 48 zone codes, 62 grid codes, 48 common; strict overlap 100.00% | The S3-derived enrichment census marks `reglement=true`, `usage_dominant=true`, `effet_densifiant=real`. | 1,827 served lots: folded norms 1,598 (87.47%; **229 missing**); address 1,823 (99.78%; **4 missing**). |

The lot figures were refreshed at 2026-07-18T08:14:32Z from S3 sidecars. The
enrichment census is a served-S3 census (not a configuration claim), generated
at 2026-07-18T02:49:07Z. Both municipalities have complete polygon surface and
postal-code fields. Neither is a TOD municipality, so `in_tod=0` is out of
scope rather than a rendering defect.

Stored effet-densifiant evidence contains, respectively: Sutton 27 densified,
48 stable, 10 reduced, and 10 unknown zones; Saint-Stanislas-de-Kostka 7
densified, 29 stable, and 12 unknown zones. The unknown rows prevent claiming
complete effect coverage.

## Blockers

- The remaining M9 immo issue is field completion, not absence of zoning or
  norms: the exact folded-norm and address deficits above must be resolved and
  re-audited on the served lot product.
- Objective-loop reporting was attempted twice. `h2a loop report
  loop-mre4avom` rejects this CLI because it has no unambiguous enrolled agent;
  the loop lists `codex:geo:4997dd8257e8` as its conductor, but supplying that
  ID still requires `h2a_loop_join`. No identity was invented or impersonated.
- Package-wide `npm run typecheck` remains blocked by pre-existing diagnostic
  files and unrelated type errors; the focused fleet test passes.
