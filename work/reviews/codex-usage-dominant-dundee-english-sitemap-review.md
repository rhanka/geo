---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 220a6b65 chore(usage-dominant): retain Dundee English sitemap probes
target-paths:
  - acquisition/config/usage-dominant-capture-20260810-dundee-english-sitemap.json
  - acquisition/config/usage-dominant-capture-20260810-dundee-english-pages-sitemap.json
observed-failure: The author session does not attest an exact model identifier or reasoning effort, so no author-complementary reviewer can be selected under harness/review. No review consensus is claimed.
---

# Review — usage-dominant Dundee English sitemap discovery

The literal English sitemap URL comes from the official robots receipt already
stored on S3. Its index exposes the exact English pages sitemap, and both
worklists passed `k8s-capture-run --dry-run` and completed on the declared OVH
cluster. The pages list contains no zoning, planning, urbanism, permit, or
bylaw path; its sole regulation-related entry is the already-known French
regulations page localized with `?lang=en`. No duplicate fetch or mapping is
introduced.
