/**
 * Adaptive cluster runner for the 56-city "ANOTHER density document" campaign.
 *
 * Unlike the generic static worklist runner, this process may follow links that
 * exist in captured HTML/sitemaps/CDX responses. Every network request still
 * goes through `capturedFetch`; the body is durable in CAS before it is parsed.
 * The durable output is the run manifest itself, with source tags recording the
 * bounded strategy. No served data and no density/effect conclusion is written.
 *
 * One Indexed-Job completion handles one slug. A pod retry gets a new run ID;
 * completed requests deduplicate through CAS without rewriting history.
 */
import { fileURLToPath } from "node:url";

import {
  capturedFetch,
  type CapturedFetchResult,
  type CaptureRequestInit,
  type CaptureRun,
} from "../../packages/qc-sources/src/capture/index.js";
import {
  buildDensityDiscoverySeeds,
  discoverDensityLinks,
  hasHardProjectMarker,
  interestingCdxDocuments,
  interestingSitemapLocations,
  parseCdxDocuments,
  parseDensityDiscoveryWorklist,
  safeDecodeUrl,
  sitemapLocations,
  waybackSnapshotUrl,
  type CdxDocument,
  type DensityDiscoveryTarget,
  type DiscoveryStrategy,
} from "../../packages/qc-sources/src/sources/density-document-discovery.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import { capturedRobotsFetch } from "./capture-worklist-run.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { getBytes, s3Client } from "./lib/s3.js";

const MAX_HTML_PAGES = 36;
const MAX_SITEMAPS = 10;
const MAX_DOCUMENTS = 24;
const MAX_SIG_METADATA = 12;
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 128 * 1024 * 1024;
const HTML_TIMEOUT_MS = 45_000;
const DOCUMENT_TIMEOUT_MS = 120_000;

interface PageLead {
  url: string;
  strategy: DiscoveryStrategy;
}

interface DocumentLead {
  url: string;
  title: string;
  strategy: DiscoveryStrategy;
  sourceUrl: string;
  score: number;
  archive: CdxDocument | null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function nonNegativeInt(name: string): number {
  const value = Number(requireEnv(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} doit être un entier >= 0`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sourceTag(strategy: DiscoveryStrategy, kind: "page" | "sitemap" | "cdx" | "document" | "sig"): string {
  return `normes-density-${strategy}-${kind}`;
}

function isExcludedUrl(url: string, target: DensityDiscoveryTarget): boolean {
  if (!target.excludedSourceUrl) return false;
  try {
    const candidate = new URL(url);
    const excluded = new URL(target.excludedSourceUrl);
    candidate.hash = "";
    excluded.hash = "";
    return candidate.href === excluded.href;
  } catch {
    return false;
  }
}

export function isExcludedDocument(result: CapturedFetchResult, target: DensityDiscoveryTarget): boolean {
  return (
    target.excludedSourceSha256 !== null
    && result.line.sha256 === `sha256:${target.excludedSourceSha256}`
  );
}

function registrableHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sameHost(left: string, right: string): boolean {
  const l = registrableHost(left);
  const r = registrableHost(right);
  return l !== null && r !== null && l === r;
}

function isSigUrl(url: string): boolean {
  return /arcgis|featureserver|mapserver|geocentriq|goazimut|gonet|jmap|vplus/i.test(url);
}

function textualBody(result: CapturedFetchResult): string | null {
  if (!result.ok || result.bytes === null) return null;
  const contentType = result.line.content_type ?? "";
  const prefix = Buffer.from(result.bytes.subarray(0, 64)).toString("utf8");
  if (
    /html|xml|json|text|javascript/i.test(contentType)
    || /^\s*(?:<!doctype|<html|<\?xml|[{[])/i.test(prefix)
  ) {
    return Buffer.from(result.bytes).toString("utf8");
  }
  return null;
}

export function documentMagic(bytes: Uint8Array | null): "pdf" | "zip" | "ole" | "text" | "unknown" {
  if (bytes === null || bytes.length === 0) return "unknown";
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "zip";
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole";
  const text = head.toString("utf8");
  return /^[\s<{[]/.test(text) ? "text" : "unknown";
}

/** ArcGIS item/service URLs found only in already captured official content. */
export function sigMetadataUrls(value: string, sourceUrl: string): string[] {
  const out = new Set<string>();
  const itemIds = new Set<string>();
  for (const match of value.matchAll(/\b[a-f0-9]{32}\b/gi)) itemIds.add(match[0]!.toLowerCase());
  for (const itemId of itemIds) {
    out.add(`https://www.arcgis.com/sharing/rest/content/items/${itemId}?f=json`);
    out.add(`https://www.arcgis.com/sharing/rest/content/items/${itemId}/data?f=json`);
  }
  const urlRe = /https?:\\?\/\\?\/[^\s"'<>\\]+/gi;
  for (const match of value.matchAll(urlRe)) {
    const raw = match[0]!.replace(/\\\//g, "/").replace(/[),.;]+$/, "");
    if (!/(?:FeatureServer|MapServer)(?:\/\d+)?/i.test(raw)) continue;
    try {
      const service = new URL(raw, sourceUrl);
      service.search = "";
      service.hash = "";
      service.searchParams.set("f", "pjson");
      out.add(service.href);
    } catch {
      // malformed captured URL: no extrapolation
    }
  }
  return [...out];
}

interface CaptureContext {
  run: CaptureRun;
  robots: RobotsCache;
  target: DensityDiscoveryTarget;
}

async function capture(
  ctx: CaptureContext,
  url: string,
  strategy: DiscoveryStrategy,
  kind: "page" | "sitemap" | "cdx" | "document" | "sig",
  accept: string,
  title?: string,
): Promise<CapturedFetchResult> {
  const init: CaptureRequestInit = {
    method: "GET",
    // The manifest records run.userAgent. Force the same value on the wire so
    // the 403/browser-UA evidence cannot lie through a header override.
    headers: { "user-agent": ctx.run.userAgent, accept },
  };
  return capturedFetch(url, init, {
    run: ctx.run,
    source: sourceTag(strategy, kind),
    slugs: [ctx.target.slug],
    robots: ctx.robots,
    retainBody: true,
    maxBytes: kind === "document" ? MAX_DOCUMENT_BYTES : MAX_PAGE_BYTES,
    timeoutMs: kind === "document" ? DOCUMENT_TIMEOUT_MS : HTML_TIMEOUT_MS,
    ...(title ? { title } : {}),
  });
}

function addPage(queue: PageLead[], seen: Set<string>, lead: PageLead, target: DensityDiscoveryTarget): void {
  if (isExcludedUrl(lead.url, target) || seen.has(lead.url)) return;
  // Follow off-host pages only for an explicit SIG lead. Linked documents may
  // still live on a CDN and are handled separately.
  if (!sameHost(lead.url, target.website) && !isSigUrl(lead.url)) return;
  seen.add(lead.url);
  queue.push(lead);
}

function addDocument(
  leads: Map<string, DocumentLead>,
  lead: DocumentLead,
  target: DensityDiscoveryTarget,
): void {
  if (isExcludedUrl(lead.url, target) || hasHardProjectMarker(`${lead.title} ${safeDecodeUrl(lead.url)}`)) return;
  const previous = leads.get(lead.url);
  if (!previous || lead.score > previous.score) leads.set(lead.url, lead);
}

async function runTarget(ctx: CaptureContext): Promise<void> {
  const seeds = buildDensityDiscoverySeeds(ctx.target);
  const pageQueue: PageLead[] = [];
  const sitemapQueue: PageLead[] = [];
  const cdxQueue: PageLead[] = [];
  const pageSeen = new Set<string>();
  const sitemapSeen = new Set<string>();
  const documents = new Map<string, DocumentLead>();

  for (const seed of seeds) {
    if (seed.kind === "html") addPage(pageQueue, pageSeen, seed, ctx.target);
    else if (seed.kind === "sitemap" && !sitemapSeen.has(seed.url)) {
      sitemapSeen.add(seed.url);
      sitemapQueue.push(seed);
    } else if (seed.kind === "cdx") cdxQueue.push(seed);
  }

  let processedPages = 0;
  const processPages = async (): Promise<void> => {
    while (processedPages < pageQueue.length && processedPages < MAX_HTML_PAGES) {
      const lead = pageQueue[processedPages++]!;
      const kind = lead.strategy === "sig" ? "sig" : "page";
      const result = await capture(
        ctx,
        lead.url,
        lead.strategy,
        kind,
        "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      );
      const body = textualBody(result);
      if (body === null) continue;
      const discovered = discoverDensityLinks(body, lead.url, ctx.target.excludedSourceUrl);
      for (const doc of discovered.documents) {
        addDocument(documents, { ...doc, archive: null }, ctx.target);
      }
      for (const page of discovered.pages) {
        addPage(pageQueue, pageSeen, page, ctx.target);
      }
      if (isSigUrl(lead.url) || isSigUrl(body)) {
        for (const metadataUrl of sigMetadataUrls(body, lead.url).slice(0, MAX_SIG_METADATA)) {
          addPage(pageQueue, pageSeen, { url: metadataUrl, strategy: "sig" }, ctx.target);
        }
      }
    }
  };
  await processPages();

  for (let index = 0; index < sitemapQueue.length && index < MAX_SITEMAPS; index++) {
    const lead = sitemapQueue[index]!;
    const result = await capture(ctx, lead.url, "sitemap", "sitemap", "application/xml,text/xml,text/plain,*/*");
    const body = textualBody(result);
    if (body === null) continue;
    const interesting = interestingSitemapLocations(sitemapLocations(body, lead.url));
    for (const url of interesting.sitemaps) {
      if (sitemapSeen.has(url)) continue;
      sitemapSeen.add(url);
      sitemapQueue.push({ url, strategy: "sitemap" });
    }
    for (const url of interesting.pages) {
      addPage(pageQueue, pageSeen, { url, strategy: "sitemap" }, ctx.target);
    }
    for (const url of interesting.documents) {
      addDocument(documents, {
        url,
        title: "",
        strategy: "sitemap",
        sourceUrl: lead.url,
        score: 4,
        archive: null,
      }, ctx.target);
    }
  }
  // Sitemaps often reveal the only urbanisme/annexe pages. Process those newly
  // queued pages under the SAME bounded page budget.
  await processPages();

  for (const lead of cdxQueue) {
    const result = await capture(ctx, lead.url, "wayback", "cdx", "text/plain,application/json,*/*");
    const body = textualBody(result);
    if (body === null) continue;
    for (const archived of interestingCdxDocuments(parseCdxDocuments(body)).slice(0, 12)) {
      addDocument(documents, {
        url: archived.originalUrl,
        title: "",
        strategy: "wayback",
        sourceUrl: lead.url,
        score: 3,
        archive: archived,
      }, ctx.target);
    }
  }

  const ranked = [...documents.values()]
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  let attemptedDocuments = 0;
  for (let index = 0; index < ranked.length && attemptedDocuments < MAX_DOCUMENTS; index++) {
    const lead = ranked[index]!;
    attemptedDocuments++;
    const live = await capture(
      ctx,
      lead.url,
      lead.strategy,
      "document",
      "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,*/*",
      lead.title,
    );
    const excluded = isExcludedDocument(live, ctx.target);
    if (excluded) {
      ctx.run.log(`[density-discovery] ${ctx.target.slug} SAME-DOCUMENT sha=${live.line.sha256} url=${lead.url}`);
    }
    const liveMagic = documentMagic(live.bytes);
    const liveDocument = live.ok && !excluded && (liveMagic === "pdf" || liveMagic === "zip" || liveMagic === "ole");
    if (!liveDocument && live.ok && liveMagic === "text") {
      const body = textualBody(live);
      if (body !== null) {
        const nested = discoverDensityLinks(body, lead.url, ctx.target.excludedSourceUrl);
        for (const doc of nested.documents) {
          const nestedLead: DocumentLead = { ...doc, archive: null };
          addDocument(documents, nestedLead, ctx.target);
          if (!ranked.some((entry) => entry.url === nestedLead.url)) ranked.push(nestedLead);
        }
      }
    }
    if (liveDocument || lead.archive === null) continue;
    const archivedUrl = waybackSnapshotUrl(lead.archive);
    const archived = await capture(
      ctx,
      archivedUrl,
      "wayback",
      "document",
      "application/pdf,application/octet-stream,*/*",
      lead.title,
    );
    if (isExcludedDocument(archived, ctx.target)) {
      ctx.run.log(`[density-discovery] ${ctx.target.slug} SAME-DOCUMENT-WAYBACK sha=${archived.line.sha256} url=${archivedUrl}`);
    }
    if (
      archived.ok
      && archived.bytes !== null
      && archived.bytes.length === 1_048_576
      && documentMagic(archived.bytes) === "pdf"
    ) {
      // This is the measured Wayback truncation signature. It remains
      // inconclusive until the range-capture receipt is implemented; never call
      // it an absence and never feed the truncated bytes to a parser.
      ctx.run.log(`[density-discovery] ${ctx.target.slug} WAYBACK-TRUNCATED-1MIB ${archivedUrl}`);
    }
  }

  ctx.run.log(
    `[density-discovery] complete slug=${ctx.target.slug} pages=${Math.min(pageQueue.length, MAX_HTML_PAGES)} `
      + `sitemaps=${Math.min(sitemapQueue.length, MAX_SITEMAPS)} candidates=${documents.size} `
      + `documents_attempted=${attemptedDocuments}`,
  );
}

async function main(): Promise<void> {
  const worklistKey = requireEnv("WORKLIST");
  const targetIndex = nonNegativeInt("TARGET_INDEX");
  const runStamp = requireEnv("RUN_STAMP");
  const podAttempt = (process.env["POD_UID"] ?? process.env["HOSTNAME"] ?? "manual")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
  const s3 = s3Client();
  // No caller timeout: an S3 read that fails is a failed measurement, never an
  // inferred absence.
  const worklist = parseDensityDiscoveryWorklist(
    JSON.parse((await getBytes(s3, worklistKey)).toString("utf8")),
  );
  const target = worklist.targets[targetIndex];
  if (!target) throw new Error(`TARGET_INDEX=${targetIndex} hors lot de ${worklist.targets.length}`);
  const runId = `normes-${runStamp}-d${worklist.lot}-${targetIndex}-${podAttempt}`;
  const run = openCaptureRun({
    lane: "normes",
    runId,
    shard: `${worklist.lot}-${targetIndex}-${podAttempt}`,
    s3,
    userAgent: CAPTURE_USER_AGENT,
    egress: "direct",
    worklist: worklistKey,
    flushEvery: 1,
  });
  const robots = new RobotsCache({
    userAgent: CAPTURE_USER_AGENT,
    fetchImpl: capturedRobotsFetch(run),
    log: (message) => run.log(message),
  });
  let exitCode = 0;
  try {
    run.log(
      `[density-discovery] start slug=${target.slug} lot=${worklist.lot}/${worklist.lots} `
        + `baseline_sha256=${worklist.baselineSha256} ua=${CAPTURE_USER_AGENT}`,
    );
    await runTarget({ run, robots, target });
  } catch (error) {
    exitCode = 1;
    run.log(`[density-discovery] fatal slug=${target.slug} ${errorText(error)}`);
    throw error;
  } finally {
    await run.finish(exitCode);
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
