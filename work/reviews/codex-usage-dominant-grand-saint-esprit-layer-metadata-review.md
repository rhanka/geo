---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 0a6dcf01 chore(usage-dominant): retain Grand-Saint-Esprit layer probes
target-paths:
  - acquisition/config/usage-dominant-capture-20260810-grand-saint-esprit-layer-metadata.json
  - acquisition/config/usage-dominant-capture-20260810-grand-saint-esprit-layer-metadata-trailing-slash.json
observed-failure: The author session does not attest an exact model identifier or reasoning effort, so no author-complementary reviewer can be selected under harness/review. No review consensus is claimed.
---

# Review — usage-dominant Grand-Saint-Esprit ArcGIS layer metadata

Both worklists derive from the documented official geometry endpoint and ask only
for ArcGIS layer metadata, not a guessed regulation. Each passed
`k8s-capture-run --dry-run` and completed on the declared OVH cluster. The
metadata path and its trailing-slash variant both redirect to `www2.goazimut.com`
and return HTTP 404; neither exposes a renderer nor legend from which the served
`A-*`, `H-*`, or `HC-*` codes could be interpreted. No mapping is added.
