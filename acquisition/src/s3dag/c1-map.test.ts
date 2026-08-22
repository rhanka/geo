import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * C1 identity→workspaceId table — an INDEPENDENT audit of the committed JSON.
 *
 * This test keeps its OWN hardcoded copy of the 8 expected pairs on purpose. If the
 * table is ever "simplified" into a function/template (`geo-${lane}`) and DRIFTS —
 * a 9th lane leaks in, a value changes, a wildcard appears — this breaks. The
 * duplication is the check: C1 must be 8 LITERAL pairs, never computed (mesh
 * anti-pattern clause). Do NOT replace this expected table with a loop over
 * CAPTURE_LANES — that would defeat the very drift it exists to catch.
 */

interface C1Entry {
  lane: string;
  serviceAccount: string;
  sub: string;
  workspaceId: string;
}
interface C1 {
  tenant?: string;
  map: C1Entry[];
  acceptance?: unknown;
}

const EXPECTED: ReadonlyArray<{ sub: string; workspaceId: string }> = [
  { sub: "system:serviceaccount:geo:s3dag-zones-sa", workspaceId: "geo-zones" },
  { sub: "system:serviceaccount:geo:s3dag-normes-sa", workspaceId: "geo-normes" },
  { sub: "system:serviceaccount:geo:s3dag-pv-sa", workspaceId: "geo-pv" },
  { sub: "system:serviceaccount:geo:s3dag-reglement-sa", workspaceId: "geo-reglement" },
  { sub: "system:serviceaccount:geo:s3dag-usage-dominant-sa", workspaceId: "geo-usage-dominant" },
  { sub: "system:serviceaccount:geo:s3dag-effet-densifiant-sa", workspaceId: "geo-effet-densifiant" },
  { sub: "system:serviceaccount:geo:s3dag-cadastre-sa", workspaceId: "geo-cadastre" },
  { sub: "system:serviceaccount:geo:s3dag-immo-lots-sa", workspaceId: "geo-immo-lots" },
];

function loadC1(): C1 {
  const path = new URL("../../../deploy/k8s/s3dag-c1-identity-workspace-map.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as C1;
}

/** The gateway's fail-closed lookup, in reference form (R1): unknown sub → undefined. */
function lookupWorkspaceId(map: readonly C1Entry[], sub: string): string | undefined {
  const hit = map.find((e) => e.sub === sub); // EXACT equality — no pattern, no prefix
  return hit?.workspaceId;
}

describe("C1 identity→workspaceId table (committed JSON)", () => {
  const c1 = loadC1();

  it("is exactly the 8 LITERAL pairs (breaks on any drift / functionalization)", () => {
    expect(c1.map.map((e) => ({ sub: e.sub, workspaceId: e.workspaceId }))).toEqual([...EXPECTED]);
  });

  it("has 8 DISTINCT workspaceId (crit. 1)", () => {
    expect(new Set(c1.map.map((e) => e.workspaceId)).size).toBe(8);
  });

  it("keys on the FULL sub, exact form (crit. 2)", () => {
    for (const e of c1.map) {
      expect(e.sub).toBe(`system:serviceaccount:geo:${e.serviceAccount}`);
      expect(e.serviceAccount).toMatch(/^s3dag-[a-z0-9-]+-sa$/);
    }
  });

  it("has NO wildcard/catch-all — R1 fail-closed (crit. 3)", () => {
    for (const e of c1.map) {
      expect(e.sub).not.toBe("*");
      expect(e.lane).not.toBe("*");
      expect(e.workspaceId).not.toBe("default");
    }
    // an unknown sub resolves to undefined (never a default), by construction
    expect(lookupWorkspaceId(c1.map, "system:serviceaccount:geo:s3dag-unknown-sa")).toBeUndefined();
    expect(lookupWorkspaceId(c1.map, "system:serviceaccount:kube-system:default")).toBeUndefined();
  });

  it("carries NO audience (crit. 5 — audience is a separate mesh contract value)", () => {
    const raw = readFileSync(new URL("../../../deploy/k8s/s3dag-c1-identity-workspace-map.json", import.meta.url), "utf8");
    expect(raw).not.toMatch(/"audience"/);
  });

  it("is ONE tenant `geo` + 8 workspaceId, not 8 tenants (granularity)", () => {
    expect(c1.tenant).toBe("geo");
    expect(JSON.stringify(c1)).not.toMatch(/"tenantId"/);
  });
});
