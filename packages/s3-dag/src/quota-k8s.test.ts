import { describe, expect, it } from "vitest";

import {
  parseQuantity,
  quotaHeadroomFrom,
  readQuotaHeadroom,
  type K8sQuotaApi,
  type RawResourceQuota,
} from "./quota-k8s.js";

describe("parseQuantity (pure)", () => {
  it("parses CPU to milli-cores", () => {
    expect(parseQuantity("250m", "requests.cpu")).toBe(250);
    expect(parseQuantity("2", "limits.cpu")).toBe(2000);
    expect(parseQuantity(undefined, "requests.cpu")).toBe(0);
  });

  it("parses memory to bytes (binary + decimal suffixes)", () => {
    expect(parseQuantity("768Mi", "requests.memory")).toBe(768 * 1024 ** 2);
    expect(parseQuantity("1Gi", "limits.memory")).toBe(1024 ** 3);
    expect(parseQuantity("1000", "pods")).toBe(1000);
  });

  it("throws on a malformed quantity", () => {
    expect(() => parseQuantity("12x", "requests.memory")).toThrow(/invalid/);
  });
});

describe("quotaHeadroomFrom (pure)", () => {
  it("computes hard − used across the five dimensions", () => {
    const raw: RawResourceQuota = {
      status: {
        hard: { pods: "20", "requests.cpu": "10", "requests.memory": "20Gi", "limits.cpu": "20", "limits.memory": "40Gi" },
        used: { pods: "5", "requests.cpu": "2", "requests.memory": "5Gi", "limits.cpu": "4", "limits.memory": "10Gi" },
      },
    };
    expect(quotaHeadroomFrom(raw)).toEqual({
      pods: 15,
      requestsCpuMilli: 8000,
      requestsMemoryBytes: 15 * 1024 ** 3,
      limitsCpuMilli: 16000,
      limitsMemoryBytes: 30 * 1024 ** 3,
    });
  });

  it("treats missing dimensions as zero headroom (never guesses)", () => {
    expect(quotaHeadroomFrom({})).toEqual({
      pods: 0,
      requestsCpuMilli: 0,
      requestsMemoryBytes: 0,
      limitsCpuMilli: 0,
      limitsMemoryBytes: 0,
    });
  });
});

describe("readQuotaHeadroom", () => {
  it("reads the named quota through the injected api", async () => {
    const api: K8sQuotaApi = {
      getResourceQuota: (ns, name) => {
        expect(ns).toBe("geo");
        expect(name).toBe("tenant-quota");
        return Promise.resolve({ status: { hard: { pods: "10" }, used: { pods: "3" } } });
      },
    };
    expect((await readQuotaHeadroom(api, "geo", "tenant-quota")).pods).toBe(7);
  });
});
