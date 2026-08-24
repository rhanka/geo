import { describe, expect, it } from "vitest";

import { acquireLease } from "./lease.js";
import type { K8sRest } from "./k8s-rest.js";

type Handler = (method: string, path: string, body?: unknown) => Promise<unknown>;

class FakeRest implements K8sRest {
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  constructor(private readonly handler: Handler) {}
  json<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    return this.handler(method, path, body) as Promise<T>;
  }
}

const err = (status: number): Error => Object.assign(new Error(`HTTP ${status}`), { status });
const NOW = new Date("2026-08-22T12:00:00.000Z");
const base = { namespace: "geo", name: "s3dag-pv-lock", holder: "tick-1", now: NOW, seconds: 90 };

describe("acquireLease", () => {
  it("creates the lease when absent → acquired", async () => {
    const rest = new FakeRest((method) => {
      if (method === "GET") return Promise.reject(err(404));
      return Promise.resolve({});
    });
    expect(await acquireLease({ ...base, rest })).toBe(true);
    expect(rest.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("loses the create race (409 on POST) → not acquired", async () => {
    const rest = new FakeRest((method) => Promise.reject(err(method === "GET" ? 404 : 409)));
    expect(await acquireLease({ ...base, rest })).toBe(false);
  });

  it("renews an EXPIRED lease → acquired", async () => {
    const rest = new FakeRest((method) => {
      if (method === "GET") {
        return Promise.resolve({
          metadata: { resourceVersion: "7" },
          spec: { holderIdentity: "someone-else", renewTime: "2026-08-22T11:00:00.000Z", leaseDurationSeconds: 90 },
        });
      }
      return Promise.resolve({}); // PUT
    });
    expect(await acquireLease({ ...base, rest })).toBe(true);
    expect(rest.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
  });

  it("refuses a live lease held by another holder → not acquired, no PUT", async () => {
    const rest = new FakeRest((method) => {
      if (method === "GET") {
        return Promise.resolve({
          metadata: { resourceVersion: "7" },
          spec: { holderIdentity: "someone-else", renewTime: "2026-08-22T11:59:30.000Z", leaseDurationSeconds: 90 },
        });
      }
      throw new Error("must not write");
    });
    expect(await acquireLease({ ...base, rest })).toBe(false);
    expect(rest.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("re-acquires its OWN live lease → acquired", async () => {
    const rest = new FakeRest((method) => {
      if (method === "GET") {
        return Promise.resolve({
          metadata: { resourceVersion: "7" },
          spec: { holderIdentity: "tick-1", renewTime: "2026-08-22T11:59:30.000Z", leaseDurationSeconds: 90 },
        });
      }
      return Promise.resolve({}); // PUT
    });
    expect(await acquireLease({ ...base, rest })).toBe(true);
  });

  it("loses the renew CAS (409 on PUT) → not acquired", async () => {
    const rest = new FakeRest((method) => {
      if (method === "GET") {
        return Promise.resolve({
          metadata: { resourceVersion: "7" },
          spec: { holderIdentity: "tick-1", renewTime: "2026-08-22T11:00:00.000Z", leaseDurationSeconds: 90 },
        });
      }
      return Promise.reject(err(409)); // PUT lost
    });
    expect(await acquireLease({ ...base, rest })).toBe(false);
  });
});
