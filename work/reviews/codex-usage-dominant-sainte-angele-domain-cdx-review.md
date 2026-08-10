---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 02ce2c16 chore(usage-dominant): retain Sainte-Angele domain CDX probes
target-paths:
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-domain-cdx.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-domain-cdx-2010-06.json
observed-failure: The author session does not attest an exact model identifier or reasoning effort, so no author-complementary reviewer can be selected under harness/review. No review consensus is claimed.
---

# Review — usage-dominant Sainte-Angèle historical-domain CDX probes

Both CDX worklists passed `k8s-capture-run --dry-run` and were submitted to
the declared OVH cluster. The broad historical-domain query and its exact
`2010-06` refinement both recorded durable timeout attempts on S3, with no CAS
body to support an inference. The change retains those reproducible probes and
adds no regulation or usage-dominant mapping.
