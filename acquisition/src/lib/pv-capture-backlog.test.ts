import { describe, expect, it } from "vitest";

import {
  captureBacklogCronManifest,
  captureBacklogJobManifest,
  captureBacklogSlots,
  captureJobName,
  createBacklogManifest,
  createBacklogState,
  markLotSubmitted,
  pendingLots,
  planLot,
  reconcileBacklogState,
  sha256,
  stateCounts,
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
  it("caps every wave at six Jobs and fails closed on quota headroom", () => {
    const sixSlots = {
      pods: 7,
      requests_cpu_milli: 395,
      requests_memory_bytes: 736 * 1024 ** 2,
      limits_cpu_milli: 900,
      limits_memory_bytes: 2304 * 1024 ** 2,
    };
    expect(captureBacklogSlots(0, sixSlots)).toBe(6);
    expect(captureBacklogSlots(5, sixSlots)).toBe(1);
    expect(captureBacklogSlots(0, { ...sixSlots, requests_memory_bytes: 119 * 1024 ** 2 })).toBe(0);
    expect(captureBacklogSlots(0, { ...sixSlots, pods: 0 })).toBe(0);
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
    const yaml = captureBacklogJobManifest(campaign, campaign.lots[0]!);
    expect(yaml).toContain("completions: 1\n  parallelism: 1");
    expect(yaml).toContain("backoffLimit: 0");
    expect(yaml).toContain("memory: 120Mi");
    expect(yaml).toContain("memory: 176Mi");
    expect(yaml).toContain("cpu: 60m");
    expect(yaml).toContain("cpu: 150m");
    expect(yaml).toContain(`value: \"${campaign.lots[0]!.worklist_key}\"`);
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
