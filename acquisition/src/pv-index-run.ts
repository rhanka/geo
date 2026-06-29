/**
 * CLI runner — scrape the procès-verbaux (PV) INDEX of every configured QC
 * municipality and deposit one index manifest per city to S3.
 *
 * This is the production "decollage" runner for the PV layer. It REUSES the
 * generic PV adapter (`packages/qc-sources/src/sources/proces-verbaux-generic.ts`):
 * the same `ALL_PV_CITIES` registry, `createProcesVerbauxAdapter`, honest
 * `PV_USER_AGENT`, typed `PvSourceFetchError`, and the shared `RobotsCache`.
 * For each city it fetches the configured `pvIndexUrl`, parses + window-filters
 * the PV list via the adapter's `list()`, and writes the discovered refs
 * (url / publishedAt / title / contentType) to S3. It does NOT download the PV
 * documents themselves — that is a separate fetch pass; this run establishes the
 * INDEX (what exists, where, when) province-wide.
 *
 * ANTI-INVENTION: only refs actually returned by `list()` are recorded; a city
 * whose index yields zero PV is logged as empty and NO manifest with fabricated
 * entries is ever written. A fetch/parse failure is caught per-city (typed) and
 * never aborts the run.
 *
 * IDEMPOTENT / RESUMABLE: before scraping a city the runner HEAD-probes its
 * target manifest key in S3; if present the city is skipped (unless --force).
 * Each city's manifest is deposited immediately, so an interrupted run resumes
 * from where it stopped on the next invocation.
 *
 * S3 layout (mirrors the `registry/qc-<kind>/<slug>...` convention used by
 * zonage-norms): one manifest per city at
 *   registry/qc-pv/<slug>/index.json
 * Bucket + creds come from `lib/s3` (Scaleway, forcePathStyle, s3.env). The PV
 * DOCUMENT bytes, when later fetched, go under the canonical CAS key
 *   raw/<sourceId>/cas/<sha256>.<ext>
 * (see RawDocument.rawStorageKey) — out of scope for this index pass.
 *
 * This repo is Node/TS end-to-end (NO Python). Run via tsx from acquisition/:
 *   # prove it on 3 cities, no S3 writes:
 *   npx tsx src/pv-index-run.ts --limit 3 --dry-run
 *   # full province, deposit to S3, polite 2s floor:
 *   npx tsx src/pv-index-run.ts --delay-ms 2000
 *   # restrict to a few slugs:
 *   npx tsx src/pv-index-run.ts --slugs saint-damase,sainte-catherine
 *
 * Flags:
 *   --limit N        only the first N cities from ALL_PV_CITIES (default: all)
 *   --slugs a,b,c    restrict to these slugs (overrides --limit)
 *   --delay-ms N     politeness delay floor between index fetches (default 2000);
 *                    a longer robots.txt Crawl-delay overrides it per domain
 *   --window-days N  PV look-back window in days (default 183 ≈ 6 months)
 *   --timeout-ms N   per-fetch timeout (default 15000)
 *   --dry-run        scrape + report, but write nothing to S3
 *   --force          re-scrape + overwrite cities whose manifest already exists
 *   --no-robots      DISABLE robots.txt enforcement (default: ON — robots honoured)
 *
 * ROBOTS: by default each index URL is checked against the origin's robots.txt
 * (fetched once per domain, cached). A Disallowed index is skipped (recorded as
 * a robots-skip, never scraped). Crawl-delay raises the inter-fetch delay. A
 * missing/unreachable robots.txt is permissive (logged).
 */
import {
  ALL_PV_CITIES,
  PV_USER_AGENT,
  PvSourceFetchError,
  createProcesVerbauxAdapter,
  type PvCityConfig,
  type PvFetchLike,
} from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import type { RawDocumentRef } from "../../packages/qc-sources/src/SourceAdapter.js";

import { s3Client, exists, putBytes } from "./lib/s3.js";

// ── args ─────────────────────────────────────────────────────────────────────

interface Args {
  limit?: number;
  slugs?: string[];
  delayMs: number;
  windowDays: number;
  timeoutMs: number;
  dryRun: boolean;
  force: boolean;
  robots: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const limitRaw = get("limit");
  const slugsRaw = get("slugs");
  return {
    ...(limitRaw ? { limit: Number(limitRaw) } : {}),
    ...(slugsRaw
      ? { slugs: slugsRaw.split(",").map((s) => s.trim()).filter(Boolean) }
      : {}),
    delayMs: Number(get("delay-ms") ?? "2000"),
    windowDays: Number(get("window-days") ?? "183"),
    timeoutMs: Number(get("timeout-ms") ?? "15000"),
    dryRun: has("dry-run"),
    force: has("force"),
    robots: !has("no-robots"),
  };
}

// ── city selection (dedup by slug; registry has a few repeated configs) ────────

function selectCities(args: Args): PvCityConfig[] {
  const bySlug = new Map<string, PvCityConfig>();
  for (const e of ALL_PV_CITIES) {
    if (!bySlug.has(e.config.citySlug)) bySlug.set(e.config.citySlug, e.config);
  }
  let configs = [...bySlug.values()];
  if (args.slugs && args.slugs.length > 0) {
    const want = new Set(args.slugs);
    return configs.filter((c) => want.has(c.citySlug));
  }
  if (args.limit !== undefined) configs = configs.slice(0, args.limit);
  return configs;
}

// ── manifest model — exactly what list() discovered, nothing invented ──────────

interface PvIndexEntry {
  url: string;
  title?: string;
  publishedAt?: string;
  contentType?: string;
}

interface PvIndexManifest {
  _note: string;
  _generatedAt: string;
  slug: string;
  sourceId: string;
  pvIndexUrl: string;
  windowDays: number;
  userAgent: string;
  count: number;
  entries: PvIndexEntry[];
}

function manifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

function toEntry(ref: RawDocumentRef): PvIndexEntry {
  return {
    url: ref.url,
    ...(ref.title !== undefined ? { title: ref.title } : {}),
    ...(ref.publishedAt !== undefined ? { publishedAt: ref.publishedAt } : {}),
    ...(ref.contentType !== undefined ? { contentType: ref.contentType } : {}),
  };
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fetchImpl = globalThis.fetch as unknown as PvFetchLike;
  const cities = selectCities(args);
  const s3 = args.dryRun ? null : s3Client();
  const robots = args.robots
    ? new RobotsCache({ fetchImpl, userAgent: PV_USER_AGENT, timeoutMs: args.timeoutMs })
    : undefined;

  console.error(
    `[pv-index] ${cities.length} city(ies)` +
      ` window=${args.windowDays}d` +
      ` delay=${args.delayMs}ms` +
      ` robots=${args.robots ? "on" : "OFF"}` +
      (args.dryRun ? " (dry-run, no S3 writes)" : "") +
      (args.force ? " (force overwrite)" : ""),
  );

  let scraped = 0; // cities actually fetched (not skipped)
  let withPv = 0; // cities whose index yielded ≥1 PV
  let deposited = 0; // manifests written to S3
  let skippedExisting = 0; // idempotent skip (manifest already in S3)
  let robotsSkipped = 0; // index URL Disallowed by robots
  let totalPv = 0; // grand total of PV refs discovered
  const failures: { slug: string; reason: string }[] = [];

  for (const cfg of cities) {
    const slug = cfg.citySlug;
    const key = manifestKey(slug);

    // Idempotent skip — manifest already deposited (resume support).
    if (s3 && !args.force && (await exists(s3, key))) {
      skippedExisting++;
      console.error(`--- ${slug}: skip (manifest exists)`);
      continue;
    }

    // Robots gate on the index URL itself.
    if (robots && !(await robots.isAllowed(cfg.pvIndexUrl))) {
      robotsSkipped++;
      console.error(`[robots] skip ${slug} → ${cfg.pvIndexUrl}`);
      continue;
    }

    // Politeness delay: max(--delay-ms, robots Crawl-delay) before each fetch.
    const delay = robots
      ? Math.max(args.delayMs, (await robots.crawlDelayMs(cfg.pvIndexUrl)) ?? 0)
      : args.delayMs;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    const adapter = createProcesVerbauxAdapter(cfg, {
      fetchImpl,
      timeoutMs: args.timeoutMs,
      windowDays: args.windowDays,
    });

    let entries: PvIndexEntry[];
    try {
      const collected: PvIndexEntry[] = [];
      for await (const ref of adapter.list({})) collected.push(toEntry(ref));
      entries = collected;
    } catch (e) {
      const reason =
        e instanceof PvSourceFetchError
          ? `${e.kind}: ${e.detail}`
          : e instanceof Error
            ? e.message
            : String(e);
      failures.push({ slug, reason });
      console.error(`[fail] ${slug}: ${reason}`);
      continue;
    }

    scraped++;
    totalPv += entries.length;
    if (entries.length > 0) withPv++;
    console.error(`=== ${slug}: ${entries.length} PV in window`);

    if (entries.length === 0) {
      // Empty index: record as a no-PV outcome. Do NOT write a manifest with
      // fabricated entries — anti-invention. (A future run may find some once
      // the city publishes; the absence is intentionally not persisted.)
      continue;
    }

    const manifest: PvIndexManifest = {
      _note:
        "PV index discovered by pv-index-run.ts (generic PV adapter). Each entry " +
        "is a real ref returned by adapter.list() from the live pvIndexUrl — no " +
        "fabrication. Document bytes are fetched separately to raw/<sourceId>/cas/.",
      _generatedAt: new Date().toISOString(),
      slug,
      sourceId: cfg.sourceId,
      pvIndexUrl: cfg.pvIndexUrl,
      windowDays: args.windowDays,
      userAgent: PV_USER_AGENT,
      count: entries.length,
      entries,
    };

    if (s3) {
      try {
        await putBytes(
          s3,
          key,
          JSON.stringify(manifest, null, 2) + "\n",
          "application/json",
        );
        deposited++;
        console.error(`  → s3://registry/qc-pv/${slug}/index.json (${entries.length})`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        failures.push({ slug, reason: `s3-put: ${reason}` });
        console.error(`[fail] ${slug}: s3-put ${reason}`);
      }
    } else {
      console.error(`  (dry-run) would write ${key} (${entries.length})`);
    }
  }

  console.error(
    `=== FIN PV-INDEX:` +
      ` cities=${cities.length}` +
      ` scraped=${scraped}` +
      ` withPv=${withPv}` +
      ` deposited=${deposited}` +
      ` skippedExisting=${skippedExisting}` +
      ` robotsSkipped=${robotsSkipped}` +
      ` failures=${failures.length}` +
      ` totalPv=${totalPv} ===`,
  );
  if (failures.length > 0) {
    const byReason = new Map<string, number>();
    for (const f of failures) {
      const head = f.reason.split(":")[0] ?? f.reason;
      byReason.set(head, (byReason.get(head) ?? 0) + 1);
    }
    console.error(
      `failures by kind: ${[...byReason.entries()].map(([k, n]) => `${k}=${n}`).join(" ")}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
