# @geo/geo-sources-americas-legacy-shim

Minimal **compat shim** for legacy acquisition scripts.

Several scripts under `acquisition/src/` (`pv-discover-unlisted.ts`,
`pv-gonet-run.ts`, `recense-ville.ts`) import `websiteForSlug` /
`MUNICIPAL_DIRECTORY` from:

```
../../packages/geo-sources-americas/ca-qc/municipalities/municipal-directory.js
```

This package exists only to keep that import path working without dragging in a
full `geo-sources-americas` build. It is **tracked** (not under `dist/`, which is
gitignored) so that `remote shell --sync` — which ships only tracked files —
embeds it automatically, with no in-pod workaround.

## Source of truth

The directory data is **not** stored here. The shim reads, in order:

1. `packages/qc-sources/src/geo/qc-municipal-directory.json` — the versioned
   MAMH repertoire (schema `qc-municipal-directory/v1`, key `entries`, ~1100
   municipalities, 1076 with a public website). This is the repo-relative copy
   that travels with `--sync`.
2. `/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json` — the
   out-of-repo shared copy, used only as a developer-machine fallback.

Only public MAMH registry fields are present (`slug`, `name`, `mamhCode`,
`designation`, `website`, `source`, `verifiedAt`). The per-entry `email` field
from the source registry is **intentionally omitted** from the versioned repo
copy — it is unused by the shim/scripts and a handful of entries carry named
officer addresses; the full data (incl. email) stays in the out-of-repo copy.
No personal data is versioned.

## Migration note

Long term, `websiteForSlug` should move into `@geo/qc-sources` and these imports
should point there. This shim is the low-risk intermediate that makes the
acquisition runs portable today.
