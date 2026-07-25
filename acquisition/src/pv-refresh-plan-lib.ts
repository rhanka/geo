/**
 * Pure planning contract for a bounded QC PV refresh.
 *
 * The planner deliberately treats an exact S3 index object as the coverage
 * source of truth.  The coverage matrix remains useful context, but a stale
 * local cell never authorises a fabricated manifest or an unbounded crawl.
 */

export const PV_REFRESH_PLAN_SCHEMA = "qc-pv-refresh-plan/v1" as const;
export const MAX_PV_REFRESH_BATCH = 10;
export const MIN_PV_REFRESH_DELAY_MS = 1_000;
export const LEGACY_GENERIC_PV_NOTE_PREFIX = "PV index discovered by pv-index-run.ts (generic PV adapter).";

export type PvCoverageStatus = "done" | "planned" | "to-research";
export type PvRefreshAction = "deposit-missing" | "revalidate-older-manifest";

export interface PvCoverageCell {
  readonly status?: PvCoverageStatus;
}

export interface PvRefreshSource {
  readonly slug: string;
  readonly sourceId: string;
  readonly pvIndexUrl: string;
}

export interface PvInventoryObject {
  readonly key: string;
  readonly lastModified: string;
}

export interface PvRefreshPlanInput {
  readonly asOf: string;
  readonly refreshAfterDays: number;
  readonly limit: number;
  readonly delayMs: number;
  readonly windowDays: number;
  readonly cities: Readonly<Record<string, { readonly pv?: PvCoverageCell }>>;
  readonly configuredSources: readonly PvRefreshSource[];
  readonly inventory: readonly PvInventoryObject[];
}

export interface PvRefreshPlanTarget {
  readonly slug: string;
  readonly action: PvRefreshAction;
  readonly sourceId: string;
  readonly pvIndexUrl: string;
  readonly manifestKey: string;
  readonly expectedLastModified?: string;
}

export interface PvRefreshPlan {
  readonly schema: typeof PV_REFRESH_PLAN_SCHEMA;
  readonly asOf: string;
  readonly refreshBefore: string;
  readonly settings: {
    readonly maxTargets: number;
    readonly delayMs: number;
    readonly windowDays: number;
  };
  readonly coverage: {
    readonly municipalities: number;
    readonly s3VerifiedPresent: number;
    readonly matrixDone: number;
    readonly matrixDoneMissingS3: string[];
    readonly matrixNonDonePresentS3: string[];
    readonly s3UnknownSlugs: string[];
  };
  readonly residual: {
    readonly total: number;
    readonly configuredMissing: string[];
    readonly unconfiguredMissing: string[];
  };
  readonly eligible: {
    readonly missing: number;
    readonly stale: number;
  };
  readonly selected: readonly PvRefreshPlanTarget[];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

/**
 * A manifest fingerprint intentionally excludes operational metadata such as
 * `_generatedAt` and `_note`.  The resulting JSON is canonical enough to avoid
 * rewriting a generic manifest whose source and discovered entries are unchanged.
 */
export function pvManifestFingerprint(manifest: unknown): string | null {
  const root = asRecord(manifest);
  if (!root || !Array.isArray(root.entries)) return null;
  const slug = root.slug;
  const sourceId = root.sourceId;
  const pvIndexUrl = root.pvIndexUrl;
  const windowDays = root.windowDays;
  const userAgent = root.userAgent;
  if (typeof slug !== "string" || typeof sourceId !== "string" || typeof pvIndexUrl !== "string" ||
      typeof windowDays !== "number" || typeof userAgent !== "string") return null;
  const entries: Array<{ url: string; title?: string; publishedAt?: string; contentType?: string }> = [];
  for (const raw of root.entries) {
    const entry = asRecord(raw);
    if (!entry || typeof entry.url !== "string") return null;
    if (entry.title !== undefined && typeof entry.title !== "string") return null;
    if (entry.publishedAt !== undefined && typeof entry.publishedAt !== "string") return null;
    if (entry.contentType !== undefined && typeof entry.contentType !== "string") return null;
    entries.push({
      url: entry.url,
      ...(typeof entry.title === "string" ? { title: entry.title } : {}),
      ...(typeof entry.publishedAt === "string" ? { publishedAt: entry.publishedAt } : {}),
      ...(typeof entry.contentType === "string" ? { contentType: entry.contentType } : {}),
    });
  }
  entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ slug, sourceId, pvIndexUrl, windowDays, userAgent, entries });
}

export function isCompatibleGenericPvManifest(
  manifest: unknown,
  source: PvRefreshSource,
  allowLegacyGeneric = false,
): boolean {
  const root = asRecord(manifest);
  if (!root || root.slug !== source.slug || root.sourceId !== source.sourceId || root.pvIndexUrl !== source.pvIndexUrl) {
    return false;
  }
  if (root._refreshAdapter === "pv-index-run/v1") return true;
  // Pre-marker generic output is migratable only on an explicit, bounded
  // request. Other adapters have different provenance notes and remain blocked.
  return allowLegacyGeneric && typeof root._note === "string" && root._note.startsWith(LEGACY_GENERIC_PV_NOTE_PREFIX);
}

export function pvManifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

function mustDate(value: string, flag: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${flag} must be an ISO-8601 timestamp`);
  return parsed;
}

function canonicalIso(value: string, flag: string): string {
  return mustDate(value, flag).toISOString();
}

function sourceMap(sources: readonly PvRefreshSource[]): Map<string, PvRefreshSource> {
  const out = new Map<string, PvRefreshSource>();
  for (const source of sources) {
    if (!source.slug || !source.sourceId || !source.pvIndexUrl) {
      throw new Error("configured source must include slug, sourceId, and pvIndexUrl");
    }
    if (out.has(source.slug)) throw new Error(`duplicate configured PV source: ${source.slug}`);
    out.set(source.slug, source);
  }
  return out;
}

/**
 * Selects no more than ten explicit configured sources.  Missing manifests are
 * prioritised over old manifests; then the sort is stable by age and slug.
 * S3 LastModified is a scheduling threshold only, never evidence that a source
 * is stale. The result contains no wall-clock value: callers supply `asOf`.
 */
export function buildPvRefreshPlan(input: PvRefreshPlanInput): PvRefreshPlan {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PV_REFRESH_BATCH) {
    throw new Error(`limit must be an integer from 1 to ${MAX_PV_REFRESH_BATCH}`);
  }
  if (!Number.isInteger(input.delayMs) || input.delayMs < MIN_PV_REFRESH_DELAY_MS) {
    throw new Error(`delayMs must be an integer >= ${MIN_PV_REFRESH_DELAY_MS}`);
  }
  if (!Number.isInteger(input.windowDays) || input.windowDays < 1) {
    throw new Error("windowDays must be a positive integer");
  }
  if (!Number.isInteger(input.refreshAfterDays) || input.refreshAfterDays < 1) {
    throw new Error("refreshAfterDays must be a positive integer");
  }

  const asOf = mustDate(input.asOf, "asOf");
  const refreshBefore = new Date(asOf.getTime() - input.refreshAfterDays * 86_400_000).toISOString();
  const sources = sourceMap(input.configuredSources);
  const citySlugs = Object.keys(input.cities).sort();
  const citySet = new Set(citySlugs);
  const objects = new Map<string, PvInventoryObject>();
  const unknown = new Set<string>();

  for (const object of input.inventory) {
    const match = /^registry\/qc-pv\/([^/]+)\/index\.json$/.exec(object.key);
    if (!match) continue;
    const slug = match[1]!;
    const lastModified = canonicalIso(object.lastModified, `inventory ${object.key} lastModified`);
    if (!citySet.has(slug)) {
      unknown.add(slug);
      continue;
    }
    objects.set(slug, { key: object.key, lastModified });
  }

  const matrixDoneMissingS3: string[] = [];
  const matrixNonDonePresentS3: string[] = [];
  const configuredMissing: string[] = [];
  const unconfiguredMissing: string[] = [];
  const missing: PvRefreshPlanTarget[] = [];
  const stale: PvRefreshPlanTarget[] = [];
  let matrixDone = 0;

  for (const slug of citySlugs) {
    const status = input.cities[slug]?.pv?.status ?? "to-research";
    const present = objects.get(slug);
    if (status === "done") matrixDone++;
    if (status === "done" && !present) matrixDoneMissingS3.push(slug);
    if (status !== "done" && present) matrixNonDonePresentS3.push(slug);

    const source = sources.get(slug);
    if (!present) {
      if (status !== "done" && source) configuredMissing.push(slug);
      if (status !== "done" && !source) unconfiguredMissing.push(slug);
      if (source) {
        missing.push({
          slug,
          action: "deposit-missing",
          sourceId: source.sourceId,
          pvIndexUrl: source.pvIndexUrl,
          manifestKey: pvManifestKey(slug),
        });
      }
      continue;
    }

    if (source && present.lastModified <= refreshBefore) {
      stale.push({
        slug,
          action: "revalidate-older-manifest",
        sourceId: source.sourceId,
        pvIndexUrl: source.pvIndexUrl,
        manifestKey: pvManifestKey(slug),
        expectedLastModified: present.lastModified,
      });
    }
  }

  stale.sort((a, b) =>
    (a.expectedLastModified ?? "").localeCompare(b.expectedLastModified ?? "") || a.slug.localeCompare(b.slug),
  );
  const selected = [...missing, ...stale].slice(0, input.limit);

  return {
    schema: PV_REFRESH_PLAN_SCHEMA,
    asOf: asOf.toISOString(),
    refreshBefore,
    settings: { maxTargets: input.limit, delayMs: input.delayMs, windowDays: input.windowDays },
    coverage: {
      municipalities: citySlugs.length,
      s3VerifiedPresent: objects.size,
      matrixDone,
      matrixDoneMissingS3,
      matrixNonDonePresentS3,
      s3UnknownSlugs: [...unknown].sort(),
    },
    residual: {
      total: configuredMissing.length + unconfiguredMissing.length,
      configuredMissing,
      unconfiguredMissing,
    },
    eligible: { missing: missing.length, stale: stale.length },
    selected,
  };
}

/** Arguments for the existing idempotent generic adapter. */
export function pvRefreshRunnerArgs(plan: PvRefreshPlan, dryRun: boolean, allowLegacyGeneric = false): string[] | null {
  if (plan.selected.length === 0) return null;
  return [
    "npx",
    "tsx",
    "acquisition/src/pv-index-run.ts",
    "--slugs",
    plan.selected.map((target) => target.slug).join(","),
    "--refresh-before",
    plan.refreshBefore,
    "--delay-ms",
    String(plan.settings.delayMs),
    "--window-days",
    String(plan.settings.windowDays),
    ...(allowLegacyGeneric ? ["--allow-legacy-generic"] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ];
}
