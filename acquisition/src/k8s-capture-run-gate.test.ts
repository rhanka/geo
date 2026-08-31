/**
 * Preuve locale du gate de campagne CÔTÉ RUNNER (k8s-capture-run), sans réseau
 * ni cluster. Couvre CA-G2 (jamais local), le refus par construction (aucun
 * artefact câblé) et le câblage CA-G1/G6 (design_sha256 recalculé sur les cibles
 * réelles du runner).
 */
import { describe, expect, it } from "vitest";

import {
  buildCampaignExecutionPlan,
  campaignDesignSha256,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
  type CampaignBucket,
  type CampaignScope,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./lib/object-store-campaign-gate.js";
import {
  assertCaptureStoreAuthorized,
  captureCampaignMethod,
  type CaptureCampaignGateDeps,
} from "./k8s-capture-run.js";

const RUNNER_SHA = "a".repeat(40);
const TEST_BUCKET: CampaignBucket = "sentropic-geo";
const OWNER_INSTANCE = "owner:direct";
const GEO_COND_INSTANCE = "claude:geo-cond";
const ENVELOPE_ID = "env:campaign-go";
const SESSION_ID = "sess:geo-cond";

const targets = [
  { slug: "sainte-julie", source: "pv", urls: ["https://ville.example/pv/2026-05.pdf"] },
  { slug: "beloeil", source: "pv", urls: ["https://ville.example/pv/2026-04.pdf"] },
];

const method = captureCampaignMethod({
  lane: "pv",
  egress: "direct",
  image: "geo-capture:test",
  maxBytes: 104_857_600,
});

function realDesignSha256(): Sha256Ref {
  return campaignDesignSha256(
    buildCampaignExecutionPlan({ scope: "capture", bucket: TEST_BUCKET, runnerGitSha: RUNNER_SHA, method, targets }),
  );
}

function ownerGo(designSha256: Sha256Ref, scope: CampaignScope = "capture"): ObjectStoreCampaignOwnerGo {
  return {
    contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
    actor: { role: "OWNER", instance: OWNER_INSTANCE },
    via: "geo-cond",
    owner_go_direct: true,
    design_sha256: designSha256,
    scope,
    bucket: TEST_BUCKET,
    owner_instance: OWNER_INSTANCE,
    geo_cond_instance: GEO_COND_INSTANCE,
    h2a_envelope_id: ENVELOPE_ID,
    h2a_session_id: SESSION_ID,
  };
}

function depsFor(artefact: ObjectStoreCampaignOwnerGo): CaptureCampaignGateDeps {
  return {
    resolveOwnerGo: async () => ({
      ownerGo: artefact,
      readEnvelope: async () => ({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: artefact.h2a_envelope_id,
        type: "event",
        actor: { instance: artefact.owner_instance, role: "OWNER", scope: "scope:default" },
        body: {
          kind: OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
          via: "geo-cond",
          owner_go_direct: true,
          design_sha256: artefact.design_sha256,
          scope: artefact.scope,
          bucket: artefact.bucket,
          owner_instance: artefact.owner_instance,
          geo_cond_instance: artefact.geo_cond_instance,
          h2a_session_id: artefact.h2a_session_id,
        },
      }),
      readSession: async () => ({ sessionId: SESSION_ID, instance: GEO_COND_INSTANCE, state: "live" }),
    }),
  };
}

describe("assertCaptureStoreAuthorized — gate runner de la campagne capture", () => {
  it("CA-G2 : refuse une exécution non-cluster (jamais local)", async () => {
    await expect(
      assertCaptureStoreAuthorized({
        execution: "local",
        runnerGitSha: RUNNER_SHA,
        bucket: TEST_BUCKET,
        method,
        targets,
        deps: depsFor(ownerGo(realDesignSha256())),
      }),
    ).rejects.toThrow(/CA-G2 exige "cluster"/);
  });

  it("refuse par construction quand AUCUN artefact owner-go n'est câblé", async () => {
    await expect(
      assertCaptureStoreAuthorized({
        execution: "cluster",
        runnerGitSha: RUNNER_SHA,
        bucket: TEST_BUCKET,
        method,
        targets,
        deps: {},
      }),
    ).rejects.toThrow(/aucun artefact owner-go câblé/);
  });

  it("autorise avec un artefact owner-go valide dont le design_sha256 matche les cibles réelles", async () => {
    const designSha256 = realDesignSha256();
    const result = await assertCaptureStoreAuthorized({
      execution: "cluster",
      runnerGitSha: RUNNER_SHA,
      bucket: TEST_BUCKET,
      method,
      targets,
      deps: depsFor(ownerGo(designSha256)),
    });
    expect(result.designSha256).toBe(designSha256);
  });

  it("CA-G6 : refuse un go lié à d'autres cibles que celles réellement résolues par le runner", async () => {
    // L'owner a signé un design sur 2 villes ; le runner en résout 3 (cibles réelles).
    const staleSha = realDesignSha256();
    const runnerTargets = [
      ...targets,
      { slug: "carignan", source: "pv", urls: ["https://ville.example/pv/x.pdf"] },
    ];
    await expect(
      assertCaptureStoreAuthorized({
        execution: "cluster",
        runnerGitSha: RUNNER_SHA,
        bucket: TEST_BUCKET,
        method,
        targets: runnerTargets,
        deps: depsFor(ownerGo(staleSha)),
      }),
    ).rejects.toThrow(/design_sha256 ne vise pas/);
  });

  it("refuse un go de scope write sur une soumission capture", async () => {
    const designSha256 = realDesignSha256();
    await expect(
      assertCaptureStoreAuthorized({
        execution: "cluster",
        runnerGitSha: RUNNER_SHA,
        bucket: TEST_BUCKET,
        method,
        targets,
        deps: depsFor(ownerGo(designSha256, "write-rekey")),
      }),
    ).rejects.toThrow(/scope divergent/);
  });
});
