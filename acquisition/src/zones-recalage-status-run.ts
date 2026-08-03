/**
 * Recompute the closed B-prime-167 municipal recalage status partition.
 *
 * This measure is local and read-only: it reads three committed JSON sources
 * through git and writes only the requested coverage artefacts.  It never
 * reads or writes S3.
 *
 * Usage:
 *   npx tsx acquisition/src/zones-recalage-status-run.ts \
 *     --out=work/coverage/zones-recalage-status-167-YYYYMMDDTHHMMSSZ.json \
 *     --markdown=work/coverage/zones-recalage-status-167-YYYYMMDDTHHMMSSZ.md
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT = "zones-recalage-status-167/v1";
const EXPECTED_TOTAL = 167;

const OVERLAP_PATH = "work/coverage/overlap-bprime167-vs-geo-20260802.json";
const OVERLAP_REVISION = "5ec1d919815e0c2b98e10587c69fdb0e439fd16e";
const DISCOVERY_PATH = "work/coverage/zones-bprime6-source-discovery-20260802T190607Z.json";
const DISCOVERY_REVISION = "39eefd2da283eb23f67e5f9156df55ec20ff4775";
const MATRIX_PATH = "work/coverage/zone-provenance-quality-matrix-20260803T001639Z-81de8d776a7d73c9.json";
const MATRIX_REVISION = "608c23d2";
const RADAR_PREVIEW = "radar@800ee90 (PREVIEW non ratifie; merge PR #436 a venir)";

const BPRIME_BUCKETS = [
  "proof_live_verifiable",
  "proof_v1_live",
  "proof_v1_dead",
  "no_proof_url_signal",
] as const;
const QUALITY_STATUSES = ["v2", "acceptable", "candidate", "orphan", "unknown"] as const;
const RECALAGE_STATUSES = ["recale_ok", "recale_missing", "unresolved", "deja_v2_servi", "hors_scope"] as const;

type BprimeBucket = (typeof BPRIME_BUCKETS)[number];
type QualityStatus = (typeof QUALITY_STATUSES)[number];
type RecalageStatus = (typeof RECALAGE_STATUSES)[number];
type DiscoveryStatus = "NEEDS_RECALAGE_PDF" | "UNRESOLVED";

interface RecalageRow {
  readonly slug: string;
  readonly bucket: BprimeBucket;
  readonly discovery_status: DiscoveryStatus | null;
  readonly matrix_quality_status: QualityStatus | null;
  readonly recale_status: RecalageStatus;
  readonly evidence: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: objet requis`);
  return value;
}

function array(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: tableau requis`);
  return value;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${where}: chaine non vide requise`);
  return value.trim();
}

function requiredNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${where}: nombre requis`);
  return value;
}

function oneOf<T extends readonly string[]>(value: string, choices: T, where: string): T[number] {
  if (!(choices as readonly string[]).includes(value)) throw new Error(`${where}: valeur non permise: ${value}`);
  return value as T[number];
}

function relativePath(path: string): string {
  return relative(ROOT, path);
}

function absolutePath(path: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`chemin hors depot: ${path}`);
  return absolute;
}

function readGitJson(revision: string, path: string): unknown {
  const text = execFileSync("git", ["-C", ROOT, "show", `${revision}:${path}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(text) as unknown;
}

function outputPath(argument: "--out" | "--markdown", extension: ".json" | ".md"): string {
  const prefix = `${argument}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`${argument}=... est requis`);
  const path = absolutePath(value);
  const coverage = absolutePath("work/coverage");
  if (!path.startsWith(`${coverage}/`)) throw new Error(`${argument} doit rester sous work/coverage`);
  if (!path.endsWith(extension)) throw new Error(`${argument} doit finir par ${extension}`);
  if (existsSync(path)) throw new Error(`refus d'ecraser l'artefact: ${relativePath(path)}`);
  return path;
}

function writeArtifact(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
}

function overlapBuckets(): Map<string, BprimeBucket> {
  const root = record(readGitJson(OVERLAP_REVISION, OVERLAP_PATH), OVERLAP_PATH);
  const contract = requiredString(root.contract, `${OVERLAP_PATH}.contract`);
  if (contract !== "overlap-bprime167-vs-geo/v1") throw new Error(`${OVERLAP_PATH}.contract inattendu: ${contract}`);
  const buckets = record(root.buckets, `${OVERLAP_PATH}.buckets`);
  const unknownBuckets = Object.keys(buckets).filter((bucket) => !(BPRIME_BUCKETS as readonly string[]).includes(bucket));
  if (unknownBuckets.length > 0) throw new Error(`${OVERLAP_PATH}.buckets inconnus: ${unknownBuckets.join(", ")}`);

  const bySlug = new Map<string, BprimeBucket>();
  for (const bucket of BPRIME_BUCKETS) {
    for (const [index, value] of array(buckets[bucket], `${OVERLAP_PATH}.buckets.${bucket}`).entries()) {
      const slug = requiredString(value, `${OVERLAP_PATH}.buckets.${bucket}[${index}]`);
      if (bySlug.has(slug)) throw new Error(`${OVERLAP_PATH}: slug B-prime duplique: ${slug}`);
      bySlug.set(slug, bucket);
    }
  }

  const partition = record(root.partition, `${OVERLAP_PATH}.partition`);
  const declaredTotal = requiredNumber(partition.total, `${OVERLAP_PATH}.partition.total`);
  if (declaredTotal !== bySlug.size) {
    throw new Error(`${OVERLAP_PATH}: partition.total=${declaredTotal} mais ${bySlug.size} slugs uniques`);
  }
  return bySlug;
}

function discoveryBySlug(): Map<string, DiscoveryStatus> {
  const root = record(readGitJson(DISCOVERY_REVISION, DISCOVERY_PATH), DISCOVERY_PATH);
  const bySlug = new Map<string, DiscoveryStatus>();
  for (const [index, value] of array(root.cities, `${DISCOVERY_PATH}.cities`).entries()) {
    const city = record(value, `${DISCOVERY_PATH}.cities[${index}]`);
    const slug = requiredString(city.slug, `${DISCOVERY_PATH}.cities[${index}].slug`);
    const status = oneOf(requiredString(city.status, `${DISCOVERY_PATH}.cities[${index}].status`), ["NEEDS_RECALAGE_PDF", "UNRESOLVED"] as const, `${DISCOVERY_PATH}.cities[${index}].status`);
    if (bySlug.has(slug)) throw new Error(`${DISCOVERY_PATH}: slug duplique: ${slug}`);
    bySlug.set(slug, status);
  }
  return bySlug;
}

function matrixQualityBySlug(): Map<string, QualityStatus> {
  const root = record(readGitJson(MATRIX_REVISION, MATRIX_PATH), MATRIX_PATH);
  const contract = requiredString(root.contract, `${MATRIX_PATH}.contract`);
  if (contract !== "zone-provenance-quality-matrix/v1") throw new Error(`${MATRIX_PATH}.contract inattendu: ${contract}`);
  const bySlug = new Map<string, QualityStatus>();
  for (const [index, value] of array(root.rows, `${MATRIX_PATH}.rows`).entries()) {
    const row = record(value, `${MATRIX_PATH}.rows[${index}]`);
    const slug = requiredString(row.city_slug, `${MATRIX_PATH}.rows[${index}].city_slug`);
    const quality = oneOf(requiredString(row.quality_status, `${MATRIX_PATH}.rows[${index}].quality_status`), QUALITY_STATUSES, `${MATRIX_PATH}.rows[${index}].quality_status`);
    if (bySlug.has(slug)) throw new Error(`${MATRIX_PATH}: city_slug duplique: ${slug}`);
    bySlug.set(slug, quality);
  }
  return bySlug;
}

function classify(bucket: BprimeBucket, discovery: DiscoveryStatus | null, quality: QualityStatus | null): RecalageStatus {
  if (bucket === "proof_live_verifiable") {
    if (quality === "v2") return "deja_v2_servi";
    if (quality === "acceptable" || quality === "candidate") return "recale_ok";
    return "recale_missing";
  }
  if (bucket === "proof_v1_dead") {
    if (discovery === "NEEDS_RECALAGE_PDF") return "recale_missing";
    if (discovery === "UNRESOLVED") return "unresolved";
    throw new Error("proof_v1_dead sans status discovery committee");
  }
  if (bucket === "no_proof_url_signal") return quality === "v2" ? "deja_v2_servi" : "recale_missing";
  throw new Error("proof_v1_live non vide: aucune regle committee de classement n'est fournie");
}

function evidenceFor(
  slug: string,
  bucket: BprimeBucket,
  discovery: DiscoveryStatus | null,
  quality: QualityStatus | null,
): string[] {
  const evidence = [`git:${OVERLAP_REVISION}:${OVERLAP_PATH}#buckets.${bucket}`];
  if (discovery !== null) evidence.push(`git:${DISCOVERY_REVISION}:${DISCOVERY_PATH}#cities[slug=${slug}].status=${discovery}`);
  if (quality === null) {
    evidence.push(`git:${MATRIX_REVISION}:${MATRIX_PATH}#rows (aucune entree city_slug=${slug}; pas de geometrie servie mesuree)`);
  } else {
    evidence.push(`git:${MATRIX_REVISION}:${MATRIX_PATH}#rows[city_slug=${slug}].quality_status=${quality}`);
  }
  return evidence;
}

function counts(rows: readonly RecalageRow[]): Record<RecalageStatus, number> {
  const result: Record<RecalageStatus, number> = {
    recale_ok: 0,
    recale_missing: 0,
    unresolved: 0,
    deja_v2_servi: 0,
    hors_scope: 0,
  };
  for (const row of rows) result[row.recale_status] += 1;
  return result;
}

function markdown(report: Record<string, unknown>, output: string, markdownOutput: string): string {
  const validation = record(report.validation, "report.validation");
  const distribution = record(validation.recale_status_counts, "report.validation.recale_status_counts");
  return [
    "# Statut recalage B-prime 167",
    "",
    `Contrat : \`${CONTRACT}\`. Source overlap : \`${OVERLAP_REVISION}\` (${OVERLAP_PATH}).`,
    `Provenance : ${RADAR_PREVIEW}.`,
    "",
    "Règle fermée : `proof_live_verifiable` est `deja_v2_servi` seulement en matrice `v2` et `recale_ok` seulement en `acceptable`/`candidate`; les autres états ne prouvent pas une géométrie vivante et restent `recale_missing`. `proof_v1_dead` reprend strictement la discovery (`NEEDS_RECALAGE_PDF` → `recale_missing`, `UNRESOLVED` → `unresolved`). `no_proof_url_signal` est `recale_missing` par défaut, sauf `v2`. Toute absence de ligne matrice est mesurée comme absence de géométrie servie et reste `recale_missing`.",
    "",
    `Total : **${validation.total}** (attendu ${EXPECTED_TOTAL}); somme des statuts : ${validation.recale_status_sum}.`,
    `Répartition : recale_ok=${distribution.recale_ok}, recale_missing=${distribution.recale_missing}, unresolved=${distribution.unresolved}, deja_v2_servi=${distribution.deja_v2_servi}, hors_scope=${distribution.hors_scope}.`,
    `Exception : ${validation.exception ?? "aucune"}.`,
    "",
    `Recalcul : \`npx tsx acquisition/src/zones-recalage-status-run.ts --out=${relativePath(output)} --markdown=${relativePath(markdownOutput)}\`.`,
    "",
  ].join("\n");
}

function main(): void {
  const output = outputPath("--out", ".json");
  const markdownOutput = outputPath("--markdown", ".md");
  if (output === markdownOutput) throw new Error("--out et --markdown doivent etre distincts");

  const buckets = overlapBuckets();
  const discoveries = discoveryBySlug();
  const qualities = matrixQualityBySlug();
  const rows = [...buckets.entries()]
    .map(([slug, bucket]): RecalageRow => {
      const discovery = discoveries.get(slug) ?? null;
      const quality = qualities.get(slug) ?? null;
      if (bucket === "proof_v1_dead" && discovery === null) {
        throw new Error(`${slug}: proof_v1_dead sans ligne dans ${DISCOVERY_PATH}`);
      }
      if (bucket !== "proof_v1_dead" && discovery !== null) {
        throw new Error(`${slug}: discovery hors bucket proof_v1_dead`);
      }
      return {
        slug,
        bucket,
        discovery_status: discovery,
        matrix_quality_status: quality,
        recale_status: classify(bucket, discovery, quality),
        evidence: evidenceFor(slug, bucket, discovery, quality),
      };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const statusCounts = counts(rows);
  const statusSum = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const exceptions: string[] = [];
  if (rows.length !== EXPECTED_TOTAL) exceptions.push(`total overlap mesure=${rows.length}; attendu=${EXPECTED_TOTAL}; aucun total n'a ete force`);
  if (statusSum !== rows.length) exceptions.push(`somme recale_status=${statusSum}; total=${rows.length}`);

  const report: Record<string, unknown> = {
    contract: CONTRACT,
    generated_at_utc: new Date().toISOString(),
    provenance: {
      radar_preview: RADAR_PREVIEW,
      read_only: true,
      join_key: "graph_city_slug",
      sources: {
        overlap: { revision: OVERLAP_REVISION, path: OVERLAP_PATH, contract: "overlap-bprime167-vs-geo/v1" },
        discovery: { revision: DISCOVERY_REVISION, path: DISCOVERY_PATH },
        matrix: { revision: MATRIX_REVISION, path: MATRIX_PATH, contract: "zone-provenance-quality-matrix/v1" },
      },
    },
    classification_rule: {
      proof_live_verifiable: {
        v2: "deja_v2_servi",
        acceptable_or_candidate: "recale_ok",
        otherwise: "recale_missing",
      },
      proof_v1_dead: {
        NEEDS_RECALAGE_PDF: "recale_missing",
        UNRESOLVED: "unresolved",
      },
      no_proof_url_signal: {
        v2: "deja_v2_servi",
        otherwise: "recale_missing",
      },
      matrix_absent_or_no_identifiable_served_geometry: "recale_missing",
      recale_ok_guard: "recale_ok exige une preuve committee de geometrie issue d'une source autoritaire vivante (matrix acceptable ou candidate).",
    },
    cities: rows,
    validation: {
      expected_total: EXPECTED_TOTAL,
      total: rows.length,
      total_matches_expected_167: rows.length === EXPECTED_TOTAL,
      recale_status_counts: statusCounts,
      recale_status_sum: statusSum,
      partition_closed: statusSum === rows.length,
      exception: exceptions.length === 0 ? null : exceptions.join("; "),
    },
  };

  writeArtifact(output, `${JSON.stringify(report, null, 2)}\n`);
  writeArtifact(markdownOutput, markdown(report, output, markdownOutput));
  process.stdout.write(`${JSON.stringify({ json: relativePath(output), markdown: relativePath(markdownOutput), total: rows.length, recale_status_counts: statusCounts })}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
