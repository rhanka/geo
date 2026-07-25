import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertNoLicenseDrift,
  buildLicenses,
  renderLicensesMarkdown,
  type Registry,
} from "./licenses.js";

const GOOD_REGISTRY: Registry = {
  sources: [
    {
      sourceId: "ca-qc/sda",
      kind: "administrative",
      provider: "Gouvernement du Québec — Ministère des Ressources naturelles et des Forêts (MRNF)",
      homepage: "https://www.donneesquebec.ca/recherche/dataset/decoupages-administratifs",
      licenseId: "cc-by-4.0",
      redistributable: true,
      attributionRequired: true,
      shareAlike: false,
      attribution: "© Gouvernement du Québec — CC BY 4.0",
      retrievedAt: "2026-06-13",
      datasets: ["qc-regions", "qc-mrc", "qc-municipalites"],
      notes: "Découpages administratifs du Québec (SDA).",
    },
  ],
};

describe("assertNoLicenseDrift", () => {
  it("passes when flags match geo-core", () => {
    expect(() => assertNoLicenseDrift(GOOD_REGISTRY)).not.toThrow();
  });

  it("throws when redistributable disagrees with geo-core", () => {
    const bad: Registry = {
      sources: [{ ...GOOD_REGISTRY.sources[0]!, redistributable: false }],
    };
    expect(() => assertNoLicenseDrift(bad)).toThrow(/drift/);
  });

  it("throws when attributionRequired disagrees with geo-core", () => {
    const bad: Registry = {
      sources: [{ ...GOOD_REGISTRY.sources[0]!, attributionRequired: false }],
    };
    expect(() => assertNoLicenseDrift(bad)).toThrow(/attributionRequired/);
  });
});

describe("renderLicensesMarkdown", () => {
  it("renders a table row and an attribution for each source", () => {
    const md = renderLicensesMarkdown(GOOD_REGISTRY);
    expect(md).toContain("| `ca-qc/sda` |");
    expect(md).toContain("CC BY 4.0");
    expect(md).toContain("✅");
    expect(md).toContain("## Attributions");
    expect(md).toContain("GÉNÉRÉ depuis licenses/registry.json");
  });
});

describe("buildLicenses", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "geo-cli-lic-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a temp registry and writes the generated markdown", async () => {
    const registryPath = join(dir, "registry.json");
    const outPath = join(dir, "out", "licenses.md");
    await writeFile(registryPath, JSON.stringify(GOOD_REGISTRY));

    const result = await buildLicenses({ registry: registryPath, out: outPath });
    expect(result.entries).toBe(1);
    expect(result.outPath).toBe(outPath);

    const written = await readFile(outPath, "utf8");
    expect(written).toContain("| `ca-qc/sda` |");
  });

  it("throws on a drifting registry before writing", async () => {
    const registryPath = join(dir, "registry.json");
    const drift: Registry = {
      sources: [{ ...GOOD_REGISTRY.sources[0]!, redistributable: false }],
    };
    await writeFile(registryPath, JSON.stringify(drift));
    await expect(
      buildLicenses({ registry: registryPath, out: join(dir, "out.md") }),
    ).rejects.toThrow(/drift/);
  });
});
