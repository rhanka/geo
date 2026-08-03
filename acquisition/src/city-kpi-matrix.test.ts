import { describe, it, expect } from "vitest";

// Contrat de la matrice par-ville × 20 KPI. Le générateur lit les matrices de
// complétion committées (sources réelles) ; ce test verrouille les INVARIANTS
// structurels (anti-invention, fermeture, pending, gaps) plutôt qu'une valeur
// mouvante — les comptes évoluent avec les dépôts, la STRUCTURE non.
const mod = await import("../../scripts/city-kpi-matrix.mjs");
const payload = mod.build("20260803");

describe("city-kpi-matrix contract", () => {
  it("30 villes, 20 KPI, partitions fermées", () => {
    expect(payload.rows.length).toBe(30);
    expect(payload.columns.length).toBe(20);
    expect(payload.validation.closed).toBe(true);
    expect(payload.validation.errors).toEqual([]);
  });

  it("chaque ville : les 4 états somment à 20", () => {
    for (const r of payload.rows) {
      const tot = r.counts.complete + r.counts.incomplete + r.counts.unknown + r.counts["N-A"];
      expect(tot).toBe(20);
    }
  });

  it("villes PENDING-GRAPH-NODE : toutes cellules unknown + drapeau", () => {
    const pending = payload.rows.filter((r: any) => !r.graph_matched);
    expect(pending.length).toBe(3);
    for (const r of pending) {
      expect(r.flag).toBe("PENDING-GRAPH-NODE");
      expect(r.counts.unknown).toBe(20);
      expect(r.complete_over_20).toBe(0);
    }
  });

  it("cols GAP (5/6/7 regdens, 20 v3.4) : 0 complete sur les matchées + raison", () => {
    const gapKeys = ["reglement", "usage_dominant", "effet_densifiant", "v34_qc_zoning_events"];
    for (const key of gapKeys) {
      const k = payload.per_kpi.find((x: any) => x.key === key);
      expect(k).toBeTruthy();
      expect(k.gap).toBeTruthy();
      expect(k.counts.complete).toBe(0);
      expect(k.counts.incomplete).toBe(0);
    }
  });

  it("anti-invention : aucune cellule hors des 4 états", () => {
    const allowed = new Set(["complete", "incomplete", "unknown", "N-A"]);
    for (const r of payload.rows) {
      for (const col of payload.columns) {
        expect(allowed.has(r.cells[col.key])).toBe(true);
      }
    }
  });

  it("rollup KPI : dénominateur = villes matchées graphe (pending exclues)", () => {
    const matched = payload.rows.filter((r: any) => r.graph_matched).length;
    for (const k of payload.per_kpi) {
      const tot = k.counts.complete + k.counts.incomplete + k.counts.unknown + k.counts["N-A"];
      expect(tot).toBe(matched);
    }
  });
});
