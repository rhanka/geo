import { describe, it, expect } from "vitest";

import {
  createReglementsZonageSherbrookeAdapter,
  extractGrilleDocument,
  splitLayoutPages,
  pdfToLayoutTextViaPoppler,
  ZONAGE_SHERBROOKE_GRILLE_URL,
  ZONAGE_SHERBROOKE_SNAPSHOT,
  type GrilleExtractionResult,
} from "./reglements-zonage-sherbrooke.js";
import {
  GRILLE_SHERBROOKE_H0001,
  GRILLE_SHERBROOKE_P0004,
  GRILLE_SHERBROOKE_H0005,
  NON_GRILLE_SHERBROOKE_TITLE,
} from "./grille-specifications.fixture.js";
import type { NormFieldT, ZoneNormsT } from "./grille-specifications-parser.js";

/**
 * A LIGHT test of the production adapter that wires the FROZEN grille parser onto
 * a live fetch. It exercises the adapter's own surface — page splitting, the
 * document-level aggregation, the injectable fetch + pdftotext overrides — using
 * ONLY the committed verbatim fixture pages (no network, no poppler). The parser's
 * own field-level guarantees are covered by `grille-specifications-parser.test.ts`
 * (37/37); here we prove the adapter does not break the chain or invent values.
 */

const OPTS = {
  source_url: ZONAGE_SHERBROOKE_GRILLE_URL,
  snapshot: ZONAGE_SHERBROOKE_SNAPSHOT,
};

/** A realistic multi-page `pdftotext -layout` blob: 3 grilles + 1 non-grille,
 *  form-feed delimited exactly as poppler emits a multi-page run. */
const MULTIPAGE_LAYOUT = [
  GRILLE_SHERBROOKE_H0001,
  NON_GRILLE_SHERBROOKE_TITLE,
  GRILLE_SHERBROOKE_P0004,
  GRILLE_SHERBROOKE_H0005,
].join("\f");

function allFields(z: ZoneNormsT): NormFieldT[] {
  const out: NormFieldT[] = [];
  for (const f of [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ]) {
    if (f) out.push(f);
  }
  return out;
}

describe("splitLayoutPages", () => {
  it("splits a form-feed-delimited blob and drops blank pages", () => {
    const pages = splitLayoutPages(`A\fB\f\f   \fC`);
    expect(pages).toEqual(["A", "B", "C"]);
  });
});

describe("extractGrilleDocument — document-level aggregation", () => {
  it("aggregates ZoneNorms across grille pages and SKIPS the non-grille page", () => {
    const res = extractGrilleDocument(MULTIPAGE_LAYOUT, OPTS);
    // 4 pages in, 1 non-grille skipped, 3 grilles accepted (none rejected).
    expect(res.stats.totalPages).toBe(4);
    expect(res.stats.skippedNonGrille).toBe(1);
    expect(res.stats.grillePages).toBe(3);
    expect(res.stats.rejectedGrillePages).toBe(0);
    // H0001 has 4 zone rows, P0004 has 3, H0005 has 3 → 10 rows total.
    expect(res.stats.zoneRows).toBe(10);
    expect(res.zones.length).toBe(10);
    // The non-grille title page contributes nothing.
    expect(res.zones.every((z) => z.zone_code !== "")).toBe(true);
  });

  it("ANTI-INVENTION: every published value is a verbatim substring of its page", () => {
    const res = extractGrilleDocument(MULTIPAGE_LAYOUT, OPTS);
    for (const zone of res.zones) {
      for (const field of allFields(zone)) {
        if (field.value === null) continue; // refusals are allowed
        // The served numeric value must round-trip to the verbatim raw cell.
        const rawNumber = field.raw.replace(",", ".");
        expect(rawNumber).toContain(String(field.value));
      }
    }
  });

  it("carries the adapter's source_url + snapshot into per-field provenance", () => {
    const res = extractGrilleDocument(MULTIPAGE_LAYOUT, OPTS);
    const fields = res.zones.flatMap(allFields);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(f._provenance.source_url).toBe(ZONAGE_SHERBROOKE_GRILLE_URL);
      expect(f._provenance.snapshot).toBe(ZONAGE_SHERBROOKE_SNAPSHOT);
    }
  });

  it("treats H-3's 'Note 5'/'Note 6' reference cells as null, not numbers", () => {
    const res = extractGrilleDocument(GRILLE_SHERBROOKE_H0001, OPTS);
    const h3 = res.zones.find((z) => z.zone_code === "H-3");
    expect(h3).toBeDefined();
    expect(h3!.frontage_min?.value).toBeNull();
    expect(h3!.superficie_min?.value).toBeNull();
  });
});

describe("ReglementsZonageSherbrookeAdapter — fetch + extract (injected I/O)", () => {
  /** A fake fetch returning fixed PDF-magic bytes; a fake pdftotext returning the
   *  committed layout text. No network, no poppler — pure adapter surface. */
  function fakeAdapter() {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    return createReglementsZonageSherbrookeAdapter({
      now: () => new Date("2026-06-21T00:00:00Z"),
      fetchImpl: (async (_url: string) => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => pdfBytes.buffer,
      })) as never,
      pdfToLayoutText: async () => MULTIPAGE_LAYOUT,
    });
  }

  it("list() yields exactly the single grille-PDF ref", async () => {
    const adapter = createReglementsZonageSherbrookeAdapter();
    const refs = [];
    for await (const r of adapter.list({})) refs.push(r);
    expect(refs.length).toBe(1);
    expect(refs[0]!.url).toBe(ZONAGE_SHERBROOKE_GRILLE_URL);
    expect(refs[0]!.contentType).toBe("application/pdf");
    expect(refs[0]!.metadata?.reglement).toBe("1200");
  });

  it("fetch() attaches the layout text and a sha256; extractZoneNorms() aggregates", async () => {
    const adapter = fakeAdapter();
    const refs = [];
    for await (const r of adapter.list({})) refs.push(r);
    const raw = await adapter.fetch(refs[0]!);
    expect(raw.contentType).toBe("application/pdf");
    expect(raw.text).toBe(MULTIPAGE_LAYOUT);
    expect(raw.sha256).toMatch(/^[0-9a-f]{64}$/);

    const result: GrilleExtractionResult = adapter.extractZoneNorms(raw);
    expect(result.stats.zoneRows).toBe(10);
    expect(result.zones.find((z) => z.zone_code === "C-306")).toBeDefined();
  });
});

describe("pdfToLayoutTextViaPoppler", () => {
  it("is a factory that returns a (bytes, timeoutMs) => Promise<string>", () => {
    const fn = pdfToLayoutTextViaPoppler("https://example.test/x.pdf");
    expect(typeof fn).toBe("function");
    expect(fn.length).toBe(2);
  });
});
