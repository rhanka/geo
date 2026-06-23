import { describe, it, expect } from "vitest";

import {
  COVERAGE_LAYERS,
  COVERAGE_TRACKS,
  trackIdsFor,
  findTrack,
  isFreeTrack,
} from "./coverage-tracks.js";
import {
  emptyMatrix,
  markDone,
  allMunicipalities,
} from "./coverage-matrix.js";
import { seedMatrix, MEASURED } from "./coverage-seed.js";
import { rollup } from "./coverage-report.js";
import { recenseVille, applyRecensement } from "./recense-ville.js";

// ── Taxonomie ────────────────────────────────────────────────────────────────
describe("coverage-tracks taxonomy", () => {
  it("covers exactly the 6 layers", () => {
    expect([...COVERAGE_LAYERS].sort()).toEqual(
      ["cadastre", "normes", "pmtiles", "pv", "role-foncier", "zones"].sort(),
    );
  });

  it("every layer ends in a universal fallback (aucun plafond)", () => {
    for (const layer of COVERAGE_LAYERS) {
      const tracks = COVERAGE_TRACKS[layer];
      expect(tracks.length).toBeGreaterThan(0);
      const last = tracks[tracks.length - 1];
      expect(last.fallback).toBe(true);
    }
  });

  it("only pdf-vision carries an LLM cost; everything else is free", () => {
    const llm: string[] = [];
    for (const layer of COVERAGE_LAYERS)
      for (const t of COVERAGE_TRACKS[layer])
        if (t.cost === "llm") llm.push(t.id);
    expect([...new Set(llm)]).toEqual(["pdf-vision"]);
    expect(isFreeTrack("zones", "agol-account")).toBe(true);
    expect(isFreeTrack("normes", "pdf-vision")).toBe(false);
  });

  it("zones lists the prioritized voies including pdf T1..T4 + obscura", () => {
    const ids = trackIdsFor("zones");
    expect(ids[0]).toBe("agol-account");
    expect(ids).toContain("disaggregation");
    expect(ids).toContain("pdf-georef-t1");
    expect(ids).toContain("pdf-scan-t4");
    expect(ids).toContain("obscura-session");
    expect(ids[ids.length - 1]).toBe("recenseur-manual");
  });

  it("findTrack resolves a known id", () => {
    expect(findTrack("pv", "scraper-configured")?.platform).toBe("cms-pv");
  });
});

// ── Matrice + seed ──────────────────────────────────────────────────────────
describe("coverage matrix seed (measured state)", () => {
  it("targets the 1106 municipalities", () => {
    expect(allMunicipalities().length).toBe(1106);
    const m = emptyMatrix();
    expect(m.municipalityCount).toBe(1106);
    expect(Object.keys(m.cities).length).toBe(1106);
  });

  it("empty matrix starts every cell to-research with full candidate list", () => {
    const m = emptyMatrix();
    const first = Object.values(m.cities)[0];
    expect(first.zones.status).toBe("to-research");
    expect(first.zones.candidateTracks).toEqual(trackIdsFor("zones"));
  });

  it("seed reproduces the measured roll-up per layer", () => {
    const r = rollup(seedMatrix());
    const by = Object.fromEntries(r.layers.map((l) => [l.layer, l]));
    expect(by.cadastre.done).toBe(MEASURED.cadastre.done); // 1102
    expect(by["role-foncier"].done).toBe(MEASURED.roleFoncier.done); // 1095
    expect(by.zones.done).toBe(
      MEASURED.zones.agol + MEASURED.zones.disaggregation, // 99
    );
    expect(by.normes.done).toBe(MEASURED.normes.done); // 25
    // pv: ready → planned (not done)
    expect(by.pv.done).toBe(0);
    expect(by.pv.planned).toBeGreaterThan(500);
    // pmtiles: every city planned (derived)
    expect(by.pmtiles.planned).toBe(1106);
  });

  it("seed ventilates zones done by track (38 agol + 61 disaggregation)", () => {
    const r = rollup(seedMatrix());
    const zones = r.layers.find((l) => l.layer === "zones")!;
    expect(zones.doneByTrack["agol-account"]).toBe(MEASURED.zones.agol);
    expect(zones.doneByTrack["disaggregation"]).toBe(
      MEASURED.zones.disaggregation,
    );
  });

  it("never marks an audit-absent city as zones-done", () => {
    const m = seedMatrix();
    for (const slug of [
      "sainte-catherine",
      "alma",
      "la-sarre",
      "saint-charles-borromee",
      "notre-dame-de-lourdes--lerable",
    ]) {
      expect(m.cities[slug]?.zones.status).not.toBe("done");
    }
  });

  it("markDone attaches the producing track", () => {
    const m = markDone(emptyMatrix(), "westmount", "zones", "agol-account");
    expect(m.cities["westmount"].zones.status).toBe("done");
    expect(m.cities["westmount"].zones.doneTrack).toBe("agol-account");
  });
});

// ── Recenseur (hermétique, fetch mocké) ─────────────────────────────────────
describe("recense-ville (hermetic, mocked fetch)", () => {
  const arcgisFetch: typeof fetch = (async (
    _url: unknown,
    init?: { method?: string },
  ) => {
    const body =
      '{"currentVersion": 11.1, "services": [{"name":"esri"}]}';
    if (init?.method === "HEAD") {
      return {
        ok: true,
        status: 200,
        url: "https://example.qc.ca",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "",
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      url: "https://example.qc.ca",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  it("detects arcgis from body and surfaces agol-account for zones", async () => {
    // westmount is in the directory, so recensePlatformForCity resolves a URL.
    const rec = await recenseVille("westmount", { fetchImpl: arcgisFetch });
    expect(rec.platform).toBe("arcgis");
    const zones = rec.layers.find((l) => l.layer === "zones")!;
    expect(zones.candidateTracks[0]).toBe("agol-account");
    expect(zones.firstViableTrack).toBe("agol-account");
  });

  it("always leaves a universal fallback at the end of every layer chain", async () => {
    const rec = await recenseVille("westmount", { fetchImpl: arcgisFetch });
    for (const l of rec.layers) {
      const last = l.candidateTracks[l.candidateTracks.length - 1];
      const t = findTrack(l.layer, last);
      expect(t?.fallback).toBe(true);
    }
  });

  it("applyRecensement records lastResearchAt without downgrading done cells", async () => {
    let m = seedMatrix();
    const before = m.cities["westmount"].cadastre.status;
    const rec = await recenseVille("westmount", { fetchImpl: arcgisFetch });
    m = applyRecensement(m, rec);
    expect(m.cities["westmount"].cadastre.status).toBe(before); // unchanged
    expect(m.cities["westmount"].zones.lastResearchAt).toBeTruthy();
  });
});
