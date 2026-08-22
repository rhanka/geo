/**
 * ResourceQuota → {@link QuotaHeadroom} reader. The quota tick input is HEADROOM
 * (hard − used) per dimension, in Kubernetes units, so the planner never schedules
 * over the tenant quota. Parsing is PURE (unit-testable); the live read is behind
 * an injectable {@link K8sQuotaApi}.
 */

import { inClusterRest, type K8sRest } from "./k8s-rest.js";
import type { QuotaHeadroom } from "./ports.js";

export interface RawResourceQuota {
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

const MEMORY_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  K: 1_000,
  M: 1_000 ** 2,
  G: 1_000 ** 3,
  T: 1_000 ** 4,
};

/**
 * PURE: parse a Kubernetes quantity to a number. CPU → milli-cores (`250m`→250,
 * `2`→2000); memory/other → bytes (`768Mi`, `1Gi`, plain integers). Missing → 0.
 */
export function parseQuantity(value: string | undefined, resource: string): number {
  if (!value) return 0;
  if (resource.endsWith("cpu")) {
    return value.endsWith("m") ? Number(value.slice(0, -1)) : Number(value) * 1_000;
  }
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(value);
  if (!m) throw new Error(`invalid Kubernetes quantity ${resource}=${value}`);
  return Number(m[1]) * (m[2] ? MEMORY_UNITS[m[2]]! : 1);
}

/** PURE: headroom (hard − used) across the five quota dimensions the planner uses. */
export function quotaHeadroomFrom(raw: RawResourceQuota): QuotaHeadroom {
  const hard = raw.status?.hard ?? {};
  const used = raw.status?.used ?? {};
  const remaining = (r: string): number => parseQuantity(hard[r], r) - parseQuantity(used[r], r);
  return {
    pods: remaining("pods"),
    requestsCpuMilli: remaining("requests.cpu"),
    requestsMemoryBytes: remaining("requests.memory"),
    limitsCpuMilli: remaining("limits.cpu"),
    limitsMemoryBytes: remaining("limits.memory"),
  };
}

/** Injectable ResourceQuota read (tests inject a fake). */
export interface K8sQuotaApi {
  getResourceQuota(namespace: string, name: string): Promise<RawResourceQuota>;
}

/** The real in-cluster reader. */
export function inClusterQuotaApi(rest: K8sRest = inClusterRest()): K8sQuotaApi {
  return {
    getResourceQuota(namespace, name) {
      return rest.json<RawResourceQuota>("GET", `/api/v1/namespaces/${namespace}/resourcequotas/${name}`);
    },
  };
}

/** Read the live headroom for a named ResourceQuota. */
export async function readQuotaHeadroom(api: K8sQuotaApi, namespace: string, name: string): Promise<QuotaHeadroom> {
  return quotaHeadroomFrom(await api.getResourceQuota(namespace, name));
}
