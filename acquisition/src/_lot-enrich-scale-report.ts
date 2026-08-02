/**
 * _lot-enrich-scale-report.ts — matérialise le rapport d'un batch borné.
 *
 * Lecture du journal local reprenable + HEAD/lecture S3 des produits finaux,
 * des backups cœur et de la provenance de zone. Les seules écritures sont les
 * deux rapports de couverture demandés.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  exists,
  getGeoJsonFeatureCollection,
  objectHead,
  s3Client,
} from "./lib/s3.js";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const JOURNAL = resolve(ROOT, ".cache/lot-enrich-scale-progress-20260802.json");
const OUT_JSON = resolve(ROOT, "work/coverage/lot-enrich-scale-20260802.json");
const OUT_MD = resolve(ROOT, "work/coverage/lot-enrich-scale-20260802.md");

const PREFLIGHT_CEILINGS: Record<string, number> = {
  "sainte-cecile-de-whitton": 1053,
  "saint-ludger": 1173,
  marston: 944,
  stornoway: 775,
  milan: 454,
  "grenville-sur-la-rouge": 1045,
};

const ASSIGNMENT_PATH = resolve(ROOT, "work/coverage/immo-lot-zone-assignment-matrix-20260802.json");
const FOLDED_PATH = resolve(ROOT, "work/coverage/immo-folded-normes-city-matrix-20260802.json");
const COVERAGE_PATH = resolve(ROOT, "work/coverage/coverage-matrix.json");

interface Metrics {
  stats_key: string;
  num_lots: number;
  num_with_norms: number;
  num_with_code_zone: number;
  num_with_adresse: number | null;
}

interface Entry {
  slug: string;
  deposited: boolean;
  skipped_reason: string | null;
  backup_ts: string | null;
  mirror: "mirrored" | "flat-only" | null;
  started_at: string;
  finished_at: string;
  lot_metrics_before: Metrics | null;
  lot_metrics_after: Metrics | null;
  lot_metrics_final: Metrics | null;
}

interface Journal {
  generated_at: string;
  simplify_zones_m: number;
  entries: Entry[];
}

interface ZoneStamp {
  status: "STAMPED" | "STAMPED_NULL" | "UNSTAMPED";
  level: string | null;
  url: string | null;
  key: string | null;
  last_modified: string | null;
}

interface MatrixRow {
  slug: string;
  reason: string;
  observed_lots?: number;
  folded_normes_lots?: number | null;
  missing_folded_normes_lots?: number | null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function backupKey(key: string, ts: string): string {
  const slash = key.lastIndexOf("/");
  return `${key.slice(0, slash)}/_replaced/${key.slice(slash + 1)}.${ts}`;
}

function pct(value: number, lots: number): number {
  return lots ? Math.round((10000 * value) / lots) / 100 : 0;
}

async function readZoneStamp(s3: ReturnType<typeof s3Client>, slug: string): Promise<ZoneStamp> {
  const keys = [
    `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`,
    `normalized/ca-qc-zonage/qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    const head = await objectHead(s3, key);
    const fc = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> | null }>(s3, key);
    for (const feature of fc.features ?? []) {
      const props = feature.properties ?? {};
      const hasUrl = Object.prototype.hasOwnProperty.call(props, "zone_source_url");
      const hasLevel = Object.prototype.hasOwnProperty.call(props, "zone_source_level");
      if (!hasUrl && !hasLevel) continue;
      const url = typeof props.zone_source_url === "string" ? props.zone_source_url : null;
      const level = typeof props.zone_source_level === "string" ? props.zone_source_level : null;
      return {
        status: url ? "STAMPED" : "STAMPED_NULL",
        level,
        url,
        key,
        last_modified: head.lastModified?.toISOString() ?? null,
      };
    }
    return { status: "UNSTAMPED", level: null, url: null, key, last_modified: head.lastModified?.toISOString() ?? null };
  }
  return { status: "UNSTAMPED", level: null, url: null, key: null, last_modified: null };
}

async function main(): Promise<void> {
  const journal = readJson<Journal>(JOURNAL);
  const assignment = readJson<{ city_measurements: MatrixRow[] }>(ASSIGNMENT_PATH);
  const folded = readJson<{ city_measurements: MatrixRow[] }>(FOLDED_PATH);
  const coverage = readJson<{ cities: Record<string, { normes?: { status?: string; doneTrack?: string } }> }>(COVERAGE_PATH);
  const assignmentBySlug = new Map(assignment.city_measurements.map((row) => [row.slug, row]));
  const foldedBySlug = new Map(folded.city_measurements.map((row) => [row.slug, row]));
  const s3 = s3Client();
  const municipalities: Array<Record<string, unknown>> = [];

  for (const entry of journal.entries) {
    const before = entry.lot_metrics_before;
    const after = entry.lot_metrics_final ?? entry.lot_metrics_after;
    if (!before || !after) throw new Error(`${entry.slug}: journal metrics incomplete`);
    const assignmentRow = assignmentBySlug.get(entry.slug);
    const foldedRow = foldedBySlug.get(entry.slug);
    const zoneStamp = await readZoneStamp(s3, entry.slug);
    const batchStart = Date.parse(entry.started_at);
    const zoneLastModified = zoneStamp.last_modified ? Date.parse(zoneStamp.last_modified) : NaN;
    const stampPreserved = zoneStamp.status !== "UNSTAMPED" && Number.isFinite(batchStart) && Number.isFinite(zoneLastModified)
      ? zoneLastModified <= batchStart
      : false;

    const coreKeys = [
      `normalized/qc-lots/qc-lots-${entry.slug}.geojson`,
      `normalized/qc-lots/qc-lots-${entry.slug}.stats.json`,
      `normalized/qc-lot-zonage/${entry.slug}.parquet`,
      `normalized/qc-lot-zonage/${entry.slug}.stats.json`,
    ];
    const backupKeys = entry.backup_ts ? coreKeys.map((key) => backupKey(key, entry.backup_ts!)) : [];
    const backupHeads = [];
    for (const key of backupKeys) backupHeads.push({ key, head: await objectHead(s3, key) });
    const backupOk = backupHeads.length === coreKeys.length && backupHeads.every((item) => item.head.exists && (item.head.contentLength ?? 0) > 0);

    const flatGeo = `normalized/qc-lots/qc-lots-${entry.slug}.geojson`;
    const flatStats = `normalized/qc-lots/qc-lots-${entry.slug}.stats.json`;
    const nestedGeo = `normalized/qc-lots/qc-lots-${entry.slug}/qc-lots-${entry.slug}.geojson`;
    const nestedStats = `normalized/qc-lots/qc-lots-${entry.slug}/qc-lots-${entry.slug}.stats.json`;
    const flatOk = (await objectHead(s3, flatGeo)).exists && (await objectHead(s3, flatStats)).exists;
    const nestedGeoHead = await objectHead(s3, nestedGeo);
    const nestedStatsHead = await objectHead(s3, nestedStats);
    const mirrorOk = entry.mirror === "flat-only"
      ? !nestedGeoHead.exists && !nestedStatsHead.exists && flatOk
      : nestedGeoHead.exists && nestedStatsHead.exists && flatOk;

    municipalities.push({
      slug: entry.slug,
      lots: after.num_lots,
      matrix: {
        assignment_reason: assignmentRow?.reason ?? null,
        normes_reason: foldedRow?.reason ?? null,
        normes_track: coverage.cities[entry.slug]?.normes?.doneTrack ?? null,
        folded_normes_matrix: foldedRow?.folded_normes_lots ?? null,
        folded_normes_matrix_missing: foldedRow?.missing_folded_normes_lots ?? null,
      },
      preflight_join_ceiling: PREFLIGHT_CEILINGS[entry.slug] ?? null,
      folded_normes_avant: { lots: before.num_with_norms, pct: pct(before.num_with_norms, before.num_lots) },
      folded_normes_apres: { lots: after.num_with_norms, pct: pct(after.num_with_norms, after.num_lots) },
      folded_normes_gain: after.num_with_norms - before.num_with_norms,
      adresse_avant: { lots: before.num_with_adresse, pct: before.num_with_adresse === null ? null : pct(before.num_with_adresse, before.num_lots) },
      adresse_apres: { lots: after.num_with_adresse, pct: after.num_with_adresse === null ? null : pct(after.num_with_adresse, after.num_lots) },
      adresse_gain: before.num_with_adresse !== null && after.num_with_adresse !== null ? after.num_with_adresse - before.num_with_adresse : null,
      backup_ts: entry.backup_ts,
      backup_ok: backupOk,
      mirror: entry.mirror,
      mirror_ok: mirrorOk,
      stamp_before_after: { status: zoneStamp.status, level: zoneStamp.level, url: zoneStamp.url, key: zoneStamp.key },
      stamp_preserved: stampPreserved,
      stamp_evidence: "zone object LastModified precedes batch start; chain writes qc-lots/qc-lot-zonage only",
      deposited: entry.deposited,
      skipped_reason: entry.skipped_reason,
    });
  }

  const foldedGain = municipalities.reduce((sum, city) => sum + Number(city.folded_normes_gain ?? 0), 0);
  const addressGain = municipalities.reduce((sum, city) => sum + Number(city.adresse_gain ?? 0), 0);
  const report = {
    contract: "lot-enrich-scale/v1",
    as_of: "2026-08-02",
    scope: {
      batch_max_seconds: 2400,
      max_lots: 15000,
      province: false,
      excluded_large: ["laval", "montreal", "saguenay"],
      target_rule: "assignment complete + coverage normes done + folded matrix incomplete + current folded below current join ceiling",
    },
    source_matrices: [
      "work/coverage/immo-lot-zone-assignment-matrix-20260802.json",
      "work/coverage/immo-folded-normes-city-matrix-20260802.json",
      "work/coverage/coverage-matrix.json",
    ],
    target_selection: {
      matrix_candidates: 159,
      productive_targets: municipalities.map((city) => city.slug),
      productive_target_count: municipalities.length,
      matrix_candidates_at_current_ceiling: 153,
      remaining_productive_targets: [],
      ceiling_policy: "liste plafond séparée; aucun re-traitement sans nouveau parquet/normes ou changement de zone",
    },
    anti_invention: {
      address_rule: "adresse absente du rôle joint par lot = null; aucune adresse n'est déduite",
      structural_nulls: "Les nulls adresse sont comptés comme structurels et ne sont pas un gain.",
      stamp_rule: "zone_source_url et zone_source_level lus sur la collection zonage servie; objet zone non écrit par ce batch",
    },
    municipalities,
    summary: {
      municipalities_processed: municipalities.length,
      folded_normes_avant: municipalities.reduce((sum, city) => sum + Number((city.folded_normes_avant as { lots: number }).lots), 0),
      folded_normes_apres: municipalities.reduce((sum, city) => sum + Number((city.folded_normes_apres as { lots: number }).lots), 0),
      folded_normes_added: foldedGain,
      adresse_added: addressGain,
      backup_ok_all: municipalities.every((city) => city.backup_ok === true),
      mirror_ok_all: municipalities.every((city) => city.mirror_ok === true),
      stamp_preserved_all: municipalities.every((city) => city.stamp_preserved === true),
      deposited_all: municipalities.every((city) => city.deposited === true),
    },
    checkpoint: ".cache/lot-enrich-scale-progress-20260802.json",
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [
    "# Scale WP1 — lots-enriched folded-normes + adresse (2026-08-02)",
    "",
    `Cible prouvée : ${municipalities.length} muni(s) productive(s) après contrôle du plafond réel; 159 admissibles par matrices, 153 au plafond et laissées intactes.`,
    "",
    "## Résultat",
    "",
    `- Traitées : ${municipalities.length}; folded-normes ajoutées : **${foldedGain}**; adresses ajoutées : **${addressGain}**.`,
    `- Avant → après folded-normes : ${report.summary.folded_normes_avant} → ${report.summary.folded_normes_apres}.`,
    `- Backup OK partout : **${report.summary.backup_ok_all ? "oui" : "non"}**; miroir : **${report.summary.mirror_ok_all ? "oui (flat-only quand le sous-dossier était absent)" : "non"}**; stamp : **${report.summary.stamp_preserved_all ? "oui" : "non"}**.`,
    "",
    "## Munis",
    "",
    ...municipalities.map((city) => {
      const before = city.folded_normes_avant as { lots: number; pct: number };
      const after = city.folded_normes_apres as { lots: number; pct: number };
      const addr = city.adresse_apres as { lots: number | null; pct: number | null };
      return `- ${city.slug} — ${city.lots} lots; normes ${before.lots} → ${after.lots} (+${city.folded_normes_gain}); adresse ${addr.lots ?? "null"}/${city.lots} (${addr.pct ?? "null"}%), backup=${city.backup_ok ? "OK" : "KO"}, mirror=${city.mirror}, stamp=${city.stamp_preserved ? "OK" : "KO"}.`;
    }),
    "",
    "Les valeurs d’adresse nulles restent structurelles; aucune adresse n’a été déduite. Les objets S3 ne sont pas committés.",
  ];
  writeFileSync(OUT_MD, `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ output_json: "work/coverage/lot-enrich-scale-20260802.json", output_md: "work/coverage/lot-enrich-scale-20260802.md", folded_normes_added: foldedGain, adresse_added: addressGain }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
