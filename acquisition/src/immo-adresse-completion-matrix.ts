/**
 * Build the dated, closed city partition for Immo civic-address completion.
 *
 * This is an analysis-only runner: it reads the geo-api authoritative
 * qc-lots layout (nested before flat) and the public MAMH role XML, then
 * compares every served lot's `adresse` to the exact `parseRole` result that
 * `lots-enriched-run.ts` folds.  It never writes served data; its only S3 write
 * is the capture manifest that the chokepoint emits for the MAMH role fetch
 * (`store: false` — the raw role XML is not deposited).
 *
 * Memory discipline: one municipality is fetched, parsed, classified and
 * released before the next one.  Only `NO_LOT`/`adresse` observations are kept
 * from a served GeoJSON; geometry is never retained.  A content-length guard
 * makes an oversized object an honest `unknown`, never an OOM gamble.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/immo-adresse-completion-matrix.ts \
 *       --date 20260802 --max-seconds 55
 *   ... --resume                    # continue the local checkpoint
 *   ... --checkpoint <path>         # choose a different local checkpoint
 *   ... --help
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import {
  capturedFetch,
  CapturedFetchError,
  NODE_FETCH_DEFAULT_MAX_REDIRECTS,
  type CaptureRun,
} from "../../packages/qc-sources/src/capture/index.js";
import { openCaptureRun } from "./lib/capture-s3.js";
import { DEFAULT_MILLESIME, fetchIndex, parseRole, type IndexEntry, type RoleAttrs } from "./role-foncier.js";
import { getBytes, objectHead, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE = resolve(ROOT, "work/coverage/coverage-matrix.json");
const IMMO_FIELDS = resolve(ROOT, "work/immo-field-completion-matrices/immo-field-completion-matrix.json");
const IMMO_LOTS = resolve(ROOT, "work/coverage/immo-lots.json");
const BPRIME_REFERENCE = resolve(ROOT, "work/coverage/_refold-normes-bprime-slugs.txt");
const MUNICIPALITIES = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
const OUT_DIR = resolve(ROOT, "work/coverage");
const CACHE_DIR = resolve(ROOT, ".cache");
const UNIVERSE = 1106;
const DEFAULT_MAX_MB = 1024;
/** The role parser supports Montréal's huge XML, but this matrix must remain
 *  safe alongside a served GeoJSON in a one-municipality worker. */
const MAX_ROLE_MB = 512;
const ROLE_URL = (codeGeo: string) => `https://donneesouvertes.affmunqc.net/role/RL${codeGeo}_${DEFAULT_MILLESIME}.xml`;
/** UA that the naked global `fetch` already sent before this call was captured. */
const NODE_FETCH_USER_AGENT = "undici";

type State = "complete" | "foldable" | "unknown" | "N/A";
type ServedLayout = "subdirectory" | "flat" | null;
type NoLotVerbatim = string | number | boolean | null;

interface RegistryMuni {
  slug?: unknown;
  name?: unknown;
  priorityRank?: unknown;
}

interface RoleAbsentExample {
  no_lot_verbatim: NoLotVerbatim;
  no_lot_key: string;
  reason: "role_lookup_absent" | "role_adresse_null";
}

interface CityMeasurement {
  slug: string;
  etat: State;
  reason: string;
  served_layout: ServedLayout;
  served_geojson_key: string | null;
  served_geojson_etag: string | null;
  role_code_geo: string | null;
  role_resolution_note: string | null;
  lots_served: number | null;
  lots_matches: number | null;
  adresse_servie: number | null;
  role_a_adresse_non_servie: number | null;
  role_sans_adresse: number | null;
  lots_unknown: number | null;
  role_sans_adresse_examples: RoleAbsentExample[];
}

interface Progress {
  contract: "immo-adresse-completion-progress/v1";
  as_of_date: string;
  source_sha256: Record<string, string>;
  cities: CityMeasurement[];
}

interface Args {
  date: string;
  maxSeconds: number;
  maxMb: number;
  resume: boolean;
  checkpoint: string;
}

interface LocalInputs {
  universe: string[];
  naSlugs: Set<string>;
  municipalityBySlug: Map<string, { name: string; priorityRank: number | null }>;
  priority167: string[];
  sourceSha256: Record<string, string>;
  sourceMeta: Record<string, unknown>[];
}

interface LotObservation {
  noLotKey: string | null;
  noLotVerbatim: NoLotVerbatim;
  adresse: "present" | "absent" | "malformed";
}

interface RoleResolution {
  codeGeo: string;
  roleMap: Record<string, RoleAttrs>;
  overlap: number;
}

class TimeboxExceeded extends Error {
  constructor() {
    super("Invocation time budget reached; resume from the checkpoint.");
    this.name = "TimeboxExceeded";
  }
}

function fail(message: string): never {
  throw new Error(`immo-adresse-completion-matrix: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function ascending(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readJson(path: string): { text: string; value: unknown } {
  const text = readFileSync(path, "utf8");
  return { text, value: JSON.parse(text) as unknown };
}

function dateToday(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function usage(): string {
  return [
    "Usage: npx tsx acquisition/src/immo-adresse-completion-matrix.ts [options]",
    "  --date YYYYMMDD       Date embedded in the immutable output (default: today)",
    "  --max-seconds N       Wall-time cap for this invocation (default: 55)",
    `  --max-mb N            Per-object memory guard in MiB (default: ${DEFAULT_MAX_MB})`,
    "  --resume              Resume the compatible local checkpoint",
    "  --checkpoint PATH     Local checkpoint path (default: .cache/...)",
    "  --help                Show this help",
    "",
    "Reads S3 and MAMH roles; the MAMH fetch is captured through the chokepoint, whose only S3 write is a capture manifest (store:false deposits no raw bytes and never writes served data). Otherwise writes only local checkpoint/output files.",
    "The served qc-lots nested layout is authoritative when nested and flat both exist.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args | null {
  let date = dateToday();
  let maxSeconds = 55;
  let maxMb = DEFAULT_MAX_MB;
  let resume = false;
  let checkpoint: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--help") return null;
    if (token === "--resume") {
      resume = true;
      continue;
    }
    const inline = token.match(/^--(date|max-seconds|max-mb|checkpoint)=(.+)$/u);
    const key = inline?.[1] ?? (token.startsWith("--") ? token.slice(2) : "");
    const value = inline?.[2] ?? argv[++index];
    if (!value || !["date", "max-seconds", "max-mb", "checkpoint"].includes(key)) {
      fail(`unknown or incomplete option ${token}`);
    }
    if (key === "date") date = value;
    else if (key === "max-seconds") maxSeconds = Number(value);
    else if (key === "max-mb") maxMb = Number(value);
    else checkpoint = value;
  }
  invariant(/^\d{8}$/u.test(date), "--date must be YYYYMMDD");
  invariant(Number.isFinite(maxSeconds) && maxSeconds > 0, "--max-seconds must be a positive number");
  invariant(Number.isFinite(maxMb) && maxMb > 0, "--max-mb must be a positive number");
  return {
    date,
    maxSeconds,
    maxMb,
    resume,
    checkpoint: checkpoint
      ? resolve(ROOT, checkpoint)
      : resolve(CACHE_DIR, `immo-adresse-completion-${date}.progress.json`),
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

function outputPath(date: string): string {
  return resolve(OUT_DIR, `immo-adresse-completion-matrix-${date}.json`);
}

function markdownPath(date: string): string {
  return resolve(OUT_DIR, `immo-adresse-completion-matrix-${date}.md`);
}

function writeImmutable(path: string, text: string): void {
  if (existsSync(path)) {
    invariant(readFileSync(path, "utf8") === text, `dated output already exists with different bytes: ${relative(ROOT, path)}`);
    return;
  }
  writeAtomic(path, text);
}

function sources(): LocalInputs {
  const coverage = readJson(COVERAGE);
  const fields = readJson(IMMO_FIELDS);
  const lots = readJson(IMMO_LOTS);
  const bprime = readFileSync(BPRIME_REFERENCE, "utf8");
  const registry = readJson(MUNICIPALITIES);

  const coverageValue = record(coverage.value, "coverage matrix");
  const coverageCities = record(coverageValue["cities"], "coverage matrix.cities");
  invariant(coverageValue["municipalityCount"] === UNIVERSE, `coverage municipalityCount must be ${UNIVERSE}`);
  const universe = Object.keys(coverageCities).sort(ascending);
  invariant(universe.length === UNIVERSE, `coverage matrix has ${universe.length} city rows, expected ${UNIVERSE}`);
  const universeSet = new Set(universe);

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
  for (const slug of naSlugs) invariant(universeSet.has(slug), `N/A city ${slug} is outside the canonical universe`);

  const lotsValue = record(lots.value, "immo lots snapshot");
  const perMuni = lotsValue["perMuni"];
  invariant(Array.isArray(perMuni), "immo lots snapshot.perMuni must be an array");
  const zeroLotSlugs = new Set<string>();
  for (const raw of perMuni) {
    const row = record(raw, "immo lots row");
    if (row["numLots"] === 0 && typeof row["slug"] === "string") zeroLotSlugs.add(row["slug"]);
  }
  invariant(JSON.stringify([...zeroLotSlugs].sort(ascending)) === JSON.stringify([...naSlugs].sort(ascending)), "explicit N/A list drifted from zero-lot Immo snapshot");

  invariant(Array.isArray(registry.value), "municipalities registry must be an array");
  const municipalityBySlug = new Map<string, { name: string; priorityRank: number | null }>();
  for (const raw of registry.value as RegistryMuni[]) {
    invariant(typeof raw.slug === "string" && raw.slug.length > 0, "municipality registry row has no slug");
    invariant(typeof raw.name === "string" && raw.name.length > 0, `municipality registry ${raw.slug} has no name`);
    invariant(!municipalityBySlug.has(raw.slug), `municipality registry duplicate ${raw.slug}`);
    municipalityBySlug.set(raw.slug, {
      name: raw.name,
      priorityRank: typeof raw.priorityRank === "number" && Number.isInteger(raw.priorityRank) ? raw.priorityRank : null,
    });
  }
  invariant(municipalityBySlug.size === UNIVERSE, `municipality registry has ${municipalityBySlug.size} rows, expected ${UNIVERSE}`);
  invariant([...municipalityBySlug.keys()].every((slug) => universeSet.has(slug)), "municipality registry drifted from coverage universe");
  const priority167 = [...municipalityBySlug.entries()]
    .filter(([, city]) => city.priorityRank !== null && city.priorityRank <= 167)
    .sort(([, left], [, right]) => left.priorityRank! - right.priorityRank!)
    .map(([slug]) => slug);
  invariant(priority167.length === 167, `numeric priorityRank <= 167 yielded ${priority167.length} cities, expected 167`);
  invariant(new Set(priority167).size === 167, "priorityRank <= 167 has duplicate slugs");
  const ranks = priority167.map((slug) => municipalityBySlug.get(slug)!.priorityRank!);
  invariant(ranks.every((rank, index) => rank === index + 1), "priorityRank <= 167 must be exactly ranks 1..167");

  const bprimeSlugs = bprime.split("\n").map((slug) => slug.trim()).filter(Boolean);
  invariant(new Set(bprimeSlugs).size === bprimeSlugs.length, "_refold-normes-bprime-slugs.txt contains duplicate slugs");
  invariant(bprimeSlugs.length === 47, `expected the checked B' reference file to contain 47 rows, got ${bprimeSlugs.length}`);

  const sourceSha256 = {
    "work/coverage/coverage-matrix.json": sha256(coverage.text),
    "work/immo-field-completion-matrices/immo-field-completion-matrix.json": sha256(fields.text),
    "work/coverage/immo-lots.json": sha256(lots.text),
    "work/coverage/_refold-normes-bprime-slugs.txt": sha256(bprime),
    "packages/qc-sources/src/geo/municipalities.qc.json": sha256(registry.text),
  };
  return {
    universe,
    naSlugs,
    municipalityBySlug,
    priority167,
    sourceSha256,
    sourceMeta: [
      { role: "canonical_city_universe", path: "work/coverage/coverage-matrix.json", sha256: sourceSha256["work/coverage/coverage-matrix.json"], declaredAsOf: coverageValue["generatedAt"] ?? null },
      { role: "explicit_portfolio_NA_list", path: "work/immo-field-completion-matrices/immo-field-completion-matrix.json", sha256: sourceSha256["work/immo-field-completion-matrices/immo-field-completion-matrix.json"] },
      { role: "zero_lot_NA_crosscheck", path: "work/coverage/immo-lots.json", sha256: sourceSha256["work/coverage/immo-lots.json"], declaredAsOf: lotsValue["generatedAt"] ?? null },
      { role: "checked_non_authoritative_bprime_reference", path: "work/coverage/_refold-normes-bprime-slugs.txt", sha256: sourceSha256["work/coverage/_refold-normes-bprime-slugs.txt"], observedSlugCount: bprimeSlugs.length, usedForSubset: false },
      { role: "derived_priority_167_subset", path: "packages/qc-sources/src/geo/municipalities.qc.json", sha256: sourceSha256["packages/qc-sources/src/geo/municipalities.qc.json"], selector: "typeof priorityRank === 'number' && priorityRank <= 167", selectedCount: priority167.length },
      { role: "served_qc_lots", prefix: "normalized/qc-lots/", readOnly: true, layoutPolicy: "nested qc-lots-<slug>/qc-lots-<slug>.geojson before flat qc-lots-<slug>.geojson; never combine layouts" },
      { role: "mamh_role", millesime: DEFAULT_MILLESIME, indexUrl: `https://donneesouvertes.affmunqc.net/role/indexRole${DEFAULT_MILLESIME}.csv`, xmlUrlTemplate: "https://donneesouvertes.affmunqc.net/role/RL{code_geo}_2026.xml", readOnly: true, maxRoleMiB: MAX_ROLE_MB },
    ],
  };
}

function checkpointFor(args: Args, sourceSha256: Record<string, string>, cities: Map<string, CityMeasurement>): Progress {
  return {
    contract: "immo-adresse-completion-progress/v1",
    as_of_date: args.date,
    source_sha256: sourceSha256,
    cities: [...cities.values()].sort((left, right) => ascending(left.slug, right.slug)),
  };
}

function loadProgress(args: Args, sourceSha256: Record<string, string>, universe: readonly string[]): Map<string, CityMeasurement> {
  if (!args.resume) return new Map();
  invariant(existsSync(args.checkpoint), `--resume requested but checkpoint is absent: ${relative(ROOT, args.checkpoint)}`);
  const progress = JSON.parse(readFileSync(args.checkpoint, "utf8")) as Progress;
  invariant(progress.contract === "immo-adresse-completion-progress/v1", "checkpoint contract is incompatible");
  invariant(progress.as_of_date === args.date, "checkpoint date is incompatible");
  invariant(JSON.stringify(progress.source_sha256) === JSON.stringify(sourceSha256), "checkpoint source hashes are incompatible; restart without --resume");
  const allowed = new Set(universe);
  const cities = new Map<string, CityMeasurement>();
  for (const city of progress.cities) {
    invariant(allowed.has(city.slug), `checkpoint has out-of-universe city ${city.slug}`);
    invariant(!cities.has(city.slug), `checkpoint has duplicate city ${city.slug}`);
    cities.set(city.slug, city);
  }
  return cities;
}

function timeRemaining(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new TimeboxExceeded();
  return remaining;
}

async function readS3BytesWithinDeadline(s3: S3Client, key: string, deadline: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeRemaining(deadline));
  try {
    return await getBytes(s3, key, undefined, controller.signal);
  } catch (error) {
    if (Date.now() >= deadline || controller.signal.aborted) throw new TimeboxExceeded();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRoleWithinDeadline(codeGeo: string, slug: string, run: CaptureRun, deadline: number, maxBytes: number): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeRemaining(deadline));
  try {
    // The MAMH role fetch goes through the capture chokepoint: the deadline
    // AbortController still governs the timeout (chokepoint timer disabled), and
    // the `--max-mb`/role guard is enforced by `maxBytes`. `store: false` journals
    // the manifest proof (url, http_status, retrieved_at, sha256, bytes) without
    // depositing the raw role XML, keeping this an analysis-only reader.
    const captured = await capturedFetch(
      ROLE_URL(codeGeo),
      { signal: controller.signal },
      {
        run,
        lane: "cadastre",
        source: "immo-adresse-completion-matrix",
        slugs: [slug],
        timeoutMs: null,
        maxBytes,
        maxRedirects: NODE_FETCH_DEFAULT_MAX_REDIRECTS,
        store: false,
      },
    );
    const status = captured.response?.status;
    if (status === 403 || status === 404) return null;
    if (!captured.ok || captured.bytes === null) {
      if (captured.response !== null) throw new Error(`rôle HTTP ${captured.response.status}`);
      throw new CapturedFetchError(captured.line);
    }
    const bytes = Buffer.from(captured.bytes);
    if (bytes.length > maxBytes) throw new Error(`rôle object ${bytes.length} bytes exceeds --max-mb guard ${maxBytes} bytes`);
    return bytes;
  } catch (error) {
    if (Date.now() >= deadline || controller.signal.aborted) throw new TimeboxExceeded();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function roleIndexByName(index: Record<string, IndexEntry>): Map<string, string[]> {
  const byName = new Map<string, Set<string>>();
  const entries = new Map<string, IndexEntry>();
  for (const entry of Object.values(index)) entries.set(entry.code_geo, entry);
  for (const entry of entries.values()) {
    const key = normalizedName(entry.nom);
    if (!key) continue;
    let codes = byName.get(key);
    if (!codes) byName.set(key, (codes = new Set()));
    codes.add(entry.code_geo);
  }
  return new Map([...byName.entries()].map(([name, codes]) => [name, [...codes].sort(ascending)]));
}

function candidateCodes(slug: string, name: string, byName: ReadonlyMap<string, readonly string[]>): string[] {
  const candidates = new Set<string>();
  for (const key of [normalizedName(name), normalizedName(slug), normalizedName(slug.split(/-{2,}/u)[0] ?? slug)]) {
    for (const code of byName.get(key) ?? []) candidates.add(code);
  }
  return [...candidates].sort(ascending);
}

function noLotOf(properties: Record<string, unknown>): { key: string | null; verbatim: NoLotVerbatim } {
  for (const field of ["NO_LOT", "noLot", "no_lot", "NOLOT", "lot_id", "LOT_ID"]) {
    const value = properties[field];
    if (value === null || value === undefined || !String(value).trim()) continue;
    const verbatim: NoLotVerbatim = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
    return { key: String(value).replace(/ /g, ""), verbatim };
  }
  return { key: null, verbatim: null };
}

function adresseOf(properties: Record<string, unknown>): LotObservation["adresse"] {
  const value = properties["adresse"];
  if (value === null || value === undefined) return "absent";
  return typeof value === "string" && value.trim().length > 0 ? "present" : "malformed";
}

const FEATURES_TOKEN = Buffer.from('"features"');

function isJsonWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function findFeaturesArrayStart(buffer: Buffer, key: string): number {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < buffer.length; index++) {
    const byte = buffer[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte !== 0x22) continue;
    if (buffer.subarray(index, index + FEATURES_TOKEN.length).equals(FEATURES_TOKEN)) {
      let cursor = index + FEATURES_TOKEN.length;
      while (cursor < buffer.length && isJsonWhitespace(buffer[cursor]!)) cursor++;
      if (buffer[cursor] !== 0x3a) continue;
      cursor++;
      while (cursor < buffer.length && isJsonWhitespace(buffer[cursor]!)) cursor++;
      if (buffer[cursor] === 0x5b) return cursor + 1;
    }
    inString = true;
  }
  fail(`GeoJSON features array not found: ${key}`);
}

/** Parse one feature at a time and retain only its tiny classification record. */
function observationsFromGeoJson(buffer: Buffer, key: string, deadline: number): LotObservation[] {
  const observations: LotObservation[] = [];
  const start = findFeaturesArrayStart(buffer, key);
  let inString = false;
  let escaped = false;
  let depth = 0;
  let featureStart = -1;
  for (let index = start; index < buffer.length; index++) {
    if ((index & 0x3fff) === 0) timeRemaining(deadline);
    const byte = buffer[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) {
      inString = true;
      continue;
    }
    if (depth === 0) {
      if (byte === 0x5d) return observations;
      if (byte === 0x7b) {
        featureStart = index;
        depth = 1;
      }
      continue;
    }
    if (byte === 0x7b) depth++;
    else if (byte === 0x7d) {
      depth--;
      if (depth === 0) {
        const feature = record(JSON.parse(buffer.subarray(featureStart, index + 1).toString("utf8")) as unknown, `${key} feature`);
        const rawProperties = feature["properties"];
        const properties = rawProperties === null || rawProperties === undefined ? {} : record(rawProperties, `${key} feature.properties`);
        const lot = noLotOf(properties);
        observations.push({ noLotKey: lot.key, noLotVerbatim: lot.verbatim, adresse: adresseOf(properties) });
        featureStart = -1;
      }
    }
  }
  fail(`GeoJSON features array did not terminate: ${key}`);
}

async function readServedObservations(
  s3: S3Client,
  slug: string,
  deadline: number,
  maxBytes: number,
): Promise<{ layout: ServedLayout; key: string | null; etag: string | null; observations: LotObservation[] | null; error: string | null }> {
  const collection = `qc-lots-${slug}`;
  const nestedKey = `normalized/qc-lots/${collection}/${collection}.geojson`;
  const flatKey = `normalized/qc-lots/${collection}.geojson`;
  const nested = await objectHead(s3, nestedKey);
  const layout: ServedLayout = nested.exists
    ? "subdirectory"
    : (await objectHead(s3, flatKey)).exists ? "flat" : null;
  const key = layout === "subdirectory" ? nestedKey : layout === "flat" ? flatKey : null;
  if (!key) return { layout: null, key: null, etag: null, observations: null, error: "No qc-lots geometry is served in either supported layout." };
  const head = layout === "subdirectory" ? nested : await objectHead(s3, key);
  if (!head.exists) return { layout, key, etag: null, observations: null, error: "The selected served qc-lots geometry disappeared during the read." };
  if (head.contentLength !== undefined && head.contentLength > maxBytes) {
    return { layout, key, etag: head.etag ?? null, observations: null, error: `Served GeoJSON ${head.contentLength} bytes exceeds --max-mb guard ${maxBytes} bytes.` };
  }
  let bytes = await readS3BytesWithinDeadline(s3, key, deadline);
  try {
    if (bytes.length > maxBytes) return { layout, key, etag: head.etag ?? null, observations: null, error: `Served GeoJSON ${bytes.length} bytes exceeds --max-mb guard ${maxBytes} bytes.` };
    return { layout, key, etag: head.etag ?? null, observations: observationsFromGeoJson(bytes, key, deadline), error: null };
  } finally {
    // Do not retain geometry while the role XML/map is loaded for this city.
    bytes = Buffer.alloc(0);
  }
}

async function resolveRole(
  slug: string,
  name: string,
  observations: readonly LotObservation[],
  byName: ReadonlyMap<string, readonly string[]>,
  run: CaptureRun,
  deadline: number,
  maxBytes: number,
): Promise<{ resolution: RoleResolution | null; note: string | null }> {
  const lotKeys = new Set(observations.flatMap((observation) => observation.noLotKey ? [observation.noLotKey] : []));
  if (lotKeys.size === 0) return { resolution: null, note: "No served lot exposes a usable NO_LOT-family key." };
  const candidates = candidateCodes(slug, name, byName);
  if (candidates.length === 0) return { resolution: null, note: "No MAMH code_geo candidate for municipality name." };
  const minimumOverlap = Math.max(30, Math.floor(0.03 * lotKeys.size));
  let best: RoleResolution | null = null;
  const failures: string[] = [];
  for (const codeGeo of candidates.slice(0, 6)) {
    timeRemaining(deadline);
    let xml: Buffer | null;
    try {
      xml = await fetchRoleWithinDeadline(codeGeo, slug, run, deadline, maxBytes);
    } catch (error) {
      if (error instanceof TimeboxExceeded) throw error;
      failures.push(`${codeGeo}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!xml) {
      failures.push(`${codeGeo}: role unavailable`);
      continue;
    }
    let roleMap: Record<string, RoleAttrs>;
    try {
      roleMap = parseRole(xml);
    } catch (error) {
      failures.push(`${codeGeo}: role parse failed (${error instanceof Error ? error.message : String(error)})`);
      continue;
    } finally {
      xml = Buffer.alloc(0);
    }
    let overlap = 0;
    for (const key of Object.keys(roleMap)) if (lotKeys.has(key)) overlap++;
    if (!best || overlap > best.overlap) best = { codeGeo, roleMap, overlap };
  }
  if (!best) return { resolution: null, note: `No readable MAMH role (${failures.join("; ") || "no candidate succeeded"}).` };
  if (best.overlap < minimumOverlap) {
    return { resolution: null, note: `MAMH role overlap too low (best code=${best.codeGeo}, matched=${best.overlap}, minimum=${minimumOverlap}).` };
  }
  return { resolution: best, note: null };
}

function unknownCity(
  slug: string,
  reason: string,
  served: { layout: ServedLayout; key: string | null; etag: string | null },
  observations: readonly LotObservation[] | null = null,
  roleCode: string | null = null,
): CityMeasurement {
  return {
    slug,
    etat: "unknown",
    reason,
    served_layout: served.layout,
    served_geojson_key: served.key,
    served_geojson_etag: served.etag,
    role_code_geo: roleCode,
    role_resolution_note: reason,
    lots_served: observations?.length ?? null,
    lots_matches: null,
    adresse_servie: null,
    role_a_adresse_non_servie: null,
    role_sans_adresse: null,
    lots_unknown: observations ? observations.length : null,
    role_sans_adresse_examples: [],
  };
}

function classifyWithRole(
  slug: string,
  served: { layout: ServedLayout; key: string; etag: string | null },
  observations: readonly LotObservation[],
  resolution: RoleResolution,
): CityMeasurement {
  let lotsMatches = 0;
  let adresseServie = 0;
  let roleHasAdresseNotServed = 0;
  let roleSansAdresse = 0;
  let lotsUnknown = 0;
  const examples: RoleAbsentExample[] = [];
  for (const observation of observations) {
    if (observation.adresse === "malformed" || !observation.noLotKey) {
      lotsUnknown++;
      continue;
    }
    const role = resolution.roleMap[observation.noLotKey];
    if (role) lotsMatches++;
    if (observation.adresse === "present") {
      adresseServie++;
      continue;
    }
    if (role?.adresse) {
      roleHasAdresseNotServed++;
      continue;
    }
    roleSansAdresse++;
    if (examples.length < 3) {
      examples.push({
        no_lot_verbatim: observation.noLotVerbatim,
        no_lot_key: observation.noLotKey,
        reason: role ? "role_adresse_null" : "role_lookup_absent",
      });
    }
  }
  invariant(adresseServie + roleHasAdresseNotServed + roleSansAdresse + lotsUnknown === observations.length, `${slug}: lot case partition does not sum to served lots`);
  const etat: State = lotsUnknown > 0
    ? "unknown"
    : roleHasAdresseNotServed > 0 ? "foldable" : "complete";
  const reason = etat === "unknown"
    ? `At least ${lotsUnknown} served lot(s) cannot be evaluated (malformed adresse or absent NO_LOT-family key).`
    : etat === "foldable"
      ? `${roleHasAdresseNotServed} served lot(s) have a non-null MAMH role address that has not been folded.`
      : `Every served lot is either already addressed or has a MAMH-proved absence of address.`;
  return {
    slug,
    etat,
    reason,
    served_layout: served.layout,
    served_geojson_key: served.key,
    served_geojson_etag: served.etag,
    role_code_geo: resolution.codeGeo,
    role_resolution_note: null,
    lots_served: observations.length,
    lots_matches: lotsMatches,
    adresse_servie: adresseServie,
    role_a_adresse_non_servie: roleHasAdresseNotServed,
    role_sans_adresse: roleSansAdresse,
    lots_unknown: lotsUnknown,
    role_sans_adresse_examples: examples,
  };
}

function naCity(slug: string): CityMeasurement {
  return {
    slug,
    etat: "N/A",
    reason: "Explicit portfolio N/A: canonical Immo field matrix reports a zero per-lot denominator.",
    served_layout: null,
    served_geojson_key: null,
    served_geojson_etag: null,
    role_code_geo: null,
    role_resolution_note: null,
    lots_served: 0,
    lots_matches: 0,
    adresse_servie: 0,
    role_a_adresse_non_servie: 0,
    role_sans_adresse: 0,
    lots_unknown: 0,
    role_sans_adresse_examples: [],
  };
}

async function readCity(
  s3: S3Client,
  slug: string,
  name: string,
  roleByName: ReadonlyMap<string, readonly string[]>,
  run: CaptureRun,
  deadline: number,
  maxGeoBytes: number,
  maxRoleBytes: number,
): Promise<CityMeasurement> {
  let served: Awaited<ReturnType<typeof readServedObservations>>;
  try {
    served = await readServedObservations(s3, slug, deadline, maxGeoBytes);
  } catch (error) {
    if (error instanceof TimeboxExceeded) throw error;
    return unknownCity(slug, `Served qc-lots read failed: ${error instanceof Error ? error.message : String(error)}`, { layout: null, key: null, etag: null });
  }
  if (!served.observations || !served.key || !served.layout) {
    return unknownCity(slug, served.error ?? "Served qc-lots state is not evaluable.", served);
  }
  if (served.observations.length === 0) {
    return unknownCity(slug, "Selected served qc-lots GeoJSON has zero features outside the explicit N/A list.", served, served.observations);
  }
  let resolved: { resolution: RoleResolution | null; note: string | null };
  try {
    resolved = await resolveRole(slug, name, served.observations, roleByName, run, deadline, maxRoleBytes);
  } catch (error) {
    if (error instanceof TimeboxExceeded) throw error;
    return unknownCity(slug, `MAMH role resolution failed: ${error instanceof Error ? error.message : String(error)}`, served, served.observations);
  }
  if (!resolved.resolution) return unknownCity(slug, resolved.note ?? "MAMH role is not resolvable.", served, served.observations);
  return classifyWithRole(slug, { layout: served.layout, key: served.key, etag: served.etag }, served.observations, resolved.resolution);
}

function partition(cities: readonly CityMeasurement[]): Record<State, string[]> {
  const buckets: Record<State, string[]> = { complete: [], foldable: [], unknown: [], "N/A": [] };
  for (const city of cities) buckets[city.etat].push(city.slug);
  for (const bucket of Object.values(buckets)) bucket.sort(ascending);
  const all = Object.values(buckets).flat();
  invariant(all.length === UNIVERSE, `city partition covers ${all.length}, expected ${UNIVERSE}`);
  invariant(new Set(all).size === UNIVERSE, "city partition has a duplicate city");
  return buckets;
}

function stateCounts(cities: readonly CityMeasurement[]): Record<State, number> {
  const buckets = partition(cities);
  return { complete: buckets.complete.length, foldable: buckets.foldable.length, unknown: buckets.unknown.length, "N/A": buckets["N/A"].length };
}

function numberOrZero(value: number | null): number {
  return value ?? 0;
}

function buildMatrix(date: string, input: LocalInputs, cities: readonly CityMeasurement[]): Record<string, unknown> {
  const sortedCities = cities.slice().sort((left, right) => ascending(left.slug, right.slug));
  const buckets = partition(sortedCities);
  const measured = sortedCities.filter((city) => city.lots_served !== null);
  const totals = {
    lots_served: measured.reduce((sum, city) => sum + numberOrZero(city.lots_served), 0),
    lots_matches: measured.reduce((sum, city) => sum + numberOrZero(city.lots_matches), 0),
    adresse_servie: measured.reduce((sum, city) => sum + numberOrZero(city.adresse_servie), 0),
    role_a_adresse_non_servie: measured.reduce((sum, city) => sum + numberOrZero(city.role_a_adresse_non_servie), 0),
    role_sans_adresse: measured.reduce((sum, city) => sum + numberOrZero(city.role_sans_adresse), 0),
    lots_unknown: measured.reduce((sum, city) => sum + numberOrZero(city.lots_unknown), 0),
  };
  const fullyClassified = sortedCities.filter((city) => city.etat !== "unknown" && city.etat !== "N/A");
  for (const city of fullyClassified) {
    invariant(
      numberOrZero(city.adresse_servie) + numberOrZero(city.role_a_adresse_non_servie) + numberOrZero(city.role_sans_adresse) + numberOrZero(city.lots_unknown) === numberOrZero(city.lots_served),
      `${city.slug}: persisted lot case partition is not closed`,
    );
  }
  const subset = input.priority167.map((slug) => {
    const city = sortedCities.find((measurement) => measurement.slug === slug);
    invariant(city, `priority 167 slug ${slug} is absent from city measurements`);
    return city;
  });
  const subsetBuckets = {
    complete: subset.filter((city) => city.etat === "complete").map((city) => city.slug).sort(ascending),
    foldable: subset.filter((city) => city.etat === "foldable").map((city) => city.slug).sort(ascending),
    unknown: subset.filter((city) => city.etat === "unknown").map((city) => city.slug).sort(ascending),
    "N/A": subset.filter((city) => city.etat === "N/A").map((city) => city.slug).sort(ascending),
  };
  invariant(Object.values(subsetBuckets).flat().length === 167, "priority 167 subset partition is not closed");
  const refoldTarget = sortedCities
    .filter((city) => numberOrZero(city.role_a_adresse_non_servie) > 0)
    .map((city) => ({ slug: city.slug, lots_recuperables: city.role_a_adresse_non_servie!, etat: city.etat }))
    .sort((left, right) => ascending(left.slug, right.slug));
  return {
    $schema: "immo-adresse-completion-matrix/v1",
    as_of: date,
    _rule: {
      classifier: "For a selected served qc-lots layout, every lot is exactly one of adresse_servie (non-empty served string), role_a_adresse_non_servie/foldable (served adresse null and resolved MAMH role address non-null), role_sans_adresse/N-A-prouve (served adresse null and resolved role lookup absent or role adresse null, with verbatim NO_LOT evidence), or lots_unknown (malformed served adresse or no usable NO_LOT-family key). A city is complete when all its served lots are adresse_servie or N-A-prouve; foldable when it has recoverable role addresses and no unknown lot; unknown when selected served data, a role resolution, or a lot evaluation is unavailable; N/A is only the explicit six-city portfolio list.",
      served_layout_policy: "geo-api serves normalized/qc-lots/qc-lots-<slug>/qc-lots-<slug>.geojson before normalized/qc-lots/qc-lots-<slug>.geojson. The nested object is selected first and the flat shadow is never read.",
      role_join: "The production join is reproduced: first non-empty NO_LOT/noLot/no_lot/NOLOT/lot_id/LOT_ID value with literal spaces removed equals MAMH RL0103Ax; candidate code_geo is accepted only with overlap >= max(30, floor(3% of distinct served keys)). parseRole supplies the canonical RL0101 address semantics.",
      anti_invention: "Served addresses are never recomputed or repaired. A non-string/blank served adresse is unknown. No role candidate, unreadable/invalid role, insufficient overlap, missing served collection, or zero denominator outside the six explicit N/A cities is unknown, never complete. N-A proof records a verbatim NO_LOT value and whether the resolved role lookup was absent or its address was null.",
      memory_and_write_policy: `One municipality is processed at a time; only lot observations are retained. The MAMH role fetch goes through the capture chokepoint, whose sole S3 write is a capture manifest (store:false deposits no raw bytes and no served data is ever written). --max-seconds is resumable through a local atomic checkpoint; --max-mb rejects oversized served objects fail-closed, and a fixed ${MAX_ROLE_MB} MiB role guard refuses a larger MAMH XML before parsing.`,
      priority_167_policy: "The supplied _refold-normes-bprime-slugs.txt has 47 rows and is therefore not used as B'-167. The requested fallback is the committed municipality registry selector typeof priorityRank === 'number' && priorityRank <= 167, validated as exactly ranks 1..167.",
    },
    source: input.sourceMeta,
    counts: {
      city_states: stateCounts(sortedCities),
      partition_total: UNIVERSE,
      applicable_denominator: UNIVERSE - buckets["N/A"].length,
      cities_with_NA_proved_lots: sortedCities.filter((city) => numberOrZero(city.role_sans_adresse) > 0).length,
      cities_with_recoverable_address_lots: refoldTarget.length,
      lot_cases: totals,
    },
    city_buckets: buckets,
    subset_167: {
      selector: "typeof priorityRank === 'number' && priorityRank <= 167",
      cardinality: subset.length,
      city_states: { complete: subsetBuckets.complete.length, foldable: subsetBuckets.foldable.length, unknown: subsetBuckets.unknown.length, "N/A": subsetBuckets["N/A"].length },
      city_buckets: subsetBuckets,
      cities_with_NA_proved_lots: subset.filter((city) => numberOrZero(city.role_sans_adresse) > 0).length,
      refold_target: refoldTarget.filter((target) => input.priority167.includes(target.slug)),
    },
    refold_target: refoldTarget,
    city_measurements: sortedCities,
  };
}

function markdown(matrix: Record<string, unknown>): string {
  const counts = record(matrix["counts"], "matrix.counts");
  const states = record(counts["city_states"], "matrix.counts.city_states");
  const subset = record(matrix["subset_167"], "matrix.subset_167");
  const subsetStates = record(subset["city_states"], "matrix.subset_167.city_states");
  const target = matrix["refold_target"];
  invariant(Array.isArray(target), "matrix.refold_target must be an array");
  return [
    "# Complétion adresse Immo — col. 17",
    "",
    `Instantané déterministe : ${String(matrix["as_of"])}. Analyse lecture seule S3/MAMH; aucune écriture S3.`,
    "",
    "| Périmètre | complete | foldable | unknown | N/A |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| 1106 | ${states["complete"]} | ${states["foldable"]} | ${states["unknown"]} | ${states["N/A"]} |`,
    `| priorityRank ≤ 167 | ${subsetStates["complete"]} | ${subsetStates["foldable"]} | ${subsetStates["unknown"]} | ${subsetStates["N/A"]} |`,
    "",
    `N-A prouvée est une raison au niveau lot, incluse dans complete : ${counts["cities_with_NA_proved_lots"]} ville(s) sur 1106, ${subset["cities_with_NA_proved_lots"]} sur le sous-ensemble 167.`,
    "",
    `Cible de re-fold : ${target.length} municipalité(s) avec au moins un lot dont le rôle MAMH porte une adresse absente du lot servi. Les comptes et la preuve N-A (NO_LOT verbatim) sont dans le JSON.`,
    "",
    "La liste `_refold-normes-bprime-slugs.txt` compte 47 slugs, pas 167; le sous-ensemble est donc le repli traçable `priorityRank` numérique ≤ 167 du registre committé.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(usage());
    return;
  }
  const out = outputPath(args.date);
  const md = markdownPath(args.date);
  if (existsSync(out)) {
    const existing = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    writeImmutable(md, markdown(existing));
    const counts = record(existing["counts"], "existing output.counts");
    console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), markdown: relative(ROOT, md), city_states: counts["city_states"], reused_existing_output: true }));
    return;
  }
  const input = sources();
  const cities = loadProgress(args, input.sourceSha256, input.universe);
  for (const slug of input.naSlugs) cities.set(slug, naCity(slug));
  const deadline = Date.now() + args.maxSeconds * 1000;
  const pending = input.universe.filter((slug) => !cities.has(slug));
  if (pending.length > 0) {
    const index = await fetchIndex(DEFAULT_MILLESIME);
    const roleByName = roleIndexByName(index);
    const maxBytes = Math.floor(args.maxMb * 1024 * 1024);
    const maxRoleBytes = Math.min(maxBytes, MAX_ROLE_MB * 1024 * 1024);
    const s3 = s3Client();
    const run = openCaptureRun({ lane: "cadastre", userAgent: NODE_FETCH_USER_AGENT });
    let exitCode = 1;
    try {
      for (const slug of pending) {
        if (Date.now() >= deadline) break;
        const city = input.municipalityBySlug.get(slug);
        invariant(city, `no municipality registry row for ${slug}`);
        try {
          cities.set(slug, await readCity(s3, slug, city.name, roleByName, run, deadline, maxBytes, maxRoleBytes));
        } catch (error) {
          if (error instanceof TimeboxExceeded) break;
          throw error;
        }
        writeAtomic(args.checkpoint, `${JSON.stringify(checkpointFor(args, input.sourceSha256, cities), null, 2)}\n`);
        console.error(`[immo-adresse] progress ${cities.size}/${UNIVERSE} checkpoint=${relative(ROOT, args.checkpoint)}`);
      }
      exitCode = 0;
    } finally {
      await run.finish(exitCode);
    }
  }
  if (cities.size !== UNIVERSE) {
    console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), measured_cities: cities.size, remaining_cities: UNIVERSE - cities.size, resume: `--date ${args.date} --resume --max-seconds ${args.maxSeconds} --max-mb ${args.maxMb}` }));
    return;
  }
  const matrix = buildMatrix(args.date, input, [...cities.values()]);
  const text = `${JSON.stringify(matrix, null, 2)}\n`;
  writeImmutable(out, text);
  writeImmutable(md, markdown(matrix));
  const counts = record(matrix["counts"], "matrix.counts");
  console.log(JSON.stringify({ complete: true, output: relative(ROOT, out), markdown: relative(ROOT, md), city_states: counts["city_states"], refold_target_cities: (matrix["refold_target"] as unknown[]).length, checkpoint: relative(ROOT, args.checkpoint) }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
