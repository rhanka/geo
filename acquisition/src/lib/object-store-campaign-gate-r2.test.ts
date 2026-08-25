/**
 * R2 (revue adversariale #267) — la gate PARTAGÉE doit rejeter tout plan
 * non-JSON-total dans method/targets, sinon deux plans distincts pourraient
 * partager un design_sha256 (drop silencieux) ou le hash throw (bigint). Garde
 * de validation ; l'API publique + l'algo de canonicalisation restent inchangés.
 */
import { describe, expect, it } from "vitest";

import {
  assertCampaignExecutionPlan,
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  type CampaignExecutionPlan,
} from "./object-store-campaign-gate.js";

const GIT = "a".repeat(40);
const build = (method: Record<string, unknown>, targets: unknown[]) =>
  buildCampaignExecutionPlan({ scope: "capture", runnerGitSha: GIT, method, targets });

describe("R2 — JSON-total guard on campaign-execution-plan", () => {
  it("accepts a JSON-total plan and hashes it deterministically", () => {
    const plan = build({ lane: "pv", max_bytes: 100 }, [{ slug: "amos", url: "https://x/a.pdf" }]);
    expect(campaignDesignSha256(plan)).toMatch(/^sha256:[0-9a-f]{64}$/);
    // stable across a re-build (order-independent method keys)
    const plan2 = build({ max_bytes: 100, lane: "pv" }, [{ url: "https://x/a.pdf", slug: "amos" }]);
    expect(campaignDesignSha256(plan2)).toBe(campaignDesignSha256(plan));
  });

  it("rejects undefined in method (silently dropped by JSON → collision risk)", () => {
    expect(() => build({ lane: "pv", extra: undefined as unknown as string }, [])).toThrow();
  });

  it("rejects a function in targets (silently dropped)", () => {
    expect(() => build({}, [{ f: (() => 1) as unknown }])).toThrow();
  });

  it("rejects bigint in method (JSON.stringify throws)", () => {
    expect(() => build({ n: 1n as unknown as number }, [])).toThrow();
  });

  it("rejects non-finite numbers in targets (NaN/Infinity → null)", () => {
    expect(() => build({}, [{ x: Number.NaN }])).toThrow();
    expect(() => build({}, [{ x: Number.POSITIVE_INFINITY }])).toThrow();
  });

  it("rejects a non-plain object (Date) that canonicalize would flatten to {}", () => {
    expect(() => build({ when: new Date() as unknown as string }, [])).toThrow();
  });

  it("assertCampaignExecutionPlan rejects a hand-built plan carrying undefined", () => {
    const plan = {
      contract: "campaign-execution-plan/v1",
      scope: "capture",
      bucket: "sentropic-geo",
      runner_git_sha: GIT,
      method: { a: undefined },
      targets: [],
    } as unknown as CampaignExecutionPlan;
    expect(() => assertCampaignExecutionPlan(plan)).toThrow();
  });

  it("a plan differing only by a dropped-undefined field can no longer collide", () => {
    // the tainted variant is rejected outright ...
    expect(() => build({ a: 1, b: undefined as unknown as number }, [])).toThrow();
    // ... while its clean sibling hashes fine and is distinct from {a:1,b:2}
    const clean = build({ a: 1 }, []);
    const other = build({ a: 1, b: 2 }, []);
    expect(campaignDesignSha256(clean)).not.toBe(campaignDesignSha256(other));
  });
});
