import { describe, expect, it } from "vitest";

import {
  laneServiceAccountManifests,
  reconcilerCronManifest,
  reconcilerLockName,
  reconcilerRbac,
} from "./reconciler-manifest.js";

const LANES = ["zones", "normes", "pv", "reglement", "usage-dominant", "effet-densifiant", "cadastre", "immo-lots"];

interface Rule {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
  resourceNames?: string[];
}

describe("laneServiceAccountManifests — pre-provisioned per-lane job SAs", () => {
  it("emits one SA per lane, named s3dag-<lane>-sa, with NO RoleBinding and automount off", () => {
    const sas = laneServiceAccountManifests(LANES, "geo") as {
      kind: string;
      metadata: { name: string; namespace: string };
      automountServiceAccountToken: boolean;
    }[];
    expect(sas).toHaveLength(8);
    expect(sas.map((s) => s.metadata.name)).toContain("s3dag-usage-dominant-sa");
    expect(sas.map((s) => s.metadata.name)).toContain("s3dag-cadastre-sa");
    for (const sa of sas) {
      expect(sa.kind).toBe("ServiceAccount");
      expect(sa.metadata.namespace).toBe("geo");
      expect(sa.automountServiceAccountToken).toBe(false);
    }
  });

  it("grants the worker NO RBAC — only bare ServiceAccounts (closes the worker jobs:create vector)", () => {
    // A worker runs as its lane SA; with NO Role/RoleBinding it is default-deny, so a
    // compromised worker cannot create a Job as another SA (geo-archi dry-run finding).
    const objs = laneServiceAccountManifests(LANES, "geo") as { kind: string }[];
    expect(objs.every((o) => o.kind === "ServiceAccount")).toBe(true);
    expect(objs.some((o) => o.kind === "Role" || o.kind === "RoleBinding")).toBe(false);
  });
});

describe("reconcilerRbac — minimal, NO serviceaccounts verb", () => {
  const { serviceAccount, role, roleBinding } = reconcilerRbac({
    cronJobName: "s3dag-pv-reconciler",
    namespace: "geo",
    reconcilerServiceAccountName: "s3dag-reconciler-sa",
  });
  const rules = (role as { rules: Rule[] }).rules;

  it("grants jobs create/get/list, pods get/list, resourcequotas get", () => {
    const jobs = rules.find((r) => r.resources.includes("jobs"))!;
    expect(jobs.verbs.sort()).toEqual(["create", "get", "list"]);
    expect(rules.find((r) => r.resources.includes("pods"))!.verbs.sort()).toEqual(["get", "list"]);
    expect(rules.find((r) => r.resources.includes("resourcequotas"))!.verbs).toEqual(["get"]);
  });

  it("NEVER grants any verb on serviceaccounts (cannot invent/patch an identity)", () => {
    for (const r of rules) expect(r.resources).not.toContain("serviceaccounts");
  });

  it("restricts the lock lease to its own name", () => {
    const leaseGetUpdate = rules.find((r) => r.resources.includes("leases") && r.resourceNames)!;
    expect(leaseGetUpdate.resourceNames).toEqual([reconcilerLockName("s3dag-pv-reconciler")]);
  });

  it("grants `create` on jobs and on NO OTHER pod-spec carrier (jobs-only VAP soundness)", () => {
    const POD_SPEC_CARRIERS = ["pods", "deployments", "statefulsets", "replicasets", "daemonsets", "replicationcontrollers", "cronjobs"];
    const createResources = rules.filter((r) => r.verbs.includes("create")).flatMap((r) => r.resources);
    // the ONLY workload kind with create is `jobs`; leases (no pod-spec) may also create
    expect(createResources).toContain("jobs");
    for (const carrier of POD_SPEC_CARRIERS) {
      expect(createResources).not.toContain(carrier); // cannot escape a jobs-only VAP by changing kind
    }
    // and no cronjobs verb at all (no patch → cannot mutate its own jobTemplate)
    expect(rules.some((r) => r.resources.includes("cronjobs"))).toBe(false);
  });

  it("binds the reconciler SA to the Role", () => {
    expect((serviceAccount as { metadata: { name: string } }).metadata.name).toBe("s3dag-reconciler-sa");
    const rb = roleBinding as { subjects: { name: string }[]; roleRef: { name: string } };
    expect(rb.subjects[0]!.name).toBe("s3dag-reconciler-sa");
    expect(rb.roleRef.name).toBe("s3dag-pv-reconciler");
  });

  it("NEVER binds the `default` ServiceAccount (VAP invariant: `default` is allowed only because it stays bare)", () => {
    // mesh measured `default` bare → it is on the allowlist; a RoleBinding to it would
    // be a hole. Our RBAC binds ONLY s3dag-reconciler-sa; lane SAs get no binding at all.
    const rb = roleBinding as { subjects: { name: string; kind: string }[] };
    expect(rb.subjects.every((s) => s.name !== "default")).toBe(true);
    expect(rb.subjects.map((s) => s.name)).toEqual(["s3dag-reconciler-sa"]);
    // The lane SA bundle emits ServiceAccounts only — nothing that could bind `default`.
    const laneObjs = laneServiceAccountManifests(LANES, "geo") as { kind: string }[];
    expect(laneObjs.some((o) => o.kind === "RoleBinding")).toBe(false);
  });
});

describe("reconcilerCronManifest", () => {
  const cron = reconcilerCronManifest({
    cronJobName: "s3dag-pv-reconciler",
    namespace: "geo",
    reconcilerServiceAccountName: "s3dag-reconciler-sa",
    image: "ghcr.io/rhanka/geo-capture@sha256:deadbeef",
    env: { S3DAG_DAG_ID: "pv", S3DAG_LANE: "pv", S3DAG_BUCKET: "sentropic-geo-preprod" },
    s3SecretName: "geo-s3-credentials-preprod",
    imagePullSecret: "geo-registry-pull",
  }) as {
    spec: {
      schedule: string;
      concurrencyPolicy: string;
      jobTemplate: {
        spec: {
          backoffLimit: number;
          template: {
            spec: {
              serviceAccountName: string;
              restartPolicy: string;
              containers: { image: string; command: string[]; env: { name: string; value: string }[]; envFrom: { secretRef: { name: string } }[] }[];
            };
          };
        };
      };
    };
  };

  it("is a Forbid-concurrency CronJob whose tick is backoffLimit:0 / restartPolicy Never", () => {
    expect(cron.spec.concurrencyPolicy).toBe("Forbid");
    expect(cron.spec.jobTemplate.spec.backoffLimit).toBe(0);
    expect(cron.spec.jobTemplate.spec.template.spec.restartPolicy).toBe("Never");
  });

  it("runs the reconciler tick under the reconciler SA with S3 creds + injected env", () => {
    const pod = cron.spec.jobTemplate.spec.template.spec;
    expect(pod.serviceAccountName).toBe("s3dag-reconciler-sa");
    const c = pod.containers[0]!;
    expect(c.command).toEqual(["tsx", "src/s3dag/reconcile-run.ts"]);
    expect(c.envFrom[0]!.secretRef.name).toBe("geo-s3-credentials-preprod");
    const env = Object.fromEntries(c.env.map((e) => [e.name, e.value]));
    expect(env["S3DAG_DAG_ID"]).toBe("pv");
    expect(env["NODE_OPTIONS"]).toContain("ipv4first");
  });
});
