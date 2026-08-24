/**
 * pv-cohorte-gaps.ts — croise une liste de cohorte (slugs) avec la couverture PV
 * mesurée et émet les GAPS PV in-cohorte (munis de la cohorte NON couvertes).
 *
 * Recentre l'effort PV sur la cohorte (directive geo-cond) plutôt que la traîne
 * /1106. Consomme :
 *   - une liste de cohorte : TSV (`rank<TAB>graph_city_slug`, en-tête ignoré) via
 *     --cohort-tsv, OU un JSON tableau de {slug} / tableau de chaînes via --cohort-json ;
 *   - un rapport de couverture pv-couverture-municipale/v1 (--coverage), dont
 *     `municipal_coverage.slugs[].slug` fait foi pour le couvert.
 *
 * LECTURE SEULE. Émet le partitionnement in-cohorte (couvert / non-couvert) ;
 * les gaps sont la file de travail à durcir (HEAD-probe) puis capturer.
 *
 * Usage :
 *   npx tsx acquisition/src/pv-cohorte-gaps.ts \
 *     --cohort-tsv work/coverage/zoning-events-col20-167-s3gt-20260803.audit/cohort-167.tsv \
 *     --coverage work/coverage/pv-couverture-municipale-<UTC>.json \
 *     --out work/coverage/pv-cohorte-gaps-<UTC>.json
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/u;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function insideRepo(path: string, name: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`--${name} doit rester dans le dépôt`);
  return absolute;
}

function cohortFromTsv(path: string): string[] {
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const slugs: string[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    const candidate = (cols[1] ?? cols[0] ?? "").trim();
    if (candidate === "graph_city_slug" || candidate === "slug" || !candidate) continue;
    if (!SLUG_RE.test(candidate)) continue;
    slugs.push(candidate);
  }
  return slugs;
}

function cohortFromJson(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as { slugs?: unknown; municipalities?: unknown }).slugs
      ?? (parsed as { municipalities?: unknown }).municipalities;
  if (!Array.isArray(arr)) throw new Error("--cohort-json: tableau attendu (ou {slugs}/{municipalities})");
  return arr.map((v) => (typeof v === "string" ? v : (v as { slug?: unknown }).slug))
    .filter((v): v is string => typeof v === "string" && SLUG_RE.test(v));
}

function coveredSlugs(path: string): Set<string> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    contract?: string;
    municipal_coverage?: { slugs?: Array<{ slug?: unknown }> };
  };
  if (parsed.contract !== "pv-couverture-municipale/v1") throw new Error("--coverage: contrat pv-couverture-municipale/v1 attendu");
  const slugs = parsed.municipal_coverage?.slugs;
  if (!Array.isArray(slugs)) throw new Error("--coverage: municipal_coverage.slugs manquant");
  return new Set(slugs.map((s) => String(s.slug)).filter((s) => SLUG_RE.test(s)));
}

function main(): void {
  const tsv = arg("cohort-tsv");
  const json = arg("cohort-json");
  const coveragePath = arg("coverage");
  const outArg = arg("out");
  if ((tsv === undefined) === (json === undefined)) throw new Error("un seul de --cohort-tsv ou --cohort-json requis");
  if (!coveragePath || !outArg) throw new Error("--coverage et --out requis");
  const out = insideRepo(outArg, "out");
  if (!out.startsWith(`${COVERAGE}/`) || !out.endsWith(".json")) throw new Error("--out doit être un JSON sous work/coverage");
  if (existsSync(out)) throw new Error(`artefact déjà présent: ${out}`);

  const cohortList = tsv !== undefined ? cohortFromTsv(insideRepo(tsv, "cohort-tsv")) : cohortFromJson(insideRepo(json!, "cohort-json"));
  const cohort = [...new Set(cohortList)];
  const covered = coveredSlugs(insideRepo(coveragePath, "coverage"));

  const inCohortCovered = cohort.filter((s) => covered.has(s)).sort();
  const inCohortGaps = cohort.filter((s) => !covered.has(s)).sort();

  const report = {
    contract: "pv-cohorte-gaps/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    cohort_source: tsv ?? json,
    coverage_source: coveragePath,
    cohort_size: cohort.length,
    in_cohort_covered: inCohortCovered.length,
    in_cohort_gaps: inCohortGaps.length,
    gaps: inCohortGaps,
    covered: inCohortCovered,
  };
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(tmp, out);
  process.stdout.write(`${JSON.stringify({ out: out.slice(ROOT.length + 1), cohort_size: cohort.length, in_cohort_covered: inCohortCovered.length, in_cohort_gaps: inCohortGaps.length, gaps: inCohortGaps }, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  }
}
