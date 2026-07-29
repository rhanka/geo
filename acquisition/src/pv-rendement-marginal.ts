/**
 * Read-only marginal-yield measurement for completed PV/ODJ classifications.
 *
 * This reads only small local classification reports and small S3 manifests /
 * run headers. It never reads a CAS body and never writes S3. A CAS key is
 * new for a lot only when the corresponding durable manifest line says
 * `dedup: false`; if the manifest is absent, the result is null, never zero.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { getBytes, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const MAX_BYTES = 5 * 1024 * 1024;
const TARGET_PV_URLS = 45_751;

type JsonObject = Record<string, unknown>;

interface ClassifiedLine {
  manifest_key: string;
  line_index: number;
  url: string;
  storage_key: string | null;
  classification: string;
  slug?: string;
  municipality_name?: string;
}

interface ClassificationReport {
  contract: unknown;
  generated_at?: unknown;
  complete: unknown;
  scope?: { run_prefix?: unknown };
  progress?: { attempts?: unknown };
  summary?: Record<string, unknown>;
  lines: unknown;
}

interface ManifestLine extends JsonObject {
  url?: unknown;
  storage_key?: unknown;
  dedup?: unknown;
  source?: unknown;
  run_id?: unknown;
  requested_at?: unknown;
  retrieved_at?: unknown;
  http_status?: unknown;
  slugs?: unknown;
}

interface RunHeader extends JsonObject {
  run_id?: unknown;
  worklist?: unknown;
  started_at?: unknown;
  finished_at?: unknown;
  exit_code?: unknown;
  counts?: JsonObject;
}

interface LoadedReport {
  path: string;
  generated_at: string | null;
  run_prefix: string | null;
  lines: ClassifiedLine[];
}

interface ObjectRead {
  key: string;
  present: boolean;
  bytes: number | null;
  value: string | null;
}

function assertSmall(path: string, bytes: number): void {
  if (bytes > MAX_BYTES) throw new Error(`${path}: ${bytes} octets > plafond de lecture ${MAX_BYTES}`);
}

function readSmallJson(path: string): unknown {
  const bytes = statSync(path).size;
  assertSmall(path, bytes);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${context}: chaîne requise`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInt(value: unknown, context: string): number {
  if (!Number.isInteger(value)) throw new Error(`${context}: entier requis`);
  return value as number;
}

function parseManifest(text: string, key: string): ManifestLine[] {
  const lines: ManifestLine[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`${key}:${index + 1}: JSON invalide: ${String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${key}:${index + 1}: ligne non-objet`);
    }
    lines.push(parsed as ManifestLine);
  }
  return lines;
}

function lineIdentity(manifestKey: string, lineIndex: number): string {
  return `${manifestKey}\u0000${lineIndex}`;
}

function reportFiles(): string[] {
  return readdirSync(COVERAGE)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name.startsWith("pv-capture-octets-classification-") || name.startsWith("pv-ordre-du-jour-lot-"))
    .map((name) => resolve(COVERAGE, name));
}

function loadReports(): LoadedReport[] {
  const loaded: LoadedReport[] = [];
  for (const path of reportFiles()) {
    const raw = readSmallJson(path) as ClassificationReport;
    if (raw.contract !== "pv-capture-octets-classification/v1" || raw.complete !== true) continue;
    if (!Array.isArray(raw.lines)) throw new Error(`${path}: lines invalide`);
    const lines = raw.lines.map((value, index): ClassifiedLine => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: lines[${index}] invalide`);
      const line = value as Record<string, unknown>;
      return {
        manifest_key: asString(line.manifest_key, `${path}:lines[${index}].manifest_key`),
        line_index: asInt(line.line_index, `${path}:lines[${index}].line_index`),
        url: asString(line.url, `${path}:lines[${index}].url`),
        storage_key: line.storage_key === null ? null : asString(line.storage_key, `${path}:lines[${index}].storage_key`),
        classification: asString(line.classification, `${path}:lines[${index}].classification`),
        slug: asNullableString(line.slug) ?? undefined,
        municipality_name: asNullableString(line.municipality_name) ?? undefined,
      };
    });
    loaded.push({
      path,
      generated_at: asNullableString(raw.generated_at),
      run_prefix: asNullableString(raw.scope?.run_prefix),
      lines,
    });
  }

  // The same run has two local reports (a control alias and the canonical
  // report). Keep one identity set, preferring the explicit *-octets report.
  const byIdentity = new Map<string, LoadedReport[]>();
  for (const report of loaded) {
    const identities = new Set(report.lines.map((line) => lineIdentity(line.manifest_key, line.line_index)));
    const key = [...identities].sort().join("\u0001");
    const current = byIdentity.get(key) ?? [];
    current.push(report);
    byIdentity.set(key, current);
  }
  return [...byIdentity.values()].map((group) => group.sort((left, right) => {
    const leftCanonical = basename(left.path).endsWith("-octets.json") ? 0 : 1;
    const rightCanonical = basename(right.path).endsWith("-octets.json") ? 0 : 1;
    return leftCanonical - rightCanonical || left.path.localeCompare(right.path);
  })[0]!);
}

async function readSmallObject(s3: ReturnType<typeof s3Client>, key: string): Promise<ObjectRead> {
  const head = await objectHead(s3, key);
  if (!head.exists) return { key, present: false, bytes: null, value: null };
  if (head.contentLength === undefined) throw new Error(`${key}: taille S3 absente`);
  assertSmall(key, head.contentLength);
  const body = await getBytes(s3, key);
  assertSmall(key, body.byteLength);
  return { key, present: true, bytes: body.byteLength, value: body.toString("utf8") };
}

function reportKind(name: string): "pv_probable" | "ordre_du_jour" {
  if (name.includes("ordre-du-jour") || /20260729-(023400|023401|023402|035100|035102|035103|035104|035106|035107)Z/.test(name)) {
    return "ordre_du_jour";
  }
  return "pv_probable";
}

function campaignName(name: string, kind: string): string {
  if (name.includes("20260729-035")) return "odj-20260729-035100Z";
  if (name.includes("20260729-0234")) return "odj-20260729-0234";
  if (name.includes("pv-ordre-du-jour-lot")) return "odj-20260728-01";
  if (name.includes("control")) return "pv-control-20260728";
  if (name.includes("campaign-lot")) return "pv-probable-20260728-campaign";
  if (name.includes("lot-01")) return "pv-probable-20260728-lots-0100+";
  return kind;
}

function countBy<T>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedMunicipalities(
  lines: readonly ClassifiedLine[],
  manifestByIdentity: Map<string, ManifestLine>,
  manifestByUrl: Map<string, ManifestLine>,
): Array<Record<string, unknown>> {
  const bySlug = new Map<string, { attempted: number; confirmed: number; cas: Set<string>; newCas: Set<string> }>();
  for (const line of lines) {
    const slug = line.slug ?? "<null>";
    const current = bySlug.get(slug) ?? { attempted: 0, confirmed: 0, cas: new Set<string>(), newCas: new Set<string>() };
    current.attempted++;
    if (line.classification === "PV_LISIBLE_PROPRIETAIRE_CONFIRME") current.confirmed++;
    const manifest = manifestByUrl.get(`${line.manifest_key}\u0000${line.url}`)
      ?? manifestByIdentity.get(lineIdentity(line.manifest_key, line.line_index));
    if (line.storage_key) current.cas.add(line.storage_key);
    if (manifest?.storage_key && manifest.dedup === false) current.newCas.add(manifest.storage_key as string);
    bySlug.set(slug, current);
  }
  return [...bySlug.entries()]
    .sort((left, right) => right[1].attempted - left[1].attempted || left[0].localeCompare(right[0]))
    .map(([slug, value]) => ({ slug, attempted: value.attempted, confirmed: value.confirmed, cas_keys: value.cas.size, new_cas_keys: value.newCas.size }));
}

function readOdjPlan(): Map<string, number> {
  const path = resolve(COVERAGE, "pv-ordre-du-jour-2026-2025-all.json");
  const parsed = readSmallJson(path);
  if (!Array.isArray(parsed)) throw new Error(`${path}: plan ODJ non-tableau`);
  const counts = new Map<string, number>();
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const slug = typeof row.slug === "string" ? row.slug : "<null>";
    const urls = Array.isArray(row.urls) ? row.urls.filter((url): url is string => typeof url === "string") : [];
    counts.set(slug, (counts.get(slug) ?? 0) + urls.length);
  }
  return counts;
}

function enrichDispersion(rows: Array<Record<string, unknown>>, plan: Map<string, number>): void {
  for (const row of rows) {
    const municipalities = row.municipalities;
    if (!Array.isArray(municipalities)) continue;
    for (const municipality of municipalities) {
      if (!municipality || typeof municipality !== "object") continue;
      const slug = (municipality as Record<string, unknown>).slug;
      (municipality as Record<string, unknown>).plan_urls = typeof slug === "string" ? (plan.get(slug) ?? null) : null;
    }
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

async function main(): Promise<void> {
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  const md = process.argv.find((arg) => arg.startsWith("--md="))?.slice("--md=".length);
  if (!out || !md) throw new Error("--out=... et --md=... sont requis");
  const outPath = resolve(ROOT, out);
  const mdPath = resolve(ROOT, md);
  const reports = loadReports();
  const s3 = s3Client();
  const manifestCache = new Map<string, ManifestLine[] | null>();
  const runCache = new Map<string, RunHeader | null>();

  async function manifest(key: string): Promise<ManifestLine[] | null> {
    if (manifestCache.has(key)) return manifestCache.get(key)!;
    const read = await readSmallObject(s3, key);
    const value = read.present ? parseManifest(read.value!, key) : null;
    manifestCache.set(key, value);
    return value;
  }

  async function runHeader(manifestKey: string): Promise<RunHeader | null> {
    const key = `${manifestKey.slice(0, -"manifest.jsonl".length)}run.json`;
    if (runCache.has(key)) return runCache.get(key)!;
    const read = await readSmallObject(s3, key);
    const value = read.present ? JSON.parse(read.value!) as RunHeader : null;
    runCache.set(key, value);
    return value;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const report of reports) {
    const name = basename(report.path);
    const kind = reportKind(name);
    const manifests = [...new Set(report.lines.map((line) => line.manifest_key))].sort();
    const manifestByIdentity = new Map<string, ManifestLine>();
    const manifestByUrl = new Map<string, ManifestLine>();
    const missingManifests: string[] = [];
    const runHeaders: RunHeader[] = [];
    const missingRunHeaders: string[] = [];
    for (const manifestKey of manifests) {
      const parsed = await manifest(manifestKey);
      if (parsed === null) {
        missingManifests.push(manifestKey);
        continue;
      }
      for (const [index, line] of parsed.entries()) {
        manifestByIdentity.set(lineIdentity(manifestKey, index + 1), line);
        if (typeof line.url === "string") manifestByUrl.set(`${manifestKey}\u0000${line.url}`, line);
      }
      const header = await runHeader(manifestKey);
      if (header === null) missingRunHeaders.push(`${manifestKey.slice(0, -"manifest.jsonl".length)}run.json`);
      else runHeaders.push(header);
    }

    const allCas = new Set<string>();
    const newCas = new Set<string>();
    const reusedCas = new Set<string>();
    const unknownDedupCas = new Set<string>();
    const manifestMismatches: string[] = [];
    for (const line of report.lines) {
      if (line.storage_key) allCas.add(line.storage_key);
      const source = manifestByUrl.get(`${line.manifest_key}\u0000${line.url}`)
        ?? manifestByIdentity.get(lineIdentity(line.manifest_key, line.line_index));
      if (!source) continue;
      if (source.url !== line.url || (source.storage_key ?? null) !== line.storage_key) {
        manifestMismatches.push(lineIdentity(line.manifest_key, line.line_index));
        continue;
      }
      if (!source.storage_key) continue;
      if (source.dedup === false) newCas.add(source.storage_key);
      else if (source.dedup === true) reusedCas.add(source.storage_key);
      else unknownDedupCas.add(source.storage_key);
    }
    if (manifestMismatches.length > 0) throw new Error(`${name}: divergences classification/manifeste: ${manifestMismatches.length}`);

    const categories = countBy(report.lines.map((line) => line.classification));
    const attempts = report.lines.length;
    const categoryTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
    if (categoryTotal !== attempts) throw new Error(`${name}: partition classification invalide`);
    const started = runHeaders.map((header) => typeof header.started_at === "string" ? header.started_at : null).filter((value): value is string => value !== null).sort()[0] ?? report.generated_at;
    const finished = runHeaders.map((header) => typeof header.finished_at === "string" ? header.finished_at : null).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const exitCodes = runHeaders.map((header) => header.exit_code).filter((value): value is number => Number.isInteger(value));
    const newCasCount = missingManifests.length > 0 ? null : newCas.size;
    const municipalityRows = sortedMunicipalities(report.lines, manifestByIdentity, manifestByUrl);
    rows.push({
      lot: name,
      kind,
      campaign: campaignName(name, kind),
      chronological_started_at: started,
      finished_at: finished,
      run_count: manifests.length,
      run_ids: [...new Set(runHeaders.map((header) => typeof header.run_id === "string" ? header.run_id : null).filter((value): value is string => value !== null))].sort(),
      exit_codes: exitCodes,
      url_attempted: attempts,
      url_distinct: new Set(report.lines.map((line) => line.url)).size,
      confirmed_at_opening: categories.PV_LISIBLE_PROPRIETAIRE_CONFIRME ?? 0,
      confirmed_rate_on_attempts_percent: Number((((categories.PV_LISIBLE_PROPRIETAIRE_CONFIRME ?? 0) / attempts) * 100).toFixed(2)),
      classification_partition: categories,
      cas_keys_observed: allCas.size,
      cas_keys_new: newCasCount,
      cas_keys_reused: missingManifests.length > 0 ? null : reusedCas.size,
      cas_keys_dedup_unknown: missingManifests.length > 0 ? null : unknownDedupCas.size,
      new_cas_per_attempted_url: newCasCount === null ? null : Number((newCasCount / attempts).toFixed(6)),
      s3_evidence: {
        manifest_keys: manifests,
        manifests_present: manifests.length - missingManifests.length,
        manifests_missing: missingManifests,
        run_headers_missing: missingRunHeaders,
        line_identity_match_count: report.lines.filter((line) => manifestByIdentity.has(lineIdentity(line.manifest_key, line.line_index))).length,
        line_url_match_count: report.lines.filter((line) => manifestByUrl.has(`${line.manifest_key}\u0000${line.url}`)).length,
      },
      municipalities: municipalityRows,
    });
  }

  rows.sort((left, right) => String(left.chronological_started_at ?? "").localeCompare(String(right.chronological_started_at ?? "")) || String(left.lot).localeCompare(String(right.lot)));
  const series = rows.map((row) => ({
    lot: row.lot,
    kind: row.kind,
    started_at: row.chronological_started_at,
    url_attempted: row.url_attempted,
    confirmed_at_opening: row.confirmed_at_opening,
    cas_keys_new: row.cas_keys_new,
    new_cas_per_attempted_url: row.new_cas_per_attempted_url,
  }));
  const latestOdj = rows.filter((row) => row.campaign === "odj-20260729-035100Z");
  const plan = readOdjPlan();
  enrichDispersion(latestOdj, plan);
  const latestMunicipalities = new Set(latestOdj.flatMap((row) => Array.isArray(row.municipalities) ? row.municipalities.map((value) => (value as Record<string, unknown>).slug) : []).filter((value): value is string => typeof value === "string"));
  const latestAttempted = latestOdj.reduce((sum, row) => sum + Number(row.url_attempted), 0);
  const latestNew = latestOdj.every((row) => row.cas_keys_new !== null) ? latestOdj.reduce((sum, row) => sum + Number(row.cas_keys_new), 0) : null;
  const latestPlanCounts = [...latestMunicipalities].map((slug) => plan.get(slug) ?? null).filter((value): value is number => value !== null);

  const report = {
    contract: "pv-rendement-marginal-cas/v1",
    generated_at: new Date().toISOString(),
    read_only: { s3_writes: false, capture: false, kubectl: false, raw_writes: false, capture_runs_writes: false, normalized_writes: false },
    unit: {
      attempted: "classification report lines (pv-index URLs), not robots.txt lines",
      confirmed_at_opening: "classification exactly PV_LISIBLE_PROPRIETAIRE_CONFIRME",
      new_cas_keys: "distinct storage_key on matched S3 manifest lines with dedup=false; null when the manifest is absent",
    },
    scope: {
      reports_discovered: reportFiles().length,
      completed_reports_used: rows.length,
      duplicate_local_reports_excluded: loadedReportDuplicateCount(reports),
      chronology: "minimum run.json started_at; generated_at only as fallback",
      partition: "each report classification categories sum exactly to url_attempted",
    },
    series,
    lots: rows,
    municipal_dispersion_test: {
      target_campaign: "odj-20260729-035100Z",
      plan_source: "work/coverage/pv-ordre-du-jour-2026-2025-all.json",
      plan_urls: 3058,
      latest_attempted_urls: latestAttempted,
      latest_new_cas_keys: latestNew,
      latest_distinct_municipalities: latestMunicipalities.size,
      latest_plan_urls_per_sampled_municipality_median: median(latestPlanCounts),
      latest_lot_rows: latestOdj.map((row) => ({ lot: row.lot, municipalities: row.municipalities })),
      interpretation: "La dispersion est une preuve de composition et d'ordre de parcours, pas un test suffisant pour séparer saturation et biais: les six lots sont une sélection contiguë/non aléatoire; aucun chiffre global n'est extrapolé.",
    },
    distinct_document_estimate: {
      target_population: { class: "pv_probable", url_count: TARGET_PV_URLS },
      estimate: null,
      conclusion: "on ne peut pas savoir honnêtement avec les preuves actuelles",
      observed_lower_bound: { distinct_cas_keys: 4719, source: "docs/reports/PV_CAPTURE_CAMPAIGN_AUDIT_20260728.md" },
      observed_pv_campaign_sample: { canonical_urls: 5350, distinct_cas_keys: 4719, descriptive_cas_per_url: Number((4719 / 5350).toFixed(6)), source: "docs/reports/PV_CAPTURE_CAMPAIGN_AUDIT_20260728.md" },
      cross_class_probe: { odj_attempted_urls: latestAttempted, odj_confirmed: 220, odj_durable_cas_keys: 296, odj_new_cas_keys: 7, source: "work/coverage/pv-capture-ordre-du-jour-20260729-035100Z-aggregate.json" },
      why_no_extrapolation: [
        "La campagne PV observée n'est pas un échantillon aléatoire documenté du corpus 45 751.",
        "Le probe ODJ est ordonné par municipalité et mesure surtout un recouvrement inter-classes; il ne mesure pas la redondance interne de pv_probable.",
        "Les blocs 0108--0111 sont documentés comme redondants avec 0104--0107, donc une extrapolation naïve serait biaisée.",
      ],
      required_for_estimate: "capturer et classifier un échantillon aléatoire ou stratifié de nouvelles URL pv_probable, avec manifests CAS conservés; la taille N ne peut pas être honnêtement fixée à partir de ce seul échantillon biaisé.",
    },
    provenance: {
      local_report_paths: rows.map((row) => `work/coverage/${row.lot}`),
      s3_bucket: "sentropic-geo",
      s3_objects_read: "only manifest.jsonl and run.json named by the local reports; each HEAD and body checked <= 5 MiB",
      large_kpi_files: "not read; no stream or line dump used",
    },
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const latestSeries = series.filter((row) => row.lot.includes("20260729-035"));
  const markdown = [
    "# Rendement marginal CAS — PV / ODJ",
    "",
    `Mesure UTC : ${report.generated_at}. Lecture seule; ${rows.length} rapports complets utilisés; chaque partition de classification est fermée.`,
    "",
    "## Série cles CAS nouvelles / URL tentées",
    "",
    `Toutes les lignes sont dans le JSON. Dernier probe ODJ (six lots) : ${latestSeries.map((row) => `${row.lot.replace(/.*classification-/, "")}=${row.cas_keys_new === null ? "null" : row.cas_keys_new}/${row.url_attempted}`).join(", ")}.`,
    "",
    "`null` signifie que le manifeste S3 requis est absent; ce n'est pas zéro.",
    "",
    "## Verdict",
    "",
    `Le probe ODJ est 7 nouvelles clés CAS sur 296 durables et 300 URL tentées; sa composition est municipale et séquentielle, donc elle prouve un recouvrement, pas une saturation globale. Dispersion du dernier probe : ${latestMunicipalities.size} municipalités; médiane du nombre d'URL ODJ du plan par municipalité ${median(latestPlanCounts) ?? "null"}.`,
    "",
    "Nombre de documents distincts derrière 45 751 URL : **on ne peut pas savoir honnêtement** avec ces preuves. Plancher observé : 4 719 clés CAS sur 5 350 URL canoniques de la campagne PV auditée; aucune extrapolation.",
    "",
    `Voir le JSON pour les lotissements, partitions, municipalités, manifests manquants et limites : ${relative(ROOT, outPath)}.`,
    "",
  ].join("\n");
  writeFileSync(mdPath, markdown);
  process.stdout.write(JSON.stringify({ out: relative(ROOT, outPath), md: relative(ROOT, mdPath), lots: rows.length, latest_series: latestSeries, latest_municipalities: latestMunicipalities.size }, null, 2) + "\n");
}

function loadedReportDuplicateCount(reports: readonly LoadedReport[]): number {
  const identities = new Set<string>();
  let duplicates = 0;
  for (const report of reports) {
    const key = report.lines.map((line) => lineIdentity(line.manifest_key, line.line_index)).sort().join("\u0001");
    if (identities.has(key)) duplicates++;
    identities.add(key);
  }
  return duplicates;
}

await main();
