/**
 * Public control only: re-fetch a served proof URL and compare the digest of
 * the bytes received now with the digest currently exposed by geo-api.  The
 * in-memory CaptureRun keeps every network call behind capturedFetch while
 * deliberately writing neither raw bytes nor a capture manifest to S3: this
 * result is a control, never a new provenance attestation.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRun,
  capturedFetch,
  type CaptureObjectStore,
} from "../../packages/qc-sources/src/capture/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = "https://api.geo.sent-tech.ca";
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type ControlCategory = "PREUVE_V2_EXACTE" | "URL_SHA_SANS_CAPTURE";

interface PartitionReport {
  contract: "preuves-servies-partition/v1";
  partition: Record<ControlCategory, { slugs: string[] }>;
}

interface ServedEndpoint {
  field: "proof.geometry_source.url" | "proof.sources.geometry.artifact_uri";
  url: string;
  sha256: `sha256:${string}`;
}

class MemoryCaptureStore implements CaptureObjectStore {
  async head(): Promise<boolean> { return false; }
  async put(): Promise<void> { /* The refetch control is intentionally non-durable. */ }
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function servedProofEndpoint(feature: unknown, category: ControlCategory): ServedEndpoint {
  const properties = record(record(feature)?.properties);
  const proof = record(properties?.proof);
  const source = category === "PREUVE_V2_EXACTE"
    ? record(proof?.geometry_source)
    : record(record(proof?.sources)?.geometry);
  const field = category === "PREUVE_V2_EXACTE" ? "proof.geometry_source.url" : "proof.sources.geometry.artifact_uri";
  const url = category === "PREUVE_V2_EXACTE" ? source?.url : source?.artifact_uri;
  const sha256 = source?.sha256;
  if (!validHttpsUrl(url) || typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
    throw new Error(`served feature does not expose ${category} at ${field}`);
  }
  return { field, url, sha256: sha256 as `sha256:${string}` };
}

function selectedSlugs(report: PartitionReport): Array<{ slug: string; category: ControlCategory }> {
  const exact = report.partition.PREUVE_V2_EXACTE.slugs;
  const withoutCapture = report.partition.URL_SHA_SANS_CAPTURE.slugs;
  for (const slug of ["armagh", ...exact]) {
    if (exact.includes(slug)) {
      const categoryTwo = ["laval", "lassomption"].filter((candidate) => withoutCapture.includes(candidate));
      if (categoryTwo.length === 2) {
        return [{ slug, category: "PREUVE_V2_EXACTE" }, ...categoryTwo.map((candidate) => ({ slug: candidate, category: "URL_SHA_SANS_CAPTURE" as const }))];
      }
    }
  }
  throw new Error("the partition no longer contains the fixed 1+2 refetch control sample");
}

async function main(): Promise<void> {
  const partitionArgument = option("partition");
  const outputArgument = option("out");
  if (!partitionArgument || !outputArgument) throw new Error("--partition=<partition.json> --out=<rehashes.json> are required");
  const partitionPath = insideRepo(partitionArgument, "partition");
  const outputPath = insideRepo(outputArgument, "out");
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite refetch control: ${relative(ROOT, outputPath)}`);
  const partition = JSON.parse(readFileSync(partitionPath, "utf8")) as Partial<PartitionReport>;
  if (
    partition.contract !== "preuves-servies-partition/v1" ||
    !Array.isArray(partition.partition?.PREUVE_V2_EXACTE?.slugs) ||
    !Array.isArray(partition.partition?.URL_SHA_SANS_CAPTURE?.slugs)
  ) throw new Error(`incompatible partition report: ${relative(ROOT, partitionPath)}`);
  const run = new CaptureRun({
    runId: `proof-control-${new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z")}`,
    lane: "zones",
    store: new MemoryCaptureStore(),
    userAgent: "sentropic-geo-proof-control/1.0",
    execution: "local",
    echo: null,
    flushEvery: 1,
  });
  const observations = [];
  for (const target of selectedSlugs(partition as PartitionReport)) {
    const collectionUrl = `${API}/collections/qc-zonage-${target.slug}/items?limit=1`;
    const served = await capturedFetch(collectionUrl, { headers: { accept: "application/geo+json" } }, {
      run,
      source: "served-zonage-public-proof-control",
      slugs: [target.slug],
      store: false,
      retainBody: true,
    });
    if (!served.ok || served.bytes === null) throw new Error(`public geo-api read failed for ${target.slug}: ${served.line.error ?? served.line.http_status}`);
    const payload = JSON.parse(Buffer.from(served.bytes).toString("utf8")) as { features?: unknown[] };
    const endpoint = servedProofEndpoint(payload.features?.[0], target.category);
    const refetched = await capturedFetch(endpoint.url, { headers: { accept: "application/geo+json,application/json;q=0.9,*/*;q=0.1" } }, {
      run,
      source: "served-zonage-public-proof-control",
      slugs: [target.slug],
      store: false,
      retainBody: false,
    });
    observations.push({
      slug: target.slug,
      category: target.category,
      public_collection_url: collectionUrl,
      proof_field: endpoint.field,
      proof_url: endpoint.url,
      served_sha256: endpoint.sha256,
      refetch_http_status: refetched.line.http_status,
      refetch_sha256: refetched.line.sha256,
      rehash_matches_served_sha256: refetched.ok && refetched.line.sha256 === endpoint.sha256,
      control_only: true,
    });
  }
  await run.finish(0);
  const report = {
    contract: "served-zonage-proof-refetch-control/v1",
    generated_at: new Date().toISOString(),
    partition: relative(ROOT, partitionPath),
    control: "public geo-api proof endpoint refetch; capturedFetch used with an in-memory store, so no S3 object or capture manifest was written and no refetch digest is an attestation",
    observations,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output: relative(ROOT, outputPath), observations }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
