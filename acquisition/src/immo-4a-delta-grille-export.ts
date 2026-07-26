/**
 * Export the separate Geo -> Immo 4a grid-delta artifact.
 *
 * From repository root (all S3 runs require the two transport safeguards):
 * NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/immo-4a-delta-grille-export.ts --dry-run
 *
 * Omit --dry-run only to write the NEW `exports/immo/...` prefix. This runner
 * never writes a served qc-zonage collection or immo's graph_nodes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  IMMO_4A_OUTPUT_PREFIX,
  publishImmo4aArtifact,
  s3Immo4aStore,
  type VivierB,
} from "./lib/immo-4a-delta-grille.js";

const VIVIER_PATH = "acquisition/config/immo-vivier-b-20260725.json";

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function mainArgs(argv: string[]): {
  dryRun: boolean;
  generatedAt: string;
  outputPrefix: string;
  readConcurrency: number | undefined;
} {
  const unsupported = argv.filter((arg) => arg.startsWith("--") && !["--dry-run", "--generated-at", "--output-prefix", "--read-concurrency"].includes(arg));
  if (unsupported.length > 0) throw new Error(`option 4a inconnue: ${unsupported.join(", ")}`);
  const generatedAt = valueOf(argv, "--generated-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error(`--generated-at ISO invalide: ${generatedAt}`);
  const rawConcurrency = valueOf(argv, "--read-concurrency");
  const readConcurrency = rawConcurrency === undefined ? undefined : Number(rawConcurrency);
  if (readConcurrency !== undefined && (!Number.isInteger(readConcurrency) || readConcurrency < 1 || readConcurrency > 32)) {
    throw new Error(`--read-concurrency invalide: ${rawConcurrency} (attendu 1..32)`);
  }
  return {
    dryRun: hasFlag(argv, "--dry-run"),
    generatedAt,
    outputPrefix: valueOf(argv, "--output-prefix") ?? IMMO_4A_OUTPUT_PREFIX,
    readConcurrency,
  };
}

async function main(): Promise<void> {
  const args = mainArgs(process.argv.slice(2));
  const vivierBytes = readFileSync(VIVIER_PATH);
  const vivier = JSON.parse(vivierBytes.toString("utf8")) as VivierB;
  console.error(`[4a] démarrage scope=B' villes=${vivier.count} dry_run=${args.dryRun}`);
  const result = await publishImmo4aArtifact({
    store: s3Immo4aStore(),
    vivier,
    vivierSha256: createHash("sha256").update(vivierBytes).digest("hex"),
    vivierPath: VIVIER_PATH,
    generatedAt: args.generatedAt,
    readConcurrency: args.readConcurrency,
    dryRun: args.dryRun,
    outputPrefix: args.outputPrefix,
    verbose: true,
  });
  console.log(JSON.stringify({
    dry_run: args.dryRun,
    snapshot_uri: result.snapshotUri,
    latest_uri: result.latestUri,
    artifact_sha256: result.artifactSha256,
    coverage: result.artifact.coverage,
  }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
