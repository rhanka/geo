import { describe, expect, it } from "vitest";

import {
  assertContiguousWorklistLots,
  assertPvBacklogWorklistBytes,
  captureBacklogCronManifest,
  captureBacklogJobManifest,
  captureBacklogSlots,
  captureJobName,
  createBacklogManifest,
  createBacklogState,
  deduplicatePvBacklogTargets,
  kubernetesLeaseTime,
  markLotSubmitted,
  pendingLots,
  planLot,
  reconcileBacklogState,
  sha256,
  stateCounts,
  verifiedCaptureConcurrency,
  worklistKey,
} from "./pv-capture-backlog.js";

const NOW = "2026-07-26T12:00:00.000Z";
const ID = "pv-20260726-084c868acc968fb1";

function manifest(lots = 2) {
  return createBacklogManifest({
    id: ID,
    created_at: NOW,
    lane: "pv",
    namespace: "geo",
    image: "registry.example/geo-capture:backlog",
    delay_ms: 2_000,
    max_bytes: 104857600,
    egress: "direct",
    lots: Array.from({ length: lots }, (_, index) => {
      const lot = index + 1;
      const body = `[{"slug":"ville-${lot}","source":"pv-index","urls":["https://ville.example/${lot}.pdf"]}]\n`;
      return {
        lot,
        targets: 1,
        worklist_key: worklistKey(ID, lot),
        worklist_sha256: sha256(body),
        job_name: captureJobName(ID, lot),
      };
    }),
  });
}

describe("PV capture backlog", () => {
  it("accepts globally offset but contiguous worklist names", () => {
    expect(() => assertContiguousWorklistLots([112, 113, 114, 115, 116, 117])).not.toThrow();
    expect(() => assertContiguousWorklistLots([112, 114])).toThrow("non contiguë");
  });

  it("refuses an entirely captured resumed lot instead of serving it again", () => {
    const targets = [{
      slug: "alpha",
      source: "pv-index",
      urls: ["https://documents.example/already.pdf"],
    }];

    expect(() => deduplicatePvBacklogTargets(108, targets, new Set([
      "https://documents.example/already.pdf",
    ]))).toThrow("lot 108 intégralement redondant: 1 documents déjà captés");
  });

  it("reduces a partially captured resumed lot and counts discarded documents", () => {
    const targets = [{
      slug: "alpha",
      source: "pv-index",
      urls: ["https://documents.example/already.pdf#page=1", "https://documents.example/new.pdf"],
    }];

    expect(deduplicatePvBacklogTargets(109, targets, new Set([
      "https://documents.example/already.pdf",
    ]))).toEqual({
      targets: [{ slug: "alpha", source: "pv-index", urls: ["https://documents.example/new.pdf"] }],
      discarded_captured: 1,
    });
  });

  it("persists the filtered immutable worklist before submitting its Job", () => {
    const campaign = manifest();
    const prepared = {
      worklist_key: `registry/capture-worklists/${ID}/resume/lot-0001-0123456789abcdef.json`,
      worklist_sha256: sha256("filtered worklist"),
      discarded_captured: 1,
    };
    const state = planLot(createBacklogState(campaign, NOW), 1, NOW, prepared);
    expect(state.lots[0]).toMatchObject({
      status: "planned",
      effective_worklist_key: prepared.worklist_key,
      effective_worklist_sha256: prepared.worklist_sha256,
      discarded_captured: 1,
    });

    const job = JSON.parse(captureBacklogJobManifest(campaign, campaign.lots[0]!, prepared.worklist_key)) as {
      spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value?: string }> }> } } };
    };
    expect(job.spec.template.spec.containers[0]!.env.find((entry) => entry.name === "WORKLIST")?.value).toBe(prepared.worklist_key);
  });

  it("rejects a changed effective worklist when resuming after planned", () => {
    const campaign = manifest();
    const prepared = {
      worklist_key: `registry/capture-worklists/${ID}/resume/lot-0001-0123456789abcdef.json`,
      worklist_sha256: sha256("immutable worklist"),
      discarded_captured: 1,
    };
    const state = planLot(createBacklogState(campaign, NOW), 1, NOW, prepared);
    const persisted = state.lots[0]!;

    expect(() => assertPvBacklogWorklistBytes(
      persisted.lot,
      persisted.effective_worklist_key!,
      persisted.effective_worklist_sha256!,
      "changed worklist",
    )).toThrow("divergente du hash immuable");
  });

  it("sérialise les LeaseTime Kubernetes avec six chiffres de fraction", () => {
    expect(kubernetesLeaseTime(new Date("2026-07-28T16:32:14.182Z"))).toBe("2026-07-28T16:32:14.182000Z");
  });

  it("caps every wave at six Jobs and fails closed on quota headroom", () => {
    const sixSlots = {
      pods: 7,
      requests_cpu_milli: 395,
      requests_memory_bytes: 736 * 1024 ** 2,
      limits_cpu_milli: 900,
      limits_memory_bytes: 2304 * 1024 ** 2,
    };
    expect(captureBacklogSlots(0, sixSlots)).toBe(6);
    expect(captureBacklogSlots(5, sixSlots, 6)).toBe(1);
    expect(captureBacklogSlots(0, { ...sixSlots, requests_memory_bytes: 119 * 1024 ** 2 })).toBe(0);
    expect(captureBacklogSlots(0, { ...sixSlots, pods: 0 })).toBe(0);
  });

  it("raises concurrency only after a successfully settled prior lot", () => {
    const campaign = manifest(3);
    let state = createBacklogState(campaign, NOW);
    expect(verifiedCaptureConcurrency(state, campaign)).toBe(1);
    state = markLotSubmitted(planLot(state, 1, NOW), 1, NOW);
    state = reconcileBacklogState(state, campaign, [{ name: campaign.lots[0]!.job_name, status: "complete", failure_reason: null }], NOW);
    expect(verifiedCaptureConcurrency(state, campaign)).toBe(2);
  });

  it("reuses the deterministic planned Job after a controller crash without skipping the lot", () => {
    const campaign = manifest();
    let state = createBacklogState(campaign, NOW);
    state = planLot(state, 1, NOW); // CAS durable avant le POST Kubernetes.
    expect(pendingLots(state, 6)).toEqual([1, 2]);

    // Le processus est mort après create: le Job peut être vu au tick suivant,
    // qui ne crée pas un second nom et le marque submitted.
    state = reconcileBacklogState(state, campaign, [{
      name: campaign.lots[0]!.job_name,
      status: "active",
      failure_reason: null,
    }], NOW);
    expect(state.lots[0]).toMatchObject({ status: "submitted", submitted_at: NOW });
    expect(state.lots[0]!.planned_at).toBe(NOW);
  });

  it("settles a 404-containing successful Job as terminal work without classifying any source absent", () => {
    const campaign = manifest();
    let state = createBacklogState(campaign, NOW);
    state = markLotSubmitted(planLot(state, 1, NOW), 1, NOW);
    state = reconcileBacklogState(state, campaign, [{
      name: campaign.lots[0]!.job_name,
      status: "complete",
      failure_reason: null,
    }], NOW);

    expect(state.phase).toBe("running");
    expect(state.lots[0]).toMatchObject({ status: "settled", blocked_reason: null });
    // La preuve de 404 demeure le manifest de run, pas un statut "absent" ici.
    expect(stateCounts(state)).toEqual({ pending: 1, planned: 0, submitted: 0, settled: 1, blocked: 0 });
  });

  it("halts on OOMKilled instead of retrying a partially fetched lot", () => {
    const campaign = manifest();
    let state = createBacklogState(campaign, NOW);
    state = markLotSubmitted(planLot(state, 1, NOW), 1, NOW);
    state = reconcileBacklogState(state, campaign, [{
      name: campaign.lots[0]!.job_name,
      status: "failed",
      failure_reason: "OOMKilled",
    }], NOW);

    expect(state.phase).toBe("halted");
    expect(state.lots[0]).toMatchObject({ status: "blocked", blocked_reason: "OOMKilled" });
    expect(pendingLots(state, 6)).toEqual([]);
  });

  it("stops only when every immutable lot has a completed Kubernetes Job", () => {
    const campaign = manifest();
    let state = createBacklogState(campaign, NOW);
    for (const lot of [1, 2]) state = markLotSubmitted(planLot(state, lot, NOW), lot, NOW);
    state = reconcileBacklogState(state, campaign, campaign.lots.map((lot) => ({
      name: lot.job_name,
      status: "complete" as const,
      failure_reason: null,
    })), NOW);

    expect(state.phase).toBe("complete");
    expect(stateCounts(state)).toEqual({ pending: 0, planned: 0, submitted: 0, settled: 2, blocked: 0 });
  });

  it("emits one mono-pod capture Job with the measured resource ceiling", () => {
    const campaign = manifest();
    const job = JSON.parse(captureBacklogJobManifest(campaign, campaign.lots[0]!)) as {
      spec: { completions: number; parallelism: number; backoffLimit: number; template: { spec: { containers: Array<{ env: Array<{ name: string; value?: string }>; resources: { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } } }> } } };
    };
    const capture = job.spec.template.spec.containers[0]!;
    expect(job.spec.completions).toBe(1);
    expect(job.spec.parallelism).toBe(1);
    expect(job.spec.backoffLimit).toBe(0);
    expect(capture.resources).toEqual({ requests: { cpu: "60m", memory: "120Mi" }, limits: { cpu: "150m", memory: "176Mi" } });
    expect(capture.env.find((entry) => entry.name === "WORKLIST")?.value).toBe(campaign.lots[0]!.worklist_key);
  });

  it("emits a separate short CronJob with least-privilege observation and self-suspension", () => {
    const campaign = manifest();
    const yaml = captureBacklogCronManifest(campaign, `geo-pv-backlog-${ID}`);
    expect(yaml).toContain("schedule: \"*/2 * * * *\"");
    expect(yaml).toContain("concurrencyPolicy: Forbid");
    expect(yaml).toContain("resources: [\"jobs\"]");
    expect(yaml).toContain("resources: [\"leases\"]");
    expect(yaml).toContain("resources: [\"resourcequotas\"]");
    expect(yaml).toContain("resources: [\"cronjobs\"]");
    expect(yaml).toContain("command: [\"tsx\", \"src/pv-capture-backlog-run.ts\"]");
    expect(yaml).toContain("memory: 16Mi");
  });
});
