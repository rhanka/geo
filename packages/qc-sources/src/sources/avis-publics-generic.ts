import type { SourceKind } from "../domain.js";

import { sha256Hex } from "../RawDocument.js";
import type {
  IsoDateString,
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "../SourceAdapter.js";
import {
  parseAvisPublics,
  type AvisPublicItemT,
} from "./avis-publics-parser.js";
// The canonical error + fetch types live in avis-publics-valleyfield.ts (shared
// across all avis adapters). Import for internal use; callers should import from
// avis-publics-valleyfield.js or from the package root.
import {
  SourceFetchError,
  type FetchLike,
  AVIS_PUBLICS_USER_AGENT as AVIS_GENERIC_USER_AGENT,
} from "./avis-publics-valleyfield.js";
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const AVIS_PUBLICS_GENERIC_ADAPTER_VERSION = "0.1.0";

/** Hard cap per fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────────
// City configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-city configuration for the generic avis-publics adapter.
 *
 * `avisIndexUrl` is the public URL of the page listing the current avis-publics.
 * The shared `parseAvisPublics` dispatcher handles both Craft (Valleyfield) and
 * WordPress (Beauharnois) markup, so adding a new city requires only this config.
 *
 * `citySlug` must match the radar city registry slug (lowercase, hyphenated).
 */
export interface AvisCityConfig {
  /** City slug used for RawDocument.city and storage key derivation. */
  readonly citySlug: string;
  /** Public URL of the avis-publics index page. */
  readonly avisIndexUrl: string;
  /** Stable source id used for the RECUEIL endpoint and storage keys. */
  readonly sourceId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter options
// ─────────────────────────────────────────────────────────────────────────────

export interface AvisAdapterOptions {
  /** Inject a mock fetch in tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: FetchLike;
  /** Per-fetch timeout in ms; defaults to FETCH_TIMEOUT_MS (15 s). */
  readonly timeoutMs?: number;
  /** Clock injection for the "now" timestamp (unit tests). */
  readonly now?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zonage detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keywords that signal an avis is related to land-use / zoning (anticipation
 * pré-PV). All strings are lowercase, accent-insensitive substrings. The list
 * is anchored on real Québec municipal law vocabulary (LAU art. 115 et seq.):
 *
 *   - "projet de règlement" + "zonage" → premier projet règlement de zonage
 *   - "ppcmoi" → Programme particulier de construction, modification ou
 *                occupation d'un immeuble (LAU art. 145.9–145.14)
 *   - "entrée en vigueur" + "règlement de zonage" → adoption finale
 *   - "règlement de zonage" alone → general reference
 *   - "changement de zonage" / "changement de zone" → rezoning application
 *
 * The check is intentionally broad (substring) so minor wording variations
 * across cities (e.g. "règlement de zonage 701") are captured.
 */
const ZONAGE_KEYWORDS_FR: readonly string[] = [
  "ppcmoi",
  "règlement de zonage",
  "reglement de zonage",
  "changement de zonage",
  "changement de zone",
  "projet de règlement",
  "projet de reglement",
];

/**
 * Returns `true` when the avis title or type suggests it is related to zoning
 * (zonage). This is a best-effort classification from public notice titles
 * (anti-invention: never true unless a keyword matches).
 *
 * Coverage:
 *   - PPCMOI notices (any city)
 *   - Projet de règlement mentioning "règlement de zonage" or "701" patterns
 *   - Entrée en vigueur of a règlement de zonage
 *   - Explicit "changement de zonage" phrasing
 */
export function isAvisLieAuZonage(item: AvisPublicItemT): boolean {
  const t = item.title.toLowerCase();
  // Direct PPCMOI type (fastest path).
  if (item.type === "ppcmoi") return true;
  // Keyword scan of the title.
  for (const kw of ZONAGE_KEYWORDS_FR) {
    if (t.includes(kw)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic avis-publics SourceAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic avis-publics SourceAdapter — parameterised by `AvisCityConfig`.
 *
 * Supports both Craft CMS (Valleyfield) and WordPress (Beauharnois) index pages
 * through the shared `parseAvisPublics` dispatcher. Adding a new city requires
 * only a new `AvisCityConfig`; no code change is needed.
 *
 * `list()` discovers the single index page (the parseable artifact carrying all
 * current notices). `fetch()` performs the real HTTP GET and returns the raw
 * bytes + provenance. `hash()` is the sha256 used for idempotent storage.
 *
 * The adapter NEVER throws on a fetch failure: it raises a typed
 * `SourceFetchError` that the RECUEIL job converts into a typed outcome.
 *
 * `parseItems()` converts the fetched bytes into structured notices.
 * `parseItemsZonage()` filters to notices related to land-use/zoning.
 */
export class AvisPublicsGenericAdapter implements SourceAdapter {
  readonly kind: SourceKind = "avis-publics";
  readonly city: string;
  readonly version = AVIS_PUBLICS_GENERIC_ADAPTER_VERSION;

  private readonly config: AvisCityConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(config: AvisCityConfig, options: AvisAdapterOptions = {}) {
    this.config = config;
    this.city = config.citySlug;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  // ── list() ─────────────────────────────────────────────────────────────────

  /**
   * Yield the single index-page ref. The index is the canonical artifact that
   * carries all current notices; the RECUEIL job decides whether to re-fetch it
   * based on the sha256 hash (idempotency).
   */
  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    yield {
      sourceKind: this.kind,
      city: this.city,
      url: this.config.avisIndexUrl,
      discoveredAt: this.now().toISOString(),
      title: `Avis publics — ${this.config.citySlug} (index)`,
      contentType: "text/html",
      metadata: { avisSourceId: this.config.sourceId },
    };
  }

  // ── fetch() ────────────────────────────────────────────────────────────────

  /**
   * Perform the HTTP GET for `ref.url` with a hard timeout and an honest
   * user-agent. Returns a fully-formed `RawDocument` including sha256 and
   * provenance. Raises `SourceFetchError` on timeout / network / HTTP error
   * (never throws a plain Error).
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(ref.url, {
          signal: controller.signal,
          headers: { "user-agent": AVIS_GENERIC_USER_AGENT, accept: "text/html" },
        });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        throw new SourceFetchError(
          isAbort ? "timeout" : "network",
          e instanceof Error ? e.message : String(e),
          ref.url,
        );
      }

      if (!res.ok) {
        throw new SourceFetchError("http", `HTTP ${res.status}`, ref.url);
      }

      const arrayBuffer = await res.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);
      const contentType =
        res.headers.get("content-type") ?? ref.contentType ?? "text/html";

      const document: RawDocument = {
        ref,
        sourceKind: this.kind,
        city: this.city,
        url: ref.url,
        fetchedAt,
        contentType,
        body,
        httpStatus: res.status,
        sha256: sha256Hex(body),
        provenance: {
          adapterVersion: this.version,
          userAgent: AVIS_GENERIC_USER_AGENT,
          fetchedViaObscura: false,
          obtentionMode: "scraping",
        },
      };
      return document;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── hash() ─────────────────────────────────────────────────────────────────

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }

  // ── parse helpers ──────────────────────────────────────────────────────────

  /** Parse the fetched index bytes into structured notices (EXPLOITATION input). */
  parseItems(raw: RawDocument): AvisPublicItemT[] {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseAvisPublics(text);
  }

  /**
   * Parse the fetched index bytes and return ONLY notices related to zoning
   * (anticipation pré-PV). Uses `isAvisLieAuZonage` for the filter.
   */
  parseItemsZonage(raw: RawDocument): AvisPublicItemT[] {
    return this.parseItems(raw).filter(isAvisLieAuZonage);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Well-known city configurations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Salaberry-de-Valleyfield: Craft CMS, `icon-block--is-link` notices.
 * Source URL confirmed robots-allowed (public HTML, no login, no CAPTCHA).
 */
export const VALLEYFIELD_AVIS_CONFIG: AvisCityConfig = {
  citySlug: "salaberry-de-valleyfield",
  avisIndexUrl: "https://www.ville.valleyfield.qc.ca/avis-publics",
  sourceId: "avis-publics-valleyfield",
};

/**
 * Beauharnois: WordPress block editor, `<details>` notices + `wp-block-file`.
 * Source URL confirmed robots-allowed (only `/wp-admin/` disallowed).
 */
export const BEAUHARNOIS_AVIS_CONFIG: AvisCityConfig = {
  citySlug: "beauharnois",
  avisIndexUrl:
    "https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics",
  sourceId: "avis-publics-beauharnois",
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────────────────────────────────────

/** Factory for any city by config (generic entry-point). */
export function createAvisPublicsAdapter(
  config: AvisCityConfig,
  options: AvisAdapterOptions = {},
): AvisPublicsGenericAdapter {
  return new AvisPublicsGenericAdapter(config, options);
}

/** Factory shortcut for the Valleyfield avis-publics adapter. */
export function createAvisPublicsValleyfieldGenericAdapter(
  options: AvisAdapterOptions = {},
): AvisPublicsGenericAdapter {
  return new AvisPublicsGenericAdapter(VALLEYFIELD_AVIS_CONFIG, options);
}

/** Factory shortcut for the Beauharnois avis-publics adapter. */
export function createAvisPublicsBeauharnoisGenericAdapter(
  options: AvisAdapterOptions = {},
): AvisPublicsGenericAdapter {
  return new AvisPublicsGenericAdapter(BEAUHARNOIS_AVIS_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Sud cluster: Roussillon MRC cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Catherine (MRC Roussillon, ~25 km SW of Montréal).
 * Avis publics on a dedicated page (custom CMS, direct PDF links).
 * Confirmed HTTP 200, robots.txt: Disallow /craft/ only.
 * Captured 2026-06-10.
 */
export const SAINTE_CATHERINE_AVIS_CONFIG: AvisCityConfig = {
  citySlug: "sainte-catherine",
  avisIndexUrl:
    "https://www.ville.sainte-catherine.qc.ca/ville/vie-municipale/avis-publics-et-divulgations-legales/",
  sourceId: "avis-publics-sainte-catherine",
};

/** Factory shortcut for the Sainte-Catherine avis-publics adapter. */
export function createAvisPublicsSainteCatherineAdapter(
  options: AvisAdapterOptions = {},
): AvisPublicsGenericAdapter {
  return new AvisPublicsGenericAdapter(SAINTE_CATHERINE_AVIS_CONFIG, options);
}

/**
 * Saint-Constant (MRC Roussillon, ~30 km SW of Montréal).
 * Avis publics co-located with the PV/séances page, organized by week.
 * Confirmed HTTP 200, robots.txt: no restrictions.
 * Captured 2026-06-10.
 */
export const SAINT_CONSTANT_AVIS_CONFIG: AvisCityConfig = {
  citySlug: "saint-constant",
  avisIndexUrl:
    "https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics",
  sourceId: "avis-publics-saint-constant",
};

/** Factory shortcut for the Saint-Constant avis-publics adapter. */
export function createAvisPublicsSaintConstantAdapter(
  options: AvisAdapterOptions = {},
): AvisPublicsGenericAdapter {
  return new AvisPublicsGenericAdapter(SAINT_CONSTANT_AVIS_CONFIG, options);
}
