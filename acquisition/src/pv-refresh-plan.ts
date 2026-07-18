/**
 * pv-refresh-plan — read-only, reproducible PV inventory and bounded revalidation
 * selector.  It lists the authoritative S3 manifest prefix and reads the local
 * matrix only as a residual classification aid; it never rewrites the matrix.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-refresh-plan.ts \
 *     --as-of 2026-07-18T00:00:00Z --refresh-after-days 183 --limit 10
 *
 * The emitted plan includes two exact `pv-index-run` argv arrays.  Run the
 * dry-run array first; the deposit array is still bounded, robots-aware, and
 * semantically idempotent. S3 LastModified only schedules revalidation; it
 * does not claim source freshness. No fleet configuration is read or changed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ALL_PV_CITIES } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { BUCKET, s3Client } from "./lib/s3.js";
import {
  MAX_PV_REFRESH_BATCH,
  MIN_PV_REFRESH_DELAY_MS,
  buildPvRefreshPlan,
  pvRefreshRunnerArgs,
  type PvInventoryObject,
} from "./pv-refresh-plan-lib.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "../../work/coverage/coverage-matrix.json");

interface Args {
  readonly asOf: string;
  readonly refreshAfterDays: number;
  readonly limit: number;
  readonly delayMs: number;
  readonly windowDays: number;
  readonly out?: string;
}

function value(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function positiveInteger(raw: string | undefined, fallback: number, flag: string): number {
  const n = Number(raw ?? fallback);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

function parseArgs(argv: readonly string[]): Args {
  const asOf = value(argv, "--as-of");
  if (!asOf) throw new Error("usage: --as-of ISO-8601 [--refresh-after-days 183] [--limit 10] [--out FILE]");
  const limit = positiveInteger(value(argv, "--limit"), MAX_PV_REFRESH_BATCH, "--limit");
  if (limit > MAX_PV_REFRESH_BATCH) throw new Error(`--limit cannot exceed ${MAX_PV_REFRESH_BATCH}`);
  const delayMs = positiveInteger(value(argv, "--delay-ms"), 2_000, "--delay-ms");
  if (delayMs < MIN_PV_REFRESH_DELAY_MS) {
    throw new Error(`--delay-ms must be at least ${MIN_PV_REFRESH_DELAY_MS}`);
  }
  return {
    asOf,
    refreshAfterDays: positiveInteger(value(argv, "--refresh-after-days"), 183, "--refresh-after-days"),
    limit,
    delayMs,
    windowDays: positiveInteger(value(argv, "--window-days"), 183, "--window-days"),
    ...(value(argv, "--out") ? { out: value(argv, "--out") } : {}),
  };
}

async function listInventory(): Promise<PvInventoryObject[]> {
  const s3 = s3Client();
  const inventory: PvInventoryObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "registry/qc-pv/",
        ContinuationToken: continuationToken,
        MaxKeys: 1_000,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.LastModified) continue;
      inventory.push({ key: object.Key, lastModified: object.LastModified.toISOString() });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return inventory.sort((a, b) => a.key.localeCompare(b.key));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, { pv?: { status?: "done" | "planned" | "to-research" } }>;
  };
  const bySlug = new Map<string, { slug: string; sourceId: string; pvIndexUrl: string }>();
  for (const entry of ALL_PV_CITIES) {
    const config = entry.config;
    if (!bySlug.has(config.citySlug)) {
      bySlug.set(config.citySlug, {
        slug: config.citySlug,
        sourceId: config.sourceId,
        pvIndexUrl: config.pvIndexUrl,
      });
    }
  }

  const inventory = await listInventory();
  const plan = buildPvRefreshPlan({
    asOf: args.asOf,
    refreshAfterDays: args.refreshAfterDays,
    limit: args.limit,
    delayMs: args.delayMs,
    windowDays: args.windowDays,
    cities: matrix.cities,
    configuredSources: [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    inventory,
  });
  const output = {
    ...plan,
    execution: {
      dryRunArgs: pvRefreshRunnerArgs(plan, true),
      depositArgs: pvRefreshRunnerArgs(plan, false),
      legacyGenericOptInDryRunArgs: pvRefreshRunnerArgs(plan, true, true),
      legacyGenericOptInDepositArgs: pvRefreshRunnerArgs(plan, false, true),
      note: "Review dryRunArgs first. Legacy-generic args are explicit opt-in and accept only the historic pv-index-run note plus matching source. S3 LastModified schedules revalidation only; it does not prove a municipal source is current.",
    },
    inventoryEvidence: {
      objectCount: inventory.length,
      sha256: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"),
      objects: inventory,
    },
  };
  const json = JSON.stringify(output, null, 2) + "\n";
  if (args.out) {
    writeFileSync(args.out, json);
    console.error(`[pv-refresh-plan] read-only S3 plan -> ${args.out}; selected=${plan.selected.length}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
