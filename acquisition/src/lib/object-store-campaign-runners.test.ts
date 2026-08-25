import { describe, expect, it, vi } from "vitest";

import {
  campaignDesignSha256,
  CAMPAIGN_BUCKET,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
  OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
  type CampaignScope,
  type H2aRecordReader,
  type ObjectStoreCampaignOwnerGo,
  type Sha256Ref,
} from "./object-store-campaign-gate.js";
import {
  buildLegacyMergePlan,
  buildRekeyPlan,
  runLegacyMergeCampaign,
  runRekeyCampaign,
  type LegacyMergeTarget,
  type RekeyTarget,
} from "./object-store-campaign-runners.js";
import { getBytes, objectHead } from "./s3.js";

// --------------------------------------------------------------------------
// Stateful, network-free mock S3 — records every command; actually copies bytes
// so byte-for-byte survival can be asserted after a re-key.
// --------------------------------------------------------------------------

function bytesOf(body: unknown): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body as Uint8Array);
}

interface MockOp {
  op: "put" | "put-412" | "get" | "head" | "copy" | "delete";
  bucket: string;
  key: string;
}

function makeMockS3(initial: Record<string, string> = {}) {
  const store = new Map<string, Buffer>();
  for (const [k, v] of Object.entries(initial)) store.set(k, Buffer.from(v, "utf8"));
  const ops: MockOp[] = [];
  let etagSeq = 0;
  const send = vi.fn(
    async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      const input = command.input;
      const bucket = String(input["Bucket"]);
      if (name === "PutObjectCommand") {
        const key = String(input["Key"]);
        if (input["IfNoneMatch"] === "*" && store.has(key)) {
          ops.push({ op: "put-412", bucket, key });
          throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
        }
        store.set(key, bytesOf(input["Body"]));
        ops.push({ op: "put", bucket, key });
        return { ETag: `"etag-${String(++etagSeq)}"` };
      }
      if (name === "GetObjectCommand") {
        const key = String(input["Key"]);
        ops.push({ op: "get", bucket, key });
        const bytes = store.get(key);
        if (!bytes) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
        return {
          Body: (async function* () {
            yield bytes;
          })(),
        };
      }
      if (name === "HeadObjectCommand") {
        const key = String(input["Key"]);
        ops.push({ op: "head", bucket, key });
        const bytes = store.get(key);
        if (!bytes) throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
        return { ETag: '"etag-head"', ContentLength: bytes.length, LastModified: new Date(0) };
      }
      if (name === "CopyObjectCommand") {
        const key = String(input["Key"]);
        const copySource = String(input["CopySource"]);
        const srcKey = decodeURI(copySource.slice(bucket.length + 1));
        const bytes = store.get(srcKey);
        if (!bytes) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
        store.set(key, Buffer.from(bytes)); // server-side copy = independent bytes
        ops.push({ op: "copy", bucket, key });
        return {};
      }
      if (name === "DeleteObjectCommand") {
        const key = String(input["Key"]);
        store.delete(key);
        ops.push({ op: "delete", bucket, key });
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  );
  return { s3: { send } as never, store, ops };
}

// --------------------------------------------------------------------------
// Synthetic owner-go artefact + matching h2a envelope/session in an injected store
// --------------------------------------------------------------------------

const OWNER = "owner:alice";
const GEO_COND = "geo-cond:runner-7";
const ENVELOPE_ID = "env-abc";
const SESSION_ID = "sess-xyz";
const RUNNER_SHA = "a".repeat(40);

function buildFixture(scope: CampaignScope, designSha256: Sha256Ref) {
  const ownerGo: ObjectStoreCampaignOwnerGo = {
    contract: OBJECT_STORE_CAMPAIGN_OWNER_GO_CONTRACT,
    actor: { role: "OWNER", instance: OWNER },
    via: "geo-cond",
    owner_go_direct: true,
    design_sha256: designSha256,
    scope,
    bucket: CAMPAIGN_BUCKET,
    owner_instance: OWNER,
    geo_cond_instance: GEO_COND,
    h2a_envelope_id: ENVELOPE_ID,
    h2a_session_id: SESSION_ID,
  };
  const h2aEnvelope = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: ENVELOPE_ID,
    type: "event",
    actor: { instance: OWNER, role: "OWNER" },
    body: {
      kind: OBJECT_STORE_CAMPAIGN_OWNER_GO_KIND,
      via: "geo-cond",
      owner_go_direct: true,
      owner_instance: OWNER,
      geo_cond_instance: GEO_COND,
      design_sha256: designSha256,
      scope,
      bucket: CAMPAIGN_BUCKET,
      h2a_session_id: SESSION_ID,
    },
  };
  const session = { sessionId: SESSION_ID, instance: GEO_COND, state: "live" };
  const readEnvelope: H2aRecordReader = async (id) => (id === ENVELOPE_ID ? h2aEnvelope : null);
  const readSession: H2aRecordReader = async (id) => (id === SESSION_ID ? session : null);
  return { ownerGo, readEnvelope, readSession };
}

const REKEY_TARGETS: RekeyTarget[] = [
  { src_key: "exports/geo/old/a.json", dest_key: "exports/geo/new/a.json" },
  { src_key: "exports/geo/old/b.json", dest_key: "exports/geo/new/b.json" },
];
const REKEY_DESIGN = campaignDesignSha256(buildRekeyPlan(RUNNER_SHA, REKEY_TARGETS));

const LEGACY_TAG = "legacy-2026";
const LEGACY_TARGETS: LegacyMergeTarget[] = [
  { key: "registry/geo/legacy/tag-1/x.json", body: "XXX", contentType: "application/json" },
  { key: "registry/geo/legacy/tag-1/y.json", body: "YYY", contentType: "application/json" },
];
const LEGACY_DESIGN = campaignDesignSha256(
  buildLegacyMergePlan(RUNNER_SHA, LEGACY_TAG, LEGACY_TARGETS),
);

function outcomesByKey(written: Array<{ key: string; outcome: string }>): Record<string, string> {
  return Object.fromEntries(written.map((w) => [w.key, w.outcome]));
}

// --------------------------------------------------------------------------
// CA-G7 — re-key is COPY-ONLY (old key intact byte-for-byte; no deleteObject)
// --------------------------------------------------------------------------

describe("CA-G7 — re-key COPY-ONLY", () => {
  it("copies to new keys; old keys stay byte-identical; deleteObject never called", async () => {
    const mock = makeMockS3({
      "exports/geo/old/a.json": "AAA",
      "exports/geo/old/b.json": "BBB",
    });
    const fx = buildFixture("write-rekey", REKEY_DESIGN);
    const result = await runRekeyCampaign({
      s3: mock.s3,
      ownerGo: fx.ownerGo,
      readEnvelope: fx.readEnvelope,
      readSession: fx.readSession,
      runnerGitSha: RUNNER_SHA,
      targets: REKEY_TARGETS,
    });

    expect(result.copied).toHaveLength(2);
    // (a) deleteObject was NEVER called
    expect(mock.ops.filter((o) => o.op === "delete")).toHaveLength(0);
    // (b) old keys still return byte-identical content
    expect((await getBytes(mock.s3, "exports/geo/old/a.json", CAMPAIGN_BUCKET)).toString()).toBe("AAA");
    expect((await getBytes(mock.s3, "exports/geo/old/b.json", CAMPAIGN_BUCKET)).toString()).toBe("BBB");
    expect((await objectHead(mock.s3, "exports/geo/old/a.json", CAMPAIGN_BUCKET)).exists).toBe(true);
    // new keys carry the copied bytes
    expect((await getBytes(mock.s3, "exports/geo/new/a.json", CAMPAIGN_BUCKET)).toString()).toBe("AAA");
    expect((await getBytes(mock.s3, "exports/geo/new/b.json", CAMPAIGN_BUCKET)).toString()).toBe("BBB");
  });
});

// --------------------------------------------------------------------------
// CA-G3 — legacy-merge is ADDITIVE-TAGGED (never overwrites/drops)
// --------------------------------------------------------------------------

describe("CA-G3 — legacy-merge additif-taggé", () => {
  it("leaves an existing (identical) target byte-unchanged; only new tagged keys added", async () => {
    const mock = makeMockS3({ "registry/geo/legacy/tag-1/x.json": "XXX" });
    const fx = buildFixture("write-legacy-merge", LEGACY_DESIGN);
    const result = await runLegacyMergeCampaign({
      s3: mock.s3,
      ownerGo: fx.ownerGo,
      readEnvelope: fx.readEnvelope,
      readSession: fx.readSession,
      runnerGitSha: RUNNER_SHA,
      tag: LEGACY_TAG,
      targets: LEGACY_TARGETS,
    });

    expect(outcomesByKey(result.written)).toEqual({
      "registry/geo/legacy/tag-1/x.json": "existing-equal",
      "registry/geo/legacy/tag-1/y.json": "created",
    });
    // existing key byte-unchanged; no successful overwrite PUT landed on it
    expect((await getBytes(mock.s3, "registry/geo/legacy/tag-1/x.json", CAMPAIGN_BUCKET)).toString()).toBe("XXX");
    expect(mock.ops.filter((o) => o.op === "put" && o.key.endsWith("x.json"))).toHaveLength(0);
    // new tagged key added
    expect((await getBytes(mock.s3, "registry/geo/legacy/tag-1/y.json", CAMPAIGN_BUCKET)).toString()).toBe("YYY");
  });

  it("refuses to overwrite an existing key holding DIFFERENT bytes (leaves it unchanged)", async () => {
    const mock = makeMockS3({ "registry/geo/legacy/tag-1/x.json": "DIFFERENT" });
    const fx = buildFixture("write-legacy-merge", LEGACY_DESIGN);
    await expect(
      runLegacyMergeCampaign({
        s3: mock.s3,
        ownerGo: fx.ownerGo,
        readEnvelope: fx.readEnvelope,
        readSession: fx.readSession,
        runnerGitSha: RUNNER_SHA,
        tag: LEGACY_TAG,
        targets: LEGACY_TARGETS,
      }),
    ).rejects.toThrow(/immutable S3 object collision/);
    // the pre-existing object is untouched, and no delete happened
    expect((await getBytes(mock.s3, "registry/geo/legacy/tag-1/x.json", CAMPAIGN_BUCKET)).toString()).toBe("DIFFERENT");
    expect(mock.ops.filter((o) => o.op === "delete")).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// CA-G4 — no destructive op; nothing written outside sentropic-geo
// --------------------------------------------------------------------------

describe("CA-G4 — SCW intacte / non-destructif", () => {
  it("neither runner ever calls deleteObject nor writes outside sentropic-geo", async () => {
    const rekeyMock = makeMockS3({
      "exports/geo/old/a.json": "AAA",
      "exports/geo/old/b.json": "BBB",
    });
    const rekeyFx = buildFixture("write-rekey", REKEY_DESIGN);
    await runRekeyCampaign({
      s3: rekeyMock.s3,
      ownerGo: rekeyFx.ownerGo,
      readEnvelope: rekeyFx.readEnvelope,
      readSession: rekeyFx.readSession,
      runnerGitSha: RUNNER_SHA,
      targets: REKEY_TARGETS,
    });

    const legacyMock = makeMockS3();
    const legacyFx = buildFixture("write-legacy-merge", LEGACY_DESIGN);
    await runLegacyMergeCampaign({
      s3: legacyMock.s3,
      ownerGo: legacyFx.ownerGo,
      readEnvelope: legacyFx.readEnvelope,
      readSession: legacyFx.readSession,
      runnerGitSha: RUNNER_SHA,
      tag: LEGACY_TAG,
      targets: LEGACY_TARGETS,
    });

    for (const mock of [rekeyMock, legacyMock]) {
      expect(mock.ops.filter((o) => o.op === "delete")).toHaveLength(0);
      expect(mock.ops.every((o) => o.bucket === CAMPAIGN_BUCKET)).toBe(true);
    }
    expect(CAMPAIGN_BUCKET).toBe("sentropic-geo");
  });
});

// --------------------------------------------------------------------------
// CA-G6 — design_sha binding (recomputed on the REAL plan; targets bound)
// --------------------------------------------------------------------------

describe("CA-G6 — binding design_sha", () => {
  it("refuses when the artefact's design_sha does not match the runner's recomputed plan (target added)", async () => {
    const mock = makeMockS3({
      "exports/geo/old/a.json": "AAA",
      "exports/geo/old/b.json": "BBB",
      "exports/geo/old/c.json": "CCC",
    });
    // Artefact authorises the 2-target plan…
    const fx = buildFixture("write-rekey", REKEY_DESIGN);
    // …but the runner resolves a 3-target plan → recomputed sha differs → refusal.
    await expect(
      runRekeyCampaign({
        s3: mock.s3,
        ownerGo: fx.ownerGo,
        readEnvelope: fx.readEnvelope,
        readSession: fx.readSession,
        runnerGitSha: RUNNER_SHA,
        targets: [
          ...REKEY_TARGETS,
          { src_key: "exports/geo/old/c.json", dest_key: "exports/geo/new/c.json" },
        ],
      }),
    ).rejects.toThrow(/binding rompu/);
    // gate BEFORE any write: nothing copied, nothing deleted
    expect(mock.ops.filter((o) => o.op === "copy" || o.op === "delete")).toHaveLength(0);
  });

  it("design_sha is order-independent (canonical, sorted preimage) and code-bound", () => {
    const forward = campaignDesignSha256(buildRekeyPlan(RUNNER_SHA, REKEY_TARGETS));
    const reversed = campaignDesignSha256(buildRekeyPlan(RUNNER_SHA, [...REKEY_TARGETS].reverse()));
    expect(reversed).toBe(forward);
    // a different runner_git_sha (different CODE) changes the binding
    const otherCode = campaignDesignSha256(buildRekeyPlan("b".repeat(40), REKEY_TARGETS));
    expect(otherCode).not.toBe(forward);
  });
});
