/**
 * Mark existing zoning deposits as honest bbox-approx provisional outputs.
 *
 * This does not drop geometry. It updates feature properties and stats metadata
 * so downstream consumers can see that the layer still needs human 3-GCP
 * calibration before it should be treated as accurate.
 */
import { readFileSync } from "node:fs";

import type { FeatureCollection } from "geojson";

import { getBytes, putBytes, s3Client } from "./lib/s3.js";

interface Args {
  slugs: string[];
  reason: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let reason = "autonomous real-GCP derivation failed; current deposit is bbox-corner approximate";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--slug") slugs.push(argv[++i]!);
    else if (t === "--slugs") slugs.push(...argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean));
    else if (t === "--reason") reason = argv[++i]!;
    else if (t === "--dry-run") dryRun = true;
  }
  if (slugs.length === 0) throw new Error("required: --slug <slug> or --slugs a,b,c");
  return { slugs, reason, dryRun };
}

function flagGeojson(fc: FeatureCollection, slug: string, reason: string): FeatureCollection & { metadata?: Record<string, unknown> } {
  const out = fc as FeatureCollection & { metadata?: Record<string, unknown> };
  const flaggedAt = new Date().toISOString();
  out.metadata = {
    ...(out.metadata ?? {}),
    georeference: {
      source: "bbox-approx",
      confidence: "low",
      needs_human_gcp: true,
      flagged_at: flaggedAt,
      reason,
    },
  };
  for (const f of out.features) {
    f.properties = {
      ...(f.properties ?? {}),
      source: "bbox-approx",
      confidence: "low",
      needs_human_gcp: true,
      georef_source: "bbox-approx",
      georef_confidence: "low",
      georef_flagged_at: flaggedAt,
      georef_flag_reason: reason,
      city_slug: slug,
    };
  }
  return out;
}

function flagStats(raw: unknown, slug: string, reason: string): Record<string, unknown> {
  const stats = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ...stats,
    slug,
    source: "bbox-approx",
    confidence: "low",
    needs_human_gcp: true,
    real_gcp: false,
    georef_source: "bbox-approx",
    georef_confidence: "low",
    georef_flagged_at: new Date().toISOString(),
    georef_flag_reason: reason,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  for (const slug of args.slugs) {
    const gjKey = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    const stKey = `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`;
    const gj = JSON.parse((await getBytes(s3, gjKey)).toString("utf8")) as FeatureCollection;
    let statsRaw: unknown = {};
    try {
      statsRaw = JSON.parse((await getBytes(s3, stKey)).toString("utf8")) as unknown;
    } catch {
      try {
        statsRaw = JSON.parse(readFileSync(`/tmp/georef-real-current/qc-zonage-${slug}.stats.json`, "utf8")) as unknown;
      } catch {
        statsRaw = {};
      }
    }
    const flaggedGj = flagGeojson(gj, slug, args.reason);
    const flaggedStats = flagStats(statsRaw, slug, args.reason);
    if (!args.dryRun) {
      await putBytes(s3, gjKey, JSON.stringify(flaggedGj), "application/geo+json");
      await putBytes(s3, stKey, JSON.stringify(flaggedStats, null, 2), "application/json");
    }
    console.log(
      JSON.stringify({
        slug,
        features: flaggedGj.features.length,
        source: "bbox-approx",
        confidence: "low",
        needs_human_gcp: true,
        dry_run: args.dryRun,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
