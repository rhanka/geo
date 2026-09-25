import { describe, expect, it } from "vitest";

import { resolveModelMigrationChain, type ModelMigration } from "./model-migration.js";

const registry: ModelMigration[] = [
  { id: "m1", fromModel: "v1", toModel: "v2" },
  { id: "m2", fromModel: "v2", toModel: "v3" },
];

describe("resolveModelMigrationChain", () => {
  it("is up-to-date when restored == expected", () => {
    const plan = resolveModelMigrationChain("v3", "v3", registry);
    expect(plan.status).toBe("up-to-date");
    expect(plan.chain).toEqual([]);
  });

  it("resolves a single-step chain", () => {
    const plan = resolveModelMigrationChain("v2", "v3", registry);
    expect(plan.status).toBe("migrate");
    expect(plan.chain.map((m) => m.id)).toEqual(["m2"]);
  });

  it("resolves a multi-step chain in order", () => {
    const plan = resolveModelMigrationChain("v1", "v3", registry);
    expect(plan.chain.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("fails closed on an unregistered model change", () => {
    expect(() => resolveModelMigrationChain("v1", "v9", registry)).toThrow(/NON couvert|fail-closed/);
    expect(() => resolveModelMigrationChain("vX", "v3", registry)).toThrow(/bloque a vX/);
  });

  it("fails closed on an ambiguous fork", () => {
    const forked: ModelMigration[] = [...registry, { id: "m1b", fromModel: "v1", toModel: "v2b" }];
    expect(() => resolveModelMigrationChain("v1", "v3", forked)).toThrow(/fork ambigu/);
  });

  it("fails closed on a cycle", () => {
    const cyclic: ModelMigration[] = [
      { id: "a", fromModel: "v1", toModel: "v2" },
      { id: "b", fromModel: "v2", toModel: "v1" },
    ];
    expect(() => resolveModelMigrationChain("v1", "v9", cyclic)).toThrow(/cycle/);
  });

  it("rejects empty version identifiers", () => {
    expect(() => resolveModelMigrationChain("", "v3", registry)).toThrow(/restoredModel/);
    expect(() => resolveModelMigrationChain("v1", "", registry)).toThrow(/expectedModel/);
  });
});
