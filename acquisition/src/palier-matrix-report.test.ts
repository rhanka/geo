import { describe, it, expect } from "vitest";

// Contrat de la matrice palier par-ville × 20 KPI. Le générateur lit les
// matrices de complétion committées (sources réelles) ; ce test verrouille les
// INVARIANTS (anti-invention, fermeture, présence, pending, gaps) plutôt qu'une
// valeur mouvante — les comptes évoluent avec les dépôts, la STRUCTURE non.
const mod = await import("../../scripts/palier-matrix-report.mjs");
const payload = mod.build("20260803");

describe("palier-matrix contract", () => {
  it("cohorte 167 par défaut, 20 KPI, partitions fermées", () => {
    expect(payload.rows.length).toBe(167);
    expect(payload.columns.length).toBe(20);
    expect(payload.validation.closed).toBe(true);
    expect(payload.validation.errors).toEqual([]);
    // sous-vue palier 1 (rang<=30) présente comme sous-ensemble.
    expect(payload.subset_palier1_rank_le_30.cities_scored).toBeGreaterThan(0);
    expect(payload.subset_palier1_rank_le_30.cities_scored).toBeLessThanOrEqual(30);
  });

  it("chaque ville : les 4 états somment à 20", () => {
    for (const r of payload.rows) {
      const tot = r.counts.complete + r.counts.incomplete + r.counts.unknown + r.counts["N-A"];
      expect(tot).toBe(20);
    }
  });

  it("PENDING-GRAPH-NODE : 3 villes, cellules toutes unknown + présence 0", () => {
    const pending = payload.rows.filter((r: any) => !r.graph_matched);
    expect(pending.length).toBe(5);
    for (const r of pending) {
      expect(r.flag).toBe("PENDING-GRAPH-NODE");
      expect(r.counts.unknown).toBe(20);
      expect(r.presence.present).toBe(0);
    }
  });

  it("cols 5/6/7 (règlement/usage/effet) SONT peuplées per-city (non-gap)", () => {
    for (const key of ["reglement", "usage_dominant", "effet_densifiant"]) {
      const k = payload.per_kpi.find((x: any) => x.key === key);
      expect(k.gap).toBeNull();
      // au moins une ville a une donnée présente (present > 0) : la source per-city est câblée.
      expect(k.present).toBeGreaterThan(0);
    }
  });

  it("gate présence : cols 10 (v2) et 20 (v3.4) EXCLUES", () => {
    const v2 = payload.columns.find((c: any) => c.key === "prov_v2");
    const v34 = payload.columns.find((c: any) => c.key === "v34_qc_zoning_events");
    expect(v2.gate_excluded).toBe(true);
    expect(v34.gate_excluded).toBe(true);
    // dénominateur présence par ville n'inclut pas les 2 colonnes exclues.
    const gateCols = payload.columns.filter((c: any) => !c.gate_excluded).length;
    expect(gateCols).toBe(18);
    for (const r of payload.rows.filter((x: any) => x.graph_matched)) {
      expect(r.presence.present + r.presence.absent + r.presence.na_excluded).toBe(18);
    }
  });

  it("présence = état ≠ unknown ; unknown = absent", () => {
    for (const r of payload.rows.filter((x: any) => x.graph_matched)) {
      let present = 0, absent = 0;
      for (const c of payload.columns) {
        if (c.gate_excluded) continue;
        const st = r.cells[c.key];
        if (st === "unknown") absent++; else if (st !== "N-A") present++;
      }
      expect(r.presence.present).toBe(present);
      expect(r.presence.absent).toBe(absent);
    }
  });

  it("anti-invention : aucune cellule hors des 4 états ; Δ «—» sans snapshot antérieur", () => {
    const allowed = new Set(["complete", "incomplete", "unknown", "N-A"]);
    for (const r of payload.rows) {
      for (const col of payload.columns) expect(allowed.has(r.cells[col.key])).toBe(true);
      if (payload.previousSnapshotDate === null) {
        for (const col of payload.columns) expect(r.deltas[col.key]).toBe("—");
      }
    }
  });
});
