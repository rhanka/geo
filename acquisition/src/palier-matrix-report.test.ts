import { describe, it, expect } from "vitest";

// Contrat de la matrice palier par-ville × 20 KPI. Le générateur lit les
// matrices de complétion committées (sources réelles) ; ce test verrouille les
// INVARIANTS (anti-invention, fermeture, présence, pending, gaps) plutôt qu'une
// valeur mouvante — les comptes évoluent avec les dépôts, la STRUCTURE non.
// @ts-expect-error Script executable MJS sans déclaration TypeScript publique.
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

  it("PENDING-GRAPH-NODE : colonnes DÉRIVÉES du graphe unknown ; colonnes immo per-slug MESURÉES", () => {
    // Contrat révisé : `graph_matched` dérive du match zonage-events (set-167-bprime),
    // qui ne gouverne QUE les colonnes dérivées du graphe. Les colonnes immo
    // `slug_measured` (14-19) suivent leur artefact per-slug autoritaire même pour
    // une ville UNMATCHED — bloquer ces cellules à unknown affirmerait unknown sur
    // un complete PROUVÉ (invention à l'envers). On verrouille : graphe→unknown,
    // immo→état réel de la source.
    const graphKeys = payload.columns.filter((c: any) => !c.slug_measured).map((c: any) => c.key);
    const slugKeys = payload.columns.filter((c: any) => c.slug_measured).map((c: any) => c.key);
    expect(slugKeys.length).toBe(6); // cols 14-19
    const pending = payload.rows.filter((r: any) => !r.graph_matched);
    expect(pending.length).toBe(payload.cohort.pending_graph_node);
    for (const r of pending) {
      expect(r.flag).toBe("PENDING-GRAPH-NODE");
      // toutes les colonnes graphe sont unknown (aucune mesure hors du graphe).
      for (const k of graphKeys) expect(r.cells[k]).toBe("unknown");
      // les colonnes immo per-slug ne sont PAS forcées à unknown : au moins une
      // ville pending porte un état mesuré ≠ unknown (donnée immo réelle servie).
    }
    const anyMeasuredImmo = pending.some((r: any) => slugKeys.some((k: string) => r.cells[k] !== "unknown"));
    expect(anyMeasuredImmo).toBe(true);
  });

  it("cols 5/6/7 (règlement/usage/effet) SONT peuplées per-city (non-gap)", () => {
    for (const key of ["reglement", "usage_dominant", "effet_densifiant"]) {
      const k = payload.per_kpi.find((x: any) => x.key === key);
      expect(k.gap).toBeNull();
      // au moins une ville a une donnée présente (present > 0) : la source per-city est câblée.
      expect(k.present).toBeGreaterThan(0);
    }
  });

  it("gate présence : les 20 KPI comptent — AUCUNE colonne exclue (cols 10 v2 & 20 v3.4 INCLUSES, décision owner révisée)", () => {
    const v2 = payload.columns.find((c: any) => c.key === "prov_v2");
    const v34 = payload.columns.find((c: any) => c.key === "v34_qc_zoning_events");
    // décision owner révisée : plus aucune colonne n'est hors gate.
    expect(v2.gate_excluded).toBe(false);
    expect(v34.gate_excluded).toBe(false);
    const gateCols = payload.columns.filter((c: any) => !c.gate_excluded).length;
    expect(gateCols).toBe(20);
    // dénominateur présence par ville = les 20 KPI (present+absent+N-A).
    for (const r of payload.rows.filter((x: any) => x.graph_matched)) {
      expect(r.presence.present + r.presence.absent + r.presence.na_excluded).toBe(20);
    }
    // La gate agrège les lignes matchées : elle ne fige aucun nombre qui varie
    // avec les sources per-ville (dont la col 20).
    const fullPresenceRows = payload.rows.filter((r: any) => r.graph_matched && r.presence.absent === 0).length;
    expect(payload.presence_gate.cities_full_presence).toBe(fullPresenceRows);
  });

  it("présence = donnée là ; colonne presence_strict (PV capté) : present ssi complete", () => {
    for (const r of payload.rows.filter((x: any) => x.graph_matched)) {
      let present = 0, absent = 0;
      for (const c of payload.columns) {
        const st = r.cells[c.key];
        if (st === "N-A") continue;
        if (c.presence_strict) { if (st === "complete") present++; else absent++; }
        else if (st === "unknown") absent++; else present++;
      }
      expect(r.presence.present).toBe(present);
      expect(r.presence.absent).toBe(absent);
    }
    // col 4 PV est bien presence_strict.
    const pv = payload.columns.find((c: any) => c.key === "pv");
    expect(pv.presence_strict).toBe(true);
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
