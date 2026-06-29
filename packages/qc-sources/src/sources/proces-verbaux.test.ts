/**
 * Tests for the procès-verbaux parser + zonage-change detector.
 *
 * Fixtures are REAL text extracted from public Saint-Damase PV PDFs fetched
 * 2026-06-10. Nothing is fabricated (ANTI-INVENTION rule).
 *
 * Test suite:
 *   1. detectZonageChange — positive (Règlement 38-41, real zonage change)
 *   2. detectZonageChange — negative (Règlement 158, building maintenance, no zonage)
 *   3. parsePvIndex — Saint-Damase HTML accordion index
 *   4. filterPvByWindow — date window filtering
 *   5. ProcesVerbauxGenericAdapter — list() with mocked fetch
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  filterPvByWindow,
  parsePvIndex,
  PV_NON_DISPONIBLE,
} from "./proces-verbaux-parser.js";
import {
  SAINT_DAMASE_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
} from "./proces-verbaux-generic.js";
import {
  PV_SAINT_DAMASE_2025_05_POSITIVE,
  PV_SAINT_DAMASE_2026_03_NEGATIVE,
  PV_SAINT_DAMASE_INDEX_HTML,
} from "./proces-verbaux-saint-damase.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectZonageChange — POSITIVE (real fixture, règlement 38-41 + zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – positive (May 2025 PV, Règlement 38-41)", () => {
  const result = detectZonageChange(PV_SAINT_DAMASE_2025_05_POSITIVE);

  it("detects avisDeMotion", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("extracts Règlement 38-41", () => {
    expect(result.reglementNumbers).toContain("38-41");
  });

  it("flags changementZonage", () => {
    expect(result.changementZonage).toBe(true);
  });

  it("provides at least one excerpt", () => {
    expect(result.excerpts.length).toBeGreaterThan(0);
    // Excerpt should contain the match context
    const joined = result.excerpts.join(" ");
    expect(joined.toLowerCase()).toMatch(/zonage|38-41/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. detectZonageChange — NEGATIVE (March 2026 PV, Règlement 158, no zonage)
// ─────────────────────────────────────────────────────────────────────────────

describe("detectZonageChange – negative (March 2026 PV, Règlement 158)", () => {
  const result = detectZonageChange(PV_SAINT_DAMASE_2026_03_NEGATIVE);

  it("detects avisDeMotion (motion is present)", () => {
    expect(result.avisDeMotion).toBe(true);
  });

  it("does NOT flag changementZonage", () => {
    expect(result.changementZonage).toBe(false);
  });

  it("does NOT extract a règlement de zonage number (158 is non-hyphenated)", () => {
    // Règlement 158 has no hyphen so the high-precision regex does not match it
    // as a zonage bylaw number (prevents false positives on numeric-only IDs).
    expect(result.reglementNumbers).not.toContain("158");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePvIndex — Saint-Damase HTML accordion
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePvIndex – Saint-Damase accordion index HTML", () => {
  const items = parsePvIndex(
    PV_SAINT_DAMASE_INDEX_HTML,
    "https://www.st-damase.qc.ca/proces-verbaux/",
  );

  it("parses at least 5 PV items from the accordion", () => {
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it("all items have https PDF URLs", () => {
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/.+\.pdf/i);
    }
  });

  it("includes the May 2025 PV", () => {
    const may2025 = items.find((i) => i.url.includes("2025-05") || i.url.includes("6-mai"));
    expect(may2025).toBeDefined();
  });

  it("includes a 2026 PV", () => {
    const y2026 = items.find((i) => i.url.includes("2026"));
    expect(y2026).toBeDefined();
  });

  it("date ISO is parseable when a date is in the title", () => {
    const withDates = items.filter((i) => i.dateIso !== PV_NON_DISPONIBLE);
    // At least some items should have parseable dates (e.g. "3 mars 2026")
    // The URL-based title "Procès-verbal manuscrit 3 mars 2026" is parseable.
    expect(withDates.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. filterPvByWindow — date window filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("filterPvByWindow", () => {
  const items = parsePvIndex(
    PV_SAINT_DAMASE_INDEX_HTML,
    "https://www.st-damase.qc.ca/proces-verbaux/",
  );

  it("returns only items within the window", () => {
    const filtered = filterPvByWindow(items, "2026-01-01", "2026-12-31");
    // Items dated outside 2026 (2025 PVs with parseable dates) should be excluded
    for (const item of filtered) {
      if (item.dateIso !== PV_NON_DISPONIBLE) {
        expect(item.dateIso >= "2026-01-01").toBe(true);
        expect(item.dateIso <= "2026-12-31").toBe(true);
      }
    }
  });

  it("includes NON_DISPONIBLE items (conservative)", () => {
    const filtered = filterPvByWindow(items, "2099-01-01", "2099-12-31");
    const unknown = items.filter((i) => i.dateIso === PV_NON_DISPONIBLE);
    expect(filtered.length).toBe(unknown.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ProcesVerbauxGenericAdapter — list() with mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcesVerbauxGenericAdapter.list() – mocked fetch", () => {
  const mockFetch = async (
    _url: string,
    _init?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) => ({
    ok: true as const,
    status: 200,
    headers: { get: (_name: string) => "text/html" },
    arrayBuffer: async () =>
      new TextEncoder().encode(PV_SAINT_DAMASE_INDEX_HTML).buffer,
  });

  // Fix clock so the window covers both 2025 and 2026 entries.
  const adapter = new ProcesVerbauxGenericAdapter(SAINT_DAMASE_PV_CONFIG, {
    fetchImpl: mockFetch as unknown as typeof mockFetch,
    now: () => new Date("2026-06-10T00:00:00Z"),
    windowDays: 365, // large window so 2025 entries are included
  });

  it("yields at least 3 PV refs within a 12-month window", async () => {
    const refs: unknown[] = [];
    for await (const ref of adapter.list({})) {
      refs.push(ref);
    }
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it("all refs have sourceKind 'pv'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { sourceKind: string }).sourceKind).toBe("pv");
    }
  });

  it("all refs have the city slug 'saint-damase'", async () => {
    for await (const ref of adapter.list({})) {
      expect((ref as { city: string }).city).toBe("saint-damase");
    }
  });

  it("respects abort signal — yields nothing when pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const refs: unknown[] = [];
    for await (const ref of adapter.list({ signal: controller.signal })) {
      refs.push(ref);
    }
    expect(refs.length).toBe(0);
  });
});
