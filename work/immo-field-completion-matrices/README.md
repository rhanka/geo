# Deterministic Immo field-completion matrices

This directory is a local-only, reproducible completion report for the fixed
1,106-city universe. It does not acquire data or change any shared coverage
artifact.

Inputs are read only:

- `work/coverage/coverage-matrix.json` supplies the complete city universe and
  TOD scope.
- `work/coverage/immo-lots.json` supplies the local per-city Immo stats.

The outputs are a JSON matrix with an explicit status and reason for every
requested field in every city, plus the same city-by-field matrix as CSV:

- `immo-field-completion-matrix.json`
- `immo-field-completion-matrix.csv`

The only statuses are `complete`, `incomplete`, `unknown`, and `N/A`.
`unknown` is used when a city lacks local Immo stats, while `N/A` is reserved
for an out-of-scope TOD city or a served zero-lot row with no per-lot
denominator.

The source snapshot contains 877 rows but only 874 exact city slugs. Three
alternate spellings duplicate already-present canonical city rows:
`l-assomption`, `l-epiphanie`, and `sainte-christine-d-auvergne`. They are
fully enumerated in the JSON reconciliation block and never treated as extra
cities or silently dropped.

Build and validate with local Node only:

```sh
node work/immo-field-completion-matrices/build.mjs
node work/immo-field-completion-matrices/build.mjs --check
```

The builder writes no wall-clock timestamp. It stores SHA-256 hashes of the
two local input files, sorts city rows by slug, and `--check` rejects stale or
non-deterministic outputs while enforcing exact 1,106-city coverage.
