import { describe, expect, it } from "vitest";

import { defineDag, topoOrder } from "./dag.js";

const spec = { image: "x" };
const SA = "geo-pv-sa";

describe("defineDag — acyclic validation", () => {
  it("accepts a valid DAG and returns a topological order (upstream before downstream)", () => {
    const dag = defineDag({
      id: "pv",
      serviceAccountName: SA,
      nodes: {
        capture: { spec },
        normalize: { needs: ["capture"], spec },
        serve: { needs: ["normalize"], spec },
        verify: { needs: ["serve"], spec },
      },
    });
    expect(dag.order).toEqual(["capture", "normalize", "serve", "verify"]);
  });

  it("produces a deterministic order for diamonds (sorted tie-break)", () => {
    const nodes = { a: { spec }, b: { needs: ["a"], spec }, c: { needs: ["a"], spec }, d: { needs: ["b", "c"], spec } };
    const dag = defineDag({ id: "d", serviceAccountName: SA, nodes });
    expect(dag.order[0]).toBe("a");
    expect(dag.order[3]).toBe("d");
    expect(dag.order.slice(1, 3).sort()).toEqual(["b", "c"]);
    expect(defineDag({ id: "d", serviceAccountName: SA, nodes }).order).toEqual(dag.order); // stable
  });

  it("throws on a direct cycle", () => {
    expect(() => topoOrder({ a: { needs: ["b"], spec }, b: { needs: ["a"], spec } })).toThrow(/cycle/);
  });

  it("throws on an indirect cycle", () => {
    expect(() =>
      defineDag({ id: "c", serviceAccountName: SA, nodes: { a: { needs: ["c"], spec }, b: { needs: ["a"], spec }, c: { needs: ["b"], spec } } }),
    ).toThrow(/cycle/);
  });

  it("throws on a self-loop", () => {
    expect(() => defineDag({ id: "s", serviceAccountName: SA, nodes: { a: { needs: ["a"], spec } } })).toThrow(/cycle/);
  });

  it("throws on a dangling needs reference", () => {
    expect(() => defineDag({ id: "x", serviceAccountName: SA, nodes: { a: { needs: ["ghost"], spec } } })).toThrow(/unknown node "ghost"/);
  });

  it("throws on an empty graph or missing id", () => {
    expect(() => defineDag({ id: "e", serviceAccountName: SA, nodes: {} })).toThrow(/no nodes/);
    expect(() => defineDag({ id: "", serviceAccountName: SA, nodes: { a: { spec } } })).toThrow(/id is required/);
  });
});

describe("defineDag — NHI identity (dedicated per-lane SA, never default)", () => {
  it("carries the dedicated serviceAccountName on the DAG", () => {
    expect(defineDag({ id: "pv", serviceAccountName: "geo-pv-sa", nodes: { a: { spec } } }).serviceAccountName).toBe("geo-pv-sa");
  });

  it("rejects a missing SA, the shared `default`, and an invalid name (fail-closed)", () => {
    expect(() => defineDag({ id: "pv", serviceAccountName: "", nodes: { a: { spec } } })).toThrow(/serviceAccountName is required|must not be "default"|required/);
    expect(() => defineDag({ id: "pv", serviceAccountName: "default", nodes: { a: { spec } } })).toThrow(/default/);
    expect(() => defineDag({ id: "pv", serviceAccountName: "Not_Valid", nodes: { a: { spec } } })).toThrow(/DNS-1123/);
  });
});
