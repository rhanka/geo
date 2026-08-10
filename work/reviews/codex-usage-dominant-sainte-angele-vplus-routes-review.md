---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 330f60345551cbc38f0116bfd65795fe85608405 chore(usage-dominant): retain Sainte-Angele VPlus probes
target-paths:
  - acquisition/src/_vplus-tree-grep.ts
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-domain-root.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-vplus-sitemap.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-vplus-config.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-vplus-urbanisme.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-vplus-urbanisme-published.json
  - acquisition/config/usage-dominant-capture-20260810-sainte-angele-vplus-reglements-published.json
observed-failure: The author session does not attest an exact model identifier or reasoning effort, so no author-complementary reviewer can be selected under harness/review. No review consensus is claimed.
---

# Review — usage-dominant Sainte-Angèle VPlus routes

The root receipt leads to the municipality's published VPlus sitemap; the
captured `config/pc` object is inspected directly from S3 in memory. The
read-only helper identifies the literal `Urbanisme` and `Règlements` GUIDs
without materialising a capture locally.

The documented `inStructure=false` Urbanisme detail returns HTTP 403. Its
published `inStructure=true` counterpart is captured on the OVH cluster at
`raw/usage-dominant-vplus-urbanisme-published-detail/cas/a6108ce241a7362807b7f4776acb135f1abf058aa9406a81597bc354b55ecbfa.json`.
It has tariff and permit-form links only. The published Règlements detail is
captured at
`raw/usage-dominant-vplus-reglements-published-detail/cas/fe0236a765682893a7f4b8c7c3066f14e25bf6b39afe502d50499a150f3a1104.json`;
it names amendments to zoning regulation 2010-06 but does not publish its
base text or a zoning legend. Therefore no usage-dominant map is inferred.
