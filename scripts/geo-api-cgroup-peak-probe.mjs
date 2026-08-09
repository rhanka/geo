#!/usr/bin/env node
/**
 * Measure geo-api memory.peak without kubectl top's coarse sampling.
 *
 * Run this against a freshly-created, isolated geo-api pod whose cgroup has no
 * earlier workload. It opens one event-driven kubectl port-forward, drains
 * concurrent OGC responses without retaining their bodies, then reads the
 * cgroup-v2 counters from inside that exact pod. There is deliberately no S3
 * or HTTP read timeout: a timeout would measure an interrupted absence, not
 * the collection requested.
 *
 * Example:
 *   KUBECONFIG_PATH=/path/poc.yaml node scripts/geo-api-cgroup-peak-probe.mjs \
 *     --pod geo-api-stream-probe --collection qc-lots-montreal --concurrency 3
 */

import { spawn } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error("usage: --pod <name> [--collection <id>] [--concurrency <n>] [--port <n>]");
  }
  args.set(key.slice(2), value);
}

const pod = args.get("pod");
if (!pod) throw new Error("--pod is required (use a fresh isolated measurement pod)");
const collection = args.get("collection") ?? "qc-lots-montreal";
const concurrency = Number(args.get("concurrency") ?? "3");
const port = Number(args.get("port") ?? "18787");
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a TCP port");

const kubectl = process.env["KUBECTL"] ?? "kubectl";
const namespace = process.env["GEO_NAMESPACE"] ?? "geo";
const kubeconfig = process.env["KUBECONFIG_PATH"];
const kubectlPrefix = [
  ...(kubeconfig ? ["--kubeconfig", kubeconfig] : []),
  "-n",
  namespace,
];

function runKubectl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(kubectl, [...kubectlPrefix, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(`kubectl ${args.join(" ")} exited ${code}: ${Buffer.concat(errors).toString("utf8").trim()}`));
    });
  });
}

function portForward() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      kubectl,
      [...kubectlPrefix, "port-forward", `pod/${pod}`, `${port}:8787`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = false;
    const onOutput = (chunk) => {
      if (!ready && String(chunk).includes("Forwarding from")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("error", reject);
    child.once("close", (code) => {
      if (!ready) reject(new Error(`kubectl port-forward exited ${code}`));
    });
  });
}

async function cgroupValue(name) {
  const raw = await runKubectl(["exec", pod, "--", "cat", `/sys/fs/cgroup/${name}`]);
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) throw new Error(`invalid ${name}: ${JSON.stringify(raw)}`);
  return value;
}

async function drainItems() {
  const response = await fetch(
    `http://127.0.0.1:${port}/collections/${encodeURIComponent(collection)}/items?limit=10000`,
  );
  if (!response.ok || !response.body) throw new Error(`items request failed: HTTP ${response.status}`);
  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.byteLength;
  return { status: response.status, bytes };
}

const before = {
  current: await cgroupValue("memory.current"),
  peak: await cgroupValue("memory.peak"),
};
const forward = await portForward();
try {
  const responses = await Promise.all(Array.from({ length: concurrency }, () => drainItems()));
  const after = {
    current: await cgroupValue("memory.current"),
    peak: await cgroupValue("memory.peak"),
  };
  const events = await runKubectl(["exec", pod, "--", "cat", "/sys/fs/cgroup/memory.events"]);
  console.log(JSON.stringify({ pod, collection, concurrency, before, after, responses, events }, null, 2));
} finally {
  forward.kill("SIGINT");
}
