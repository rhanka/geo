import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * C1 identity→workspaceId table — an INDEPENDENT audit of the committed JSON.
 *
 * This test keeps its OWN hardcoded copy of the 8 expected pairs on purpose. If the
 * table is ever "simplified" into a function/template (`geo-${lane}`) and DRIFTS —
 * a 9th lane leaks in, a value changes, a wildcard appears — this breaks. The
 * duplication is the check: C1 must be 8 LITERAL pairs, never computed.
 *
 * SEUL `sub` est NORMATIF. This test NEVER assembles `sub` from parts (no
 * `system:serviceaccount:geo:${…}`) — it compares `sub` LITERALLY to the hardcoded
 * copy. The one regex below is a FORM check only; do NOT migrate it to key
 * resolution. (mesh: only `sub`, exact equality.)
 *
 * Scope: this proves the TABLE (8 literal pairs, no catch-all). The gateway-side
 * fail-closed on an unknown `sub` (R1) is mesh's to enforce — NOT claimed here.
 */

interface C1Entry {
  lane: string;
  sub: string;
  workspaceId: string;
}
interface C1 {
  tenant?: string;
  map: C1Entry[];
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

const C1_PATH = new URL("../../../deploy/k8s/s3dag-c1-identity-workspace-map.json", import.meta.url);

function loadC1(): C1 {
  return JSON.parse(readFileSync(C1_PATH, "utf8")) as C1;
}

/** The gateway's fail-closed lookup, reference form: EXACT sub, unknown → undefined. */
function lookupWorkspaceId(map: readonly C1Entry[], sub: string): string | undefined {
  const hit = map.find((e) => e.sub === sub); // EXACT equality — no pattern, no prefix, no assembly
  return hit?.workspaceId;
}

// Form only — NEVER used to resolve/build a key. Marks the shape of a normative sub.
const SUB_FORM = /^system:serviceaccount:geo:s3dag-[a-z0-9-]+-sa$/;

describe("C1 identity→workspaceId table (committed JSON)", () => {
  const c1 = loadC1();

  it("is exactly the 8 LITERAL pairs (breaks on any drift / functionalization)", () => {
    expect(c1.map.map((e) => ({ sub: e.sub, workspaceId: e.workspaceId }))).toEqual([...EXPECTED]);
  });

  it("has 8 DISTINCT workspaceId (crit. 1)", () => {
    expect(new Set(c1.map.map((e) => e.workspaceId)).size).toBe(8);
  });

  it("every `sub` matches the normative FORM (shape only — not key resolution) (crit. 2)", () => {
    for (const e of c1.map) expect(e.sub).toMatch(SUB_FORM);
  });

  it("has NO wildcard/catch-all — the table provides no default (crit. 3)", () => {
    for (const e of c1.map) {
      expect(e.sub).not.toBe("*");
      expect(e.lane).not.toBe("*");
      expect(e.workspaceId).not.toBe("default");
    }
    // On the TABLE, an unknown sub resolves to undefined (no default entry exists).
    // The gateway-side fail-closed behaviour (R1) is mesh's to enforce.
    expect(lookupWorkspaceId(c1.map, "system:serviceaccount:geo:s3dag-unknown-sa")).toBeUndefined();
    expect(lookupWorkspaceId(c1.map, "system:serviceaccount:kube-system:default")).toBeUndefined();
  });

  it("carries NO reconstruction recipe: sub is the only key, no serviceAccount/namespace field", () => {
    const raw = readFileSync(C1_PATH, "utf8");
    expect(raw).not.toMatch(/"serviceAccount"/); // recipe ingredient removed
    expect(raw).not.toMatch(/"namespace"/); // ns lives inside the literal sub, not as a part
    expect(raw).not.toMatch(/"audience"/); // crit. 5 — audience is a separate mesh contract value
  });

  it("is ONE tenant `geo` + 8 workspaceId, not 8 tenants (granularity)", () => {
    expect(c1.tenant).toBe("geo");
    expect(JSON.stringify(c1)).not.toMatch(/"tenantId"/);
  });
});
