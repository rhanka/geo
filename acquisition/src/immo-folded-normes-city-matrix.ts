/**
 * Build the dated, closed city partition for folded zoning norms on served Immo
 * lots.  It deliberately reuses the committed per-municipality Immo snapshot;
 * there is no geometry scan and no network path.  Its local checkpoint keeps
 * the same bounded/resumable CLI contract as the S3-backed lot-zone matrix.
 *
 * Usage:
 *   npx tsx acquisition/src/immo-folded-normes-city-matrix.ts --date 20260802 --max-seconds 15
 *   ... --resume                    # continue the local .cache checkpoint
 *   ... --checkpoint <path>          # choose a different local checkpoint
 *   ... --help
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE = resolve(ROOT, "work/coverage/coverage-matrix.json");
const IMMO_FIELDS = resolve(ROOT, "work/immo-field-completion-matrices/immo-field-completion-matrix.json");
const IMMO_LOTS = resolve(ROOT, "work/coverage/immo-lots.json");
const OUT_DIR = resolve(ROOT, "work/coverage");
const CACHE_DIR = resolve(ROOT, ".cache");
const UNIVERSE = 1106;
const BATCH_SIZE = 128;

type State = "complete" | "incomplete" | "unknown" | "not_applicable";

interface ImmoRow {
  slug?: unknown;
  numLots?: unknown;
  fieldNum?: unknown;
}

interface CityMeasurement {
  slug: string;
  state: State;
  reason: string;
  immo_source_slug: string | null;
  observed_lots: number | null;
  folded_normes_lots: number | null;
  missing_folded_normes_lots: number | null;
  folded_normes_pct: number | null;
}

interface Progress {
  contract: "immo-folded-normes-city-progress/v1";
  as_of_date: string;
  source_sha256: Record<string, string>;
  cities: CityMeasurement[];
}

interface Args {
  date: string;
  maxSeconds: number;
  resume: boolean;
  checkpoint: string;
}

function fail(message: string): never {
  throw new Error(`immo-folded-normes-city-matrix: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readJson(path: string): { text: string; value: unknown } {
  const text = readFileSync(path, "utf8");
  return { text, value: JSON.parse(text) as unknown };
}

function ascending(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function pct(numerator: number, denominator: number): number {
  return Math.round((10000 * numerator) / denominator) / 100;
}

function dateToday(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function usage(): string {
  return [
    "Usage: npx tsx acquisition/src/immo-folded-normes-city-matrix.ts [options]",
    "  --date YYYYMMDD       Date embedded in the immutable output (default: today)",
    "  --max-seconds N       Wall-time cap for this invocation (default: 15)",
    "  --resume              Resume the compatible local checkpoint",
    "  --checkpoint PATH     Local checkpoint path (default: .cache/...)",
    "  --help                Show this help",
    "",
    "Reads only committed coverage snapshots; no S3 or geometry reads.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args | null {
  let date = dateToday();
  let maxSeconds = 15;
  let resume = false;
  let checkpoint: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--help") return null;
    if (token === "--resume") {
      resume = true;
      continue;
    }
    const inline = token.match(/^--(date|max-seconds|checkpoint)=(.+)$/u);
    const key = inline?.[1] ?? (token.startsWith("--") ? token.slice(2) : "");
    const value = inline?.[2] ?? argv[++index];
    if (!value || !["date", "max-seconds", "checkpoint"].includes(key)) fail(`unknown or incomplete option ${token}`);
    if (key === "date") date = value;
    else if (key === "max-seconds") maxSeconds = Number(value);
    else checkpoint = value;
  }
  invariant(/^\d{8}$/u.test(date), "--date must be YYYYMMDD");
  invariant(Number.isFinite(maxSeconds) && maxSeconds > 0, "--max-seconds must be a positive number");
  return {
    date,
    maxSeconds,
    resume,
    checkpoint: checkpoint ? resolve(ROOT, checkpoint) : resolve(CACHE_DIR, `immo-folded-normes-city-${date}.progress.json`),
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

function sources(): {
  universe: string[];
  naSlugs: Set<string>;
  canonicalRows: Map<string, ImmoRow>;
  sourceSha256: Record<string, string>;
  sourceMeta: { coverageGeneratedAt: unknown; immoGeneratedAt: unknown; aliases: readonly string[] };
} {
  const coverage = readJson(COVERAGE);
  const fields = readJson(IMMO_FIELDS);
  const lots = readJson(IMMO_LOTS);
  const coverageValue = record(coverage.value, "coverage matrix");
  const coverageCities = record(coverageValue["cities"], "coverage matrix.cities");
  invariant(coverageValue["municipalityCount"] === UNIVERSE, `coverage municipalityCount must be ${UNIVERSE}`);
  const universe = Object.keys(coverageCities).sort(ascending);
  invariant(universe.length === UNIVERSE, `coverage matrix has ${universe.length} city rows, expected ${UNIVERSE}`);

  const fieldsValue = record(fields.value, "immo field matrix");
  const fieldCities = fieldsValue["cities"];
  invariant(Array.isArray(fieldCities), "immo field matrix.cities must be an array");
  const naSlugs = new Set<string>();
  for (const raw of fieldCities) {
    const city = record(raw, "immo field city");
    const surface = record(city["surface_m2"], "immo field city.surface_m2");
    if (surface["status"] === "N/A") {
      invariant(typeof city["slug"] === "string", "N/A immo field city has no slug");
      naSlugs.add(city["slug"]);
    }
  }
  invariant(naSlugs.size === 6, `expected exactly six explicit portfolio N/A cities, got ${naSlugs.size}`);

  const lotsValue = record(lots.value, "immo lots snapshot");
  const perMuni = lotsValue["perMuni"];
  invariant(Array.isArray(perMuni), "immo lots perMuni must be an array");
  const universeSet = new Set(universe);
  const canonicalRows = new Map<string, ImmoRow>();
  const sourceRows = new Map<string, ImmoRow>();
  for (const raw of perMuni) {
    const row = record(raw, "immo lots row") as ImmoRow;
    invariant(typeof row.slug === "string" && row.slug.length > 0, "immo lots row has no slug");
    invariant(!sourceRows.has(row.slug), `duplicate immo lots source slug ${row.slug}`);
    sourceRows.set(row.slug, row);
    if (universeSet.has(row.slug)) canonicalRows.set(row.slug, row);
  }
  const reconciliation = record(fieldsValue["reconciliation"], "immo field matrix.reconciliation");
  const duplicates = reconciliation["noncanonical_duplicate_source_rows_detail"];
  invariant(Array.isArray(duplicates), "immo field matrix alias reconciliation is absent");
  const aliases = duplicates.map((raw) => {
    const alias = record(raw, "alias reconciliation row");
    invariant(typeof alias["source_slug"] === "string", "alias row has no source_slug");
    invariant(typeof alias["canonical_city_slug"] === "string", "alias row has no canonical_city_slug");
    const source = sourceRows.get(alias["source_slug"]);
    const canonical = canonicalRows.get(alias["canonical_city_slug"]);
    invariant(source && canonical, `alias ${alias["source_slug"]} cannot be reconciled`);
    // The committed field matrix establishes that this is a duplicate source
    // spelling for the city.  It intentionally did not certify folded-normes
    // equality (l-assomption is the observed counterexample), so this KPI must
    // use only the exact canonical row and never copy the alias' folded value.
    invariant(source.numLots === canonical.numLots, `alias ${alias["source_slug"]} disagrees with its canonical lot denominator`);
    return alias["source_slug"];
  }).sort(ascending);
  const noncanonical = [...sourceRows.keys()].filter((slug) => !universeSet.has(slug)).sort(ascending);
  invariant(JSON.stringify(noncanonical) === JSON.stringify(aliases), "immo lots noncanonical rows drifted from the committed alias reconciliation");
  const zeroSlugs = [...canonicalRows.entries()].filter(([, row]) => row.numLots === 0).map(([slug]) => slug).sort(ascending);
  invariant(JSON.stringify(zeroSlugs) === JSON.stringify([...naSlugs].sort(ascending)), "explicit N/A list drifted from canonical zero-lot Immo rows");

  return {
    universe,
    naSlugs,
    canonicalRows,
    sourceSha256: {
      "work/coverage/coverage-matrix.json": sha256(coverage.text),
      "work/immo-field-completion-matrices/immo-field-completion-matrix.json": sha256(fields.text),
      "work/coverage/immo-lots.json": sha256(lots.text),
    },
    sourceMeta: { coverageGeneratedAt: coverageValue["generatedAt"] ?? null, immoGeneratedAt: lotsValue["generatedAt"] ?? null, aliases },
  };
}

function classify(slug: string, naSlugs: ReadonlySet<string>, row: ImmoRow | undefined): CityMeasurement {
  if (naSlugs.has(slug)) {
    return { slug, state: "not_applicable", reason: "Explicit portfolio N/A: canonical Immo field matrix reports a zero per-lot denominator.", immo_source_slug: row && typeof row.slug === "string" ? row.slug : null, observed_lots: 0, folded_normes_lots: null, missing_folded_normes_lots: null, folded_normes_pct: null };
  }
  if (!row) {
    return { slug, state: "unknown", reason: "No canonical committed Immo perMuni stats row exists.", immo_source_slug: null, observed_lots: null, folded_normes_lots: null, missing_folded_normes_lots: null, folded_normes_pct: null };
  }
  const lots = nonNegativeInteger(row.numLots);
  const fields = row.fieldNum === null || typeof row.fieldNum !== "object" || Array.isArray(row.fieldNum) ? null : row.fieldNum as Record<string, unknown>;
  const folded = fields ? nonNegativeInteger(fields["folded-normes"]) : null;
  if (lots === null || lots === 0 || folded === null || folded > lots) {
    return { slug, state: "unknown", reason: "Committed Immo stats do not expose a usable positive numLots/folded-normes pair.", immo_source_slug: typeof row.slug === "string" ? row.slug : null, observed_lots: null, folded_normes_lots: null, missing_folded_normes_lots: null, folded_normes_pct: null };
  }
  const missing = lots - folded;
  return {
    slug,
    state: folded === lots ? "complete" : "incomplete",
    reason: `Committed Immo stats report ${folded}/${lots} served lots with folded-normes.`,
    immo_source_slug: typeof row.slug === "string" ? row.slug : null,
    observed_lots: lots,
    folded_normes_lots: folded,
    missing_folded_normes_lots: missing,
    folded_normes_pct: pct(folded, lots),
  };
}

function loadProgress(args: Args, sourceSha256: Record<string, string>, universe: readonly string[]): Map<string, CityMeasurement> {
  if (!args.resume) return new Map();
  invariant(existsSync(args.checkpoint), `--resume requested but checkpoint is absent: ${relative(ROOT, args.checkpoint)}`);
  const progress = JSON.parse(readFileSync(args.checkpoint, "utf8")) as Progress;
  invariant(progress.contract === "immo-folded-normes-city-progress/v1", "checkpoint contract is incompatible");
  invariant(progress.as_of_date === args.date, "checkpoint date is incompatible");
  invariant(JSON.stringify(progress.source_sha256) === JSON.stringify(sourceSha256), "checkpoint source hashes are incompatible; restart without --resume");
  const allowed = new Set(universe);
  const map = new Map<string, CityMeasurement>();
  for (const city of progress.cities) {
    invariant(allowed.has(city.slug), `checkpoint has out-of-universe city ${city.slug}`);
    invariant(!map.has(city.slug), `checkpoint has duplicate city ${city.slug}`);
    map.set(city.slug, city);
  }
  return map;
}

function saveProgress(path: string, date: string, sourceSha256: Record<string, string>, cities: Map<string, CityMeasurement>): void {
  const progress: Progress = { contract: "immo-folded-normes-city-progress/v1", as_of_date: date, source_sha256: sourceSha256, cities: [...cities.values()].sort((left, right) => ascending(left.slug, right.slug)) };
  writeAtomic(path, `${JSON.stringify(progress, null, 2)}\n`);
}

function partition(cities: readonly CityMeasurement[]): Record<State, string[]> {
  const buckets: Record<State, string[]> = { complete: [], incomplete: [], unknown: [], not_applicable: [] };
  for (const city of cities) buckets[city.state].push(city.slug);
  for (const bucket of Object.values(buckets)) bucket.sort(ascending);
  const all = Object.values(buckets).flat();
  invariant(all.length === UNIVERSE, `partition covers ${all.length}, expected ${UNIVERSE}`);
  invariant(new Set(all).size === UNIVERSE, "partition has a duplicate city");
  return buckets;
}

function matrix(date: string, input: ReturnType<typeof sources>, cities: readonly CityMeasurement[]): string {
  const buckets = partition(cities);
  const measured = cities.filter((city) => city.observed_lots !== null && city.folded_normes_lots !== null && city.missing_folded_normes_lots !== null);
  const servedLots = measured.reduce((sum, city) => sum + city.observed_lots!, 0);
  const foldedLots = measured.reduce((sum, city) => sum + city.folded_normes_lots!, 0);
  const missingLots = measured.reduce((sum, city) => sum + city.missing_folded_normes_lots!, 0);
  const output = {
    $schema: "immo-folded-normes-city-matrix/v1",
    as_of: date,
    _rule: {
      classifier: "complete iff every served lot has folded-normes; incomplete iff a served positive denominator has any lot without folded-normes; unknown iff no canonical committed Immo stats row or usable field stat exists; not_applicable is inherited only from the explicit six-city Immo field portfolio list.",
      completion_threshold_percent: 100,
      convention_mirrored_from: "work/immo-field-completion-matrices/immo-field-completion-matrix.json (surface_m2 and postal_code: complete iff completed_lots === observed_lots)",
      anti_invention: "A missing or malformed source row is unknown, never complete; the three noncanonical source aliases are validated against their exact canonical rows and never counted as extra cities.",
    },
    source: {
      coverageMatrix: { path: "work/coverage/coverage-matrix.json", sha256: input.sourceSha256["work/coverage/coverage-matrix.json"], generatedAt: input.sourceMeta.coverageGeneratedAt },
      immoFieldCompletionMatrix: { path: "work/immo-field-completion-matrices/immo-field-completion-matrix.json", sha256: input.sourceSha256["work/immo-field-completion-matrices/immo-field-completion-matrix.json"] },
      immoLots: { path: "work/coverage/immo-lots.json", sha256: input.sourceSha256["work/coverage/immo-lots.json"], generatedAt: input.sourceMeta.immoGeneratedAt, noncanonicalDuplicateSourceSlugs: input.sourceMeta.aliases },
    },
    counts: {
      cityStates: { complete: buckets.complete.length, incomplete: buckets.incomplete.length, unknown: buckets.unknown.length, not_applicable: buckets.not_applicable.length },
      partitionTotal: UNIVERSE,
      applicableDenominator: UNIVERSE - buckets.not_applicable.length,
      matchedServedLots: servedLots,
      matchedFoldedNormesLots: foldedLots,
      matchedMissingFoldedNormesLots: missingLots,
      matchedFoldedNormesPct: servedLots ? pct(foldedLots, servedLots) : null,
    },
    city_buckets: buckets,
    city_measurements: cities.slice().sort((left, right) => ascending(left.slug, right.slug)),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

function outputPath(date: string): string {
  return resolve(OUT_DIR, `immo-folded-normes-city-matrix-${date}.json`);
}

function writeImmutable(path: string, text: string): void {
  if (existsSync(path)) {
    invariant(readFileSync(path, "utf8") === text, `dated output already exists with different bytes: ${relative(ROOT, path)}`);
    return;
  }
  writeAtomic(path, text);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(usage());
    return;
  }
  const input = sources();
  const out = outputPath(args.date);
  if (existsSync(out) && !args.resume) {
    const existing = JSON.parse(readFileSync(out, "utf8")) as { counts?: { cityStates?: unknown } };
    console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), city_states: existing.counts?.cityStates ?? null, reused_existing_output: true }));
    return;
  }
  const cities = loadProgress(args, input.sourceSha256, input.universe);
  const deadline = Date.now() + args.maxSeconds * 1000;
  const pending = input.universe.filter((slug) => !cities.has(slug));
  for (let start = 0; start < pending.length && Date.now() < deadline; start += BATCH_SIZE) {
    for (const slug of pending.slice(start, start + BATCH_SIZE)) cities.set(slug, classify(slug, input.naSlugs, input.canonicalRows.get(slug)));
    saveProgress(args.checkpoint, args.date, input.sourceSha256, cities);
    console.error(`[immo-folded-normes] progress ${cities.size}/${UNIVERSE} checkpoint=${relative(ROOT, args.checkpoint)}`);
  }
  if (cities.size !== UNIVERSE) {
    console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), measured_cities: cities.size, remaining_cities: UNIVERSE - cities.size, resume: `--date ${args.date} --resume --max-seconds ${args.maxSeconds}` }));
    return;
  }
  const text = matrix(args.date, input, [...cities.values()]);
  writeImmutable(out, text);
  const parsed = JSON.parse(text) as { counts: { cityStates: unknown; matchedServedLots: unknown; matchedFoldedNormesLots: unknown; matchedMissingFoldedNormesLots: unknown } };
  console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), city_states: parsed.counts.cityStates, lots: { served: parsed.counts.matchedServedLots, folded: parsed.counts.matchedFoldedNormesLots, missing: parsed.counts.matchedMissingFoldedNormesLots }, checkpoint: relative(ROOT, args.checkpoint) }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
