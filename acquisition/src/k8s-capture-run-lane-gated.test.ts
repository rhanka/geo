import { describe, expect, it } from "vitest";

import {
  assertLaneGatedCaptureAuthorized,
  parseArgs,
} from "./k8s-capture-run.js";
import {
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  type CampaignBucket,
  type Sha256Ref,
} from "./lib/object-store-campaign-gate.js";

const RUNNER_SHA = "a".repeat(40);
const TEST_BUCKET: CampaignBucket = "sentropic-geo";
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
      bucket: TEST_BUCKET,
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
    bucket: TEST_BUCKET,
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
    bucket: TEST_BUCKET,
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

  it("throws fail-closed when via is unknown (cond-3, closed enum)", () => {
    expect(() => authorize({ ...validOwnerGo(), via: "conductor" })).toThrow(/via inconnu.*fail-closed/);
  });

  it("throws fail-closed when via is missing entirely (cond-3)", () => {
    const { via: _omit, ...withoutVia } = validOwnerGo();
    expect(() => authorize(withoutVia)).toThrow(/via inconnu.*fail-closed/);
  });

  it("throws when owner_go_direct is false (geo-cond provenance check)", () => {
    expect(() => authorize({ ...validOwnerGo(), owner_go_direct: false })).toThrow(
      /go owner DIRECT via geo-cond requis/,
    );
  });

  it("throws when the owner-go bucket is not in the allowlist (fail-closed)", () => {
    expect(() => authorize({ ...validOwnerGo(), bucket: "another-bucket" })).toThrow(
      /allowlist fermée/,
    );
  });

  it("accepts a préprod owner-go on a préprod runner (allowlist + coherence)", () => {
    // Runner préprod : bucket=preprod dans le plan (→ design_sha) ET dans l'input auth.
    const preprodDesign = campaignDesignSha256(
      buildCampaignExecutionPlan({
        scope: "capture",
        bucket: "sentropic-geo-preprod",
        runnerGitSha: RUNNER_SHA,
        method,
        targets,
      }),
    );
    const preprodOwnerGo = {
      ...validOwnerGo(),
      design_sha256: preprodDesign,
      bucket: "sentropic-geo-preprod",
    };
    expect(() =>
      assertLaneGatedCaptureAuthorized({
        execution: "cluster",
        runnerGitSha: RUNNER_SHA,
        bucket: "sentropic-geo-preprod",
        method,
        targets,
        ownerGoArtifact: preprodOwnerGo,
      }),
    ).not.toThrow();
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

function validDirectChatOwnerGo(): Record<string, unknown> {
  const s = expectedDesignSha256();
  return {
    contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
    actor: { role: "OWNER", instance: "owner:direct" },
    via: "direct-session-chat",
    owner_go_direct: true,
    design_sha256: s,
    scope: "capture",
    bucket: TEST_BUCKET,
    owner_instance: "owner:direct",
    // Provenance path-A : go owner comme tour-user DANS la session exécutante (k8s) —
    // PAS de h2a_* (N/A : la provenance est le transcript, pas une enveloppe inbox).
    executor_session: "k8s:5d642e",
    received_at: "2026-08-25T10:00:00Z",
    // cond-1 : owner_go_text VERBATIM référence le design_sha S (autorise LE PLAN S).
    owner_go_text: `GO capture — design_sha S=${s} — je consens à l'ancre procédurale.`,
  };
}

describe("assertLaneGatedCaptureAuthorized — path A (via=direct-session-chat, C1-équivalent)", () => {
  it("passes an owner-direct-chat capture artifact whose owner_go_text references design_sha S (no h2a_* needed)", () => {
    const expected = expectedDesignSha256();
    expect(authorize(validDirectChatOwnerGo())).toEqual({ designSha256: expected });
  });

  it("reuses the SHARED checks — actor.role≠OWNER throws (single-source, NOT re-mirrored)", () => {
    expect(() =>
      authorize({ ...validDirectChatOwnerGo(), actor: { role: "conductor", instance: "relay" } }),
    ).toThrow(/actor\.role=OWNER requis/);
  });

  it("reuses the SHARED design_sha binding — mismatch throws (CA-G6)", () => {
    expect(() => authorize({ ...validDirectChatOwnerGo(), design_sha256: `sha256:${"c".repeat(64)}` })).toThrow(
      /design_sha256 ne vise pas le plan résolu réel/,
    );
  });

  it("throws when executor_session is missing (path-A provenance REQUIRED, not optional-for-all: F2)", () => {
    const { executor_session: _omit, ...without } = validDirectChatOwnerGo();
    expect(() => authorize(without)).toThrow(/executor_session non vide requis/);
  });

  it("throws when received_at is missing (path-A provenance REQUIRED)", () => {
    const { received_at: _omit, ...without } = validDirectChatOwnerGo();
    expect(() => authorize(without)).toThrow(/received_at non vide requis/);
  });

  it("throws when owner_go_text is missing (path-A provenance REQUIRED)", () => {
    const { owner_go_text: _omit, ...without } = validDirectChatOwnerGo();
    expect(() => authorize(without)).toThrow(/owner_go_text non vide requis/);
  });

  it("throws when owner_go_text does NOT reference the design_sha S (cond-1, plan-specific)", () => {
    expect(() =>
      authorize({ ...validDirectChatOwnerGo(), owner_go_text: "GO capture — vas-y (aucun design_sha)" }),
    ).toThrow(/owner_go_text ne référence pas le design_sha attendu/);
  });

  it("hard-refuses a write scope even via direct-session-chat (CA-G8 holds for BOTH via)", () => {
    expect(() => authorize({ ...validDirectChatOwnerGo(), scope: "write-rekey" })).toThrow(
      /CA-G8.*capture-only.*write-rekey/,
    );
  });

  it("still requires cluster execution via direct-session-chat (CA-G2)", () => {
    expect(() => authorize(validDirectChatOwnerGo(), "local")).toThrow(/CA-G2 exige "cluster"/);
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
