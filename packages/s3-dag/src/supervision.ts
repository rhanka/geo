/**
 * Supervision read-model — the immo-facing business view, read PURELY from the
 * immutable S3 objects (never from Kubernetes). Freshness is the last PROMOTED
 * artifact (a lane index the reconciler advances), not the last green Job:
 * `skipped_unchanged` is a healthy terminal, `unknown`/`refused` are closed states.
 */

import {
  isTerminal,
  latestKey,
  manifestKey,
  type NodeReceipt,
  type RunLatest,
  type RunManifest,
  type RunPhase,
} from "./state.js";
import type { DagStore } from "./ports.js";

export const LANE_INDEX_CONTRACT = "s3-dag/lane-index/v1";
export type Freshness = "fresh" | "stale" | "unknown" | "refused";

/** A lane's promoted-state pointer (advanced by the reconciler on run completion). */
export interface LaneIndex {
  contract: typeof LANE_INDEX_CONTRACT;
  lane: string;
  lastRunId: string | null;
  lastSuccessAt: string | null;
  freshness: Freshness;
  observedAt: string;
  cadenceSeconds?: number;
  artifact?: string;
}

export const laneIndexKey = (lane: string): string => `indexes/lanes/${lane}/latest.json`;

export interface RefreshOverview {
  lane: string;
  lastRunId: string | null;
  lastSuccessAt: string | null;
  freshness: Freshness;
  observedAt: string | null;
}

export interface RefreshFreshness {
  lane: string;
  observedAt: string | null;
  lastSuccessAt: string | null;
  freshness: Freshness;
  cadenceSeconds: number | null;
}

export interface RefreshRunSummary {
  runId: string;
  dagId: string;
  phase: RunPhase;
  updatedAt: string;
}

export interface RefreshRunNodeView {
  nodeId: string;
  phase: string;
  attempt: number;
  artifact?: string;
}

export interface RefreshRunView extends RefreshRunSummary {
  progress: { done: number; total: number; percent: number };
  nodes: RefreshRunNodeView[];
}

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

const UNKNOWN = (lane: string): RefreshOverview => ({
  lane,
  lastRunId: null,
  lastSuccessAt: null,
  freshness: "unknown",
  observedAt: null,
});

/** Build the read-model over a {@link DagStore}. All methods are read-only. */
export function supervision(store: DagStore) {
  async function readLaneIndex(lane: string): Promise<LaneIndex | undefined> {
    const raw = await store.get(laneIndexKey(lane));
    return raw ? parse<LaneIndex>(raw.body) : undefined;
  }

  return {
    /** Current state of a lane — from its promoted index (closed `unknown` if none). */
    async getOverview(lane: string): Promise<RefreshOverview> {
      const idx = await readLaneIndex(lane);
      if (!idx) return UNKNOWN(lane);
      return {
        lane,
        lastRunId: idx.lastRunId,
        lastSuccessAt: idx.lastSuccessAt,
        freshness: idx.freshness,
        observedAt: idx.observedAt,
      };
    },

    /** Freshness of a lane — the promoted artifact's recency, not a Job status. */
    async getFreshness(lane: string): Promise<RefreshFreshness> {
      const idx = await readLaneIndex(lane);
      return {
        lane,
        observedAt: idx?.observedAt ?? null,
        lastSuccessAt: idx?.lastSuccessAt ?? null,
        freshness: idx?.freshness ?? "unknown",
        cadenceSeconds: idx?.cadenceSeconds ?? null,
      };
    },

    /** Paginated run history (most-recently-updated first). */
    async getRuns(opts: { limit?: number } = {}): Promise<RefreshRunSummary[]> {
      const limit = opts.limit ?? 50;
      const keys = await store.list("runs/");
      const runIds = keys
        .map((k) => /^runs\/([^/]+)\/latest\.json$/.exec(k)?.[1])
        .filter((x): x is string => typeof x === "string");
      const summaries: RefreshRunSummary[] = [];
      for (const runId of runIds) {
        const raw = await store.get(latestKey(runId));
        if (!raw) continue;
        const l = parse<RunLatest>(raw.body);
        summaries.push({ runId: l.runId, dagId: l.dagId, phase: l.phase, updatedAt: l.updatedAt });
      }
      summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return summaries.slice(0, limit);
    },

    /** One run's DAG progress + per-node artifacts (from immutable receipts). */
    async getRun(runId: string): Promise<RefreshRunView | undefined> {
      const raw = await store.get(latestKey(runId));
      if (!raw) return undefined;
      const latest = parse<RunLatest>(raw.body);
      const manifestRaw = await store.get(manifestKey(runId));
      const total = manifestRaw
        ? parse<RunManifest>(manifestRaw.body).nodes.length
        : Object.keys(latest.nodes).length;
      const states = Object.values(latest.nodes);
      const done = states.filter((s) => isTerminal(s.phase)).length;
      const nodes: RefreshRunNodeView[] = [];
      for (const s of states) {
        const view: RefreshRunNodeView = { nodeId: s.nodeId, phase: s.phase, attempt: s.attempt };
        if (s.receiptKey) {
          const r = await store.get(s.receiptKey);
          const artifact = r ? parse<NodeReceipt>(r.body).artifact : undefined;
          if (artifact !== undefined) view.artifact = artifact;
        }
        nodes.push(view);
      }
      return {
        runId: latest.runId,
        dagId: latest.dagId,
        phase: latest.phase,
        updatedAt: latest.updatedAt,
        progress: { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
        nodes,
      };
    },
  };
}

export type Supervision = ReturnType<typeof supervision>;
