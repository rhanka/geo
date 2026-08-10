---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: efcd3a2c chore(usage-dominant): retain Dundee sitemap probes
target-paths:
  - acquisition/config/usage-dominant-capture-20260810-dundee-sitemap.json
  - acquisition/config/usage-dominant-capture-20260810-dundee-pages-sitemap.json
  - acquisition/config/usage-dominant-capture-20260810-dundee-permits-page.json
observed-failure: The author session does not attest an exact model identifier or reasoning effort, so no author-complementary reviewer can be selected under harness/review. No review consensus is claimed.
---

# Review — usage-dominant Dundee sitemap discovery

The official `robots.txt` captured on S3 explicitly names `sitemap.xml`; that
index names the exact Wix pages sitemap, which in turn publishes the permits
page. All three worklists passed `k8s-capture-run --dry-run` and completed on
the declared OVH cluster. The permits page only repeats the already-known
navigation link to regulations and contains no explicit zoning, urbanism, MRC,
or regulation document reference. No mapping is inferred.
