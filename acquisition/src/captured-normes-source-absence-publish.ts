/**
 * Publishes immutable proof that the authoritative MAMH directory declares no
 * municipal website for a slug. It never fetches a municipal URL: a missing
 * official source is evidence, not an invitation to invent one.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  CapturedNormesSourceAbsenceReceiptSchema,
  type CapturedNormesSourceAbsenceReceipt,
} from "../../packages/qc-sources/src/capture/index.js";
import { putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";

const DirectoryEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  mamhCode: z.string().min(1),
  mamhName: z.string().min(1),
  designation: z.string().min(1),
  website: z.string().url().nullable(),
  source: z.literal("mamh-repertoire"),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const OfficialDirectorySchema = z.object({
  $schema: z.literal("qc-municipal-directory/v1"),
  generatedAt: z.string().datetime(),
  source: z.object({
    name: z.literal("MAMH — Répertoire des municipalités du Québec"),
    dataset: z.literal("repertoire-des-municipalites-du-quebec"),
    datasetUrl: z.string().url(),
    resourceUrl: z.string().url(),
    license: z.literal("cc-by-4.0"),
    field: z.literal("mweb"),
    joinKey: z.literal("nfd-normalized-name"),
  }).strict(),
  stats: z.object({
    registryTotal: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    withWebsite: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }).strict(),
  entries: z.record(z.string(), DirectoryEntrySchema),
  repoCopyNote: z.string(),
}).strict();

const NoWebsiteDirectoryEntrySchema = DirectoryEntrySchema.extend({ website: z.null() });

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveCapturedNormesSourceAbsenceReceipt(
  directoryBytes: Buffer,
  slug: string,
): { key: string; body: string; receipt: CapturedNormesSourceAbsenceReceipt } {
  const directory = OfficialDirectorySchema.parse(JSON.parse(directoryBytes.toString("utf8")));
  const entry = NoWebsiteDirectoryEntrySchema.parse(directory.entries[slug]);
  if (entry.slug !== slug) throw new Error(`${slug}: MAMH directory entry key and slug differ`);
  const receipt = CapturedNormesSourceAbsenceReceiptSchema.parse({
    contract: "captured-normes-source-absence-receipt/v1",
    slug,
    status: "no-official-source",
    directory_sha256: `sha256:${sha256(directoryBytes)}`,
    directory: {
      schema: directory.$schema,
      generated_at: directory.generatedAt,
      source: {
        name: directory.source.name,
        dataset: directory.source.dataset,
        dataset_url: directory.source.datasetUrl,
        resource_url: directory.source.resourceUrl,
        license: directory.source.license,
        field: directory.source.field,
        join_key: directory.source.joinKey,
      },
    },
    entry: {
      slug: entry.slug,
      name: entry.name,
      mamh_code: entry.mamhCode,
      mamh_name: entry.mamhName,
      designation: entry.designation,
      website: entry.website,
      source: entry.source,
      verified_at: entry.verifiedAt,
    },
  });
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  return {
    key: `registry/normes-captured-source-absence-receipts/${slug}/${sha256(body)}.json`,
    body,
    receipt,
  };
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1] !== undefined) values.push(process.argv[index + 1]!);
  }
  return values;
}

function requireS3RunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("publication S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("publication S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

export async function publishCapturedNormesSourceAbsenceReceipts(
  directoryPath: string,
  slugs: readonly string[],
): Promise<Array<{ slug: string; key: string; upload: "created" | "existing-equal" }>> {
  requireS3RunEnvironment();
  if (slugs.length === 0) throw new Error("at least one --slug is required");
  const directoryBytes = readFileSync(directoryPath);
  const s3 = s3Client();
  const results = [];
  for (const slug of slugs) {
    const derived = deriveCapturedNormesSourceAbsenceReceipt(directoryBytes, slug);
    const upload = await putBytesIfAbsentOrEqual(s3, derived.key, derived.body, "application/json");
    results.push({ slug, key: derived.key, upload });
  }
  return results;
}

async function main(): Promise<void> {
  const directoryPath = optionValues("directory")[0] ?? "packages/qc-sources/src/geo/qc-municipal-directory.json";
  process.stdout.write(`${JSON.stringify(await publishCapturedNormesSourceAbsenceReceipts(directoryPath, optionValues("slug")), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
