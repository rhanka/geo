/**
 * qc-lots-metrics-run — mesure absolue, reprise sûre, du produit qc-lots servi.
 *
 * Cette sonde lit les stats déposées par lots-enriched-run. Elle choisit le
 * sous-dossier quand il existe (surface réellement servie par geo-api), écrit
 * l'avancement après chaque ville et ne touche jamais S3. Elle évite de
 * confondre une amélioration de pourcentage avec un gain réel de lots porteurs.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx src/qc-lots-metrics-run.ts --slugs arundel,bolton-ouest \
 *     --out work/coverage/qc-lots-metrics-before.json
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { exists, getJson, s3Client } from "./lib/s3.js";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface Metrics {
  stats_key: string;
  num_lots: number;
  num_with_norms: number;
  num_with_code_zone: number;
  complete: boolean;
}

interface Row {
  slug: string;
  state: "measured" | "unknown";
  metrics: Metrics | null;
  note?: string;
}

interface Report {
  schema: "qc-lots-metrics/v1";
  generated_at: string;
  requested: number;
  cities: Row[];
}

function value(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function save(path: string, slugs: readonly string[], rows: ReadonlyMap<string, Row>): void {
  const cities = [...rows.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const report: Report = {
    schema: "qc-lots-metrics/v1",
    generated_at: new Date().toISOString(),
    requested: Math.max(slugs.length, cities.length),
    cities,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
}

function readExisting(path: string): Map<string, Row> {
  try {
    const prior = JSON.parse(readFileSync(path, "utf8")) as Partial<Report>;
    return new Map((prior.cities ?? []).filter((row): row is Row => !!row?.slug).map((row) => [row.slug, row]));
  } catch {
    return new Map();
  }
}

async function one(s3: S3Client, slug: string): Promise<Row> {
  const keys = [
    `normalized/qc-lots/qc-lots-${slug}/qc-lots-${slug}.stats.json`,
    `normalized/qc-lots/qc-lots-${slug}.stats.json`,
  ];
  for (const statsKey of keys) {
    if (!(await exists(s3, statsKey))) continue;
    const raw = await getJson(s3, statsKey) as Record<string, unknown>;
    const lots = raw["num_lots"];
    const norms = raw["num_with_norms"];
    const code = raw["num_with_zone_code"];
    if (
      typeof lots !== "number" || !Number.isFinite(lots) ||
      typeof norms !== "number" || !Number.isFinite(norms) ||
      typeof code !== "number" || !Number.isFinite(code)
    ) {
      return { slug, state: "unknown", metrics: null, note: `stats invalides: ${statsKey}` };
    }
    return {
      slug,
      state: "measured",
      metrics: {
        stats_key: statsKey,
        num_lots: lots,
        num_with_norms: norms,
        num_with_code_zone: code,
        // Aucun porteur ne devient jamais complete par vacuité.
        complete: norms > 0 && norms === lots,
      },
    };
  }
  return { slug, state: "unknown", metrics: null, note: "stats qc-lots absentes" };
}

async function main(argv: readonly string[]): Promise<void> {
  const outRaw = value(argv, "--out");
  const slugs = (value(argv, "--slugs") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
  if (!outRaw || slugs.length === 0) throw new Error("usage: --slugs a,b --out <json>");
  const out = resolve(outRaw);
  const unique = [...new Set(slugs)];
  const rows = readExisting(out);
  const s3 = s3Client();
  for (const slug of unique) {
    const row = await one(s3, slug);
    rows.set(slug, row);
    save(out, unique, rows);
    const m = row.metrics;
    console.log(
      m
        ? `OK ${slug} norms=${m.num_with_norms}/${m.num_lots} code_zone=${m.num_with_code_zone}/${m.num_lots} complete=${m.complete}`
        : `UNKNOWN ${slug} ${row.note ?? ""}`,
    );
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
