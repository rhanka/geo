/**
 * Analyse en lecture seule les catalogues capturés de la passe catégorie A et
 * matérialise les URLs de suivi sans jamais refaire un fetch local.
 *
 * Entrées : manifestes/CAS S3 produits par k8s-capture-run.ts.
 * Sorties : trois worklists génériques 6/6/5, destinées au même runner cluster.
 * Les URLs déjà tentées dans n'importe quel préfixe fourni sont exclues.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CaptureRunHeaderSchema,
  parseCaptureWorklist,
  parseManifestJsonl,
  type CaptureManifestLine,
  type CaptureWorklistTarget,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  CATEGORY_A_GISEMENT_TARGETS,
  type CategoryAGisementTarget,
} from "./category-a-gisements-worklist.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
// Le suffixe `-document` permet au rapport natif existant de relire aussi cette
// passe. Les catalogues texte restent sans signal; les PDF/XLS passent par le
// parseur natif avant toute route vision.
const SOURCE = "normes-a-gisements-document";
const LOT_SIZE = 6;
const STRONG_DOCUMENT_HINT =
  /zonag|urbanis|grille|sp[eé]cification|usages?.{0,16}normes?|densit|logements?.{0,16}(?:hectare|ha\b)|occupation.{0,10}sol|coefficient|certificat.{0,16}conformit/i;
const PAGE_HINT =
  /zonag|urbanis|grille|documentation|centre-documentaire|municipalit|arcgis|jmap|geocentri/i;
const PROJECT_HINT =
  /(?:^|[\/_.\s-])(?:premier|second|1er|2e)?[\/_.\s-]*projet(?:s)?[\/_.\s-]*(?:de[\/_.\s-]*)?r[eè]glement|avis[\/_.\s-]+public/i;
const DOCUMENT_EXT = /\.(?:pdf|xlsx?|docx?)(?:$|[?#])/i;
const SITEMAP = /(?:sitemap|wp-sitemap|post-sitemap|page-sitemap|wpfd).*\.xml(?:$|[?#])/i;
const SERVICE = /\/(?:FeatureServer|MapServer)(?:\/\d+)?(?:$|[?#])/i;

interface CompletedRun {
  manifestKey: string;
  exitCode: number;
  lines: CaptureManifestLine[];
}

export interface FollowupDiscovery {
  documents: string[];
  catalogs: string[];
}

function safeUrl(raw: string, base: string): string | null {
  const decoded = raw
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/[),.;'"]+$/, "");
  try {
    const url = new URL(decoded, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) stringsOf(item, out);
  }
  return out;
}

function addArcgisFollowups(url: string, catalogs: Set<string>): void {
  const parsed = new URL(url);
  if (parsed.hostname === "www.arcgis.com") {
    const item = /\/content\/items\/([a-f0-9]{32})(?:\/data)?/i.exec(parsed.pathname)?.[1];
    if (item) {
      catalogs.add(`https://www.arcgis.com/sharing/rest/content/items/${item}?f=json`);
      catalogs.add(`https://www.arcgis.com/sharing/rest/content/items/${item}/data?f=json`);
    }
  }
  if (!SERVICE.test(url)) return;
  const clean = new URL(url);
  clean.search = "";
  clean.hash = "";
  clean.searchParams.set("f", "pjson");
  catalogs.add(clean.href);
}

function addCandidate(raw: string, context: string, base: string, result: {
  documents: Set<string>;
  catalogs: Set<string>;
}): void {
  const url = safeUrl(raw, base);
  if (url === null) return;
  const haystack = `${context} ${url}`;
  const regulationOnUrbanismPage =
    /r[eè]glement|reglement/i.test(haystack)
    && /zonag|urbanis/i.test(base);
  if (
    DOCUMENT_EXT.test(url)
    && !PROJECT_HINT.test(haystack)
    && (STRONG_DOCUMENT_HINT.test(haystack) || regulationOnUrbanismPage)
  ) {
    result.documents.add(url);
    return;
  }
  const fromSitemap = SITEMAP.test(base);
  const serviceWithSubject = SERVICE.test(url) && STRONG_DOCUMENT_HINT.test(haystack);
  const incidentalWpRoute =
    /\/wp-json\//i.test(url)
    && !/\/wp-json\/wp\/v2\/media(?:[/?#]|$)/i.test(url);
  if (
    SITEMAP.test(url)
    || /\/wp-json\/wp\/v2\/media(?:[/?#]|$)|\/storage\/app\/media/i.test(url)
    || serviceWithSubject
    || (
      !fromSitemap
      && !incidentalWpRoute
      && PAGE_HINT.test(haystack)
      && !/\.(?:png|jpe?g|gif|svg|css|js)(?:$|[?#])/i.test(url)
    )
  ) {
    result.catalogs.add(url);
    addArcgisFollowups(url, result.catalogs);
  }
}

function parseCdx(value: unknown, result: { documents: Set<string>; catalogs: Set<string> }): void {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return;
  const header = value[0].map(String);
  const originalIndex = header.indexOf("original");
  const timestampIndex = header.indexOf("timestamp");
  if (originalIndex < 0 || timestampIndex < 0) return;
  for (const rawRow of value.slice(1)) {
    if (!Array.isArray(rawRow)) continue;
    const original = String(rawRow[originalIndex] ?? "");
    const timestamp = String(rawRow[timestampIndex] ?? "");
    if (
      !/^\d{14}$/.test(timestamp)
      || !DOCUMENT_EXT.test(original)
      || !STRONG_DOCUMENT_HINT.test(original)
    ) continue;
    const live = safeUrl(original, original);
    if (live === null) continue;
    result.documents.add(live); // http:// reste volontairement accepté.
    result.documents.add(`https://web.archive.org/web/${timestamp}id_/${live}`);
  }
}

function parseJsonObject(value: unknown, base: string, result: {
  documents: Set<string>;
  catalogs: Set<string>;
}): void {
  parseCdx(value, result);
  if (Array.isArray(value)) {
    for (const item of value) parseJsonObject(item, base, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const context = stringsOf(record).join(" ");
  for (const [key, candidate] of Object.entries(record)) {
    if (!/(?:^|_)(?:source_)?url$|href|link|lien|document|pdf|guid/i.test(key)) continue;
    if (typeof candidate === "string") addCandidate(candidate, context, base, result);
    else if (candidate && typeof candidate === "object") {
      const rendered = (candidate as Record<string, unknown>)["rendered"];
      if (typeof rendered === "string") addCandidate(rendered, context, base, result);
    }
  }
  const id = typeof record["id"] === "string" && /^[a-f0-9]{32}$/i.test(record["id"])
    ? record["id"]
    : null;
  if (id !== null && STRONG_DOCUMENT_HINT.test(context)) {
    result.catalogs.add(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`);
    result.catalogs.add(`https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=json`);
  }
  for (const item of Object.values(record)) parseJsonObject(item, base, result);
}

function addArcgisLayerQueries(value: unknown, base: string, catalogs: Set<string>): void {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return;
  }
  const serviceMatch = /(.*\/(?:FeatureServer|MapServer))(?:\/(\d+))?\/?$/i.exec(parsed.pathname);
  if (!serviceMatch || !value || typeof value !== "object") return;
  const service = `${parsed.origin}${serviceMatch[1]}`;
  const addLayer = (id: number): void => {
    catalogs.add(`${service}/${id}?f=pjson`);
    const query = new URL(`${service}/${id}/query`);
    query.searchParams.set("where", "1=1");
    query.searchParams.set("outFields", "*");
    query.searchParams.set("returnGeometry", "false");
    query.searchParams.set("resultRecordCount", "2000");
    query.searchParams.set("f", "json");
    catalogs.add(query.href);
  };
  const explicitLayer = serviceMatch[2];
  if (explicitLayer !== undefined) addLayer(Number(explicitLayer));
  const layers = (value as Record<string, unknown>)["layers"];
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (!layer || typeof layer !== "object") continue;
      const id = (layer as Record<string, unknown>)["id"];
      if (typeof id === "number" && Number.isInteger(id) && id >= 0) addLayer(id);
    }
  }
}

export function discoverFollowups(text: string, base: string): FollowupDiscovery {
  const result = { documents: new Set<string>(), catalogs: new Set<string>() };
  let parsedJson = false;
  try {
    const value: unknown = JSON.parse(text);
    parsedJson = true;
    parseJsonObject(value, base, result);
    addArcgisLayerQueries(value, base, result.catalogs);
  } catch {
    // HTML/XML/JS sont traités ci-dessous sans interpréter leur structure.
  }
  if (!parsedJson) {
    for (const match of text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
      addCandidate(match[1]!.trim(), match[1]!, base, result);
    }
    for (const match of text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = match[2]!.replace(/<[^>]+>/g, " ");
      addCandidate(match[1]!, `${label} ${match[0]!}`, base, result);
    }
    for (const match of text.matchAll(/(?:https?:\\?\/\\?\/|(?:href|src|data-url|data-href)=["'])[^"'<>\s]+/gi)) {
      const raw = match[0]!.replace(/^(?:href|src|data-url|data-href)=["']/, "");
      addCandidate(raw, match[0]!, base, result);
    }
  }
  return {
    documents: [...result.documents].sort(),
    catalogs: [...result.catalogs].sort(),
  };
}

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) => value === `--${name}` && argv[index + 1] ? [argv[index + 1]!] : []);
}

function option(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

async function completedRuns(prefixes: readonly string[]): Promise<CompletedRun[]> {
  const s3 = s3Client();
  const manifestKeys = new Set<string>();
  for (const prefix of prefixes) {
    for (const entry of await listObjectEntries(s3, `capture/_runs/${prefix}`)) {
      if (entry.key.endsWith("/manifest.jsonl")) manifestKeys.add(entry.key);
    }
  }
  const runs: CompletedRun[] = [];
  for (const manifestKey of [...manifestKeys].sort()) {
    const runId = manifestKey.slice("capture/_runs/".length, -"/manifest.jsonl".length);
    const headerEntries = await listObjectEntries(s3, `capture/_runs/${runId}/run.json`);
    if (!headerEntries.some((entry) => entry.key === `capture/_runs/${runId}/run.json`)) continue;
    const header = CaptureRunHeaderSchema.parse(
      JSON.parse((await getBytes(s3, `capture/_runs/${runId}/run.json`)).toString("utf8")),
    );
    if (header.finished_at === null || header.exit_code === null) continue;
    runs.push({
      manifestKey,
      exitCode: header.exit_code,
      lines: parseManifestJsonl((await getBytes(s3, manifestKey)).toString("utf8")),
    });
  }
  return runs;
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function comparable(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function hostWithoutWww(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
}

function isOwnerSearch(lineUrl: string, target: CategoryAGisementTarget): boolean {
  const search = new URL(lineUrl).searchParams.get("search");
  return search !== null && comparable(search) === comparable(target.name);
}

function candidateNamesOwner(url: string, target: CategoryAGisementTarget): boolean {
  const parsed = new URL(url);
  let path = parsed.pathname + parsed.search;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Le chemin brut reste comparable si un ancien site contient un % invalide.
  }
  return comparable(path).includes(comparable(target.name));
}

function isMrcDomainCapture(lineUrl: string, target: CategoryAGisementTarget): boolean {
  const mrcHosts = new Set(target.mrcPortals.map(hostWithoutWww));
  const parsed = new URL(lineUrl);
  if (mrcHosts.has(parsed.hostname.replace(/^www\./, "").toLowerCase())) return true;
  if (parsed.hostname !== "web.archive.org" || !parsed.pathname.includes("/cdx/")) return false;
  const queried = parsed.searchParams.get("url");
  if (queried === null) return false;
  return mrcHosts.has(queried.replace(/\/\*$/, "").replace(/^www\./, "").toLowerCase());
}

function relevantForTarget(
  url: string,
  lineUrl: string,
  target: CategoryAGisementTarget,
): boolean {
  if (!isMrcDomainCapture(lineUrl, target) || isOwnerSearch(lineUrl, target)) return true;
  if (SITEMAP.test(url)) return true;
  return candidateNamesOwner(url, target);
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await fn(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function materialize(prefixes: readonly string[]): Promise<CaptureWorklistTarget[][]> {
  const runs = await completedRuns(prefixes);
  const failed = runs.filter((run) => run.exitCode !== 0);
  if (failed.length > 0) {
    throw new Error(`runs de capture échoués: ${failed.map((run) => run.manifestKey).join(",")}`);
  }
  const lines = runs.flatMap((run) => run.lines);
  const attempted = new Map<string, Set<string>>();
  const found = new Map<string, Set<string>>();
  for (const line of lines) {
    for (const slug of line.slugs) {
      const slugAttempted = attempted.get(slug) ?? new Set<string>();
      slugAttempted.add(line.url);
      attempted.set(slug, slugAttempted);
    }
  }
  const s3 = s3Client();
  const reviewed = await mapConcurrent(lines, 8, async (line): Promise<{
    line: CaptureManifestLine;
    discovered: FollowupDiscovery | null;
  }> => {
    if (line.http_status !== 200 || line.storage_key === null || line.sha256 === null) {
      return { line, discovered: null };
    }
    const bytes = await getBytes(s3, line.storage_key);
    if (digest(bytes) !== line.sha256) throw new Error(`CAS SHA incohérent: ${line.storage_key}`);
    const prefix = bytes.subarray(0, 64).toString("utf8");
    const contentType = line.content_type ?? "";
    if (!/html|xml|json|text|javascript/i.test(contentType) && !/^\s*(?:<!doctype|<html|<\?xml|[{[])/i.test(prefix)) {
      return { line, discovered: null };
    }
    return { line, discovered: discoverFollowups(bytes.toString("utf8"), line.url) };
  });
  for (const { line, discovered } of reviewed) {
    if (discovered === null) continue;
    for (const slug of line.slugs) {
      const target = CATEGORY_A_GISEMENT_TARGETS.find((entry) => entry.slug === slug);
      if (target === undefined) throw new Error(`profil catégorie A absent: ${slug}`);
      const slugFound = found.get(slug) ?? new Set<string>();
      for (const url of [...discovered.documents, ...discovered.catalogs]) {
        if (relevantForTarget(url, line.url, target)) slugFound.add(url);
      }
      found.set(slug, slugFound);
    }
  }

  const firstLots = [1, 2, 3].map((lot) =>
    parseCaptureWorklist(JSON.parse(readFileSync(resolve(
      ROOT,
      `acquisition/config/density-document-category-a-gisements-20260728-lot-${String(lot).padStart(2, "0")}.json`,
    ), "utf8")))).flat();
  const scope = firstLots.flat();
  const completedSlugs = new Set(lines.flatMap((line) => line.slugs));
  const missing = scope.map((target) => target.slug).filter((slug) => !completedSlugs.has(slug));
  if (missing.length > 0) {
    throw new Error(`captures non terminales ou absentes: ${missing.join(",")}`);
  }
  // VPlus/Modellium est une coquille SPA : l'arbre JSON ne figure pas
  // nécessairement comme ancre dans le HTML. Le sonder explicitement évite de
  // répéter le faux négatif déjà mesuré sur Batiscan et d'autres petites villes.
  for (const target of scope) {
    const hostname = new URL(target.urls[0]!).hostname.replace(/^www\./, "");
    const slugFound = found.get(target.slug) ?? new Set<string>();
    slugFound.add(`https://vplus.modellium.com/api/${hostname}/structure/tree`);
    found.set(target.slug, slugFound);
  }
  const followups = parseCaptureWorklist(scope.map((target) => ({
    slug: target.slug,
    source: SOURCE,
    urls: [...(found.get(target.slug) ?? [])]
      .filter((url) => !(attempted.get(target.slug)?.has(url) ?? false))
      .sort(),
  })).filter((target) => target.urls.length > 0));
  const bySlug = new Map(followups.map((target) => [target.slug, target]));
  return Array.from({ length: Math.ceil(scope.length / LOT_SIZE) }, (_value, index) =>
    scope.slice(index * LOT_SIZE, (index + 1) * LOT_SIZE)
      .flatMap((target) => bySlug.get(target.slug) ?? []));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const prefixes = values(argv, "run-prefix");
  if (prefixes.length === 0) throw new Error("au moins un --run-prefix est requis");
  const outTag = option(argv, "out-tag");
  if (!outTag || !/^[a-z0-9-]+$/.test(outTag)) throw new Error("--out-tag [a-z0-9-]+ est requis");
  const lots = await materialize(prefixes);
  for (const [index, lot] of lots.entries()) {
    const path = resolve(
      ROOT,
      `acquisition/config/density-document-category-a-gisements-${outTag}-lot-${String(index + 1).padStart(2, "0")}.json`,
    );
    writeFileSync(path, `${JSON.stringify(lot, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${path.replace(`${ROOT}/`, "")}\t${lot.length}\t${lot.reduce((sum, target) => sum + target.urls.length, 0)} URL\n`);
  }
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
