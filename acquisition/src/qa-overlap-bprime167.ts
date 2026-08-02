/**
 * Compose the overlap between the conductor's frozen B' 167 set, geo's
 * already-verifiable evidence, and the zones-v1 liveness sweep. B' joins on
 * its authoritative graph_city_slug, falling back verbatim to slug only when
 * graph_city_slug is empty or match is UNMATCHED.
 *
 * Usage (from repository root):
 *   npx tsx acquisition/src/qa-overlap-bprime167.ts
 *
 * This command is read-only except for its committed local report. It never
 * normalizes a slug.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const RADAR_REPOSITORY = "/home/antoinefa/src/radar-immobilier";
const BPRIME_REVISION = "800ee90";
const BPRIME_PATH = "docs/spec/reports/set-167-bprime.tsv";
const GEO_INTERNAL_PATH = "work/coverage/geo-internal-167-verifiable-url.json";
const ZONES_REVISION = "05eaa5b6";
const ZONES_PATH = "work/coverage/zones-v1-proof-url-liveness-20260802T155338Z.json";
const OUTPUT_PATH = "work/coverage/overlap-bprime167-vs-geo-20260802.json";
const EXPECTED_BPRIME_ROWS = 167;
const EXPECTED_GEO_INTERNAL_SLUGS = 167;
const EXPECTED_ZONES_SLUGS = 242;

const BPRIME_HEADER = ["slug", "name", "priorityRank", "graph_version", "graph_city_slug", "match"];

export type Bucket = "proof_live_verifiable" | "proof_v1_live" | "proof_v1_dead" | "no_proof_url_signal";
export type ZoneClassification = "LIVE" | "DEAD" | "AMBIGU" | "UNKNOWN";
export type BprimeMatch = "exact" | "normalized" | "UNMATCHED";

export interface BprimeRow {
  slug: string;
  name: string;
  priorityRank: number;
  graph_version: string;
  graph_city_slug: string;
  match: BprimeMatch;
}

export interface ZoneSignal {
  url: string;
  classification: ZoneClassification;
}

/**
 * B' TSV header authority: graph_city_slug is the serving and graph key.
 * Cities without a graph are the only permitted fallback to their B' slug.
 */
export function bprimeJoinKey(row: BprimeRow): string {
  return row.graph_city_slug === "" || row.match === "UNMATCHED" ? row.slug : row.graph_city_slug;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

/** Parse the fixed B' TSV without changing any slug or graph slug text. */
export function parseBprimeTsv(text: string): BprimeRow[] {
  const dataLines = text.split(/\r?\n/).filter((line) => line !== "" && !line.startsWith("#"));
  if (dataLines.length === 0) throw new Error("B' TSV is empty");

  const header = dataLines[0].split("\t");
  if (header.length !== BPRIME_HEADER.length || header.some((value, index) => value !== BPRIME_HEADER[index])) {
    throw new Error(`B' TSV header must be ${BPRIME_HEADER.join("\\t")}`);
  }

  const seenSlugs = new Set<string>();
  return dataLines.slice(1).map((line, lineIndex) => {
    const fields = line.split("\t");
    const rowNumber = lineIndex + 2;
    if (fields.length !== BPRIME_HEADER.length) throw new Error(`B' TSV line ${rowNumber} has ${fields.length} fields, expected 6`);

    const [slug, name, priorityRankRaw, graphVersion, graphCitySlug, matchRaw] = fields;
    if (slug.length === 0 || name.length === 0 || graphVersion.length === 0) {
      throw new Error(`B' TSV line ${rowNumber} contains an empty required field`);
    }
    if (!/^[1-9]\d*$/.test(priorityRankRaw)) throw new Error(`B' TSV line ${rowNumber} has invalid priorityRank: ${priorityRankRaw}`);
    if (seenSlugs.has(slug)) throw new Error(`B' TSV has duplicate slug: ${slug}`);
    seenSlugs.add(slug);
    if (matchRaw !== "exact" && matchRaw !== "normalized" && matchRaw !== "UNMATCHED") {
      throw new Error(`B' TSV line ${rowNumber} has invalid match: ${matchRaw}`);
    }

    return {
      slug,
      name,
      priorityRank: Number(priorityRankRaw),
      graph_version: graphVersion,
      graph_city_slug: graphCitySlug,
      match: matchRaw,
    };
  });
}

/** Apply the documented evidence precedence using exact string membership only. */
export function classifyBucket(slug: string, geoSet: ReadonlySet<string>, zonesMap: ReadonlyMap<string, ZoneSignal>): Bucket {
  if (geoSet.has(slug)) return "proof_live_verifiable";

  const zoneSignal = zonesMap.get(slug);
  if (zoneSignal?.classification === "LIVE") return "proof_v1_live";
  if (zoneSignal?.classification === "DEAD" || zoneSignal?.classification === "AMBIGU") return "proof_v1_dead";
  if (zoneSignal?.classification === "UNKNOWN") {
    throw new Error(`zones-v1 classification UNKNOWN has no allowed B' partition bucket: ${slug}`);
  }
  return "no_proof_url_signal";
}

function parseGeoInternalSet(bytes: Buffer): Set<string> {
  const document = asObject(JSON.parse(bytes.toString("utf8")));
  if (document?.contract !== "geo-internal-167-verifiable-url/v1") throw new Error("geo-internal-167 has an unexpected contract");
  if (!Array.isArray(document.slugs)) throw new Error("geo-internal-167 must contain slugs[]");
  if (requiredNonNegativeInteger(document.count, "geo-internal-167.count") !== EXPECTED_GEO_INTERNAL_SLUGS
    || requiredNonNegativeInteger(document.expected, "geo-internal-167.expected") !== EXPECTED_GEO_INTERNAL_SLUGS) {
    throw new Error("geo-internal-167 count must equal 167");
  }

  const geoSet = new Set<string>();
  for (const [index, value] of document.slugs.entries()) {
    const row = asObject(value);
    const slug = requiredString(row?.slug, `geo-internal-167.slugs[${index}].slug`);
    if (geoSet.has(slug)) throw new Error(`geo-internal-167 has duplicate slug: ${slug}`);
    geoSet.add(slug);
  }
  if (geoSet.size !== EXPECTED_GEO_INTERNAL_SLUGS) throw new Error(`geo-internal-167 has ${geoSet.size} distinct slugs, expected 167`);
  return geoSet;
}

function parseZonesMap(bytes: Buffer): Map<string, ZoneSignal> {
  const document = asObject(JSON.parse(bytes.toString("utf8")));
  if (document?.contract !== "zones-v1-proof-url-liveness/v1") throw new Error("zones-v1 liveness has an unexpected contract");
  if (!Array.isArray(document.rows)) throw new Error("zones-v1 liveness must contain rows[]");

  const zonesMap = new Map<string, ZoneSignal>();
  for (const [index, value] of document.rows.entries()) {
    const row = asObject(value);
    const slug = requiredString(row?.slug, `zones-v1.rows[${index}].slug`);
    const url = requiredString(row?.url, `zones-v1.rows[${index}].url`);
    const classification = row?.classification;
    if (classification !== "LIVE" && classification !== "DEAD" && classification !== "AMBIGU" && classification !== "UNKNOWN") {
      throw new Error(`zones-v1.rows[${index}].classification is invalid: ${String(classification)}`);
    }
    if (zonesMap.has(slug)) throw new Error(`zones-v1 has duplicate slug: ${slug}`);
    zonesMap.set(slug, { url, classification });
  }
  if (zonesMap.size !== EXPECTED_ZONES_SLUGS) throw new Error(`zones-v1 has ${zonesMap.size} distinct slugs, expected 242`);
  return zonesMap;
}

function gitShow(repository: string | null, revisionPath: string): Buffer {
  const args = repository === null ? ["show", revisionPath] : ["-C", repository, "show", revisionPath];
  return execFileSync("git", args, { cwd: ROOT });
}

function bucketCounts(buckets: Readonly<Record<Bucket, readonly string[]>>): Record<Bucket, number> {
  return {
    proof_live_verifiable: buckets.proof_live_verifiable.length,
    proof_v1_live: buckets.proof_v1_live.length,
    proof_v1_dead: buckets.proof_v1_dead.length,
    no_proof_url_signal: buckets.no_proof_url_signal.length,
  };
}

function main(): void {
  const bprimeBytes = gitShow(RADAR_REPOSITORY, `${BPRIME_REVISION}:${BPRIME_PATH}`);
  const geoInternalBytes = readFileSync(resolve(ROOT, GEO_INTERNAL_PATH));
  const zonesBytes = gitShow(null, `${ZONES_REVISION}:${ZONES_PATH}`);

  const bprimeRows = parseBprimeTsv(bprimeBytes.toString("utf8"));
  if (bprimeRows.length !== EXPECTED_BPRIME_ROWS) throw new Error(`B' TSV has ${bprimeRows.length} rows, expected 167`);

  const geoSet = parseGeoInternalSet(geoInternalBytes);
  const zonesMap = parseZonesMap(zonesBytes);
  const buckets: Record<Bucket, string[]> = {
    proof_live_verifiable: [],
    proof_v1_live: [],
    proof_v1_dead: [],
    no_proof_url_signal: [],
  };
  const recaptureTarget: Array<{
    slug: string;
    name: string;
    priorityRank: number;
    graph_version: string;
    bucket: "proof_v1_live" | "proof_v1_dead";
    v1_url: string;
    v1_classification: ZoneClassification;
  }> = [];
  const slugAmbiguities: Array<{
    slug: string;
    graph_city_slug: string;
    bucket_par_slug: Bucket;
    bucket_par_graph: Bucket;
  }> = [];
  const unmatched: Array<{
    bucket: "UNMATCHED";
    slug: string;
    graph_city_slug: string;
    match: BprimeMatch;
    bucket_par_slug: Bucket;
    bucket_par_graph: Bucket;
  }> = [];

  for (const row of bprimeRows) {
    const joinKey = bprimeJoinKey(row);
    const bucket = classifyBucket(joinKey, geoSet, zonesMap);
    buckets[bucket].push(row.slug);

    // Retain non-exact B' source mappings as a raw diagnostic only. The
    // authoritative key above resolves graph-versus-slug differences, so they
    // are no longer reported as unresolved slug ambiguities.
    if (row.slug !== row.graph_city_slug || row.match !== "exact") {
      const bucketBySlug = classifyBucket(row.slug, geoSet, zonesMap);
      const bucketByGraph = classifyBucket(row.graph_city_slug, geoSet, zonesMap);
      if (row.match !== "exact") {
        unmatched.push({
          bucket: "UNMATCHED",
          slug: row.slug,
          graph_city_slug: row.graph_city_slug,
          match: row.match,
          bucket_par_slug: bucketBySlug,
          bucket_par_graph: bucketByGraph,
        });
      }
    }

    if (bucket === "proof_v1_live" || bucket === "proof_v1_dead") {
      const signal = zonesMap.get(joinKey);
      if (signal === undefined) throw new Error(`missing zones-v1 signal for ${joinKey} classified as ${bucket}`);
      recaptureTarget.push({
        slug: row.slug,
        name: row.name,
        priorityRank: row.priorityRank,
        graph_version: row.graph_version,
        bucket,
        v1_url: signal.url,
        v1_classification: signal.classification,
      });
    }
  }

  const counts = bucketCounts(buckets);
  const total = counts.proof_live_verifiable + counts.proof_v1_live + counts.proof_v1_dead + counts.no_proof_url_signal;
  if (total !== EXPECTED_BPRIME_ROWS) {
    throw new Error(`partition B' ne ferme pas à 167: ${total} (live vérifiable=${counts.proof_live_verifiable}, v1 live=${counts.proof_v1_live}, v1 morte=${counts.proof_v1_dead}, sans signal=${counts.no_proof_url_signal})`);
  }

  recaptureTarget.sort((left, right) => left.priorityRank - right.priorityRank);
  const artifact = {
    contract: "overlap-bprime167-vs-geo/v1",
    join_key: "graph_city_slug (fallback slug si vide ou match=UNMATCHED)",
    correction: "join key slug->graph_city_slug per tsv header authority; 2 MRC double-tiret munis (saint-damase, hemmingford) reclassées no_signal->proof_v1_dead",
    provenance: {
      bprime: {
        source: "radar feat/set-167-canonical@800ee90 (PREVIEW, PR #436 NON mergée, contenu 'figé conducteur 2026-08-02')",
        path: BPRIME_PATH,
        sha256: sha256(bprimeBytes),
        rows: EXPECTED_BPRIME_ROWS,
      },
      geo_internal_167: {
        path: GEO_INTERNAL_PATH,
        commit: "cceb68fe",
        sha256: sha256(geoInternalBytes),
      },
      zones_v1_dead_axis: {
        source: "lane/zones@05eaa5b6",
        path: ZONES_PATH,
        sha256: sha256(zonesBytes),
      },
    },
    revalidation_pending: "RE-VALIDER byte-identique vs radar main dès merge PR #436 ; divergence => alerter geo",
    two_167_overlap: counts.proof_live_verifiable,
    verdict: `${counts.proof_live_verifiable}/167 villes B′ ont déjà une preuve vivante vérifiable ; le recouvrement mesuré est ${counts.proof_live_verifiable}.`,
    partition: {
      ...counts,
      total,
    },
    recapture_target: recaptureTarget,
    buckets,
    // A non-exact B' graph mapping remains outside the four-way evidence
    // partition: it is explicitly reported instead of being normalized.
    unmatched,
    slug_ambiguities: slugAmbiguities,
  };

  writeAtomic(resolve(ROOT, OUTPUT_PATH), artifact);
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    two_167_overlap: artifact.two_167_overlap,
    partition: artifact.partition,
    recapture_target: artifact.recapture_target.length,
    slug_ambiguities: artifact.slug_ambiguities.length,
    unmatched: artifact.unmatched.length,
  }, null, 2));
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
