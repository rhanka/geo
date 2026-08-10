/**
 * Reproducible absence-source attestation for the Immo 14–17 boundary.
 *
 * It reads only the served qc-lots GeoJSON selected by geo-api (nested before
 * flat) and the public MAMH role.  A missing value is an `absent` result only
 * after the served lot and its MAMH role have both been read.  Failed reads,
 * an absent served collection, and an unmatched lot selector remain the named
 * `source-inaccessible` state; none is silently credited as an absence.
 *
 * The `--coverage-dump-167` mode is deliberately housed here too: it is the
 * reproducible producer of the dated KPI 14 denominator dump.  It counts the
 * selected served GeoJSON exactly as the OGC provider computes unfiltered
 * `numberMatched`, and separately counts the canonical OntoLot `noLot` field.
 *
 * Examples:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/cadastre-role-absence-attestation.ts \
 *       --slug westmount --lots '1 581 067' --field adresse --date 20260803 \
 *       --max-seconds 55
 *
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/cadastre-role-absence-attestation.ts \
 *       --coverage-dump-167 --date 20260803 --max-seconds 55
 *   ... --coverage-dump-167 --date 20260803 --resume --max-seconds 55
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
const MUNICIPALITIES = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
const COVERAGE_DIR = resolve(ROOT, "work/coverage");
const CACHE_DIR = resolve(ROOT, ".cache");
const DEFAULT_MAX_SECONDS = 55;
const DEFAULT_MAX_MB = 1024;
const MAX_ROLE_MB = 512;
const ROLE_URL = (codeGeo: string) => `https://donneesouvertes.affmunqc.net/role/RL${codeGeo}_${DEFAULT_MILLESIME}.xml`;
/** UA that the naked global `fetch` already sent before this call was captured. */
const NODE_FETCH_USER_AGENT = "undici";
const FIELDS = ["lot", "adresse", "code_postal", "surface"] as const;
const FEATURES_TOKEN = Buffer.from('"features"');
const UNIT_OPEN = Buffer.from("<RLUEx");
const UNIT_CLOSE = Buffer.from("</RLUEx>");
const TAG_END_BYTES = new Set([0x3e, 0x2f, 0x20, 0x0a, 0x0d, 0x09]);

type Field = (typeof FIELDS)[number];
type Layout = "subdirectory" | "flat";
type Scalar = string | number | boolean | null;
type Result = "present" | "absent" | "source-inaccessible";

interface Municipality {
  slug: string;
  name: string;
  priorityRank: number;
}

interface CommonArgs {
  date: string;
  maxSeconds: number;
  maxMb: number;
  resume: boolean;
  checkpoint: string;
  out: string | null;
}

interface AttestationArgs extends CommonArgs {
  mode: "attestation";
  slug: string;
  lots: string[];
  fields: Field[];
}

interface CoverageArgs extends CommonArgs {
  mode: "coverage";
}

type Args = AttestationArgs | CoverageArgs;

interface LotObservation {
  noLotKey: string | null;
  noLotVerbatim: Scalar;
  canonicalNoLot: Scalar;
  adresse: Scalar;
  codePostal: Scalar;
  surface: Scalar;
}

interface ServedLots {
  layout: Layout;
  key: string;
  etag: string | null;
  allLotKeys: Set<string>;
  requested: Map<string, LotObservation[]>;
}

interface RoleResolution {
  codeGeo: string;
  roleUrl: string;
  roleMap: Record<string, RoleAttrs>;
  xml: Buffer;
  overlap: number;
}

interface Attestation {
  source: {
    cadastre: "qc-lots-served";
    role: "mamh-role-foncier";
  };
  asOf: string;
  query: {
    s3_key: string | null;
    served_layout: Layout | null;
    lot_selector: { NO_LOT: string };
    role_url: string | null;
    role_selector: string | null;
    field_selector: string;
  };
  result: Result;
  evidence: Record<string, unknown>;
}

interface AttestationProgress {
  contract: "cadastre-role-absence-attestation-progress/v1";
  fingerprint: string;
  attestations: Attestation[];
}

interface CoverageRow {
  slug: string;
  priorityRank: number;
  served_key: string | null;
  numberMatched: number | null;
  noLot_count: number | null;
  present: boolean;
}

interface CoverageProgress {
  contract: "qc-lots-coverage-dump-progress/v1";
  fingerprint: string;
  municipalities: CoverageRow[];
}

interface CoverageReport {
  $schema: "qc-lots-coverage-dump/v1";
  asOf: string;
  source: {
    registry: string;
    registry_sha256: string;
    selector: string;
    selected_count: number;
    served_layout_policy: string;
    numberMatched_policy: string;
  };
  municipalities: CoverageRow[];
  summary: {
    municipalities: number;
    served: number;
    total_numberMatched: number;
    total_noLot_count: number;
    present_false: string[];
  };
}

class TimeboxExceeded extends Error {
  constructor() {
    super("Invocation time budget reached; resume from the checkpoint.");
    this.name = "TimeboxExceeded";
  }
}

function fail(message: string): never {
  throw new Error(`cadastre-role-absence-attestation: ${message}`);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dateToday(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx acquisition/src/cadastre-role-absence-attestation.ts --slug SLUG --lots NO_LOT[,NO_LOT] --field lot|adresse|code_postal|surface[,FIELD] [options]",
    "  npx tsx acquisition/src/cadastre-role-absence-attestation.ts --coverage-dump-167 [options]",
    "",
    "Common options:",
    "  --date YYYYMMDD       Immutable as-of date (default: today)",
    `  --max-seconds N       Wall-time cap; resume is explicit (default: ${DEFAULT_MAX_SECONDS})`,
    `  --max-mb N            Per served GeoJSON memory guard in MiB (default: ${DEFAULT_MAX_MB})`,
    "  --checkpoint PATH     Local atomic progress path",
    "  --resume              Continue a compatible local checkpoint",
    "  --out PATH            Immutable JSON output; stdout when omitted",
    "  --help                Show this help",
    "",
    "The attestation output is one exact {source, asOf, query, result, evidence} object per requested lot/field.",
    "result=source-inaccessible is a named non-attestation state: it is never an absence proof.",
    "The coverage mode defaults to the requested dated work/coverage JSON and Markdown paths.",
    "All data reads are S3/MAMH read-only; nested qc-lots is selected before flat.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): Args | null {
  let date = dateToday();
  let maxSeconds = DEFAULT_MAX_SECONDS;
  let maxMb = DEFAULT_MAX_MB;
  let resume = false;
  let checkpoint: string | undefined;
  let out: string | undefined;
  let coverage = false;
  let slug: string | undefined;
  let lots: string | undefined;
  let fields: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--help") return null;
    if (token === "--resume") {
      resume = true;
      continue;
    }
    if (token === "--coverage-dump-167") {
      coverage = true;
      continue;
    }
    const inline = token.match(/^--(date|max-seconds|max-mb|checkpoint|out|slug|lots|field)=(.+)$/u);
    const key = inline?.[1] ?? (token.startsWith("--") ? token.slice(2) : "");
    const value = inline?.[2] ?? argv[++index];
    if (!value || !["date", "max-seconds", "max-mb", "checkpoint", "out", "slug", "lots", "field"].includes(key)) {
      fail(`unknown or incomplete option ${token}`);
    }
    if (key === "date") date = value;
    else if (key === "max-seconds") maxSeconds = Number(value);
    else if (key === "max-mb") maxMb = Number(value);
    else if (key === "checkpoint") checkpoint = value;
    else if (key === "out") out = value;
    else if (key === "slug") slug = value;
    else if (key === "lots") lots = value;
    else fields = value;
  }
  invariant(/^\d{8}$/u.test(date), "--date must be YYYYMMDD");
  invariant(Number.isFinite(maxSeconds) && maxSeconds > 0, "--max-seconds must be a positive number");
  invariant(Number.isFinite(maxMb) && maxMb > 0, "--max-mb must be a positive number");
  if (coverage) {
    invariant(!slug && !lots && !fields, "--coverage-dump-167 cannot be combined with --slug, --lots, or --field");
    const defaultOut = resolve(COVERAGE_DIR, `qc-lots-coverage-dump-167-${date}.json`);
    return {
      mode: "coverage",
      date,
      maxSeconds,
      maxMb,
      resume,
      checkpoint: checkpoint ? resolve(ROOT, checkpoint) : resolve(CACHE_DIR, `qc-lots-coverage-dump-167-${date}.progress.json`),
      out: out ? resolve(ROOT, out) : defaultOut,
    };
  }
  invariant(slug && /^[a-z0-9-]+$/u.test(slug), "--slug must be a canonical municipality slug");
  invariant(lots, "--lots is required (comma-separated NO_LOT selectors)");
  invariant(fields, "--field is required (lot|adresse|code_postal|surface)");
  const parsedLots = [...new Set(lots.split(",").map((value) => value.trim()).filter(Boolean))];
  invariant(parsedLots.length > 0, "--lots must contain at least one non-empty NO_LOT selector");
  const parsedFields = [...new Set(fields.split(",").map((value) => value.trim()).filter(Boolean))];
  invariant(parsedFields.length > 0 && parsedFields.every((field): field is Field => (FIELDS as readonly string[]).includes(field)), "--field must contain only lot|adresse|code_postal|surface");
  const sortedFields = FIELDS.filter((field) => parsedFields.includes(field));
  return {
    mode: "attestation",
    date,
    maxSeconds,
    maxMb,
    resume,
    checkpoint: checkpoint ? resolve(ROOT, checkpoint) : resolve(CACHE_DIR, `cadastre-role-absence-attestation-${slug}-${date}.progress.json`),
    out: out ? resolve(ROOT, out) : null,
    slug,
    lots: parsedLots.sort(ascending),
    fields: sortedFields,
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

function writeImmutable(path: string, text: string): void {
  if (existsSync(path)) {
    invariant(readFileSync(path, "utf8") === text, `dated output already exists with different bytes: ${relative(ROOT, path)}`);
    return;
  }
  writeAtomic(path, text);
}

function timeRemaining(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new TimeboxExceeded();
  return remaining;
}

async function getS3BytesWithinDeadline(s3: S3Client, key: string, deadline: number): Promise<Buffer> {
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

async function getRoleWithinDeadline(codeGeo: string, slug: string, run: CaptureRun, deadline: number, maxBytes: number): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeRemaining(deadline));
  try {
    // The MAMH role fetch goes through the capture chokepoint: the deadline
    // AbortController still governs the timeout (chokepoint timer disabled), and
    // the `--max-mb` cap is enforced by `maxBytes`. `store: false` journals the
    // manifest proof (url, http_status, retrieved_at, sha256, bytes) without
    // depositing the raw role XML, keeping this an analysis-only reader.
    const captured = await capturedFetch(
      ROLE_URL(codeGeo),
      { signal: controller.signal },
      {
        run,
        lane: "cadastre",
        source: "cadastre-role-absence-attestation",
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
      if (captured.response !== null) throw new Error(`MAMH role HTTP ${captured.response.status}`);
      throw new CapturedFetchError(captured.line);
    }
    const body = Buffer.from(captured.bytes);
    if (body.length > maxBytes) throw new Error(`MAMH role ${body.length} bytes exceeds --max-mb guard ${maxBytes} bytes`);
    return body;
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
  const entries = new Map<string, IndexEntry>();
  for (const entry of Object.values(index)) entries.set(entry.code_geo, entry);
  const byName = new Map<string, Set<string>>();
  for (const entry of entries.values()) {
    const name = normalizedName(entry.nom);
    if (!name) continue;
    const candidates = byName.get(name) ?? new Set<string>();
    candidates.add(entry.code_geo);
    byName.set(name, candidates);
  }
  return new Map([...byName.entries()].map(([name, codes]) => [name, [...codes].sort(ascending)]));
}

function candidateCodes(slug: string, name: string, index: ReadonlyMap<string, readonly string[]>): string[] {
  const candidates = new Set<string>();
  for (const candidate of [normalizedName(name), normalizedName(slug), normalizedName(slug.split(/-{2,}/u)[0] ?? slug)]) {
    for (const code of index.get(candidate) ?? []) candidates.add(code);
  }
  return [...candidates].sort(ascending);
}

function scalar(value: unknown): Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function hasValue(value: Scalar): boolean {
  if (value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function lotIdentity(properties: Record<string, unknown>): { key: string | null; verbatim: Scalar } {
  for (const key of ["NO_LOT", "noLot", "no_lot", "NOLOT", "lot_id", "LOT_ID"]) {
    const value = scalar(properties[key]);
    if (!hasValue(value)) continue;
    return { key: String(value).replace(/ /g, ""), verbatim: value };
  }
  return { key: null, verbatim: null };
}

function observation(properties: Record<string, unknown>): LotObservation {
  const identity = lotIdentity(properties);
  return {
    noLotKey: identity.key,
    noLotVerbatim: identity.verbatim,
    canonicalNoLot: scalar(properties["noLot"]),
    adresse: scalar(properties["adresse"]),
    codePostal: scalar(properties["code_postal"]),
    surface: scalar(properties["surface_m2"]),
  };
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function featuresArrayStart(buffer: Buffer, key: string): number {
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
      while (cursor < buffer.length && isWhitespace(buffer[cursor]!)) cursor++;
      if (buffer[cursor] !== 0x3a) continue;
      cursor++;
      while (cursor < buffer.length && isWhitespace(buffer[cursor]!)) cursor++;
      if (buffer[cursor] === 0x5b) return cursor + 1;
    }
    inString = true;
  }
  fail(`GeoJSON features array not found: ${key}`);
}

function visitFeatures(buffer: Buffer, key: string, deadline: number, visit: (properties: Record<string, unknown>) => void): void {
  const start = featuresArrayStart(buffer, key);
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
      if (byte === 0x5d) return;
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
        visit(properties);
        featureStart = -1;
      }
    }
  }
  fail(`GeoJSON features array did not terminate: ${key}`);
}

async function selectedServedKey(s3: S3Client, slug: string): Promise<{ layout: Layout; key: string; etag: string | null; contentLength: number | undefined } | null> {
  const collection = `qc-lots-${slug}`;
  const nestedKey = `normalized/qc-lots/${collection}/${collection}.geojson`;
  const flatKey = `normalized/qc-lots/${collection}.geojson`;
  const nested = await objectHead(s3, nestedKey);
  if (nested.exists) return { layout: "subdirectory", key: nestedKey, etag: nested.etag ?? null, contentLength: nested.contentLength };
  const flat = await objectHead(s3, flatKey);
  if (flat.exists) return { layout: "flat", key: flatKey, etag: flat.etag ?? null, contentLength: flat.contentLength };
  return null;
}

async function readServedLots(s3: S3Client, slug: string, requestedKeys: ReadonlySet<string>, deadline: number, maxBytes: number): Promise<ServedLots | null> {
  const selected = await selectedServedKey(s3, slug);
  if (!selected) return null;
  if (selected.contentLength !== undefined && selected.contentLength > maxBytes) {
    fail(`served GeoJSON ${selected.key} is ${selected.contentLength} bytes, above --max-mb guard ${maxBytes}`);
  }
  let bytes = await getS3BytesWithinDeadline(s3, selected.key, deadline);
  try {
    if (bytes.length > maxBytes) fail(`served GeoJSON ${selected.key} is ${bytes.length} bytes, above --max-mb guard ${maxBytes}`);
    const allLotKeys = new Set<string>();
    const requested = new Map<string, LotObservation[]>();
    visitFeatures(bytes, selected.key, deadline, (properties) => {
      const lot = observation(properties);
      if (!lot.noLotKey) return;
      allLotKeys.add(lot.noLotKey);
      if (!requestedKeys.has(lot.noLotKey)) return;
      const rows = requested.get(lot.noLotKey) ?? [];
      rows.push(lot);
      requested.set(lot.noLotKey, rows);
    });
    return { layout: selected.layout, key: selected.key, etag: selected.etag, allLotKeys, requested };
  } finally {
    bytes = Buffer.alloc(0);
  }
}

async function resolveRole(
  slug: string,
  name: string,
  allLotKeys: ReadonlySet<string>,
  roleByName: ReadonlyMap<string, readonly string[]>,
  run: CaptureRun,
  deadline: number,
  maxBytes: number,
): Promise<{ resolution: RoleResolution | null; state: string }> {
  if (allLotKeys.size === 0) return { resolution: null, state: "qc-lots-served-without-usable-NO_LOT" };
  const candidates = candidateCodes(slug, name, roleByName);
  if (candidates.length === 0) return { resolution: null, state: "mamh-code-geo-candidate-absent" };
  const minimumOverlap = Math.max(30, Math.floor(0.03 * allLotKeys.size));
  let best: RoleResolution | null = null;
  const failures: string[] = [];
  for (const codeGeo of candidates.slice(0, 6)) {
    timeRemaining(deadline);
    let xml: Buffer | null;
    try {
      xml = await getRoleWithinDeadline(codeGeo, slug, run, deadline, maxBytes);
    } catch (error) {
      if (error instanceof TimeboxExceeded) throw error;
      failures.push(`${codeGeo}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!xml) {
      failures.push(`${codeGeo}:role-http-unavailable`);
      continue;
    }
    let roleMap: Record<string, RoleAttrs>;
    try {
      roleMap = parseRole(xml);
    } catch (error) {
      failures.push(`${codeGeo}:role-parse-failed:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let overlap = 0;
    for (const lotKey of Object.keys(roleMap)) if (allLotKeys.has(lotKey)) overlap++;
    if (!best || overlap > best.overlap) {
      best = { codeGeo, roleUrl: ROLE_URL(codeGeo), roleMap, xml, overlap };
    }
  }
  if (!best) return { resolution: null, state: `mamh-role-unreadable:${failures.join(";") || "no-candidate-succeeded"}` };
  if (best.overlap < minimumOverlap) {
    return { resolution: null, state: `mamh-role-overlap-insufficient:code=${best.codeGeo},matched=${best.overlap},minimum=${minimumOverlap}` };
  }
  return { resolution: best, state: "resolved" };
}

function unitFragments(buffer: Buffer): Generator<string> {
  let position = 0;
  return (function* fragments(): Generator<string> {
    for (;;) {
      const start = buffer.indexOf(UNIT_OPEN, position);
      if (start < 0) return;
      const after = buffer[start + UNIT_OPEN.length];
      if (after === undefined || !TAG_END_BYTES.has(after)) {
        position = start + UNIT_OPEN.length;
        continue;
      }
      const end = buffer.indexOf(UNIT_CLOSE, start);
      if (end < 0) return;
      const nextOpen = buffer.indexOf(UNIT_OPEN, start + UNIT_OPEN.length);
      if (nextOpen >= 0 && nextOpen < end) {
        position = nextOpen;
        continue;
      }
      const stop = end + UNIT_CLOSE.length;
      yield buffer.toString("utf8", start, stop);
      position = stop;
    }
  })();
}

function rawTag(unit: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, "u").exec(unit);
  return match?.[1] ?? null;
}

function rawRoleEvidence(xml: Buffer, lotKey: string): Record<string, string | null> | null {
  let selected: { unit: string; hasBuildingArea: boolean } | null = null;
  for (const unit of unitFragments(xml)) {
    const keys = [...unit.matchAll(/<RL0103Ax>([^<]*)<\/RL0103Ax>/gu)].map((match) => match[1]!.replace(/ /g, ""));
    if (!keys.includes(lotKey)) continue;
    const hasBuildingArea = rawTag(unit, "RL0308A") !== null;
    if (!selected || (hasBuildingArea && !selected.hasBuildingArea)) selected = { unit, hasBuildingArea };
  }
  if (!selected) return null;
  return {
    RL0103Ax: rawTag(selected.unit, "RL0103Ax"),
    RL0101Ax: rawTag(selected.unit, "RL0101Ax"),
    RL0101Bx: rawTag(selected.unit, "RL0101Bx"),
    RL0101Cx: rawTag(selected.unit, "RL0101Cx"),
    RL0101Dx: rawTag(selected.unit, "RL0101Dx"),
    RL0101Ex: rawTag(selected.unit, "RL0101Ex"),
    RL0101Fx: rawTag(selected.unit, "RL0101Fx"),
    RL0101Gx: rawTag(selected.unit, "RL0101Gx"),
    RL0101Hx: rawTag(selected.unit, "RL0101Hx"),
    RL0101Ix: rawTag(selected.unit, "RL0101Ix"),
    RL0302A: rawTag(selected.unit, "RL0302A"),
  };
}

function fieldSelector(field: Field): string {
  if (field === "lot") return "served properties.noLot; role RL0103Ax";
  if (field === "adresse") return "served properties.adresse; role RL0101Ax/RL0101Ex/RL0101Gx (parseRole canonical address)";
  if (field === "code_postal") return "served properties.code_postal; role code_postal (null by role-foncier contract)";
  return "served properties.surface_m2; role RL0302A (superficie_terrain_m2_role)";
}

function servedValue(field: Field, lot: LotObservation): { key: string; value: Scalar } {
  if (field === "lot") return { key: "noLot", value: lot.canonicalNoLot };
  if (field === "adresse") return { key: "adresse", value: lot.adresse };
  if (field === "code_postal") return { key: "code_postal", value: lot.codePostal };
  return { key: "surface_m2", value: lot.surface };
}

function roleHasValue(field: Field, role: RoleAttrs): boolean {
  if (field === "lot") return true;
  if (field === "adresse") return role.adresse !== null;
  if (field === "code_postal") return role.code_postal !== null;
  return role.superficie_terrain_m2_role !== null;
}

function roleEvidenceValue(field: Field, raw: Record<string, string | null>): unknown {
  if (field === "lot") return raw["RL0103Ax"];
  if (field === "adresse") {
    return {
      RL0101Ax: raw["RL0101Ax"],
      RL0101Bx: raw["RL0101Bx"],
      RL0101Cx: raw["RL0101Cx"],
      RL0101Dx: raw["RL0101Dx"],
      RL0101Ex: raw["RL0101Ex"],
      RL0101Fx: raw["RL0101Fx"],
      RL0101Gx: raw["RL0101Gx"],
      RL0101Hx: raw["RL0101Hx"],
      RL0101Ix: raw["RL0101Ix"],
    };
  }
  if (field === "code_postal") return null;
  return raw["RL0302A"];
}

function roleAbsentEvidence(field: Field, raw: Record<string, string | null>): Record<string, unknown> {
  if (field === "lot") return { RL0103Ax: raw["RL0103Ax"] };
  if (field === "adresse") return { RL0101: null };
  if (field === "code_postal") return { code_postal: null };
  return { RL0302A: null };
}

function baseAttestation(date: string, selector: string, field: Field, served: ServedLots | null, role: RoleResolution | null): Omit<Attestation, "result" | "evidence"> {
  return {
    source: { cadastre: "qc-lots-served", role: "mamh-role-foncier" },
    asOf: date,
    query: {
      s3_key: served?.key ?? null,
      served_layout: served?.layout ?? null,
      lot_selector: { NO_LOT: selector },
      role_url: role?.roleUrl ?? null,
      role_selector: role ? `RL0103Ax = ${JSON.stringify(selector.replace(/ /g, ""))}` : null,
      field_selector: fieldSelector(field),
    },
  };
}

function inaccessible(date: string, selector: string, field: Field, served: ServedLots | null, role: RoleResolution | null, state: string): Attestation {
  return { ...baseAttestation(date, selector, field, served, role), result: "source-inaccessible", evidence: { state } };
}

function attestField(
  date: string,
  selector: string,
  field: Field,
  served: ServedLots,
  role: RoleResolution | null,
  roleState: string,
): Attestation {
  const lotKey = selector.replace(/ /g, "");
  const observations = served.requested.get(lotKey);
  if (!observations || observations.length === 0) {
    return inaccessible(date, selector, field, served, role, "qc-lots-lot-selector-absent");
  }
  const direct = observations.map((item) => servedValue(field, item)).find((value) => hasValue(value.value));
  const noLot = observations[0]!.noLotVerbatim;
  if (direct) {
    return {
      ...baseAttestation(date, selector, field, served, role),
      result: "present",
      evidence: { NO_LOT: noLot, [direct.key]: direct.value },
    };
  }
  if (!role) return inaccessible(date, selector, field, served, null, roleState);
  const matchedRole = role.roleMap[lotKey];
  if (!matchedRole) {
    return {
      ...baseAttestation(date, selector, field, served, role),
      result: "absent",
      evidence: { NO_LOT: noLot, RL0103Ax: null },
    };
  }
  const raw = rawRoleEvidence(role.xml, lotKey);
  if (!raw) return inaccessible(date, selector, field, served, role, "mamh-role-RL0103Ax-parser-map-disagreement");
  if (roleHasValue(field, matchedRole)) {
    return {
      ...baseAttestation(date, selector, field, served, role),
      result: "present",
      evidence: { NO_LOT: noLot, value: roleEvidenceValue(field, raw) },
    };
  }
  return {
    ...baseAttestation(date, selector, field, served, role),
    result: "absent",
    evidence: { NO_LOT: noLot, ...roleAbsentEvidence(field, raw) },
  };
}

function attestationFingerprint(args: AttestationArgs): string {
  return sha256(JSON.stringify({ slug: args.slug, lots: args.lots, fields: args.fields, date: args.date, maxMb: args.maxMb }));
}

function attestationKey(attestation: Attestation): string {
  return `${attestation.query.lot_selector.NO_LOT}\u0000${attestation.query.field_selector}`;
}

function readAttestationProgress(args: AttestationArgs): Map<string, Attestation> {
  if (!args.resume) return new Map();
  invariant(existsSync(args.checkpoint), `--resume requested but checkpoint is absent: ${relative(ROOT, args.checkpoint)}`);
  const value = JSON.parse(readFileSync(args.checkpoint, "utf8")) as Partial<AttestationProgress>;
  invariant(value.contract === "cadastre-role-absence-attestation-progress/v1", "attestation checkpoint contract is incompatible");
  invariant(value.fingerprint === attestationFingerprint(args), "attestation checkpoint is incompatible; restart without --resume");
  invariant(Array.isArray(value.attestations), "attestation checkpoint has no attestations array");
  const out = new Map<string, Attestation>();
  for (const item of value.attestations) {
    invariant(item && typeof item === "object", "attestation checkpoint has a malformed row");
    const attestation = item as Attestation;
    const key = attestationKey(attestation);
    invariant(!out.has(key), "attestation checkpoint has a duplicate result");
    out.set(key, attestation);
  }
  return out;
}

function saveAttestationProgress(args: AttestationArgs, results: ReadonlyMap<string, Attestation>): void {
  const progress: AttestationProgress = {
    contract: "cadastre-role-absence-attestation-progress/v1",
    fingerprint: attestationFingerprint(args),
    attestations: [...results.values()].sort((left, right) => ascending(attestationKey(left), attestationKey(right))),
  };
  writeAtomic(args.checkpoint, `${JSON.stringify(progress, null, 2)}\n`);
}

function municipalityBySlug(slug: string): Municipality {
  const raw = JSON.parse(readFileSync(MUNICIPALITIES, "utf8")) as unknown;
  invariant(Array.isArray(raw), "municipality registry must be an array");
  const found = raw.find((row) => record(row, "municipality registry row")["slug"] === slug);
  invariant(found, `municipality registry has no slug ${slug}`);
  const value = record(found, `municipality registry ${slug}`);
  invariant(typeof value["name"] === "string" && value["name"].length > 0, `municipality registry ${slug} has no name`);
  invariant(typeof value["priorityRank"] === "number" && Number.isInteger(value["priorityRank"]), `municipality registry ${slug} has no numeric priorityRank`);
  return { slug, name: value["name"], priorityRank: value["priorityRank"] };
}

async function runAttestation(args: AttestationArgs): Promise<void> {
  if (args.out && existsSync(args.out)) {
    console.log(readFileSync(args.out, "utf8").trim());
    return;
  }
  const expected = args.lots.flatMap((lot) => args.fields.map((field) => ({ lot, field })));
  const saved = readAttestationProgress(args);
  const complete = expected.every(({ lot, field }) => [...saved.values()].some((attestation) => attestation.query.lot_selector.NO_LOT === lot && attestation.query.field_selector === fieldSelector(field)));
  if (complete) {
    const output = expected.map(({ lot, field }) => [...saved.values()].find((attestation) => attestation.query.lot_selector.NO_LOT === lot && attestation.query.field_selector === fieldSelector(field))!);
    const text = `${JSON.stringify(output.length === 1 ? output[0] : output, null, 2)}\n`;
    if (args.out) writeImmutable(args.out, text);
    console.log(text.trim());
    return;
  }
  const deadline = Date.now() + args.maxSeconds * 1000;
  const municipality = municipalityBySlug(args.slug);
  const requestedKeys = new Set(args.lots.map((lot) => lot.replace(/ /g, "")));
  const s3 = s3Client();
  let served: ServedLots | null;
  try {
    served = await readServedLots(s3, args.slug, requestedKeys, deadline, Math.floor(args.maxMb * 1024 * 1024));
  } catch (error) {
    if (error instanceof TimeboxExceeded) {
      console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), resume: "--resume" }));
      return;
    }
    for (const { lot, field } of expected) {
      const attestation = inaccessible(args.date, lot, field, null, null, `qc-lots-read-failed:${error instanceof Error ? error.message : String(error)}`);
      saved.set(attestationKey(attestation), attestation);
    }
    saveAttestationProgress(args, saved);
    const output = expected.map(({ lot, field }) => [...saved.values()].find((attestation) => attestation.query.lot_selector.NO_LOT === lot && attestation.query.field_selector === fieldSelector(field))!);
    const text = `${JSON.stringify(output.length === 1 ? output[0] : output, null, 2)}\n`;
    if (args.out) writeImmutable(args.out, text);
    console.log(text.trim());
    return;
  }
  if (!served) {
    for (const { lot, field } of expected) {
      const attestation = inaccessible(args.date, lot, field, null, null, "qc-lots-not-served-in-supported-layouts");
      saved.set(attestationKey(attestation), attestation);
    }
  } else {
    const run = openCaptureRun({ lane: "cadastre", userAgent: NODE_FETCH_USER_AGENT });
    let resolved: { resolution: RoleResolution | null; state: string };
    let exitCode = 1;
    let timedOut = false;
    try {
      const index = await fetchIndex(DEFAULT_MILLESIME);
      resolved = await resolveRole(args.slug, municipality.name, served.allLotKeys, roleIndexByName(index), run, deadline, Math.min(Math.floor(args.maxMb * 1024 * 1024), MAX_ROLE_MB * 1024 * 1024));
      exitCode = 0;
    } catch (error) {
      if (error instanceof TimeboxExceeded) {
        timedOut = true;
        resolved = { resolution: null, state: "timebox" };
      } else {
        resolved = { resolution: null, state: `mamh-role-read-failed:${error instanceof Error ? error.message : String(error)}` };
        exitCode = 0;
      }
    } finally {
      await run.finish(exitCode);
    }
    if (timedOut) {
      console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), resume: "--resume" }));
      return;
    }
    for (const { lot, field } of expected) {
      const attestation = attestField(args.date, lot, field, served, resolved.resolution, resolved.state);
      saved.set(attestationKey(attestation), attestation);
      saveAttestationProgress(args, saved);
    }
  }
  const output = expected.map(({ lot, field }) => [...saved.values()].find((attestation) => attestation.query.lot_selector.NO_LOT === lot && attestation.query.field_selector === fieldSelector(field))!);
  const text = `${JSON.stringify(output.length === 1 ? output[0] : output, null, 2)}\n`;
  if (args.out) writeImmutable(args.out, text);
  console.log(text.trim());
}

function priority167(): { municipalities: Municipality[]; registrySha256: string } {
  const text = readFileSync(MUNICIPALITIES, "utf8");
  const raw = JSON.parse(text) as unknown;
  invariant(Array.isArray(raw), "municipality registry must be an array");
  const municipalities: Municipality[] = [];
  for (const row of raw) {
    const value = record(row, "municipality registry row");
    invariant(typeof value["slug"] === "string" && value["slug"].length > 0, "municipality registry row has no slug");
    invariant(typeof value["name"] === "string" && value["name"].length > 0, `municipality registry ${value["slug"]} has no name`);
    if (typeof value["priorityRank"] !== "number" || !Number.isInteger(value["priorityRank"]) || value["priorityRank"] > 167) continue;
    municipalities.push({ slug: value["slug"], name: value["name"], priorityRank: value["priorityRank"] });
  }
  municipalities.sort((left, right) => left.priorityRank - right.priorityRank);
  invariant(municipalities.length === 167, `priorityRank <= 167 yielded ${municipalities.length} municipalities, expected 167`);
  invariant(municipalities.every((municipality, index) => municipality.priorityRank === index + 1), "priorityRank <= 167 must be exactly ranks 1..167");
  return { municipalities, registrySha256: sha256(text) };
}

function coverageFingerprint(args: CoverageArgs, registrySha256: string): string {
  return sha256(JSON.stringify({ date: args.date, maxMb: args.maxMb, registrySha256, selector: "priorityRank <= 167" }));
}

function readCoverageProgress(args: CoverageArgs, registrySha256: string): Map<string, CoverageRow> {
  if (!args.resume) return new Map();
  invariant(existsSync(args.checkpoint), `--resume requested but checkpoint is absent: ${relative(ROOT, args.checkpoint)}`);
  const progress = JSON.parse(readFileSync(args.checkpoint, "utf8")) as Partial<CoverageProgress>;
  invariant(progress.contract === "qc-lots-coverage-dump-progress/v1", "coverage checkpoint contract is incompatible");
  invariant(progress.fingerprint === coverageFingerprint(args, registrySha256), "coverage checkpoint is incompatible; restart without --resume");
  invariant(Array.isArray(progress.municipalities), "coverage checkpoint has no municipalities array");
  const rows = new Map<string, CoverageRow>();
  for (const row of progress.municipalities) {
    invariant(row && typeof row === "object" && typeof row.slug === "string", "coverage checkpoint has a malformed row");
    invariant(!rows.has(row.slug), `coverage checkpoint duplicates ${row.slug}`);
    rows.set(row.slug, row);
  }
  return rows;
}

function saveCoverageProgress(args: CoverageArgs, registrySha256: string, rows: ReadonlyMap<string, CoverageRow>): void {
  const progress: CoverageProgress = {
    contract: "qc-lots-coverage-dump-progress/v1",
    fingerprint: coverageFingerprint(args, registrySha256),
    municipalities: [...rows.values()].sort((left, right) => left.priorityRank - right.priorityRank),
  };
  writeAtomic(args.checkpoint, `${JSON.stringify(progress, null, 2)}\n`);
}

async function coverageRow(s3: S3Client, municipality: Municipality, deadline: number, maxBytes: number): Promise<CoverageRow> {
  const selected = await selectedServedKey(s3, municipality.slug);
  if (!selected) {
    return { slug: municipality.slug, priorityRank: municipality.priorityRank, served_key: null, numberMatched: null, noLot_count: null, present: false };
  }
  if (selected.contentLength !== undefined && selected.contentLength > maxBytes) {
    fail(`served GeoJSON ${selected.key} is ${selected.contentLength} bytes, above --max-mb guard ${maxBytes}`);
  }
  let bytes = await getS3BytesWithinDeadline(s3, selected.key, deadline);
  try {
    if (bytes.length > maxBytes) fail(`served GeoJSON ${selected.key} is ${bytes.length} bytes, above --max-mb guard ${maxBytes}`);
    let numberMatched = 0;
    let noLotCount = 0;
    visitFeatures(bytes, selected.key, deadline, (properties) => {
      numberMatched++;
      if (hasValue(scalar(properties["noLot"]))) noLotCount++;
    });
    return {
      slug: municipality.slug,
      priorityRank: municipality.priorityRank,
      served_key: selected.key,
      numberMatched,
      noLot_count: noLotCount,
      present: true,
    };
  } finally {
    bytes = Buffer.alloc(0);
  }
}

function coverageReport(date: string, registrySha256: string, rows: readonly CoverageRow[]): CoverageReport {
  const ordered = rows.slice().sort((left, right) => left.priorityRank - right.priorityRank);
  invariant(ordered.length === 167, `coverage rows ${ordered.length}, expected 167`);
  const served = ordered.filter((row) => row.present);
  invariant(served.every((row) => row.served_key !== null && row.numberMatched !== null && row.noLot_count !== null), "served coverage row has a null measurement");
  const absent = ordered.filter((row) => !row.present);
  invariant(absent.every((row) => row.served_key === null && row.numberMatched === null && row.noLot_count === null), "unserved coverage row fabricates a measurement");
  return {
    $schema: "qc-lots-coverage-dump/v1",
    asOf: date,
    source: {
      registry: "packages/qc-sources/src/geo/municipalities.qc.json",
      registry_sha256: registrySha256,
      selector: "typeof priorityRank === 'number' && priorityRank <= 167",
      selected_count: 167,
      served_layout_policy: "normalized/qc-lots/qc-lots-<slug>/qc-lots-<slug>.geojson before normalized/qc-lots/qc-lots-<slug>.geojson; never combine layouts",
      numberMatched_policy: "Count every Feature in the selected served GeoJSON: this is the unfiltered OGC numberMatched loop; noLot_count counts only non-empty properties.noLot.",
    },
    municipalities: ordered,
    summary: {
      municipalities: ordered.length,
      served: served.length,
      total_numberMatched: served.reduce((sum, row) => sum + row.numberMatched!, 0),
      total_noLot_count: served.reduce((sum, row) => sum + row.noLot_count!, 0),
      present_false: absent.map((row) => row.slug),
    },
  };
}

function coverageMarkdown(report: CoverageReport): string {
  return [
    "# Dump de couverture qc-lots — KPI 14",
    "",
    `Instantané ${report.asOf}, lecture seule S3. Périmètre : ${report.source.selector} du registre committé (${report.source.selected_count} municipalités).`,
    "",
    `Collections qc-lots servies : ${report.summary.served}/167. Total \`numberMatched\` : ${report.summary.total_numberMatched}. Total \`noLot\` : ${report.summary.total_noLot_count}.`,
    "",
    "Le sous-dossier est sélectionné avant le plat, exactement comme geo-api. `numberMatched` est le compte de Features du GeoJSON retenu; `noLot_count` compte seulement `properties.noLot` non vide. `present:false` signifie explicitement que qc-lots n'est servi dans aucun des deux layouts, et porte des mesures nulles — jamais « pas trouvé ».",
    "",
    `present:false (${report.summary.present_false.length}) : ${report.summary.present_false.length ? report.summary.present_false.join(", ") : "aucune"}.`,
    "",
  ].join("\n");
}

async function runCoverage(args: CoverageArgs): Promise<void> {
  const { municipalities, registrySha256 } = priority167();
  const rows = readCoverageProgress(args, registrySha256);
  const deadline = Date.now() + args.maxSeconds * 1000;
  const s3 = s3Client();
  for (const municipality of municipalities) {
    if (rows.has(municipality.slug)) continue;
    if (Date.now() >= deadline) break;
    try {
      rows.set(municipality.slug, await coverageRow(s3, municipality, deadline, Math.floor(args.maxMb * 1024 * 1024)));
    } catch (error) {
      if (error instanceof TimeboxExceeded) break;
      throw error;
    }
    saveCoverageProgress(args, registrySha256, rows);
    console.error(`[qc-lots-coverage] progress ${rows.size}/167 checkpoint=${relative(ROOT, args.checkpoint)}`);
  }
  if (rows.size !== 167) {
    console.log(JSON.stringify({ complete: false, checkpoint: relative(ROOT, args.checkpoint), measured_municipalities: rows.size, remaining_municipalities: 167 - rows.size, resume: `--coverage-dump-167 --date ${args.date} --resume --max-seconds ${args.maxSeconds}` }));
    return;
  }
  const report = coverageReport(args.date, registrySha256, [...rows.values()]);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  invariant(args.out !== null, "coverage output path is required");
  writeImmutable(args.out, text);
  const markdownPath = args.out.replace(/\.json$/u, ".md");
  writeImmutable(markdownPath, coverageMarkdown(report));
  console.log(JSON.stringify({ complete: true, output: relative(ROOT, args.out), markdown: relative(ROOT, markdownPath), summary: report.summary, checkpoint: relative(ROOT, args.checkpoint) }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(usage());
    return;
  }
  if (args.mode === "coverage") await runCoverage(args);
  else await runAttestation(args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
