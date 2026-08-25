import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseZoningEventCohortTsv } from "./lib/zoning-event-source-audit-runner.js";
import { parseCohortFile } from "./zoning-events-recall-gate.js";

// Reproducibility gate (CLAUDE.md founding principle): the committed cohort pin
// the audit CLI now defaults to MUST load on a clean checkout — an ENOENT/parse
// failure in CI is a capitalisation defect, not a test incident. Network-free.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COHORT_TSV = resolve(ROOT, "docs", "spec", "reports", "set-167-bprime.tsv");

const PLAIN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("set-167-bprime committed cohort pin", () => {
  it("loads via the audit reader (parseZoningEventCohortTsv) to 167 valid plain slugs", () => {
    const slugs = parseZoningEventCohortTsv(readFileSync(COHORT_TSV, "utf8"));

    expect(slugs.length).toBe(167);
    expect(new Set(slugs).size).toBe(167);
    for (const slug of slugs) {
      // The runner's InventorySchema.slug regex is identical: double-dash forms
      // (graph_city_slug) would make the whole Model A inventory invalid.
      expect(slug, `slug ${slug} must be plain single-dash`).toMatch(PLAIN_SLUG_RE);
    }

    // The plain axis carries the single-dash forms, never the canonical MRC ones.
    expect(slugs).toContain("westmount");
    expect(slugs).toContain("saint-isidore-roussillon");
    expect(slugs).not.toContain("saint-isidore--roussillon");
  });

  it("also serves the recall-gate reader on the graph_city_slug axis (canonical MRC forms)", () => {
    // parseCohortFile prefers the graph_city_slug column: the double-dash MRC
    // forms surface there, so one committed file feeds both cohort consumers.
    const graphSlugs = parseCohortFile(readFileSync(COHORT_TSV, "utf8"), "set-167-bprime");

    expect(graphSlugs.length).toBe(167);
    expect(graphSlugs).toContain("saint-isidore--roussillon");
    expect(graphSlugs.filter((slug) => slug.includes("--")).length).toBe(7);
  });
});
