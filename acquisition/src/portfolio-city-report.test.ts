import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const temps: string[] = [];
const coverageBefore = process.env.PORTFOLIO_COVERAGE_DIR;

afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
  if (coverageBefore === undefined) delete process.env.PORTFOLIO_COVERAGE_DIR;
  else process.env.PORTFOLIO_COVERAGE_DIR = coverageBefore;
});

function coverageDir(): string {
  const path = mkdtempSync(join(tmpdir(), "geo-portfolio-provenance-"));
  temps.push(path);
  return path;
}

async function buildWithCoverage(coverage: string) {
  process.env.PORTFOLIO_COVERAGE_DIR = coverage;
  vi.resetModules();
  // @ts-expect-error -- the production report is an executable .mjs script.
  const module = await import("../../scripts/portfolio-city-report.mjs");
  return module.build("20260726");
}

describe("portfolio city report provenance matrix", () => {
  it("keeps the quality partition closed when a latest matrix contains verified v2", async () => {
    const coverage = coverageDir();
    writeFileSync(join(coverage, "zone-provenance-quality-matrix-20260726-beef.json"), JSON.stringify({
      as_of: "2026-07-26",
      validation: {
        city_identity: { exact_slug_joins: 836, cities_without_exact_zone_row: 270 },
        quality_status_partition: { counts: { acceptable: 700, candidate: 30, orphan: 100, unknown: 270, v2: 6 } },
      },
    }));

    const report = await buildWithCoverage(coverage);
    const quality = report.kpis.find((row: { key: string }) => row.key === "prov_qualite")!;
    const v2 = report.kpis.find((row: { key: string }) => row.key === "prov_v2")!;
    expect(quality.actuel).toMatchObject({ status: "ok", complete: 706, incomplete: 130, unknown: 270 });
    expect(quality.actuel.display).toContain("700 acceptable · 6 v2 · 30 candidate · 100 orphan · 270 unknown");
    expect(v2.actuel).toMatchObject({ status: "ok", complete: 6, unknown: 1100 });
  });

  it("renders both provenance KPIs unknown when no matching matrix exists", async () => {
    const report = await buildWithCoverage(coverageDir());
    const quality = report.kpis.find((row: { key: string }) => row.key === "prov_qualite")!;
    const v2 = report.kpis.find((row: { key: string }) => row.key === "prov_v2")!;
    expect(quality.actuel).toMatchObject({ status: "unknown", display: "unknown" });
    expect(v2.actuel).toMatchObject({ status: "unknown", display: "unknown" });
  });
});
