/**
 * Single-writer lease over `coordination.k8s.io/v1` — so two reconciler ticks
 * (e.g. an overlapping CronJob firing) never reconcile the same run concurrently.
 * The CAS on `latest.json` already makes a lost race harmless, but the lease avoids
 * the wasted work of two ticks racing. Ported from the proven `pv-capture-backlog`
 * acquire logic; `now` is injected so expiry is deterministic in tests.
 */

import { httpStatusOf, inClusterRest, type K8sRest } from "./k8s-rest.js";

interface RawLease {
  metadata?: { resourceVersion?: string };
  spec?: { holderIdentity?: string; renewTime?: string; leaseDurationSeconds?: number };
}

export interface AcquireLeaseArgs {
  rest?: K8sRest;
  namespace: string;
  name: string;
  holder: string;
  now: Date;
  /** Lease duration in seconds (a tick shorter than the CronJob interval). */
  seconds: number;
}

/**
 * Try to acquire/renew the lease. Returns true if THIS holder now owns it, false
 * if another holder owns an unexpired lease or a concurrent writer won the CAS.
 * Never throws on a lost race (409) — only on a genuine API error.
 */
export async function acquireLease(args: AcquireLeaseArgs): Promise<boolean> {
  const rest = args.rest ?? inClusterRest();
  const { namespace, name, holder, now, seconds } = args;
  const path = `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases/${name}`;
  const renewTime = now.toISOString();

  let previous: RawLease;
  try {
    previous = await rest.json<RawLease>("GET", path);
  } catch (err) {
    if (httpStatusOf(err) !== 404) throw err;
    try {
      await rest.json("POST", `/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases`, {
        apiVersion: "coordination.k8s.io/v1",
        kind: "Lease",
        metadata: { name, namespace },
        spec: { holderIdentity: holder, leaseDurationSeconds: seconds, renewTime },
      });
      return true;
    } catch (createErr) {
      if (httpStatusOf(createErr) === 409) return false; // another writer created it first
      throw createErr;
    }
  }

  const renewedAt = previous.spec?.renewTime ? Date.parse(previous.spec.renewTime) : 0;
  const duration = previous.spec?.leaseDurationSeconds ?? seconds;
  const expired = !Number.isFinite(renewedAt) || renewedAt + duration * 1_000 < now.getTime();
  if (!expired && previous.spec?.holderIdentity !== holder) return false;

  try {
    await rest.json("PUT", path, {
      apiVersion: "coordination.k8s.io/v1",
      kind: "Lease",
      metadata: { name, namespace, resourceVersion: previous.metadata?.resourceVersion },
      spec: { holderIdentity: holder, leaseDurationSeconds: seconds, renewTime },
    });
    return true;
  } catch (err) {
    if (httpStatusOf(err) === 409) return false; // lost the CAS to a concurrent writer
    throw err;
  }
}
