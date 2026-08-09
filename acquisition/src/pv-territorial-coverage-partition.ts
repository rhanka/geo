/**
 * Materialises the municipal PV coverage reached by the territorial campaigns.
 *
 * This is a read-only aggregation of committed graph-verdict reports.  It
 * deliberately distinguishes indexed records from durable captures: only an
 * INDEXED outcome opens a municipality in the resulting partition.
 *
 * Usage:
 *   npx tsx acquisition/src/pv-territorial-coverage-partition.ts \
 *     --out=work/coverage/pv-univers-partition-territorial-YYYYMMDDTHHMMSSZ.json
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

const SOURCE_PATHS = {
  base: "work/coverage/pv-univers-partition-finale-20260729T215104Z.json",
  wave1: "work/coverage/pv-territorial-20260729t222149z-verdicts.json",
  visual1: "work/coverage/pv-lecture-visuelle-territorial-v1-20260730T004831Z.json",
  wave2: "work/coverage/pv-territorial-20260729t231834z/pv-territorial-campaign-conversion-summary.json",
  visual2: "work/coverage/pv-lecture-visuelle-territorial-v2-20260730T012018Z.json",
  municipalities: "packages/qc-sources/src/geo/municipalities.qc.json",
} as const;

function requiredOut(): string {
  const value = process.argv.slice(2).find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (!value) throw new Error("--out=... est requis");
  const absolute = resolve(ROOT, value);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error("--out doit rester dans le dépôt");
  return absolute;
}

function readJson(path: string): Record<string, unknown> | unknown[] {
  const absolute = resolve(ROOT, path);
  const size = statSync(absolute).size;
  if (size > MAX_INPUT_BYTES) throw new Error(`${path}: ${size} octets > plafond de lecture`);
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error(`${path}: JSON objet ou tableau requis`);
  return parsed as Record<string, unknown> | unknown[];
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: objet requis`);
  return value as Record<string, unknown>;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: tableau requis`);
  return value;
}

function slug(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${where}: slug invalide`);
  return value;
}

function coverageSlugs(path: string): string[] {
  const root = record(readJson(path), path);
  const municipalCoverage = record(root.municipal_coverage, `${path}.municipal_coverage`);
  return array(municipalCoverage.municipality_slugs, `${path}.municipal_coverage.municipality_slugs`)
    .map((value, index) => slug(record(value, `${path}.municipal_coverage.municipality_slugs[${index}]`).slug, `${path}.municipal_coverage.municipality_slugs[${index}].slug`));
}

function indexedVerdictSlugs(path: string): string[] {
  const root = record(readJson(path), path);
  return array(root.verdicts, `${path}.verdicts`).flatMap((value, index) => {
    const verdict = record(value, `${path}.verdicts[${index}]`);
    return verdict.verdict === "INDEXED" ? [slug(verdict.slug, `${path}.verdicts[${index}].slug`)] : [];
  });
}

function impactSlugs(path: string): string[] {
  const root = record(readJson(path), path);
  const impact = record(root.municipal_impact, `${path}.municipal_impact`);
  return array(impact.zero_to_at_least_one_pv_slugs, `${path}.municipal_impact.zero_to_at_least_one_pv_slugs`)
    .map((value, index) => slug(value, `${path}.municipal_impact.zero_to_at_least_one_pv_slugs[${index}]`));
}

function conversionSlugs(path: string): string[] {
  const root = record(readJson(path), path);
  const municipalCoverage = record(root.municipal_coverage, `${path}.municipal_coverage`);
  return array(municipalCoverage.zero_to_at_least_one_pv_slugs, `${path}.municipal_coverage.zero_to_at_least_one_pv_slugs`)
    .map((value, index) => slug(value, `${path}.municipal_coverage.zero_to_at_least_one_pv_slugs[${index}]`));
}

function assertUnique(slugs: readonly string[], label: string): Set<string> {
  const values = new Set(slugs);
  if (values.size !== slugs.length) throw new Error(`${label}: slugs dupliqués (${slugs.length}/${values.size})`);
  return values;
}

function main(): void {
  const output = requiredOut();
  const municipalities = array(readJson(SOURCE_PATHS.municipalities), SOURCE_PATHS.municipalities);
  const municipalityBySlug = new Map<string, string>();
  for (const [index, raw] of municipalities.entries()) {
    const municipality = record(raw, `${SOURCE_PATHS.municipalities}[${index}]`);
    const municipalSlug = slug(municipality.slug, `${SOURCE_PATHS.municipalities}[${index}].slug`);
    if (typeof municipality.name !== "string" || !municipality.name.trim()) throw new Error(`${SOURCE_PATHS.municipalities}[${index}].name invalide`);
    if (municipalityBySlug.has(municipalSlug)) throw new Error(`${SOURCE_PATHS.municipalities}: slug dupliqué ${municipalSlug}`);
    municipalityBySlug.set(municipalSlug, municipality.name);
  }
  if (municipalityBySlug.size !== 1106) throw new Error(`référentiel municipal: ${municipalityBySlug.size}/1106`);

  const groups = [
    { name: "partition_fondatrice", expected: 174, slugs: coverageSlugs(SOURCE_PATHS.base) },
    { name: "territoriale_v1_graphify", expected: 203, slugs: indexedVerdictSlugs(SOURCE_PATHS.wave1) },
    { name: "territoriale_v1_lecture_visuelle", expected: 31, slugs: impactSlugs(SOURCE_PATHS.visual1) },
    { name: "territoriale_v2_graphify", expected: 207, slugs: conversionSlugs(SOURCE_PATHS.wave2) },
    { name: "territoriale_v2_lecture_visuelle", expected: 25, slugs: impactSlugs(SOURCE_PATHS.visual2) },
  ] as const;
  const covered = new Set<string>();
  for (const group of groups) {
    const groupSlugs = assertUnique(group.slugs, group.name);
    if (groupSlugs.size !== group.expected) throw new Error(`${group.name}: ${groupSlugs.size}/${group.expected} INDEXED inattendus`);
    for (const value of groupSlugs) {
      if (!municipalityBySlug.has(value)) throw new Error(`${group.name}: slug hors référentiel ${value}`);
      if (covered.has(value)) throw new Error(`${group.name}: recouvre une couverture antérieure (${value})`);
      covered.add(value);
    }
  }
  if (covered.size !== 640) throw new Error(`union de couverture: ${covered.size}/640`);

  const body = `${JSON.stringify({
    contract: "pv-univers-partition-finale/v1",
    generated_at: new Date().toISOString(),
    read_only_aggregation: true,
    scope: {
      coverage_definition: "INDEXED uniquement; les captures durables sans verdict INDEXED restent vierges.",
      sources: SOURCE_PATHS,
      components: groups.map((group) => ({ name: group.name, indexed_municipalities: group.expected })),
    },
    municipal_coverage: {
      reference: SOURCE_PATHS.municipalities,
      reference_municipalities: municipalityBySlug.size,
      municipalities_with_at_least_one_indexed_pv: covered.size,
      municipality_slugs: [...covered].sort().map((value) => ({ slug: value, name: municipalityBySlug.get(value)! })),
    },
  }, null, 2)}\n`;
  if (existsSync(output)) {
    if (readFileSync(output, "utf8") === body) return;
    throw new Error(`refus d'écraser le rapport immuable: ${output.slice(ROOT.length + 1)}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, body, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ out: output.slice(ROOT.length + 1), covered: covered.size, virgin: municipalityBySlug.size - covered.size, components: groups.map((group) => ({ name: group.name, indexed_municipalities: group.expected })) })}\n`);
}

main();
