/**
 * Close a finite captured-normes campaign from immutable S3 receipts.
 *
 * This reads only control receipts, never municipal source bytes. A `closed`
 * result says every planned city has an explicit outcome; it never claims that
 * a city has a usable zoning grid.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CapturedNormesCampaignPlanSchema,
  CapturedNormesCampaignReceiptSchema,
  CapturedNormesDiscoveryRunReceiptSchema,
  CapturedNormesExtractionReceiptSchema,
  type CapturedNormesCampaignEntry,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, putBytesIfAbsentOrEqual, s3Client } from "./lib/s3.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireS3RunEnvironment(): void {
  if (!(process.env["NODE_OPTIONS"] ?? "").split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

export function campaignReceiptKey(campaign: string): string {
  return `registry/normes-captured-campaign-receipts/${campaign}.json`;
}

async function assertClosedCity(entry: CapturedNormesCampaignEntry): Promise<void> {
  const s3 = s3Client();
  const discovery = CapturedNormesDiscoveryRunReceiptSchema.parse(
    JSON.parse((await getBytes(s3, entry.discovery_run_receipt_key)).toString("utf8")),
  );
  if (discovery.slug !== entry.slug || discovery.status !== "refused") {
    throw new Error(`${entry.slug}: discovery receipt does not close a refused city`);
  }
  if (entry.outcome === "no-grid" && discovery.refusal !== "no classified grille PDF candidate in eligible captured HTML") {
    throw new Error(`${entry.slug}: no-grid requires an eligible HTML no-grid refusal`);
  }
  if (entry.outcome === "unreachable" && discovery.attempts.some((attempt) => attempt.http_status === 200)) {
    throw new Error(`${entry.slug}: unreachable receipt contains an HTTP 200 attempt`);
  }
  if (entry.outcome === "http-forbidden" && !discovery.attempts.some((attempt) => attempt.http_status === 403)) {
    throw new Error(`${entry.slug}: http-forbidden requires an HTTP 403 attempt`);
  }
  for (const key of entry.extraction_receipt_keys) {
    const extraction = CapturedNormesExtractionReceiptSchema.parse(
      JSON.parse((await getBytes(s3, key)).toString("utf8")),
    );
    if (extraction.capture.slug !== entry.slug || extraction.status !== "refused" || !extraction.refusal?.startsWith("below deposit gate:")) {
      throw new Error(`${entry.slug}: extraction receipt is not a below-gate refusal`);
    }
  }
}

export async function closeCapturedNormesCampaign(planPath: string): Promise<{ key: string; upload: "created" | "existing-equal" }> {
  requireS3RunEnvironment();
  const plan = CapturedNormesCampaignPlanSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
  for (const city of plan.cities) await assertClosedCity(city);
  const receipt = CapturedNormesCampaignReceiptSchema.parse({
    contract: "captured-normes-campaign-receipt/v1",
    campaign: plan.campaign,
    closed_at: plan.closed_at,
    status: "closed",
    cities: plan.cities,
  });
  const key = campaignReceiptKey(plan.campaign);
  const upload = await putBytesIfAbsentOrEqual(s3Client(), key, `${JSON.stringify(receipt, null, 2)}\n`, "application/json");
  return { key, upload };
}

async function main(): Promise<void> {
  const planPath = option("plan");
  if (!planPath) throw new Error("--plan <campaign.json> is required");
  process.stdout.write(`${JSON.stringify(await closeCapturedNormesCampaign(planPath), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
