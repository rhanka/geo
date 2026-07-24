/**
 * _null-zone-source-probe.ts — READ-ONLY diagnostic for the null-zone-sourcing
 * lane (work/coverage/null-zone-sourcing-20260724.{json,md}).
 *
 * Goal: for served qc-zonage collections that carry `zone_source_url: null`
 * (honest null — geometry provenance not retained), OUTSIDE focus-30, help an
 * operator find a REAL public geometric source (ArcGIS/AGOL FeatureServer,
 * WFS, geocentralis, official GeoJSON) and cheaply cross-check it against the
 * codes actually served, WITHOUT ever writing to S3 (no fold, no
 * putServedZone*, no deposit — this script has zero S3 write calls).
 *
 * Three subcommands:
 *
 *   --list [--limit N] [--offset N]
 *     Static, no network: loads the committed readback audit
 *     (work/coverage/zone-source-readback-audit-20260724.json by default),
 *     takes its `stamped_null` slug list, drops FOCUS_30_SLUGS
 *     (./focus30-status.ts), joins muni name/mrc from
 *     packages/qc-sources/src/geo/municipalities.qc.json, and prints one line
 *     per slug (feature count comes straight from the audit, no S3 read).
 *
 *   --probe --slug <slug>
 *     ONE live S3 GET (read-only) of the currently served qc-zonage
 *     collection for <slug>. Reports the CURRENT zone_source_url/level
 *     (catches "already-has-source" drift since the static audit's
 *     generatedAt — other lanes deposit concurrently), feature count, and a
 *     sample of up to 15 distinct `zone_code` values to use as a fingerprint
 *     when researching a candidate source.
 *
 *   --verify --slug <slug> --url <url> [--field <field>] [--type arcgis|geojson]
 *     Fetches the candidate URL ONLY (GET, no S3 write): for --type arcgis
 *     (default when the URL contains "FeatureServer" or "MapServer"),
 *     auto-appends a /query?where=1=1&outFields=*&f=geojson if the URL
 *     doesn't already look like a query; for --type geojson, fetches as-is.
 *     Extracts distinct values of --field (default "zone_code", case-
 *     insensitive fallback), re-reads the LIVE served codes for <slug> (same
 *     S3 GET as --probe) and reports the overlap: candidate feature count,
 *     distinct candidate codes, matched codes count + sample. Verdict is
 *     left to the operator (this only measures overlap, never invents one).
 *
 * Everything is read-only: S3 GET/List via lib/s3.ts, HTTP GET via fetch.
 * No PutObjectCommand, no lib/zonage-proof.ts import, ever.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import { FOCUS_30_SLUGS } from "./focus30-status.js";
import { getGeoJsonFeatureCollection, isServedZoneKey, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_AUDIT = resolve(ROOT, "work", "coverage", "zone-source-readback-audit-20260724.json");
const MUNIS_PATH = resolve(ROOT, "packages", "qc-sources", "src", "geo", "municipalities.qc.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const HTTP_UA = "sentropic-geo-null-zone-probe/0.1";
const FETCH_TIMEOUT_MS = 20_000;

interface MuniEntry { slug: string; name: string; mrc: string | null }
interface AuditDetail { slug: string; status: string; features: number }
interface AuditReport { contract: string; details: AuditDetail[]; slugs: { stamped_null: string[] } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadMunis(): Map<string, MuniEntry> {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const map = new Map<string, MuniEntry>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry) || typeof entry["slug"] !== "string") continue;
      map.set(entry["slug"], {
        slug: entry["slug"],
        name: typeof entry["name"] === "string" ? entry["name"] : entry["slug"],
        mrc: typeof entry["mrc"] === "string" ? entry["mrc"] : null,
      });
    }
  }
  return map;
}

function loadAudit(path: string): AuditReport {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw["details"]) || !isRecord(raw["slugs"])) {
    throw new Error(`${path} does not look like a zone-source-readback-audit report`);
  }
  return raw as unknown as AuditReport;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

// -----------------------------------------------------------------------
// --list
// -----------------------------------------------------------------------
function cmdList(args: Record<string, string | boolean>): void {
  const auditPath = typeof args["audit"] === "string" ? resolve(ROOT, args["audit"]) : DEFAULT_AUDIT;
  const audit = loadAudit(auditPath);
  const munis = loadMunis();
  const focus30 = new Set(FOCUS_30_SLUGS);
  const featuresBySlug = new Map(audit.details.map((detail) => [detail.slug, detail.features]));
  const worklist = audit.slugs.stamped_null
    .filter((slug) => !focus30.has(slug))
    .sort((left, right) => left.localeCompare(right));

  const offset = typeof args["offset"] === "string" ? Number(args["offset"]) : 0;
  const limit = typeof args["limit"] === "string" ? Number(args["limit"]) : worklist.length;
  const page = worklist.slice(offset, offset + limit);

  console.log(`worklist total (null, hors focus-30): ${worklist.length} — showing [${offset}, ${offset + page.length})`);
  for (const slug of page) {
    const muni = munis.get(slug);
    console.log(
      `${slug}\tname=${muni?.name ?? "?"}\tmrc=${muni?.mrc ?? "?"}\tfeatures=${featuresBySlug.get(slug) ?? "?"}`,
    );
  }
}

// -----------------------------------------------------------------------
// --emit-registry-base [--out <path>]
// Writes the FULL worklist (null, hors focus-30) as a registry scaffold, all
// entries verdict="not-examined" — the operator then hand-patches the slugs
// actually researched this tour with their real verdict (candidate-real-
// source / orphan / already-has-source). Pure JSON generation, no network.
// -----------------------------------------------------------------------
interface RegistryEntry {
  slug: string;
  verdict: "candidate-real-source" | "orphan" | "already-has-source" | "not-examined";
  url: string | null;
  type: "arcgis" | "agol" | "wfs" | "jmap" | "geojson-officiel" | "geonet" | null;
  features: number | null;
  codes_recoupes: string[];
  note: string;
}

function cmdEmitRegistryBase(args: Record<string, string | boolean>): void {
  const auditPath = typeof args["audit"] === "string" ? resolve(ROOT, args["audit"]) : DEFAULT_AUDIT;
  const audit = loadAudit(auditPath);
  const munis = loadMunis();
  const focus30 = new Set(FOCUS_30_SLUGS);
  const featuresBySlug = new Map(audit.details.map((detail) => [detail.slug, detail.features]));
  const worklist = audit.slugs.stamped_null.filter((slug) => !focus30.has(slug)).sort((left, right) => left.localeCompare(right));
  const entries: RegistryEntry[] = worklist.map((slug) => {
    const muni = munis.get(slug);
    return {
      slug,
      verdict: "not-examined",
      url: null,
      type: null,
      features: featuresBySlug.get(slug) ?? null,
      codes_recoupes: [],
      note: `name=${muni?.name ?? "?"} mrc=${muni?.mrc ?? "?"} — pas encore recherché ce tour`,
    };
  });
  const outPath = typeof args["out"] === "string" ? resolve(ROOT, args["out"]) : resolve(ROOT, "work", "coverage", "null-zone-sourcing-20260724.json");
  writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`wrote ${entries.length} scaffold entries -> ${outPath}`);
}

// -----------------------------------------------------------------------
// shared: live read of the currently served collection for a slug
// -----------------------------------------------------------------------
interface LiveZone {
  key: string;
  url: unknown;
  level: unknown;
  features: number;
  codes: string[];
}

async function readLive(slug: string): Promise<LiveZone> {
  const s3 = s3Client();
  const flat = `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  let key = nested;
  let collection;
  try {
    collection = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> }>(s3, nested);
    if (!isServedZoneKey(nested)) throw new Error("nested key rejected by isServedZoneKey");
  } catch {
    key = flat;
    collection = await getGeoJsonFeatureCollection<{ properties?: Record<string, unknown> }>(s3, flat);
  }
  const features = collection.features ?? [];
  const codes = [...new Set(
    features
      .map((feature) => feature.properties?.["zone_code"])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort();
  const first = features[0]?.properties ?? {};
  return {
    key,
    url: first["zone_source_url"],
    level: first["zone_source_level"],
    features: features.length,
    codes,
  };
}

// -----------------------------------------------------------------------
// --probe
// -----------------------------------------------------------------------
async function cmdProbe(args: Record<string, string | boolean>): Promise<void> {
  const slug = args["slug"];
  if (typeof slug !== "string" || !slug) throw new Error("--probe requires --slug <slug>");
  const munis = loadMunis();
  const muni = munis.get(slug);
  const live = await readLive(slug);
  console.log(`slug=${slug} name=${muni?.name ?? "?"} mrc=${muni?.mrc ?? "?"}`);
  console.log(`key=${live.key} features=${live.features}`);
  console.log(`LIVE zone_source_url=${JSON.stringify(live.url)} zone_source_level=${JSON.stringify(live.level)}`);
  if (live.url !== null && live.url !== undefined) {
    console.log(`NOTE: already-has-source (live url is non-null) — audit snapshot may be stale, re-classify accordingly.`);
  }
  console.log(`sample codes (${Math.min(15, live.codes.length)}/${live.codes.length}): ${live.codes.slice(0, 15).join(", ")}`);
}

// -----------------------------------------------------------------------
// --verify
// -----------------------------------------------------------------------
async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": HTTP_UA, Accept: "application/json,*/*" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildCandidateUrl(url: string, type: string): string {
  if (type !== "arcgis") return url;
  if (/[?&](query|f=)/i.test(url) || /\/query\b/i.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  const base = url.endsWith("/query") ? url : `${url.replace(/\/$/, "")}/query`;
  return `${base}${url.endsWith("/query") ? sep : "?"}where=1%3D1&outFields=*&f=geojson&resultRecordCount=5000`;
}

function extractFeatures(payload: unknown): Array<{ properties?: Record<string, unknown> }> {
  if (isRecord(payload) && Array.isArray(payload["features"])) {
    return payload["features"] as Array<{ properties?: Record<string, unknown> }>;
  }
  return [];
}

function fieldValue(properties: Record<string, unknown> | undefined, field: string): string | null {
  if (!properties) return null;
  if (field in properties) {
    const value = properties[field];
    return typeof value === "string" && value.length > 0 ? value : value != null ? String(value) : null;
  }
  const lower = field.toLowerCase();
  for (const [key, value] of Object.entries(properties)) {
    if (key.toLowerCase() === lower && value != null) return String(value);
  }
  return null;
}

async function cmdVerify(args: Record<string, string | boolean>): Promise<void> {
  const slug = args["slug"];
  const url = args["url"];
  if (typeof slug !== "string" || !slug) throw new Error("--verify requires --slug <slug>");
  if (typeof url !== "string" || !url) throw new Error("--verify requires --url <url>");
  const field = typeof args["field"] === "string" ? args["field"] : "zone_code";
  const type = typeof args["type"] === "string" ? args["type"] : /FeatureServer|MapServer/i.test(url) ? "arcgis" : "geojson";

  const candidateUrl = buildCandidateUrl(url, type);
  console.log(`fetching (type=${type}): ${candidateUrl}`);
  const payload = await fetchWithTimeout(candidateUrl);
  const features = extractFeatures(payload);
  const rawCodes = features.map((feature) => fieldValue(feature.properties, field)).filter((value): value is string => !!value);
  const distinctCodes = [...new Set(rawCodes)].sort();
  const canonicalCandidate = new Set(distinctCodes.map((code) => canonicalizeZoneCodeForJoin(code)));

  const live = await readLive(slug);
  const canonicalServed = new Set(live.codes.map((code) => canonicalizeZoneCodeForJoin(code)));
  const matched = [...canonicalCandidate].filter((code) => canonicalServed.has(code));

  console.log(`candidate features=${features.length} distinct(${field})=${distinctCodes.length}`);
  console.log(`sample candidate codes: ${distinctCodes.slice(0, 15).join(", ")}`);
  console.log(`served (live) codes=${live.codes.length} sample: ${live.codes.slice(0, 15).join(", ")}`);
  console.log(`OVERLAP matched=${matched.length} sample: ${matched.slice(0, 10).join(", ")}`);
  console.log(matched.length > 0 ? "VERDICT-HINT: overlap>0 -> plausible real source for this muni" : "VERDICT-HINT: overlap=0 -> do NOT trust as-is (wrong muni/vintage or field mismatch)");
}

// -----------------------------------------------------------------------
// --mamh-match --codes c1,c2,... (READ-ONLY, HTTP only, no S3): resolve a
// list of MAMH `id_municipalite` geographic codes (as seen on the
// geocentralis WFS `evb:siadmin_pzon_99_s`) to municipality names via the
// official MAMH répertoire CSV, then match each name against the (static,
// no-network) null worklist by normalized name, to surface slugs that are
// candidates for that same shared WFS gisement.
// -----------------------------------------------------------------------
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function cmdMamhMatch(args: Record<string, string | boolean>): Promise<void> {
  const codesArg = args["codes"];
  if (typeof codesArg !== "string" || !codesArg) throw new Error("--mamh-match requires --codes c1,c2,...");
  const codes = codesArg.split(",").map((c) => c.trim()).filter(Boolean);
  const response = await fetch("https://donneesouvertes.affmunqc.net/repertoire/MUN.csv", {
    headers: { "User-Agent": HTTP_UA },
  });
  if (!response.ok) throw new Error(`MUN.csv HTTP ${response.status}`);
  const text = await response.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf("mcode");
  const nameIdx = header.indexOf("munnom");
  if (codeIdx < 0 || nameIdx < 0) throw new Error(`MUN.csv header not recognised: ${header.join(",")}`);
  const byCode = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const code = (cols[codeIdx] ?? "").trim();
    const name = (cols[nameIdx] ?? "").trim();
    if (code) byCode.set(code, name);
  }

  const auditPath = typeof args["audit"] === "string" ? resolve(ROOT, args["audit"]) : DEFAULT_AUDIT;
  const audit = loadAudit(auditPath);
  const focus30 = new Set(FOCUS_30_SLUGS);
  const munis = loadMunis();
  const nameToSlug = new Map<string, string>();
  for (const [slug, muni] of munis) nameToSlug.set(normalizeName(muni.name), slug);
  const nullSlugs = new Set(audit.slugs.stamped_null.filter((slug) => !focus30.has(slug)));

  for (const code of codes) {
    const name = byCode.get(code);
    if (!name) {
      console.log(`${code}\tNOT-IN-MUN-CSV`);
      continue;
    }
    const slug = nameToSlug.get(normalizeName(name));
    const inNullList = slug ? nullSlugs.has(slug) : false;
    console.log(`${code}\tname=${name}\tslug=${slug ?? "?"}\tin-null-worklist=${inNullList}`);
  }
}

// -----------------------------------------------------------------------
// --fields (candidate reconnaissance: property keys + first values, no S3)
// -----------------------------------------------------------------------
async function cmdFields(args: Record<string, string | boolean>): Promise<void> {
  const url = args["url"];
  if (typeof url !== "string" || !url) throw new Error("--fields requires --url <url>");
  const type = typeof args["type"] === "string" ? args["type"] : /FeatureServer|MapServer/i.test(url) ? "arcgis" : "geojson";
  const candidateUrl = buildCandidateUrl(url, type);
  console.log(`fetching (type=${type}): ${candidateUrl}`);
  const payload = await fetchWithTimeout(candidateUrl);
  const features = extractFeatures(payload);
  console.log(`features=${features.length}`);
  const first = features[0]?.properties ?? {};
  console.log(`property keys (feature[0]): ${Object.keys(first).join(", ")}`);
  console.log(`feature[0] values: ${JSON.stringify(first, null, 2)}`);
}

// -----------------------------------------------------------------------
// --validate-registry --file <path> : parse + summarize a registry JSON
// (catches malformed JSON from hand-edits; no network, no S3).
// -----------------------------------------------------------------------
function cmdValidateRegistry(args: Record<string, string | boolean>): void {
  const file = typeof args["file"] === "string" ? resolve(ROOT, args["file"]) : resolve(ROOT, "work", "coverage", "null-zone-sourcing-20260724.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("registry must be a JSON array");
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  let dupes = 0;
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry["slug"] !== "string" || typeof entry["verdict"] !== "string") {
      throw new Error(`malformed entry: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry["slug"])) dupes += 1;
    seen.add(entry["slug"]);
    counts[entry["verdict"]] = (counts[entry["verdict"]] ?? 0) + 1;
  }
  console.log(`OK: ${raw.length} entries, ${seen.size} distinct slugs, ${dupes} duplicate(s)`);
  for (const [verdict, count] of Object.entries(counts).sort()) console.log(`  ${verdict}: ${count}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args["list"]) return cmdList(args);
  if (args["probe"]) return cmdProbe(args);
  if (args["fields"]) return cmdFields(args);
  if (args["verify"]) return cmdVerify(args);
  if (args["mamh-match"]) return cmdMamhMatch(args);
  if (args["emit-registry-base"]) return cmdEmitRegistryBase(args);
  if (args["validate-registry"]) return cmdValidateRegistry(args);
  console.log("usage: npx tsx acquisition/src/_null-zone-source-probe.ts --list [--limit N --offset N]");
  console.log("       npx tsx acquisition/src/_null-zone-source-probe.ts --probe --slug <slug>");
  console.log("       npx tsx acquisition/src/_null-zone-source-probe.ts --fields --url <url> [--type arcgis|geojson]");
  console.log("       npx tsx acquisition/src/_null-zone-source-probe.ts --verify --slug <slug> --url <url> [--field zone_code] [--type arcgis|geojson]");
  process.exitCode = 1;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
