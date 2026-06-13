import { describe, expect, it } from "vitest";

import {
  formatSourceDetail,
  formatSourceList,
  listSources,
  showSource,
} from "./sources.js";

describe("listSources", () => {
  it("lists the registered ca-qc/sda source", () => {
    const sources = listSources();
    const sda = sources.find((s) => s.id === "ca-qc/sda");
    expect(sda).toBeDefined();
    expect(sda?.license).toBe("cc-by-4.0");
    expect(sda?.redistributable).toBe(true);
    expect(sda?.jurisdiction).toBe("CA-QC");
    expect(sda?.datasetIds).toEqual(["qc-regions", "qc-mrc", "qc-municipalites"]);
  });

  it("formats a human-readable list", () => {
    const text = formatSourceList(listSources());
    expect(text).toContain("ca-qc/sda");
    expect(text).toContain("qc-municipalites");
  });
});

describe("showSource", () => {
  it("inspects a known source", () => {
    const detail = showSource("ca-qc/sda");
    expect(detail.provider).toContain("MRNF");
    expect(detail.attributionRequired).toBe(true);
    expect(detail.datasets).toHaveLength(3);
    const muni = detail.datasets.find((d) => d.id === "qc-municipalites");
    expect(muni?.adminLevel).toBe("municipality");
    expect(muni?.layer).toBe("munic_s");
    expect(formatSourceDetail(detail)).toContain("ca-qc/sda");
  });

  it("throws for an unknown source", () => {
    expect(() => showSource("nope")).toThrow(/unknown source/);
  });
});
