import { describe, expect, it } from "vitest";

import {
  assertLaneGatedCaptureAuthorized,
  parseArgs,
} from "./k8s-capture-run.js";
import {
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  CAMPAIGN_BUCKET,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  type Sha256Ref,
} from "./lib/object-store-campaign-gate.js";

const RUNNER_SHA = "a".repeat(40);
const method = {
  lane: "pv",
  egress: "direct",
  image: `ghcr.io/rhanka/geo-capture@sha256:${"b".repeat(64)}`,
  max_bytes: 104_857_600,
};
const targets = [
  { slug: "sainte-julie", source: "pv", urls: ["https://ville.example/pv/2026-05.pdf"] },
  { slug: "beloeil", source: "pv", urls: ["https://ville.example/pv/2026-04.pdf"] },
];

function expectedDesignSha256(): Sha256Ref {
  return campaignDesignSha256(
    buildCampaignExecutionPlan({
      scope: "capture",
      runnerGitSha: RUNNER_SHA,
      method,
      targets,
    }),
  );
}

function validOwnerGo(): Record<string, unknown> {
  return {
    contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
    actor: { role: "OWNER", instance: "owner:direct" },
    via: "geo-cond",
    owner_go_direct: true,
    design_sha256: expectedDesignSha256(),
    scope: "capture",
    bucket: CAMPAIGN_BUCKET,
    owner_instance: "owner:direct",
    geo_cond_instance: "claude:geo-cond",
    // h2a_* REQUIS en mode lane-gated (hook provenance, delta-2/F2) : ils lient
    // l'artefact au message inbox que k8s a copié (k8s cross-check l'envelope_id).
    h2a_envelope_id: "env-01JLANEGATEDCAPTURE",
    h2a_session_id: "ses-01JLANEGATEDCAPTURE",
  };
}

function authorize(ownerGoArtifact: unknown, execution: "local" | "cluster" = "cluster") {
  return assertLaneGatedCaptureAuthorized({
    execution,
    runnerGitSha: RUNNER_SHA,
    method,
    targets,
    ownerGoArtifact,
  });
}

describe("assertLaneGatedCaptureAuthorized — CA-G8 capture-only lane gate", () => {
  it("passes a complete owner-direct capture artifact bound to the resolved cluster plan", () => {
    const expected = expectedDesignSha256();
    expect(authorize(validOwnerGo())).toEqual({ designSha256: expected });
  });

  it("throws when design_sha256 does not match the recomputed plan", () => {
    expect(() => authorize({ ...validOwnerGo(), design_sha256: `sha256:${"c".repeat(64)}` })).toThrow(
      /design_sha256 ne vise pas le plan résolu réel/,
    );
  });

  it("throws when actor.role is not OWNER", () => {
    expect(() => authorize({ ...validOwnerGo(), actor: { role: "conductor", instance: "relay" } })).toThrow(
      /actor\.role=OWNER requis/,
    );
  });

  it("throws when the contract is wrong", () => {
    expect(() => authorize({ ...validOwnerGo(), contract: "wrong/v1" })).toThrow(
      /contract object-store-campaign-owner-go\/v1 requis/,
    );
  });

  it("throws when via is not geo-cond", () => {
    expect(() => authorize({ ...validOwnerGo(), via: "conductor" })).toThrow(/go owner DIRECT via geo-cond requis/);
  });

  it("throws when owner_go_direct is false", () => {
    expect(() => authorize({ ...validOwnerGo(), owner_go_direct: false })).toThrow(
      /go owner DIRECT via geo-cond requis/,
    );
  });

  it("throws when bucket is not sentropic-geo", () => {
    expect(() => authorize({ ...validOwnerGo(), bucket: "another-bucket" })).toThrow(
      /bucket doit être sentropic-geo/,
    );
  });

  it("throws hard when the owner-go scope is write-rekey", () => {
    expect(() => authorize({ ...validOwnerGo(), scope: "write-rekey" })).toThrow(
      /CA-G8.*capture-only.*write-rekey/,
    );
  });

  it("throws when execution is not cluster (CA-G2)", () => {
    expect(() => authorize(validOwnerGo(), "local")).toThrow(/CA-G2 exige "cluster"/);
  });

  it("throws when h2a_envelope_id is missing — provenance hook REQUIRED in lane-gated (F2/delta-2)", () => {
    const { h2a_envelope_id: _omit, ...withoutEnvelope } = validOwnerGo();
    expect(() => authorize(withoutEnvelope)).toThrow(/h2a_envelope_id non vide requis/);
  });

  it("throws when h2a_session_id is missing — provenance hook REQUIRED in lane-gated (F2/delta-2)", () => {
    const { h2a_session_id: _omit, ...withoutSession } = validOwnerGo();
    expect(() => authorize(withoutSession)).toThrow(/h2a_session_id non vide requis/);
  });
});

describe("parseArgs — lane-gated capture requirements", () => {
  const base = [
    "--lane", "pv",
    "--worklist", "/tmp/targets.json",
    "--kubeconfig", "/tmp/ovh.kubeconfig",
    "--lane-gated-capture",
  ];

  it("throws without --owner-go-artifact", () => {
    expect(() => parseArgs([...base, "--git-sha", RUNNER_SHA])).toThrow(
      /--owner-go-artifact <path> requis avec --lane-gated-capture/,
    );
  });

  it("throws without --git-sha", () => {
    expect(() => parseArgs([...base, "--owner-go-artifact", "/tmp/owner-go.json"])).toThrow(
      /--git-sha <40-hex> requis avec --lane-gated-capture/,
    );
  });
});
