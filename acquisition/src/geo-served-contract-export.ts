/**
 * Publish the immutable Geo served-data contract.
 *
 * Safe preview (the default):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/geo-served-contract-export.ts
 *
 * Publication uses the same mandatory transport flags and requires --publish.
 * It only writes exports/immo/geo-served-contract/v1/{snapshots,latest.json};
 * no served geometry is ever written.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { s3Client } from "./lib/s3.js";
import {
  GEO_SERVED_CONTRACT_PREFIX,
  publishGeoServedContract,
  s3GeoServedContractStore,
} from "./lib/geo-served-contract.js";

const REGISTRY_PATH = "packages/qc-sources/src/geo/municipalities.qc.json";
const CANONICALIZER_PATH = "packages/geo/src/zonage/lotZoneJoin.ts";

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function requireS3RunEnvironment(): void {
  const nodeOptions = process.env["NODE_OPTIONS"] ?? "";
  if (!nodeOptions.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

function mainArgs(argv: string[]): { dryRun: boolean; generatedAt: string; outputPrefix: string; readConcurrency?: number } {
  const allowed = new Set(["--publish", "--generated-at", "--output-prefix", "--read-concurrency"]);
  const unsupported = argv.filter((arg) => arg.startsWith("--") && !allowed.has(arg));
  if (unsupported.length > 0) throw new Error(`option contrat inconnue: ${unsupported.join(", ")}`);
  const generatedAt = valueOf(argv, "--generated-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error(`--generated-at ISO invalide: ${generatedAt}`);
  const rawConcurrency = valueOf(argv, "--read-concurrency");
  const readConcurrency = rawConcurrency === undefined ? undefined : Number(rawConcurrency);
  if (readConcurrency !== undefined && (!Number.isInteger(readConcurrency) || readConcurrency < 1 || readConcurrency > 32)) {
    throw new Error(`--read-concurrency invalide: ${rawConcurrency} (attendu 1..32)`);
  }
  return { dryRun: !argv.includes("--publish"), generatedAt, outputPrefix: valueOf(argv, "--output-prefix") ?? GEO_SERVED_CONTRACT_PREFIX, readConcurrency };
}

async function main(): Promise<void> {
  const args = mainArgs(process.argv.slice(2));
  requireS3RunEnvironment();
  const registryBytes = readFileSync(REGISTRY_PATH);
  const parsedRegistry = JSON.parse(registryBytes.toString("utf8")) as Array<{ slug?: unknown }>;
  const citySlugs = parsedRegistry.map((row) => {
    if (typeof row?.slug !== "string") throw new Error("registre municipal invalide: slug absent");
    return row.slug;
  });
  if (citySlugs.length !== 1106) throw new Error(`registre municipal attendu 1106, reçu ${citySlugs.length}`);
  const canonicalizerBytes = readFileSync(CANONICALIZER_PATH);
  const result = await publishGeoServedContract({
    store: s3GeoServedContractStore(s3Client()),
    registry: { path: REGISTRY_PATH, sha256: sha256(registryBytes), city_slugs: citySlugs },
    canonicalizer: { id: "zone_ref_canon_v1", implementation_path: CANONICALIZER_PATH, implementation_sha256: sha256(canonicalizerBytes) },
    generatedAt: args.generatedAt,
    readConcurrency: args.readConcurrency,
    dryRun: args.dryRun,
    outputPrefix: args.outputPrefix,
  });
  console.log(JSON.stringify({
    dry_run: args.dryRun,
    snapshot_uri: result.snapshotUri,
    latest_uri: result.latestUri,
    manifest_sha256: result.manifestSha256,
    qc_zonage: result.manifest.qc_zonage.coverage,
    geo_4a_delta_grille: result.manifest.artefacts.geo_4a_delta_grille,
    pv: result.manifest.pv.coverage,
  }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
