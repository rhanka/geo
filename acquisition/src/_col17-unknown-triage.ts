/**
 * Diagnostic triage of the col-17 (Immo civic address) unknowns on the
 * priorityRank <= 167 subset.  Read-only over committed artifacts — no S3, no
 * network.  It answers one owner question: of the col-17 unknowns, which are
 * actionable by a geo-side fold, and which are gated upstream on col-14 (the
 * served qc-lots deposit owned by immo)?
 *
 * Inputs (all committed):
 *   - work/coverage/immo-adresse-completion-matrix-<date>.json  (col 17)
 *   - work/coverage/qc-lots-coverage-dump-167-<date>.json       (col 14)
 *   - packages/qc-sources/src/geo/municipalities.qc.json        (name/pop)
 *
 * Partition of the subset_167 unknown bucket:
 *   - absent_served_collection : no qc-lots served in either layout
 *       (dump present:false) — cannot fold an address into a lot that is not
 *       served; resolution is an immo qc-lots deposit (col 14).
 *   - served_but_unresolved    : a qc-lots collection IS served but col-17
 *       could not classify it (e.g. MAMH role overlap below the anti-invention
 *       gate).  For each we surface the served feature count against the
 *       registry population so an identity/contamination defect in the served
 *       collection is visible.
 *
 * The foldable count on the subset is reported verbatim from the matrix: it is
 * the ONLY quantity that a geo-side re-fold could convert to complete.  When it
 * is 0, no col-17 fold changes any unknown and the entire remainder is gated on
 * col-14.
 *
 * Usage:
 *   npx tsx acquisition/src/_col17-unknown-triage.ts \
 *     --matrix work/coverage/immo-adresse-completion-matrix-20260802.json \
 *     --dump   work/coverage/qc-lots-coverage-dump-167-20260803.json \
 *     --date   20260803
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
const OUT_DIR = resolve(ROOT, "work/coverage");
const SUBSET = 167;

interface Args {
  matrix: string;
  dump: string;
  date: string;
}

interface Measurement {
  slug: string;
  etat: string;
  reason: string;
  served_layout: string | null;
  served_geojson_key: string | null;
  lots_served: number | null;
}

function fail(message: string): never {
  throw new Error(`_col17-unknown-triage: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  invariant(Array.isArray(value), `${label} must be an array`);
  return value;
}

function ascending(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readJson(path: string): { text: string; value: unknown } {
  invariant(existsSync(path), `input file is absent: ${relative(ROOT, path)}`);
  const text = readFileSync(path, "utf8");
  return { text, value: JSON.parse(text) as unknown };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

function parseArgs(argv: readonly string[]): Args {
  let matrix: string | undefined;
  let dump: string | undefined;
  let date: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    const key = token.startsWith("--") ? token.slice(2) : "";
    const value = argv[++index];
    if (!value || !["matrix", "dump", "date"].includes(key)) fail(`unknown or incomplete option ${token}`);
    if (key === "matrix") matrix = value;
    else if (key === "dump") dump = value;
    else date = value;
  }
  invariant(matrix && dump, "--matrix and --dump are required");
  invariant(date && /^\d{8}$/u.test(date), "--date must be YYYYMMDD");
  return { matrix: resolve(ROOT, matrix), dump: resolve(ROOT, dump), date };
}

function loadMatrix(value: unknown): { unknownSubset: string[]; foldableSubset: number; states: Record<string, number>; measurements: Map<string, Measurement> } {
  const matrix = record(value, "matrix");
  const subset = record(matrix["subset_167"], "matrix.subset_167");
  invariant(subset["cardinality"] === SUBSET, `matrix subset cardinality must be ${SUBSET}`);
  const buckets = record(subset["city_buckets"], "matrix.subset_167.city_buckets");
  const states = record(subset["city_states"], "matrix.subset_167.city_states");
  const unknownSubset = asArray(buckets["unknown"], "subset unknown bucket").map((slug) => {
    invariant(typeof slug === "string", "unknown slug must be a string");
    return slug;
  });
  const measurements = new Map<string, Measurement>();
  for (const raw of asArray(matrix["city_measurements"], "matrix.city_measurements")) {
    const city = record(raw, "city measurement");
    const slug = city["slug"];
    invariant(typeof slug === "string", "measurement has no slug");
    measurements.set(slug, {
      slug,
      etat: String(city["etat"]),
      reason: String(city["reason"]),
      served_layout: typeof city["served_layout"] === "string" ? city["served_layout"] : null,
      served_geojson_key: typeof city["served_geojson_key"] === "string" ? city["served_geojson_key"] : null,
      lots_served: typeof city["lots_served"] === "number" ? city["lots_served"] : null,
    });
  }
  return {
    unknownSubset,
    foldableSubset: Number(states["foldable"]),
    states: {
      complete: Number(states["complete"]),
      foldable: Number(states["foldable"]),
      unknown: Number(states["unknown"]),
      "N/A": Number(states["N/A"]),
    },
    measurements,
  };
}

function loadDump(value: unknown): Map<string, { present: boolean; numberMatched: number | null }> {
  const dump = record(value, "dump");
  const rows = asArray(dump["municipalities"], "dump.municipalities");
  const byslug = new Map<string, { present: boolean; numberMatched: number | null }>();
  for (const raw of rows) {
    const row = record(raw, "dump row");
    const slug = row["slug"];
    invariant(typeof slug === "string", "dump row has no slug");
    byslug.set(slug, {
      present: row["present"] === true,
      numberMatched: typeof row["numberMatched"] === "number" ? row["numberMatched"] : null,
    });
  }
  invariant(byslug.size === SUBSET, `dump must carry ${SUBSET} rows, got ${byslug.size}`);
  return byslug;
}

function loadRegistry(value: unknown): Map<string, { name: string; population: number | null }> {
  const rows = asArray(value, "registry");
  const byslug = new Map<string, { name: string; population: number | null }>();
  for (const raw of rows) {
    const row = record(raw, "registry row");
    const slug = row["slug"];
    if (typeof slug !== "string") continue;
    byslug.set(slug, {
      name: typeof row["name"] === "string" ? row["name"] : slug,
      population: typeof row["population"] === "number" ? row["population"] : null,
    });
  }
  return byslug;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const matrixInput = readJson(args.matrix);
  const dumpInput = readJson(args.dump);
  const registryInput = readJson(REGISTRY);

  const { unknownSubset, foldableSubset, states, measurements } = loadMatrix(matrixInput.value);
  const dump = loadDump(dumpInput.value);
  const registry = loadRegistry(registryInput.value);

  invariant(states.unknown === unknownSubset.length, "matrix unknown count disagrees with its own bucket length");
  invariant(states.complete + states.foldable + states.unknown + states["N/A"] === SUBSET, "matrix subset states do not close on 167");

  const absentServed: string[] = [];
  const servedButUnresolved: Array<Record<string, unknown>> = [];
  for (const slug of unknownSubset) {
    const served = dump.get(slug);
    invariant(served, `col-17 unknown ${slug} is outside the col-14 dump universe`);
    const measurement = measurements.get(slug);
    invariant(measurement, `col-17 unknown ${slug} has no city measurement`);
    if (!served.present) {
      absentServed.push(slug);
      continue;
    }
    const reg = registry.get(slug) ?? { name: slug, population: null };
    const lots = measurement.lots_served ?? served.numberMatched;
    servedButUnresolved.push({
      slug,
      name: reg.name,
      population: reg.population,
      served_layout: measurement.served_layout,
      served_geojson_key: measurement.served_geojson_key,
      lots_served: lots,
      lots_per_capita: reg.population && reg.population > 0 && typeof lots === "number" ? Math.round((lots / reg.population) * 10) / 10 : null,
      matrix_reason: measurement.reason,
      identity_anomaly:
        reg.population !== null && reg.population > 0 && typeof lots === "number" && lots > reg.population * 20
          ? "Served feature count is grossly disproportionate to municipal population — probable served-collection identity/contamination defect (col-14 serving)."
          : null,
      gated_on: "col-14 (immo): served qc-lots collection must be corrected/re-identified before col-17 can classify.",
    });
  }
  absentServed.sort(ascending);

  invariant(absentServed.length + servedButUnresolved.length === unknownSubset.length, "triage partition does not close on the unknown bucket");

  const geoSideActionable = foldableSubset; // only foldable cities can be turned complete by a geo-side re-fold
  const triage = {
    $schema: "col17-unknown-triage/v1",
    as_of: args.date,
    read_only: true,
    _rule: {
      question: "Of the col-17 (Immo civic address) unknowns on priorityRank<=167, which are convertible to complete by a geo-side fold, and which are gated upstream on the col-14 served qc-lots deposit (immo)?",
      geo_side_convertible: "A city is convertible by a geo-side re-fold only when the col-17 matrix classifies it foldable (a served lot has a non-null MAMH role address not yet folded). foldable=0 on the subset means no unknown is convertible geo-side.",
      absent_served_collection: "col-17 unknown whose col-14 dump present:false: no qc-lots is served in either layout, so there is no served lot to attach an address to. Resolution is an immo qc-lots deposit (col 14), not a geo-side fold.",
      served_but_unresolved: "col-17 unknown whose col-14 dump present:true: a served collection exists but the anti-invention gate refused a classification. Population vs served-feature count is surfaced to expose an identity/contamination defect in the served collection.",
      anti_invention: "No unknown is relabelled complete or N/A here. This triage only partitions unknowns by their upstream blocker; it writes nothing to S3.",
    },
    sources: [
      { role: "col17_adresse_matrix", path: relative(ROOT, args.matrix), sha256: sha256(matrixInput.text) },
      { role: "col14_qc_lots_dump", path: relative(ROOT, args.dump), sha256: sha256(dumpInput.text) },
      { role: "municipality_registry", path: relative(ROOT, REGISTRY), sha256: sha256(registryInput.text) },
    ],
    subset_167_col17_states: states,
    resolved_167: states.complete + states["N/A"],
    unknown_167: states.unknown,
    geo_side_convertible_now: geoSideActionable,
    gated_on_col14_immo: {
      total: unknownSubset.length,
      absent_served_collection: {
        count: absentServed.length,
        slugs: absentServed,
        resolution: "immo deposits qc-lots for these municipalities (col 14); col-17 re-runs then reclassify.",
      },
      served_but_unresolved: {
        count: servedButUnresolved.length,
        cities: servedButUnresolved,
        resolution: "immo corrects/re-identifies the served qc-lots collection (col 14); col-17 re-runs then reclassify.",
      },
    },
  };

  const outJson = resolve(OUT_DIR, `col17-unknown-triage-${args.date}.json`);
  const outMd = resolve(OUT_DIR, `col17-unknown-triage-${args.date}.md`);
  writeAtomic(outJson, `${JSON.stringify(triage, null, 2)}\n`);

  const md = [
    "# Col-17 (adresse Immo) — triage des unknowns du sous-ensemble 167",
    "",
    `Instantané ${args.date}. Lecture seule sur artefacts committés ; aucune écriture S3.`,
    "",
    `Col-17 sur 167 : **${states.complete} complete + ${states["N/A"]} N/A = ${triage.resolved_167} résolus**, ${states.unknown} unknown, ${states.foldable} foldable.`,
    "",
    `Convertible par un fold côté geo **maintenant** : **${geoSideActionable}** (= foldable). ` +
      `Les ${unknownSubset.length} unknowns sont donc **intégralement gated sur le col-14 (immo)** :`,
    "",
    "| Blocage col-14 | Villes |",
    "| --- | ---: |",
    `| Aucune collection qc-lots servie (present:false) | ${absentServed.length} |`,
    `| Collection servie mais non résolvable (défaut d'identité/serving) | ${servedButUnresolved.length} |`,
    "",
    "## Servie mais non résolvable",
    "",
    "| slug | pop | lots servis | lots/hab | anomalie |",
    "| --- | ---: | ---: | ---: | --- |",
    ...servedButUnresolved.map((city) =>
      `| ${city["slug"]} | ${city["population"] ?? "?"} | ${city["lots_served"] ?? "?"} | ${city["lots_per_capita"] ?? "?"} | ${city["identity_anomaly"] ? "identité" : "-"} |`,
    ),
    "",
    "## Aucune collection qc-lots servie (immo doit déposer)",
    "",
    absentServed.join(", ") + ".",
    "",
    "Conclusion : aucun re-fold col-17 côté geo ne convertit un unknown (foldable=0). " +
      "La frontière col-17 est le dépôt/identité qc-lots (col 14, immo). Le générateur col-17 " +
      "reclassera automatiquement dès qu'immo dépose/corrige les collections servies.",
    "",
  ].join("\n");
  writeAtomic(outMd, md);

  console.log(
    JSON.stringify({
      complete: true,
      json: relative(ROOT, outJson),
      md: relative(ROOT, outMd),
      resolved_167: triage.resolved_167,
      unknown_167: states.unknown,
      geo_side_convertible_now: geoSideActionable,
      absent_served: absentServed.length,
      served_but_unresolved: servedButUnresolved.length,
    }),
  );
}

main();
