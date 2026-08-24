/**
 * Quota-bounded slot planning — generalizes `pv-capture-backlog`'s
 * `captureBacklogSlots`. Given the live cluster headroom, how many more Job
 * slots may we claim this tick? Bounded on EVERY ResourceQuota dimension (pods,
 * cpu/mem requests+limits) AND a `maxActiveJobs` ceiling, with `reservePods`
 * held back for the served API so a refresh burst never evicts geo-api.
 */

import type { QuotaHeadroom } from "./ports.js";

/** Per-Job resource cost. Defaults mirror the proven PV capture single-pod Job. */
export interface PerJobCost {
  pods: number;
  requestsCpuMilli: number;
  requestsMemoryBytes: number;
  limitsCpuMilli: number;
  limitsMemoryBytes: number;
}

const MIB = 1024 ** 2;

/** Conservative single-pod default (same envelope as the PV capture Job). */
export const DEFAULT_PER_JOB_COST: PerJobCost = {
  pods: 1,
  requestsCpuMilli: 60,
  requestsMemoryBytes: 120 * MIB,
  limitsCpuMilli: 150,
  limitsMemoryBytes: 768 * MIB,
};

/** floor(headroom/cost) for one dimension; a non-positive cost imposes no limit. */
function dim(headroom: number, cost: number): number {
  if (cost <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(headroom / cost);
}

/**
 * Number of additional Jobs that may be submitted this tick. Never negative.
 * The minimum across: the `maxActiveJobs` ceiling minus what's already active,
 * and each quota dimension after reserving `reservePods` for the served API.
 */
export function availableSlots(
  activeJobs: number,
  headroom: QuotaHeadroom,
  opts: { maxActiveJobs: number; reservePods?: number; perJob?: PerJobCost },
): number {
  if (!Number.isInteger(activeJobs) || activeJobs < 0) {
    throw new Error("s3-dag: activeJobs must be a non-negative integer");
  }
  if (!Number.isInteger(opts.maxActiveJobs) || opts.maxActiveJobs < 1) {
    throw new Error("s3-dag: maxActiveJobs must be a positive integer");
  }
  const values = [
    headroom.pods,
    headroom.requestsCpuMilli,
    headroom.requestsMemoryBytes,
    headroom.limitsCpuMilli,
    headroom.limitsMemoryBytes,
  ];
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error("s3-dag: quota headroom must be finite");
  }
  const perJob = opts.perJob ?? DEFAULT_PER_JOB_COST;
  const reservePods = opts.reservePods ?? 0;
  const availablePods = headroom.pods - reservePods;
  return Math.max(
    0,
    Math.min(
      opts.maxActiveJobs - activeJobs,
      dim(availablePods, perJob.pods),
      dim(headroom.requestsCpuMilli, perJob.requestsCpuMilli),
      dim(headroom.requestsMemoryBytes, perJob.requestsMemoryBytes),
      dim(headroom.limitsCpuMilli, perJob.limitsCpuMilli),
      dim(headroom.limitsMemoryBytes, perJob.limitsMemoryBytes),
    ),
  );
}
