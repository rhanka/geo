/**
 * Mesure en lecture seule des municipalités sans couverture ni candidat PV.
 *
 * Le référentiel municipal local est lu, jamais modifié. Les index S3 sont
 * lus via HEAD + GET borné à 5 MiB; aucun PUT, aucune capture et aucun octet
 * de document n'est demandé. Un candidat est défini par la règle observable
 * de `pv-probable-capture-plan` (`pv_probable`), jamais par une extension seule.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import {
  getBytes,
  listObjectEntries,
  objectHead,
  s3Client,
} from "./lib/s3.js";
import {
  planPvProbableTargets,
  pvIndexListingSha256,
  type PvIndexSnapshot,
} from "./lib/pv-probable-capture-plan.js";

const MAX_LOCAL_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_S3_INDEX_BYTES = 5 * 1024 * 1024;
const MUNICIPALITIES_PATH = "packages/qc-sources/src/geo/municipalities.qc.json";
const BASE_PARTITION_PATH = "work/coverage/pv-univers-partition-finale-20260729T215104Z.json";
const WAVE1_VERDICTS_PATH = "work/coverage/pv-territorial-20260729t222149z-verdicts.json";

interface Municipality {
  readonly slug: string;
  readonly name: string;
  readonly mrc: string | null;
}

interface BasePartition {
  readonly municipal_coverage: {
    readonly reference_municipalities: number;
    readonly municipalities_with_at_least_one_indexed_pv: number;
    readonly municipality_slugs: readonly { readonly slug: string; readonly name: string }[];
  };
}

interface Wave1Verdicts {
  readonly summary: { readonly INDEXED: number };
  readonly verdicts: readonly { readonly slug: string; readonly verdict: string }[];
}

function readLocalJson<T>(path: string): T {
  const size = statSync(path).size;
  if (size > MAX_LOCAL_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256Bytes(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function assertUnique(values: readonly string[], label: string): Set<string> {
  const set = new Set(values);
  if (set.size !== values.length) throw new Error(`${label}: doublon (${values.length}/${set.size})`);
  return set;
}

function indexKeyParts(key: string): { slug: string } | null {
  const parts = key.split("/");
  if (parts.length !== 4 || parts[0] !== "registry" || parts[1] !== "qc-pv" || parts[3] !== "index.json") {
    return null;
  }
  return { slug: parts[2]! };
}

async function readIndexSnapshots(): Promise<{
  readonly scans: readonly PvIndexSnapshot[];
  readonly listing: readonly (readonly [string, string | null, string | null])[];
  readonly oversized: readonly string[];
}> {
  const s3 = s3Client();
  const listed = (await listObjectEntries(s3, "registry/qc-pv/"))
    .map((entry) => ({ ...entry, parsed: indexKeyParts(entry.key) }))
    .filter((entry): entry is typeof entry & { parsed: { slug: string } } => entry.parsed !== null);
  const scans: PvIndexSnapshot[] = [];
  const oversized: string[] = [];
  for (let offset = 0; offset < listed.length; offset += 16) {
    const batch = listed.slice(offset, offset + 16);
    const read = await Promise.all(batch.map(async (entry) => {
      const head = await objectHead(s3, entry.key);
      if (head.contentLength === undefined || head.contentLength > MAX_S3_INDEX_BYTES) {
        return { oversized: entry.key } as const;
      }
      const raw = JSON.parse((await getBytes(s3, entry.key)).toString("utf8")) as {
        readonly pvIndexUrl?: unknown;
        readonly entries?: unknown;
      };
      return {
        scan: {
          slug: entry.parsed.slug,
          index_url: typeof raw.pvIndexUrl === "string" && raw.pvIndexUrl.trim() ? raw.pvIndexUrl.trim() : null,
          entries: Array.isArray(raw.entries) ? raw.entries : [],
        } satisfies PvIndexSnapshot,
      } as const;
    }));
    for (const item of read) {
      if ("oversized" in item && typeof item.oversized === "string") oversized.push(item.oversized);
      else scans.push(item.scan);
    }
  }
  return {
    scans,
    listing: listed.map((entry) => [entry.key, entry.etag, entry.last_modified] as const),
    oversized,
  };
}

async function main(): Promise<void> {
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!out) throw new Error("--out=... est requis");

  const municipalities = readLocalJson<Municipality[]>(MUNICIPALITIES_PATH);
  const allSlugs = assertUnique(municipalities.map((municipality) => municipality.slug), "référentiel municipal");
  if (allSlugs.size !== 1106) throw new Error(`référentiel municipal: ${allSlugs.size}/1106`);

  const base = readLocalJson<BasePartition>(BASE_PARTITION_PATH);
  const baseCovered = assertUnique(
    base.municipal_coverage.municipality_slugs.map((municipality) => municipality.slug),
    "partition de base",
  );
  if (baseCovered.size !== 174 || base.municipal_coverage.municipalities_with_at_least_one_indexed_pv !== 174) {
    throw new Error(`partition de base: couverture inattendue (${baseCovered.size})`);
  }

  const wave1 = readLocalJson<Wave1Verdicts>(WAVE1_VERDICTS_PATH);
  const wave1Indexed = assertUnique(
    wave1.verdicts.filter((verdict) => verdict.verdict === "INDEXED").map((verdict) => verdict.slug),
    "verdicts vague 1",
  );
  if (wave1Indexed.size !== 203 || wave1.summary.INDEXED !== 203) {
    throw new Error(`vague 1: INDEXED inattendus (${wave1Indexed.size})`);
  }
  if ([...baseCovered].some((slug) => wave1Indexed.has(slug))) {
    throw new Error("vague 1: intersection avec la partition de base");
  }
  const covered = new Set([...baseCovered, ...wave1Indexed]);
  if (covered.size !== 377 || [...covered].some((slug) => !allSlugs.has(slug))) {
    throw new Error(`couverture: ${covered.size}/377 ou slug hors référentiel`);
  }

  const snapshot = await readIndexSnapshots();
  if (snapshot.oversized.length > 0) {
    throw new Error(`index S3 > 5 MiB: ${snapshot.oversized.join(", ")}`);
  }
  const targets = planPvProbableTargets(snapshot.scans);
  const allCandidateSlugs = new Set(targets.map((target) => target.slug));
  const candidateSlugs = new Set([...allCandidateSlugs].filter((slug) => allSlugs.has(slug)));
  const unrecognizedCandidateSlugs = [...allCandidateSlugs].filter((slug) => !allSlugs.has(slug)).sort();
  const coveredCandidateIntersection = [...covered].filter((slug) => candidateSlugs.has(slug));
  const candidateOnly = [...candidateSlugs].filter((slug) => !covered.has(slug));
  const missingSlugs = [...allSlugs].filter((slug) => !covered.has(slug) && !candidateSlugs.has(slug)).sort();
  const municipalityBySlug = new Map(municipalities.map((municipality) => [municipality.slug, municipality]));

  const body = {
    contract: "pv-decouverte-municipalites-vierges/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    definition: {
      reference: "packages/qc-sources/src/geo/municipalities.qc.json",
      covered: "174 municipalités de la partition finale + 203 verdicts INDEXED de la vague territoriale 1; union vérifiée = 377",
      candidate: "municipalité de référence attachée à au moins une URL pv_probable de planPvProbableTargets sur registry/qc-pv/*/index.json",
      missing: "reference - covered - candidate_only; les ensembles couverts et candidate_only sont disjoints",
    },
    sources: {
      municipalities: { path: MUNICIPALITIES_PATH, sha256: sha256Bytes(MUNICIPALITIES_PATH) },
      base_partition: { path: BASE_PARTITION_PATH, sha256: sha256Bytes(BASE_PARTITION_PATH) },
      wave1_verdicts: { path: WAVE1_VERDICTS_PATH, sha256: sha256Bytes(WAVE1_VERDICTS_PATH) },
      s3_index_prefix: "s3://sentropic-geo/registry/qc-pv/",
      s3_index_listing_sha256: pvIndexListingSha256(snapshot.listing),
    },
    cardinality: {
      reference_municipalities: allSlugs.size,
      base_covered: baseCovered.size,
      wave1_indexed: wave1Indexed.size,
      covered_union: covered.size,
      probable_urls: targets.length,
      candidate_municipalities_total: allCandidateSlugs.size,
      candidate_municipalities_in_reference: candidateSlugs.size,
      candidate_municipalities_unrecognized: unrecognizedCandidateSlugs.length,
      covered_candidate_intersection: coveredCandidateIntersection.length,
      candidate_only_in_reference: candidateOnly.length,
      covered_union_candidate_union_in_reference: new Set([...covered, ...candidateSlugs]).size,
      missing_without_candidate: missingSlugs.length,
      equation: `${allSlugs.size} - ${covered.size} - ${candidateOnly.length} = ${missingSlugs.length}`,
      expected_527_delta: missingSlugs.length - 527,
    },
    unrecognized_candidate_slugs: unrecognizedCandidateSlugs,
    municipalities: missingSlugs.map((slug) => {
      const municipality = municipalityBySlug.get(slug);
      if (!municipality) throw new Error(`municipalité manquante: ${slug}`);
      return { slug: municipality.slug, name: municipality.name, mrc: municipality.mrc };
    }),
  };
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out, missing: missingSlugs.length, covered: covered.size, candidateOnly: candidateOnly.length }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
