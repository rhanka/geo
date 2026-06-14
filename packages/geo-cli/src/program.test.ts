import { describe, expect, it, vi } from "vitest";

import { buildProgram } from "./program.js";
import type { FetchResult } from "./commands/fetch.js";

/** Build a program with captured output and overridden exit (no process.exit). */
function harness(overrides: Parameters<typeof buildProgram>[0] = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const program = buildProgram({
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...overrides,
  });
  program.exitOverride();
  return { program, out, err };
}

describe("program: sources list", () => {
  it("wires `sources list` to listSources and prints the formatted output", async () => {
    const listSources = vi.fn(() => [
      {
        id: "ca-qc/sda",
        title: "SDA",
        kind: "administrative",
        jurisdiction: "CA-QC",
        license: "cc-by-4.0",
        redistributable: true,
        attribution: "© Gouvernement du Québec",
        datasetIds: ["qc-regions"],
      },
    ]);
    const { program, out } = harness({ listSources });
    await program.parseAsync(["node", "geo", "sources", "list"]);
    expect(listSources).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("ca-qc/sda");
  });
});

describe("program: sources show", () => {
  it("passes the sourceId argument through", async () => {
    const showSource = vi.fn((id: string) => ({
      id,
      title: "SDA",
      kind: "administrative",
      jurisdiction: "CA-QC",
      license: "cc-by-4.0",
      redistributable: true,
      attribution: "© Gouvernement du Québec",
      datasetIds: [],
      country: "CA",
      subdivision: "CA-QC",
      datasets: [],
    }));
    const { program } = harness({ showSource });
    await program.parseAsync(["node", "geo", "sources", "show", "ca-qc/sda"]);
    expect(showSource).toHaveBeenCalledWith("ca-qc/sda");
  });
});

describe("program: fetch", () => {
  it("wires args/options to fetchSource", async () => {
    const fetchSource = vi.fn(
      async (): Promise<FetchResult> => ({ outDir: "/tmp", datasets: [] }),
    );
    const { program, out } = harness({ fetchSource });
    await program.parseAsync([
      "node",
      "geo",
      "fetch",
      "ca-qc/sda",
      "qc-regions",
      "--out",
      "/tmp/data",
      "--force",
    ]);
    expect(fetchSource).toHaveBeenCalledWith(
      "ca-qc/sda",
      "qc-regions",
      { out: "/tmp/data", force: true },
      {},
    );
    expect(out.join("\n")).toContain("Wrote 0 dataset");
  });

  it("omits datasetId when not provided", async () => {
    const fetchSource = vi.fn(
      async (): Promise<FetchResult> => ({ outDir: "/tmp", datasets: [] }),
    );
    const { program } = harness({ fetchSource });
    await program.parseAsync(["node", "geo", "fetch", "ca-qc/sda"]);
    expect(fetchSource).toHaveBeenCalledWith("ca-qc/sda", undefined, {}, {});
  });
});

describe("program: licenses build", () => {
  it("wires options to buildLicenses", async () => {
    const buildLicenses = vi.fn(async () => ({
      registryPath: "/r.json",
      outPath: "/o.md",
      markdown: "# x",
      entries: 1,
    }));
    const { program, out } = harness({ buildLicenses });
    await program.parseAsync([
      "node",
      "geo",
      "licenses",
      "build",
      "--registry",
      "/r.json",
      "--out",
      "/o.md",
    ]);
    expect(buildLicenses).toHaveBeenCalledWith({ registry: "/r.json", out: "/o.md" });
    expect(out.join("\n")).toContain("/o.md");
  });
});

describe("program: serve", () => {
  it("wires port/data to startServer", async () => {
    const startServer = vi.fn(() => ({ port: 9000, dataDir: "/data" }));
    const { program, out } = harness({ startServer });
    await program.parseAsync(["node", "geo", "serve", "--port", "9000", "--data", "/data"]);
    expect(startServer).toHaveBeenCalledWith({ port: 9000, data: "/data" }, {});
    expect(out.join("\n")).toContain("9000");
  });
});

describe("program: refresh", () => {
  it("wires --stale to refresh", async () => {
    const refresh = vi.fn(async () => ({ requestsDir: "/req", entries: [] }));
    const { program } = harness({ refresh });
    await program.parseAsync(["node", "geo", "refresh", "--stale"]);
    expect(refresh).toHaveBeenCalledWith({ stale: true }, {});
  });
});
