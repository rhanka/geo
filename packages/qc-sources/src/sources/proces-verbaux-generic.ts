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
  filterPvByWindow,
  parsePvIndex,
  PV_NON_DISPONIBLE,
} from "./proces-verbaux-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PV_ADAPTER_VERSION = "0.1.0";

/** Honest, identifiable user-agent (rules/MASTER.md Scraping Policy). */
export const PV_USER_AGENT =
  "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)";

/** Hard cap per fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Default look-back window in days for PV discovery.
 * The spec mandates 6 months (≈183 days).
 */
const DEFAULT_WINDOW_DAYS = 183;

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch-failure kinds — returned, never thrown (patron avis-publics). */
export type PvSourceErrorKind = "timeout" | "network" | "http" | "parse";

export class PvSourceFetchError extends Error {
  constructor(
    readonly kind: PvSourceErrorKind,
    readonly detail: string,
    readonly url: string,
  ) {
    super(`[${kind}] ${detail}`);
    this.name = "PvSourceFetchError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FetchLike injectable — makes the adapter unit-testable without globals
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fetch signature so the PV adapter is testable without globals. */
export type PvFetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// City configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-city configuration for the generic PV adapter.
 *
 * `pvIndexUrl` is the public URL of the page listing the council PV documents.
 * It is fetched as-is (direct download, no Obscura required at test time).
 *
 * `citySlug` must match the radar city registry slug (lowercase, hyphenated,
 * e.g. "saint-damase", "salaberry-de-valleyfield").
 */
export interface PvCityConfig {
  /** City slug used for RawDocument.city and storage key derivation. */
  readonly citySlug: string;
  /** Public URL of the PV index page. */
  readonly pvIndexUrl: string;
  /** Source id, e.g. "proces-verbaux-saint-damase". */
  readonly sourceId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter options
// ─────────────────────────────────────────────────────────────────────────────

export interface PvAdapterOptions {
  /** Inject a mock fetch in tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: PvFetchLike;
  /** Per-fetch timeout in ms; defaults to FETCH_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Clock injection for the "now" timestamp (unit tests). */
  readonly now?: () => Date;
  /**
   * Look-back window in days.  A PV whose date is older than `now - windowDays`
   * is excluded from the list.  Defaults to DEFAULT_WINDOW_DAYS (6 months).
   */
  readonly windowDays?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic PV SourceAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic procès-verbaux SourceAdapter — parameterised by city config.
 *
 * `list()`: fetches the PV index page and yields one `RawDocumentRef` per PV
 *   document that falls within the configured window.
 * `fetch()`: downloads the PV document (HTML or PDF) and returns a `RawDocument`.
 * `hash()`: sha256 of the raw bytes (idempotent storage key primitive).
 *
 * The adapter NEVER throws on a fetch failure: it raises a typed
 * `PvSourceFetchError` that the RECUEIL job converts into a typed outcome.
 *
 * Rate-limiting (1 req / 2 s per the Scraping Policy) is the caller's
 * responsibility; the adapter itself is a pure fetch abstraction.
 */
export class ProcesVerbauxGenericAdapter implements SourceAdapter {
  readonly kind: SourceKind = "pv";
  readonly city: string;
  readonly version = PV_ADAPTER_VERSION;

  private readonly config: PvCityConfig;
  private readonly fetchImpl: PvFetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly windowDays: number;

  constructor(config: PvCityConfig, options: PvAdapterOptions = {}) {
    this.config = config;
    this.city = config.citySlug;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as PvFetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private isoWindow(): { since: string; until: string } {
    const now = this.now();
    const until = now.toISOString().slice(0, 10);
    const sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - this.windowDays);
    const since = sinceDate.toISOString().slice(0, 10);
    return { since, until };
  }

  /**
   * Perform one fetch with timeout + error wrapping.
   * Returns `{ ok, status, headers, arrayBuffer }` or throws `PvSourceFetchError`.
   */
  private async fetchWithTimeout(
    url: string,
    accept = "*/*",
  ): Promise<Awaited<ReturnType<PvFetchLike>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Awaited<ReturnType<PvFetchLike>>;
      try {
        res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            "user-agent": PV_USER_AGENT,
            accept,
          },
        });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        throw new PvSourceFetchError(
          isAbort ? "timeout" : "network",
          e instanceof Error ? e.message : String(e),
          url,
        );
      }
      if (!res.ok) {
        throw new PvSourceFetchError("http", `HTTP ${res.status}`, url);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── list() ─────────────────────────────────────────────────────────────────

  /**
   * Fetch the PV index page and yield one ref per PV within the window.
   *
   * Emits the raw index page first (sourceKind "pv", contentType "text/html"),
   * then one ref per discovered PV document.
   */
  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;

    const discoveredAt: IsoDateString = this.now().toISOString();
    const { since, until } = this.isoWindow();

    // 1. Fetch the index page. fetchWithTimeout throws PvSourceFetchError on
    //    failure; the RECUEIL job catches it — no wrapper needed here.
    const indexRes = await this.fetchWithTimeout(
      this.config.pvIndexUrl,
      "text/html",
    );
    const indexHtml = new TextDecoder("utf-8").decode(
      new Uint8Array(await indexRes.arrayBuffer()),
    );

    if (opts.signal?.aborted) return;

    // 2. Parse and filter by window.
    const allItems = parsePvIndex(indexHtml, this.config.pvIndexUrl);
    const windowItems = filterPvByWindow(allItems, since, until);

    // 3. Yield one ref per PV in the window.
    for (const item of windowItems) {
      if (opts.signal?.aborted) break;
      const hasDate = item.dateIso !== PV_NON_DISPONIBLE;
      const ref: RawDocumentRef = {
        sourceKind: this.kind,
        city: this.city,
        url: item.url,
        discoveredAt,
        title: item.title,
        ...(hasDate ? { publishedAt: item.dateIso } : {}),
        contentType: item.url.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/html",
        metadata: { pvSourceId: this.config.sourceId },
      };
      yield ref;
    }
  }

  // ── fetch() ────────────────────────────────────────────────────────────────

  /**
   * Download the document at `ref.url` and return a `RawDocument`.
   * For PDFs the caller is responsible for running `pdftotext` if needed;
   * the adapter returns raw bytes.
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const isPdf = ref.url.toLowerCase().endsWith(".pdf");
    const accept = isPdf ? "application/pdf" : "text/html,*/*";

    const res = await this.fetchWithTimeout(ref.url, accept);
    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const contentType =
      res.headers.get("content-type") ??
      ref.contentType ??
      (isPdf ? "application/pdf" : "text/html");

    const doc: RawDocument = {
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
        userAgent: PV_USER_AGENT,
        fetchedViaObscura: false,
        obtentionMode: "scraping",
      },
    };
    return doc;
  }

  // ── hash() ─────────────────────────────────────────────────────────────────

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Well-known city configurations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saint-Damase: simple WordPress site, PV list on the conseil municipal page.
 * No CAPTCHA, direct download — ideal easy-first target.
 */
export const SAINT_DAMASE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-damase",
  pvIndexUrl:
    "https://www.municipalite.saint-damase.qc.ca/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-damase",
};

/** Factory shortcut for the Saint-Damase PV adapter. */
export function createSaintDamasePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_DAMASE_PV_CONFIG, options);
}

/** Factory for any city, generic entry-point. */
export function createProcesVerbauxAdapter(
  config: PvCityConfig,
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(config, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL_PV_CITIES — single source of truth for generic PV city wiring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One city entry in the generic PV city registry.
 *
 * `config`    — PvCityConfig (citySlug + pvIndexUrl + sourceId).
 * `pvText`    — Real pdftotext excerpt used by pv-seed (no network needed).
 * `sourceUrl` — Public URL of the real PV PDF (provenance, never re-fetched).
 */
export interface PvCityEntry {
  readonly config: PvCityConfig;
  /**
   * OPTIONAL real pdftotext excerpt — present only for the "golden" demo cities
   * that pv-seed seeds offline. **New cities are config-only** (no fixture): the
   * production worker fetches them live and writes to S3 (spec S3-first §3).
   */
  readonly pvText?: string;
  /** OPTIONAL public URL of the original PV PDF (provenance for the excerpt). */
  readonly sourceUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Sud cluster: Roussillon MRC cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Catherine (MRC Roussillon, ~25 km SW of Montréal).
 * Custom CMS (same vendor as Saint-Constant). PV list at the
 * "séances publiques" page. Direct PDF links, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /craft/ only.
 * Captured 2026-06-10.
 */
export const SAINTE_CATHERINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-catherine",
  pvIndexUrl:
    "https://www.ville.sainte-catherine.qc.ca/ville/conseil-municipal/seances-publiques/",
  sourceId: "proces-verbaux-sainte-catherine",
};

/** Factory shortcut for the Sainte-Catherine PV adapter. */
export function createSainteCatherinePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_CATHERINE_PV_CONFIG, options);
}

/**
 * Saint-Constant (MRC Roussillon, ~30 km SW of Montréal).
 * Custom CMS. PV list at the "séances-du-conseil-et-documents-publics" page.
 * Direct PDF links under /uploads/attachments/Greffe/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const SAINT_CONSTANT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-constant",
  pvIndexUrl:
    "https://saint-constant.ca/fr/seances-du-conseil-et-documents-publics",
  sourceId: "proces-verbaux-saint-constant",
};

/** Factory shortcut for the Saint-Constant PV adapter. */
export function createSaintConstantPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_CONSTANT_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Sud / Vaudreuil-Soulanges cluster: additional cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La Prairie (MRC Roussillon, ~25 km SW of Montréal).
 * October CMS (custom accordion). PV list under /ville/democratie/seances-du-conseil.
 * Direct PDF links under /storage/app/media/..., no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /administration/ only.
 * Captured 2026-06-10.
 */
export const LAPRAIRIE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-prairie",
  pvIndexUrl: "https://laprairie.ca/ville/democratie/seances-du-conseil",
  sourceId: "proces-verbaux-la-prairie",
};

/** Factory shortcut for the La Prairie PV adapter. */
export function createLaPrairiePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LAPRAIRIE_PV_CONFIG, options);
}

/**
 * Châteauguay (MRC Roussillon, ~35 km SW of Montréal).
 * WordPress CMS. PV list at /affaires-municipales/seances-du-conseil/.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /wp-admin/ only; Crawl-delay: 3.
 * Captured 2026-06-10.
 */
export const CHATEAUGUAY_PV_CONFIG: PvCityConfig = {
  citySlug: "chateauguay",
  pvIndexUrl:
    "https://ville.chateauguay.qc.ca/affaires-municipales/seances-du-conseil/",
  sourceId: "proces-verbaux-chateauguay",
};

/** Factory shortcut for the Châteauguay PV adapter. */
export function createChateauguayPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CHATEAUGUAY_PV_CONFIG, options);
}

/**
 * Delson (MRC Roussillon, ~35 km SW of Montréal).
 * WordPress CMS (act-collapsible blocks). PV list at
 * /la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const DELSON_PV_CONFIG: PvCityConfig = {
  citySlug: "delson",
  pvIndexUrl:
    "https://ville.delson.qc.ca/la-ville/vie-democratique/seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-delson",
};

/** Factory shortcut for the Delson PV adapter. */
export function createDelsonPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(DELSON_PV_CONFIG, options);
}

/**
 * Vaudreuil-Dorion (MRC Vaudreuil-Soulanges, ~40 km W of Montréal).
 * Custom CMS. PV list at /fr/la-ville/conseil-municipal/seances-publiques.
 * Direct PDF links under /uploads/sections/La_Ville/Mairie/Seances_publiques/PV_20XX/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /assets/admin/ and search pages.
 * Captured 2026-06-10.
 */
export const VAUDREUIL_DORION_PV_CONFIG: PvCityConfig = {
  citySlug: "vaudreuil-dorion",
  pvIndexUrl:
    "https://www.ville.vaudreuil-dorion.qc.ca/fr/la-ville/conseil-municipal/seances-publiques",
  sourceId: "proces-verbaux-vaudreuil-dorion",
};

/** Factory shortcut for the Vaudreuil-Dorion PV adapter. */
export function createVaudreuilDorionPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(VAUDREUIL_DORION_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-2 cluster: Roussillon / Haut-St-Laurent cities near Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Martine (MRC Beauharnois-Salaberry, ~50 km SW of Montréal).
 * WordPress CMS. PV list via publications page filtered by document_type=proces-verbaux.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const SAINTE_MARTINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-martine",
  pvIndexUrl:
    "https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux",
  sourceId: "proces-verbaux-sainte-martine",
};

/** Factory shortcut for the Sainte-Martine PV adapter. */
export function createSainteMartinePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_MARTINE_PV_CONFIG, options);
}

/**
 * Candiac (MRC Roussillon, ~25 km S of Montréal).
 * Custom CMS. PV list at /la-ville/vie-democratique/seances-publiques.
 * Direct PDF links under /uploads/Documents/Juridiques/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: /admin, /uploads/carrier — content pages allowed.
 * NOTE: All Candiac PV PDFs are PaperCut scanned images (no embedded text layer).
 *       pdftotext returns 0 bytes. OCR required for text extraction.
 *       The adapter correctly lists PV refs from the index; text detection not applicable.
 * Captured 2026-06-10.
 */
export const CANDIAC_PV_CONFIG: PvCityConfig = {
  citySlug: "candiac",
  pvIndexUrl:
    "https://candiac.ca/la-ville/vie-democratique/seances-publiques",
  sourceId: "proces-verbaux-candiac",
};

/** Factory shortcut for the Candiac PV adapter. */
export function createCandiacPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CANDIAC_PV_CONFIG, options);
}

/**
 * Saint-Rémi (MRC Les Jardins-de-Napierville, ~40 km S of Montréal).
 * WordPress / Elementor CMS. Main séances page at /ville/vie-municipale/seances-du-conseil/.
 * Archives 2025: direct PDF links in accordion. 2026: sub-page links (parsePvIndex finds
 * the 2025 direct PDF links; 2026 sub-pages require an additional fetch per session).
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * NOTE: Saint-Rémi uses V-prefix règlement numbering (V654-2026-33). The existing
 *       REGLEMENT_NUMBER_RE pattern does not match V-prefix numbers, so detectZonageChange
 *       returns avisDeMotion=true but changementZonage=false even for real zonage changes.
 *       This is a documented parser limitation (honest, not a faux positif).
 * Captured 2026-06-10.
 */
export const SAINT_REMI_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-remi",
  pvIndexUrl:
    "https://www.saint-remi.ca/ville/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-remi",
};

/** Factory shortcut for the Saint-Rémi PV adapter. */
export function createSaintRemiPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_REMI_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Roussillon / Jardins-de-Napierville cluster (new cities 2026-06-10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saint-Jacques-le-Mineur (MRC Les Jardins-de-Napierville, ~45 km SSW of Montréal).
 * WordPress + custom Jupiter X theme. PV list at /seances-du-conseil/.
 * Cards (.avis_public_item) with direct PDF links to PV + OJ per session.
 * Confirmed HTTP 200, robots.txt: Crawl-delay: 10, Disallow: (empty — no restrictions).
 * Zonage réel: règlement 1212-2026 modifiant zonage 1200-2018 (zones commerciales).
 * Captured 2026-06-10.
 */
export const SAINT_JACQUES_LE_MINEUR_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jacques-le-mineur",
  pvIndexUrl:
    "https://www.saint-jacques-le-mineur.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-jacques-le-mineur",
};

/** Factory shortcut for the Saint-Jacques-le-Mineur PV adapter. */
export function createSaintJacquesLeMineurPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_JACQUES_LE_MINEUR_PV_CONFIG, options);
}

/**
 * Canton Hemmingford (MRC Les Jardins-de-Napierville, ~65 km SSW of Montréal).
 * WordPress custom theme. PV list at /municipalite/conseil-et-administration/proces-verbaux/.
 * Table layout with 2025/2026 columns and direct PDF links.
 * Confirmed HTTP 200, robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 * Zonage réel: règlement 309-19 modifiant règlement de zonage 309 (bâtiment accessoire).
 * Captured 2026-06-10.
 */
export const HEMMINGFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "hemmingford",
  pvIndexUrl:
    "https://canton.hemmingford.ca/municipalite/conseil-et-administration/proces-verbaux/",
  sourceId: "proces-verbaux-hemmingford",
};

/** Factory shortcut for the Canton Hemmingford PV adapter. */
export function createHemmingfordPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(HEMMINGFORD_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-3 cluster: Vallée-du-Richelieu / Marguerite-D'Youville cities near MTL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * McMasterville (MRC Vallée-du-Richelieu, ~25 km SE of Montréal).
 * WordPress + Visual Composer CMS. PV list at /mairie/seances-du-conseil/.
 * Panels (vc_tta-accordion) with sc_button PDF links for Procès-verbal + ODJ + Vidéo.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const MCMASTERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "mcmasterville",
  pvIndexUrl: "https://www.mcmasterville.ca/mairie/seances-du-conseil/",
  sourceId: "proces-verbaux-mcmasterville",
};

/** Factory shortcut for the McMasterville PV adapter. */
export function createMcmastervillePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MCMASTERVILLE_PV_CONFIG, options);
}

/**
 * Beloeil (MRC La Vallée-du-Richelieu, ~30 km SE of Montréal).
 * WordPress + Elementor CMS. PV list at /mairie/seances-du-conseil/.
 * Elementor accordion: 2026 individual sessions + compiled 2025/2024 PDFs.
 * Direct PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions, Yoast sitemap).
 * Captured 2026-06-10.
 */
export const BELOEIL_PV_CONFIG: PvCityConfig = {
  citySlug: "beloeil",
  pvIndexUrl: "https://www.beloeil.ca/mairie/seances-du-conseil/",
  sourceId: "proces-verbaux-beloeil",
};

/** Factory shortcut for the Beloeil PV adapter. */
export function createBeloeilPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(BELOEIL_PV_CONFIG, options);
}

/**
 * Sainte-Julie (MRC Marguerite-D'Youville, ~30 km SE of Montréal).
 * Custom CMS (saintejulie.ca). PV list at /administration/seances-publiques.
 * Custom accordeon structure with direct PDF links under /uploads/html_content/Séances publiques/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: 404 (no restrictions file; permissive by default).
 * Captured 2026-06-10.
 */
export const SAINTE_JULIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-julie",
  pvIndexUrl: "https://saintejulie.ca/administration/seances-publiques",
  sourceId: "proces-verbaux-sainte-julie",
};

/** Factory shortcut for the Sainte-Julie PV adapter. */
export function createSainteJuliePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_JULIE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Basses-Laurentides cluster: cities north of Montréal (MRC Thérèse-De Blainville,
// MRC Deux-Montagnes, Laurentides MRC)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sainte-Thérèse (MRC Thérèse-De Blainville, ~30 km N of Montréal).
 * October CMS (same as La Prairie / Blainville). PV list at
 * /la-ville/democratie/seances-du-conseil/.
 * Direct PDF links under /storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const SAINTE_THERESE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-therese",
  pvIndexUrl:
    "https://www.sainte-therese.ca/la-ville/democratie/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-therese",
};

/** Factory shortcut for the Sainte-Thérèse PV adapter. */
export function createSainteTheresePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINTE_THERESE_PV_CONFIG, options);
}

/**
 * Deux-Montagnes (MRC Deux-Montagnes, ~40 km NW of Montréal).
 * October CMS (same as La Prairie). PV list at
 * /ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal.
 * Direct PDF links under /storage/app/media/ville-de-deux-montagnes/vie-democratique/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const DEUX_MONTAGNES_PV_CONFIG: PvCityConfig = {
  citySlug: "deux-montagnes",
  pvIndexUrl:
    "https://www.ville.deux-montagnes.qc.ca/ville-de-deux-montagnes/vie-democratique/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-deux-montagnes",
};

/** Factory shortcut for the Deux-Montagnes PV adapter. */
export function createDeuxMontagnePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(DEUX_MONTAGNES_PV_CONFIG, options);
}

/**
 * Mirabel (MRC Mirabel, ~50 km NW of Montréal — largest city in Laurentides).
 * Custom CMS (mirabel.ca). PV list at /seances-conseil.
 * Custom table layout with direct PDF links under /uploads/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const MIRABEL_PV_CONFIG: PvCityConfig = {
  citySlug: "mirabel",
  pvIndexUrl: "https://mirabel.ca/seances-conseil",
  sourceId: "proces-verbaux-mirabel",
};

/** Factory shortcut for the Mirabel PV adapter. */
export function createMirabelPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MIRABEL_PV_CONFIG, options);
}

/**
 * Saint-Eustache (MRC Deux-Montagnes, ~40 km NW of Montréal).
 * October CMS (same as Sainte-Thérèse / La Prairie). PV list at
 * /ville/vie-democratique/seances-du-conseil.
 * NOTE: Saint-Eustache publishes PV as ANNUAL compiled documents (2026PV_internet.pdf,
 * 2025PV_internet.pdf, etc.) — one file per year. The parsePvIndex finds the links but
 * cannot extract individual session dates from the compiled-document filenames.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/backend only.
 * Captured 2026-06-10.
 */
export const SAINT_EUSTACHE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-eustache",
  pvIndexUrl:
    "https://www.saint-eustache.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-saint-eustache",
};

/** Factory shortcut for the Saint-Eustache PV adapter. */
export function createSaintEustachePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_EUSTACHE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanaudière cluster: couronne nord-est de Montréal (MRC Les Moulins, L'Assomption,
// D'Autray) — villes à ~40–60 km NE de Montréal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mascouche (MRC Les Moulins, ~40 km NE de Montréal).
 * October CMS. PV index at /ville/vie-democratique/seances-du-conseil.
 * One compiled PDF per year (all sessions in one file).
 * Direct PDF links under /storage/app/media/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: 404 (no restrictions file — permissive by default).
 * Captured 2026-06-10.
 */
export const MASCOUCHE_PV_CONFIG: PvCityConfig = {
  citySlug: "mascouche",
  pvIndexUrl:
    "https://mascouche.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-mascouche",
};

/** Factory shortcut for the Mascouche PV adapter. */
export function createMascouchePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MASCOUCHE_PV_CONFIG, options);
}

/**
 * Charlemagne (MRC Les Moulins, ~40 km NE de Montréal).
 * October CMS. PV index at /la-ville/vie-democratique/seances-du-conseil.
 * One PDF per month, class="small-document" anchor links.
 * Direct PDF links under /storage/app/media/la-ville/Séances du conseil/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: 404 (no restrictions file — permissive by default).
 * Captured 2026-06-10.
 */
export const CHARLEMAGNE_PV_CONFIG: PvCityConfig = {
  citySlug: "charlemagne",
  pvIndexUrl:
    "https://www.charlemagne.ca/la-ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-charlemagne",
};

/** Factory shortcut for the Charlemagne PV adapter. */
export function createCharlemagnePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(CHARLEMAGNE_PV_CONFIG, options);
}

/**
 * L'Assomption (MRC L'Assomption, ~45 km NE de Montréal).
 * Custom CMS (Bootstrap 3 accordion). PV index at /seances-conseil/.
 * Individual PV PDFs per session via download.php?filename= relative links.
 * Confirmed HTTP 200 (301 redirect from ville.lassomption.qc.ca),
 * robots.txt: User-agent: * / Sitemap only — NO Disallow rules.
 * Captured 2026-06-10.
 */
export const LASSOMPTION_PV_CONFIG: PvCityConfig = {
  citySlug: "lassomption",
  pvIndexUrl:
    "https://www.ville.lassomption.qc.ca/seances-conseil/",
  sourceId: "proces-verbaux-lassomption",
};

/** Factory shortcut for the L'Assomption PV adapter. */
export function createLAssomptionPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LASSOMPTION_PV_CONFIG, options);
}

/**
 * Lavaltrie (MRC D'Autray, ~60 km NE de Montréal).
 * October / Byscuit CMS. PV index at /conseil-municipal/seances-du-conseil-et-proces-verbaux.
 * Individual PDFs per session via fr-file relative links under /storage/app/media/.
 * Confirmed HTTP 200 (301 redirect from lavaltrie.ca),
 * robots.txt: 404 (permissive by default).
 * Captured 2026-06-10.
 */
export const LAVALTRIE_PV_CONFIG: PvCityConfig = {
  citySlug: "lavaltrie",
  pvIndexUrl:
    "https://www.ville.lavaltrie.qc.ca/conseil-municipal/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-lavaltrie",
};

/** Factory shortcut for the Lavaltrie PV adapter. */
export function createLavaltrieAdvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LAVALTRIE_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vaudreuil-Soulanges cluster (additional cities beyond Vaudreuil-Dorion)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les Cèdres (MRC Vaudreuil-Soulanges, ~50 km W of Montréal).
 * Drupal CMS. PV list at /fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour.
 * Relative PDF links under /sites/default/files/PDF/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /admin/, /includes/ — content pages allowed.
 * Captured 2026-06-10.
 */
export const LES_CEDRES_PV_CONFIG: PvCityConfig = {
  citySlug: "les-cedres",
  pvIndexUrl:
    "https://www.ville.lescedres.qc.ca/fr/services-aux-citoyens/greffe/proces-verbaux-ordres-du-jour",
  sourceId: "proces-verbaux-les-cedres",
};

/** Factory shortcut for the Les Cèdres PV adapter. */
export function createLesCedresPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LES_CEDRES_PV_CONFIG, options);
}

/**
 * Pincourt (MRC Vaudreuil-Soulanges, ~40 km W of Montréal).
 * Custom CMS. PV list at /fr/la-ville/administration/seances-et-proces-verbaux.
 * Direct absolute PDF links under /uploads/Proces-verbaux/2026/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const PINCOURT_PV_CONFIG: PvCityConfig = {
  citySlug: "pincourt",
  pvIndexUrl:
    "https://www.villepincourt.qc.ca/fr/la-ville/administration/seances-et-proces-verbaux",
  sourceId: "proces-verbaux-pincourt",
};

/** Factory shortcut for the Pincourt PV adapter. */
export function createPincourtPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(PINCOURT_PV_CONFIG, options);
}

/**
 * Coteau-du-Lac (MRC Vaudreuil-Soulanges, ~55 km W of Montréal).
 * October CMS. PV list at /vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux.
 * Direct absolute PDF links under /storage/app/media/…/proces-verbaux/2026/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /administration — content pages allowed.
 * Captured 2026-06-10.
 */
export const COTEAU_DU_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "coteau-du-lac",
  pvIndexUrl:
    "https://coteau-du-lac.com/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-coteau-du-lac",
};

/** Factory shortcut for the Coteau-du-Lac PV adapter. */
export function createCoteauDuLacPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(COTEAU_DU_LAC_PV_CONFIG, options);
}

/**
 * Les Coteaux (MRC Vaudreuil-Soulanges, ~60 km W of Montréal).
 * WordPress CMS (Yoast). PV list at /citoyens/greffe/seance-du-conseil/.
 * Direct absolute PDF links under /wp-content/uploads/2026/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const LES_COTEAUX_PV_CONFIG: PvCityConfig = {
  citySlug: "les-coteaux",
  pvIndexUrl: "https://les-coteaux.qc.ca/citoyens/greffe/seance-du-conseil/",
  sourceId: "proces-verbaux-les-coteaux",
};

/** Factory shortcut for the Les Coteaux PV adapter. */
export function createLesCoteauxPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LES_COTEAUX_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rive-Nord cluster: MRC Thérèse-De Blainville (villes additionnelles)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rosemère (MRC Thérèse-De Blainville, ~30 km N of Montréal).
 * Custom CMS (PHP legacy). PV list at /seances-conseil/.
 * Simple anchor list with relative /images/clients/PV YYYY-MM-DD FINAL.pdf links.
 * Direct PDF links (relative hrefs resolved to www.ville.rosemere.qc.ca), no CAPTCHA.
 * Confirmed HTTP 200 (via 301 redirect: ville.rosemere.qc.ca → www.ville.rosemere.qc.ca).
 * robots.txt: User-agent: * / Sitemap only — NO Disallow rules (fully permissive).
 * Captured 2026-06-10.
 */
export const ROSEMERE_PV_CONFIG: PvCityConfig = {
  citySlug: "rosemere",
  pvIndexUrl: "https://www.ville.rosemere.qc.ca/seances-conseil/",
  sourceId: "proces-verbaux-rosemere",
};

/** Factory shortcut for the Rosemère PV adapter. */
export function createRosemerePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(ROSEMERE_PV_CONFIG, options);
}

/**
 * Lorraine (MRC Thérèse-De Blainville, ~35 km N of Montréal).
 * October CMS (same as Sainte-Thérèse / Deux-Montagnes). PV list at /conseil-municipal.
 * Direct PDF links under /storage/app/media/decouvrir/bienvenue-a-lorraine/
 * conseil-municipal/proces-verbaux/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /administration, /administration/,
 * /administration/backend, /administration/backend/ only — content pages allowed.
 * Captured 2026-06-10.
 */
export const LORRAINE_PV_CONFIG: PvCityConfig = {
  citySlug: "lorraine",
  pvIndexUrl: "https://lorraine.ca/conseil-municipal",
  sourceId: "proces-verbaux-lorraine",
};

/** Factory shortcut for the Lorraine PV adapter. */
export function createLorrainePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(LORRAINE_PV_CONFIG, options);
}

/**
 * Boisbriand (MRC Thérèse-De Blainville, ~35 km NW of Montréal).
 * October CMS (same as Lorraine / Sainte-Thérèse). PV list at
 * /ville/vie-democratique/seances-du-conseil (boisbriand.ca redirects to
 * www.ville.boisbriand.qc.ca).
 * Direct PDF links under /storage/app/media/ville/vie-democratique/seances-du-conseil/PV/.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /administration,
 * /administration/, /administration/backend, /administration/backend/ only.
 * NOTE: April 2026 PV has avis de motion for non-zonage règlements only (RV-1787-1 tarifs,
 *   RV-1796 réserve financière). The zonage modification uses an "intention" resolution
 *   (different procedural language). detectZonageChange → avisDeMotion=true,
 *   changementZonage=false (honest zero — no false positive).
 * Captured 2026-06-10.
 */
export const BOISBRIAND_PV_CONFIG: PvCityConfig = {
  citySlug: "boisbriand",
  pvIndexUrl:
    "https://boisbriand.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-boisbriand",
};

/** Factory shortcut for the Boisbriand PV adapter. */
export function createBoisbriandPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(BOISBRIAND_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Montérégie-Est cluster: Vallée-du-Richelieu / Marguerite-D'Youville (suite)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mont-Saint-Hilaire (MRC La Vallée-du-Richelieu, ~30 km SE de Montréal).
 * WordPress + custom accordion CMS. PV list at /ville/conseil-municipal/seances-du-conseil/.
 * Direct absolute PDF links under /wp-content/uploads/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 * Captured 2026-06-10.
 */
export const MONT_SAINT_HILAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-saint-hilaire",
  pvIndexUrl:
    "https://www.villemsh.ca/ville/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-mont-saint-hilaire",
};

/** Factory shortcut for the Mont-Saint-Hilaire PV adapter. */
export function createMontSaintHilairePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(MONT_SAINT_HILAIRE_PV_CONFIG, options);
}

/**
 * Boucherville (MRC Marguerite-D'Youville, ~25 km SE de Montréal).
 * WordPress CMS. PV index at /mairie-conseil/seances-du-conseil/.
 * PV links are HTML intermediate pages (/medias-publications/publications/...) that
 * each contain a direct PDF download link (PV_seance_YYMMDD.pdf).
 * Direct PDF project-règlement links under /wp-content/uploads/ (2026-290-XX pattern).
 * Confirmed HTTP 200, robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 * Captured 2026-06-10.
 */
export const BOUCHERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "boucherville",
  pvIndexUrl:
    "https://www.boucherville.ca/mairie-conseil/seances-du-conseil/",
  sourceId: "proces-verbaux-boucherville",
};

/** Factory shortcut for the Boucherville PV adapter. */
export function createBouchervillePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(BOUCHERVILLE_PV_CONFIG, options);
}

/**
 * Varennes (MRC Marguerite-D'Youville, ~35 km SE de Montréal).
 * Custom CMS. PV index at /la-ville/vie-democratique/seances-et-proces-verbaux.
 * Two separate lists: ODJ PDFs and PV PDFs (approved minutes).
 * Direct absolute PDF links under /uploads/conseil_municipal/, no CAPTCHA.
 * Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Captured 2026-06-10.
 */
export const VARENNES_PV_CONFIG: PvCityConfig = {
  citySlug: "varennes",
  pvIndexUrl:
    "https://www.ville.varennes.qc.ca/la-ville/vie-democratique/seances-et-proces-verbaux",
  sourceId: "proces-verbaux-varennes",
};

/** Factory shortcut for the Varennes PV adapter. */
export function createVarennesPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(VARENNES_PV_CONFIG, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL_PV_CITIES — single source of truth for generic PV city wiring
// ─────────────────────────────────────────────────────────────────────────────

// Lazy imports so this module stays importable without pulling fixture text in
// production (tree-shaking eliminates the strings when they are unused).
import { PV_SAINT_DAMASE_2025_05_POSITIVE } from "./proces-verbaux-saint-damase.fixture.js";
import {
  PV_SAINT_CONSTANT_2026_05_TEXT,
} from "./proces-verbaux-saint-constant.fixture.js";
import {
  PV_SAINTE_CATHERINE_2026_05_TEXT,
} from "./proces-verbaux-sainte-catherine.fixture.js";
import {
  PV_LAPRAIRIE_2026_05_TEXT,
} from "./proces-verbaux-laprairie.fixture.js";
import {
  PV_CHATEAUGUAY_2026_02_TEXT,
} from "./proces-verbaux-chateauguay.fixture.js";
import {
  PV_DELSON_2026_05_TEXT,
} from "./proces-verbaux-delson.fixture.js";
import {
  PV_VAUDREUIL_DORION_2026_05_TEXT,
} from "./proces-verbaux-vaudreuil-dorion.fixture.js";
import {
  PV_SAINTE_MARTINE_2026_04_TEXT,
} from "./proces-verbaux-sainte-martine.fixture.js";
import {
  PV_SAINT_REMI_2026_04_TEXT,
} from "./proces-verbaux-saint-remi.fixture.js";
import {
  PV_MCMASTERVILLE_2025_11_TEXT,
} from "./proces-verbaux-mcmasterville.fixture.js";
import {
  PV_BELOEIL_2026_02_TEXT,
} from "./proces-verbaux-beloeil.fixture.js";
import {
  PV_SAINTE_JULIE_2026_03_TEXT,
} from "./proces-verbaux-sainte-julie.fixture.js";
import {
  PV_SAINTE_THERESE_2026_03_TEXT,
} from "./proces-verbaux-sainte-therese.fixture.js";
import {
  PV_DEUX_MONTAGNES_2026_04_TEXT,
} from "./proces-verbaux-deux-montagnes.fixture.js";
import {
  PV_MIRABEL_2026_04_TEXT,
} from "./proces-verbaux-mirabel.fixture.js";
import {
  PV_SAINT_EUSTACHE_2026_02_TEXT,
} from "./proces-verbaux-saint-eustache.fixture.js";
import {
  PV_MASCOUCHE_2026_04_TEXT,
} from "./proces-verbaux-mascouche.fixture.js";
import {
  PV_CHARLEMAGNE_2026_05_TEXT,
} from "./proces-verbaux-charlemagne.fixture.js";
import {
  PV_LASSOMPTION_2026_05_TEXT,
} from "./proces-verbaux-lassomption.fixture.js";
import {
  PV_LAVALTRIE_2026_05_TEXT,
} from "./proces-verbaux-lavaltrie.fixture.js";
import {
  PV_LES_CEDRES_2026_05_TEXT,
} from "./proces-verbaux-les-cedres.fixture.js";
import {
  PV_PINCOURT_2026_05_TEXT,
} from "./proces-verbaux-pincourt.fixture.js";
import {
  PV_COTEAU_DU_LAC_2026_04_TEXT,
} from "./proces-verbaux-coteau-du-lac.fixture.js";
import {
  PV_LES_COTEAUX_2026_04_TEXT,
} from "./proces-verbaux-les-coteaux.fixture.js";
import {
  PV_MSH_2026_03_TEXT,
} from "./proces-verbaux-mont-saint-hilaire.fixture.js";
import {
  PV_BOUCHERVILLE_2026_03_TEXT,
} from "./proces-verbaux-boucherville.fixture.js";
import {
  PV_VARENNES_2026_04_TEXT,
} from "./proces-verbaux-varennes.fixture.js";
import {
  PV_ROSEMERE_2026_03_TEXT,
} from "./proces-verbaux-rosemere.fixture.js";
import {
  PV_LORRAINE_2026_04_TEXT,
} from "./proces-verbaux-lorraine.fixture.js";
import {
  PV_BOISBRIAND_2026_04_TEXT,
} from "./proces-verbaux-boisbriand.fixture.js";
import {
  PV_SAINT_JACQUES_LE_MINEUR_2026_02_TEXT,
} from "./proces-verbaux-saint-jacques-le-mineur.fixture.js";
import {
  PV_HEMMINGFORD_2026_04_TEXT,
} from "./proces-verbaux-hemmingford.fixture.js";
import {
  PV_SAINT_ALEXANDRE_2026_03_TEXT,
} from "./proces-verbaux-saint-alexandre.fixture.js";
import {
  PV_SAINT_VALENTIN_2026_01_TEXT,
} from "./proces-verbaux-saint-valentin.fixture.js";
import {
  PV_HENRYVILLE_2026_01_TEXT,
} from "./proces-verbaux-henryville.fixture.js";

// ─────────────────────────────────────────────────────────────────────────────
// Haut-Richelieu cluster: MRC du Haut-Richelieu (villes ~50–70 km SE de Montréal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saint-Alexandre (MRC Haut-Richelieu, ~60 km SE de Montréal).
 * WordPress CMS (custom MSA theme). PV list at /la-municipalite/vie-democratique/seances-du-conseil/.
 * Simple <ul> list with direct PDF links under /wp-content/uploads/, + YouTube video links.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow: (empty — no restrictions).
 * Zonage réel: règlement 26-434 amendant le règlement de zonage 20-366 (normes d'abattage
 * d'arbres, corrections générales) — avis de motion du 2 mars 2026.
 * Captured 2026-06-10.
 */
export const SAINT_ALEXANDRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-alexandre",
  pvIndexUrl:
    "https://saint-alexandre.ca/la-municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-alexandre",
};

/** Factory shortcut for the Saint-Alexandre PV adapter. */
export function createSaintAlexandrePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_ALEXANDRE_PV_CONFIG, options);
}

/**
 * Saint-Valentin (MRC Haut-Richelieu, ~70 km SE de Montréal).
 * Custom CMS (nginx/PleskLin). PV list at /proces-verbaux.
 * Yearly sections with direct PDF links under /documents/YYYY/, some .docx via Office viewer.
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: HTTP 200 content-length 0 (empty — no restrictions).
 * Zonage réel: règlement 506-1 amendant le règlement de zonage 506 du périmètre d'urbanisation —
 * second projet adopté le 13 janvier 2026 (avis de motion donné à la séance du 2 décembre 2025).
 * Permet les usages bi-familiales, tri-familiales et multifamiliales de 4 logements dans la zone P-02.
 * Captured 2026-06-10.
 */
export const SAINT_VALENTIN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-valentin",
  pvIndexUrl: "https://municipalite.saint-valentin.qc.ca/proces-verbaux",
  sourceId: "proces-verbaux-saint-valentin",
};

/** Factory shortcut for the Saint-Valentin PV adapter. */
export function createSaintValentinPvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(SAINT_VALENTIN_PV_CONFIG, options);
}

/**
 * Henryville (MRC Haut-Richelieu, ~65 km SE de Montréal).
 * WordPress CMS. PV list at /conseil-municipal/proces-verbaux/.
 * Yearly sections with direct PDF links under /wp-content/uploads/ (HTTP, not HTTPS for 2025-2026).
 * No CAPTCHA. Confirmed HTTP 200, robots.txt: Disallow /wp-admin/ — wp-content/uploads allowed.
 * NOTE: Only one 2026 PV published at capture date (January 12, 2026). The avis de motion in
 *       that PV concerns règlements d'emprunt (238-2026, 239-2026) for aqueduc works, NOT a
 *       zonage change. detectZonageChange → avisDeMotion=true, changementZonage=false (honest zero).
 * Captured 2026-06-10.
 */
export const HENRYVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "henryville",
  pvIndexUrl: "https://henryville.ca/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-henryville",
};

/** Factory shortcut for the Henryville PV adapter. */
export function createHenryvillePvAdapter(
  options: PvAdapterOptions = {},
): ProcesVerbauxGenericAdapter {
  return new ProcesVerbauxGenericAdapter(HENRYVILLE_PV_CONFIG, options);
}


// ─────────────────────────────────────────────────────────────────────────────
// Lot « cities-round3 » — 78 villes config-only (S3-first), vérifié 2026-06-11.
// ─────────────────────────────────────────────────────────────────────────────

export const WENTWORTH_NORD_PV_CONFIG: PvCityConfig = {
  citySlug: "wentworth-nord",
  pvIndexUrl: "https://wentworth-nord.ca/mairie/proces-verbaux/",
  sourceId: "proces-verbaux-wentworth-nord",
};

export const VAL_DAVID_PV_CONFIG: PvCityConfig = {
  citySlug: "val-david",
  pvIndexUrl: "https://valdavid.com/organisation-municipale/val-david-vous-informe/proces-verbaux-seances-publiques/",
  sourceId: "proces-verbaux-val-david",
};

export const FRELIGHSBURG_PV_CONFIG: PvCityConfig = {
  citySlug: "frelighsburg",
  pvIndexUrl: "https://frelighsburg.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-frelighsburg",
};

export const SAINT_NAZAIRE_DACTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-nazaire-dacton",
  pvIndexUrl: "https://stnazairedacton.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-nazaire-dacton",
};

export const SAINT_ADOLPHE_DHOWARD_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-adolphe-dhoward",
  pvIndexUrl: "https://stadolphedhoward.qc.ca/83/seances-du-conseil",
  sourceId: "proces-verbaux-saint-adolphe-dhoward",
};

export const SAINT_GERARD_MAJELLA_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gerard-majella",
  pvIndexUrl: "https://saintgerardmajella.ca/?page=cons-proc",
  sourceId: "proces-verbaux-saint-gerard-majella",
};

export const ACTON_VALE_PV_CONFIG: PvCityConfig = {
  citySlug: "acton-vale",
  pvIndexUrl: "https://ville.actonvale.qc.ca/ville/conseil-municipal/calendriers-des-seances-ordres-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-acton-vale",
};

export const SHEFFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "shefford",
  pvIndexUrl: "https://cantonshefford.qc.ca/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-shefford",
};

export const SAINT_CUTHBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-cuthbert",
  pvIndexUrl: "https://st-cuthbert.qc.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-saint-cuthbert",
};

export const SAINT_THEODORE_DACTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-theodore-dacton",
  pvIndexUrl: "https://st-theodore.com/communications/proces-verbaux-seances/",
  sourceId: "proces-verbaux-saint-theodore-dacton",
};

export const SAINT_JOACHIM_DE_SHEFFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-joachim-de-shefford",
  pvIndexUrl: "https://st-joachim.ca/municipalite/administration-et-finance/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-joachim-de-shefford",
};

export const SAINT_CLEOPHAS_DE_BRANDON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-cleophas-de-brandon",
  pvIndexUrl: "https://st-cleophas.qc.ca/f-pv-2026.php",
  sourceId: "proces-verbaux-saint-cleophas-de-brandon",
};

export const ROXTON_PV_CONFIG: PvCityConfig = {
  citySlug: "roxton",
  pvIndexUrl: "https://cantonderoxton.qc.ca/ville/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-roxton",
};

export const LAC_DES_SEIZE_ILES_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-des-seize-iles",
  pvIndexUrl: "https://www.lac-des-seize-iles.com/fr/municipalite/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-lac-des-seize-iles",
};

export const SAINT_JEAN_DE_MATHA_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jean-de-matha",
  pvIndexUrl: "https://municipalitestjeandematha.qc.ca/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-saint-jean-de-matha",
};

export const SAINT_FRANCOIS_DU_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-francois-du-lac",
  pvIndexUrl: "https://www.saintfrancoisdulac.ca/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-francois-du-lac",
};

export const SAINT_BARTHELEMY_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-barthelemy",
  pvIndexUrl: "https://www.saint-barthelemy.ca/municipalite/conseil-municipal/ordre-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-saint-barthelemy",
};

export const WATERLOO_PV_CONFIG: PvCityConfig = {
  citySlug: "waterloo",
  pvIndexUrl: "https://ville.waterloo.qc.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-waterloo",
};

export const WARDEN_PV_CONFIG: PvCityConfig = {
  citySlug: "warden",
  pvIndexUrl: "https://municipalites-du-quebec.com/warden/f-pv-2026.php",
  sourceId: "proces-verbaux-warden",
};

export const LAC_BROME_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-brome",
  pvIndexUrl: "https://www.ville.lac-brome.qc.ca/fr/vie-municipale/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-lac-brome",
};

export const SAINT_GERMAIN_DE_GRANTHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-germain-de-grantham",
  pvIndexUrl: "https://st-germain.info/index.php/le-greffe/",
  sourceId: "proces-verbaux-saint-germain-de-grantham",
};

export const SAINT_PIE_DE_GUIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-pie-de-guire",
  pvIndexUrl: "https://www.stpiedeguire.ca/fr/vivre-a-saint-pie-de-guire-/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-pie-de-guire",
};

export const SAINTE_AGATHE_DES_MONTS_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-agathe-des-monts",
  pvIndexUrl: "https://vsadm.ca/notre-ville/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-agathe-des-monts",
};

export const BROME_PV_CONFIG: PvCityConfig = {
  citySlug: "brome",
  pvIndexUrl: "https://bromevillage.ca/proces-verbaux/",
  sourceId: "proces-verbaux-brome",
};

export const SAINT_COME_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-come",
  pvIndexUrl: "https://www.stcomelanaudiere.ca/municipalite/vie-democratique/proces-verbaux",
  sourceId: "proces-verbaux-saint-come",
};

export const ABERCORN_PV_CONFIG: PvCityConfig = {
  citySlug: "abercorn",
  pvIndexUrl: "https://abercorn.ca/f-pv-2026.php",
  sourceId: "proces-verbaux-abercorn",
};

export const DUNDEE_PV_CONFIG: PvCityConfig = {
  citySlug: "dundee",
  pvIndexUrl: "https://www.cantondundee.ca/proces-verbaux-et-ordres-du-jour",
  sourceId: "proces-verbaux-dundee",
};

export const GRENVILLE_SUR_LA_ROUGE_PV_CONFIG: PvCityConfig = {
  citySlug: "grenville-sur-la-rouge",
  pvIndexUrl: "https://www.gslr.ca/ma-municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-grenville-sur-la-rouge",
};

export const WICKHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "wickham",
  pvIndexUrl: "https://www.wickham.ca/administration-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-wickham",
};

export const SAINT_GABRIEL_DE_BRANDON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gabriel-de-brandon",
  pvIndexUrl: "https://www.saintgabrieldebrandon.com/municipalite/conseil-municipal/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-saint-gabriel-de-brandon",
};

export const PIERREVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "pierreville",
  pvIndexUrl: "https://pierreville.net/proces-verbaux/",
  sourceId: "proces-verbaux-pierreville",
};

export const MONTCALM_PV_CONFIG: PvCityConfig = {
  citySlug: "montcalm",
  pvIndexUrl: "https://montcalm.ca/administration-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-montcalm",
};

export const MASKINONGE_PV_CONFIG: PvCityConfig = {
  citySlug: "maskinonge",
  pvIndexUrl: "https://mun-maskinonge.ca/index.php/publications/proces-verbaux",
  sourceId: "proces-verbaux-maskinonge",
};

export const SUTTON_PV_CONFIG: PvCityConfig = {
  citySlug: "sutton",
  pvIndexUrl: "https://sutton.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-sutton",
};

export const NOTRE_DAME_DE_LA_MERCI_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-la-merci",
  pvIndexUrl: "https://www.mun-ndm.ca/notre-municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-notre-dame-de-la-merci",
};

export const SAINTE_CHRISTINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-christine",
  pvIndexUrl: "https://ste-christine.com/proces-verbaux-et-reunion-du-conseil/",
  sourceId: "proces-verbaux-sainte-christine",
};

export const SAINTE_ANNE_DE_LA_ROCHELLE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-de-la-rochelle",
  pvIndexUrl: "https://steannedelarochelle.ca/f-pv-2026.php",
  sourceId: "proces-verbaux-sainte-anne-de-la-rochelle",
};

export const SAINT_GABRIEL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gabriel",
  pvIndexUrl: "https://www.ville.stgabriel.qc.ca/ville/democratie/proces-verbaux",
  sourceId: "proces-verbaux-saint-gabriel",
};

export const STUKELY_SUD_PV_CONFIG: PvCityConfig = {
  citySlug: "stukely-sud",
  pvIndexUrl: "https://stukely-sud.com/proces-verbaux/",
  sourceId: "proces-verbaux-stukely-sud",
};

export const LEFEBVRE_PV_CONFIG: PvCityConfig = {
  citySlug: "lefebvre",
  pvIndexUrl: "https://municipalites-du-quebec.ca/lefebvre/pdf_procesverbaux/",
  sourceId: "proces-verbaux-lefebvre",
};

export const HARRINGTON_PV_CONFIG: PvCityConfig = {
  citySlug: "harrington",
  pvIndexUrl: "https://harrington.ca/en/municipality/council-meetings/",
  sourceId: "proces-verbaux-harrington",
};

export const BOLTON_OUEST_PV_CONFIG: PvCityConfig = {
  citySlug: "bolton-ouest",
  pvIndexUrl: "https://www.bolton-ouest.ca/en/municipality/municipal-life/minutes/",
  sourceId: "proces-verbaux-bolton-ouest",
};

export const SAINTE_EMELIE_DE_LENERGIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-emelie-de-lenergie",
  pvIndexUrl: "https://steemelie.ca/fr/muni/conseil-municipal/seances-conseil",
  sourceId: "proces-verbaux-sainte-emelie-de-lenergie",
};

export const BARKMERE_PV_CONFIG: PvCityConfig = {
  citySlug: "barkmere",
  pvIndexUrl: "https://barkmere.ca/?page_id=2594&lang=en",
  sourceId: "proces-verbaux-barkmere",
};

export const MONT_BLANC_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-blanc",
  pvIndexUrl: "https://mont-blanc.quebec/conseil-municipal/",
  sourceId: "proces-verbaux-mont-blanc",
};

export const VALCOURT_LE_VAL_SAINT_FRANCOIS_PV_CONFIG: PvCityConfig = {
  citySlug: "valcourt--le-val-saint-francois",
  pvIndexUrl: "https://www.valcourt.ca/a-propos/documents-publics/",
  sourceId: "proces-verbaux-valcourt--le-val-saint-francois",
};

export const SAINT_DIDACE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-didace",
  pvIndexUrl: "https://saint-didace.com/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-saint-didace",
};

export const LAWRENCEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "lawrenceville",
  pvIndexUrl: "https://lawrenceville.ca/proces-verbaux/",
  sourceId: "proces-verbaux-lawrenceville",
};

export const SAINT_ZEPHIRIN_DE_COURVAL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-zephirin-de-courval",
  pvIndexUrl: "https://www.saint-zephirin.ca/fr/ma-municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-zephirin-de-courval",
};

export const SAINTE_URSULE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-ursule",
  pvIndexUrl: "https://municipalites-du-quebec.com/sainte-ursule/f-pv-2026.php",
  sourceId: "proces-verbaux-sainte-ursule",
};

export const ARUNDEL_PV_CONFIG: PvCityConfig = {
  citySlug: "arundel",
  pvIndexUrl: "https://arundel.ca/en/publications/agenda-and-minutes/",
  sourceId: "proces-verbaux-arundel",
};

export const LOUISEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "louiseville",
  pvIndexUrl: "https://louiseville.ca/ville/services-municipaux/greffe/proces-verbaux-2/",
  sourceId: "proces-verbaux-louiseville",
};

export const SAINT_ETIENNE_DE_BOLTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-etienne-de-bolton",
  pvIndexUrl: "https://sedb.qc.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-etienne-de-bolton",
};

export const SAINT_EDOUARD_DE_MASKINONGE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-edouard-de-maskinonge",
  pvIndexUrl: "https://municipalites-du-quebec.com/st-edouard-de-maskinonge/f-pv-2026.php",
  sourceId: "proces-verbaux-saint-edouard-de-maskinonge",
};

export const BAIE_DU_FEBVRE_PV_CONFIG: PvCityConfig = {
  citySlug: "baie-du-febvre",
  pvIndexUrl: "https://baie-du-febvre.net/ma-municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-baie-du-febvre",
};

export const VALCOURT_LE_VAL_SAINT_FRANCOIS_2_PV_CONFIG: PvCityConfig = {
  citySlug: "valcourt--le-val-saint-francois--2",
  pvIndexUrl: "https://cantonvalcourt.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-valcourt--le-val-saint-francois--2",
};

export const MARICOURT_PV_CONFIG: PvCityConfig = {
  citySlug: "maricourt",
  pvIndexUrl: "https://maricourt.ca/ordres-du-jour-proces-verbaux/",
  sourceId: "proces-verbaux-maricourt",
};

export const DRUMMONDVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "drummondville",
  pvIndexUrl: "https://www.drummondville.ca/mairie-et-vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-drummondville",
};

export const EASTMAN_PV_CONFIG: PvCityConfig = {
  citySlug: "eastman",
  pvIndexUrl: "https://eastman.quebec/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-eastman",
};

export const SAINT_CYRILLE_DE_WENDOVER_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-cyrille-de-wendover",
  pvIndexUrl: "https://stcyrille.qc.ca/vie-democratique/proces-verbaux/",
  sourceId: "proces-verbaux-saint-cyrille-de-wendover",
};

export const BOLTON_EST_PV_CONFIG: PvCityConfig = {
  citySlug: "bolton-est",
  pvIndexUrl: "https://www.boltonest.ca/fr/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-bolton-est",
};

export const VAL_DES_LACS_PV_CONFIG: PvCityConfig = {
  citySlug: "val-des-lacs",
  pvIndexUrl: "https://www.val-des-lacs.ca/fr/vie-municipale/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-val-des-lacs",
};

export const LAVENIR_PV_CONFIG: PvCityConfig = {
  citySlug: "lavenir",
  pvIndexUrl: "https://www.municipalitelavenir.qc.ca/administration/seances-et-proces-verbaux",
  sourceId: "proces-verbaux-lavenir",
};

export const SAINTE_BRIGITTE_DES_SAULTS_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-brigitte-des-saults",
  pvIndexUrl: "https://www.saintebrigittedessaults.ca/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-brigitte-des-saults",
};

export const SAINT_LEON_LE_GRAND_MASKINONGE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-leon-le-grand--maskinonge",
  pvIndexUrl: "https://municipalite.saint-leon-le-grand.qc.ca/documents/proces-verbaux.html",
  sourceId: "proces-verbaux-saint-leon-le-grand--maskinonge",
};

export const SAINTE_ANGELE_DE_PREMONT_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-angele-de-premont",
  pvIndexUrl: "https://www.sainte-angele-de-premont.ca/gestion-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-angele-de-premont",
};

export const SAINT_DONAT_MATAWINIE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-donat--matawinie",
  pvIndexUrl: "https://www.saint-donat.ca/la-municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-donat--matawinie",
};

export const POTTON_PV_CONFIG: PvCityConfig = {
  citySlug: "potton",
  pvIndexUrl: "https://potton.ca/municipalite/affaires-municipales/",
  sourceId: "proces-verbaux-potton",
};

export const ULVERTON_PV_CONFIG: PvCityConfig = {
  citySlug: "ulverton",
  pvIndexUrl: "https://municipaliteulverton.com/seance-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-ulverton",
};

export const RACINE_PV_CONFIG: PvCityConfig = {
  citySlug: "racine",
  pvIndexUrl: "https://racine.ca/conseil-municipal/",
  sourceId: "proces-verbaux-racine",
};

export const BREBEUF_PV_CONFIG: PvCityConfig = {
  citySlug: "brebeuf",
  pvIndexUrl: "https://brebeuf.ca/proces-verbaux/",
  sourceId: "proces-verbaux-brebeuf",
};

export const NOTRE_DAME_DU_BON_CONSEIL_DRUMMOND_2_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-du-bon-conseil--drummond--2",
  pvIndexUrl: "https://municipalites-du-quebec.com/notre-dame-du-bon-conseil/f-pv-2026.php",
  sourceId: "proces-verbaux-notre-dame-du-bon-conseil--drummond--2",
};

export const YAMACHICHE_PV_CONFIG: PvCityConfig = {
  citySlug: "yamachiche",
  pvIndexUrl: "https://www.yamachiche.ca/proces-verbaux/",
  sourceId: "proces-verbaux-yamachiche",
};

export const AUSTIN_PV_CONFIG: PvCityConfig = {
  citySlug: "austin",
  pvIndexUrl: "https://municipalite.austin.qc.ca/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-austin",
};

export const SAINTE_PERPETUE_NICOLET_YAMASKA_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-perpetue--nicolet-yamaska",
  pvIndexUrl: "https://www.ste-perpetue.ca/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-perpetue--nicolet-yamaska",
};

export const ORFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "orford",
  pvIndexUrl: "https://canton.orford.qc.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-orford",
};

export const SAINTE_MONIQUE_NICOLET_YAMASKA_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-monique--nicolet-yamaska",
  pvIndexUrl: "https://www.sainte-monique.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-monique--nicolet-yamaska",
};

export const NICOLET_PV_CONFIG: PvCityConfig = {
  citySlug: "nicolet",
  pvIndexUrl: "https://nicolet.ca/fr/seances-du-conseil",
  sourceId: "proces-verbaux-nicolet",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lot « agglo-mtl » — 14 villes les plus proches de Montréal (≤25 km).
// CONFIG-ONLY (contrat S3-first) : pas de fixture, pas de pvText. Le worker
// fetch en live et écrit le raw sur S3 (content-addressed). URLs d'index réelles
// vérifiées en live HTTP 200 le 2026-06-11 ; preuve par ville (lien PV à couche
// texte + robots) dans la description de PR.
// ─────────────────────────────────────────────────────────────────────────────

/** Westmount (île de Montréal, bilingue). Statamic; PV sous /storage/app/media. */
export const WESTMOUNT_PV_CONFIG: PvCityConfig = {
  citySlug: "westmount",
  pvIndexUrl: "https://westmount.org/fr/seances-du-conseil",
  sourceId: "proces-verbaux-westmount",
};

/** Mont-Royal / Town of Mount Royal (île, bilingue). Statamic; PV sous /storage/app/media. */
export const MONT_ROYAL_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-royal",
  pvIndexUrl:
    "https://www.ville.mont-royal.qc.ca/fr/ma-ville/vie-democratique/ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-mont-royal",
};

/** Hampstead (île, FR). WordPress; index AJAX, PV découverts via media REST sous /wp-content/uploads. */
export const HAMPSTEAD_PV_CONFIG: PvCityConfig = {
  citySlug: "hampstead",
  pvIndexUrl:
    "https://www.hampstead.qc.ca/fr/ville/vie-democratique/seances-et-ordres-du-jour/",
  sourceId: "proces-verbaux-hampstead",
};

/** Montréal-Ouest / Montreal West (île, anglais). WordPress; PV sous /wp-content/uploads. */
export const MONTREAL_OUEST_PV_CONFIG: PvCityConfig = {
  citySlug: "montreal-ouest",
  pvIndexUrl: "https://montreal-ouest.ca/en/our-town/town-council/public-meetings/",
  sourceId: "proces-verbaux-montreal-ouest",
};

/** Côte-Saint-Luc (île, FR/bilingue). WordPress + Ninja Tables; PV sous /wp-content/uploads. */
export const COTE_SAINT_LUC_PV_CONFIG: PvCityConfig = {
  citySlug: "cote-saint-luc",
  pvIndexUrl: "https://cotesaintluc.org/fr/affaires-municipales/seances-du-conseil/",
  sourceId: "proces-verbaux-cote-saint-luc",
};

/** Brossard (Rive-Sud, FR). WordPress; pages par séance, PV sous /app/uploads. */
export const BROSSARD_PV_CONFIG: PvCityConfig = {
  citySlug: "brossard",
  pvIndexUrl: "https://brossard.ca/assemblees-du-conseil-municipal/",
  sourceId: "proces-verbaux-brossard",
};

/** Montréal-Est (île, FR). WordPress; PV sous /wp-content/uploads. */
export const MONTREAL_EST_PV_CONFIG: PvCityConfig = {
  citySlug: "montreal-est",
  pvIndexUrl: "https://ville.montreal-est.qc.ca/vie-democratique/proces-verbaux/",
  sourceId: "proces-verbaux-montreal-est",
};

/** Dorval (île, bilingue mais PV en FR). Statamic; PV sous /storage/app/media. */
export const DORVAL_PV_CONFIG: PvCityConfig = {
  citySlug: "dorval",
  pvIndexUrl:
    "https://www.ville.dorval.qc.ca/fr/la-cite/vie-democratique/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-dorval",
};

/** Saint-Bruno-de-Montarville (Rive-Sud, FR). WordPress; PV hébergés sur AWS S3. */
export const SAINT_BRUNO_DE_MONTARVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-bruno-de-montarville",
  pvIndexUrl: "https://stbruno.ca/ville/conseil-municipal/seances-conseil-municipal/",
  sourceId: "proces-verbaux-saint-bruno-de-montarville",
};

/** Dollard-Des Ormeaux (île, PV bilingue FR/EN). WordPress; PV sous /wp-content/uploads. */
export const DOLLARD_DES_ORMEAUX_PV_CONFIG: PvCityConfig = {
  citySlug: "dollard-des-ormeaux",
  pvIndexUrl: "https://ville.ddo.qc.ca/ma-ville/conseil/seances-du-conseil/",
  sourceId: "proces-verbaux-dollard-des-ormeaux",
};

/** Pointe-Claire (île, bilingue mais PV en FR). Statamic; PV sous /assets/images/Documents. */
export const POINTE_CLAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "pointe-claire",
  pvIndexUrl:
    "https://www.pointe-claire.ca/democratie-et-participation-citoyenne/seances-du-conseil",
  sourceId: "proces-verbaux-pointe-claire",
};

/** Carignan (MRC La Vallée-du-Richelieu, FR). WordPress; PV servis via miroir KeyCDN. */
export const CARIGNAN_PV_CONFIG: PvCityConfig = {
  citySlug: "carignan",
  pvIndexUrl: "https://www.carignan.quebec/ma-ville/democratie/proces-verbaux/",
  sourceId: "proces-verbaux-carignan",
};

/** Saint-Basile-le-Grand (MRC La Vallée-du-Richelieu, FR). WordPress; robots interdit /wp-content/uploads. */
export const SAINT_BASILE_LE_GRAND_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-basile-le-grand",
  pvIndexUrl: "https://www.villesblg.ca/ville/democratie/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-basile-le-grand",
};

/** Chambly (MRC La Vallée-du-Richelieu, FR). Statamic; PV sous /storage/app/media. */
export const CHAMBLY_PV_CONFIG: PvCityConfig = {
  citySlug: "chambly",
  pvIndexUrl: "https://chambly.ca/ville/vie-democratique/assemblees-du-conseil",
  sourceId: "proces-verbaux-chambly",
};


// ─────────────────────────────────────────────────────────────────────────────
// Lot « agglo-mtl-2 » — round 1 (70 villes config-only, S3-first).
// URLs d'index vérifiées HTTP 200 le 2026-06-11 (preuve par ville en PR).
// ─────────────────────────────────────────────────────────────────────────────

export const SAINT_LAMBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-lambert",
  pvIndexUrl: "https://www.saint-lambert.ca/fr/seances-du-conseil",
  sourceId: "proces-verbaux-saint-lambert",
};

export const LONGUEUIL_PV_CONFIG: PvCityConfig = {
  citySlug: "longueuil",
  pvIndexUrl: "https://www3.longueuil.quebec/fr/proces-verbaux?type=32",
  sourceId: "proces-verbaux-longueuil",
};

export const SAINT_PHILIPPE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-philippe",
  pvIndexUrl: "https://ville.saintphilippe.quebec/seances-du-conseil-2026/",
  sourceId: "proces-verbaux-saint-philippe",
};

export const SAINT_MATHIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-mathieu",
  pvIndexUrl: "https://saint-mathieu.com/seances-du-conseil-2026/",
  sourceId: "proces-verbaux-saint-mathieu",
};

export const BOIS_DES_FILION_PV_CONFIG: PvCityConfig = {
  citySlug: "bois-des-filion",
  pvIndexUrl: "https://villebdf.ca/proces-verbaux",
  sourceId: "proces-verbaux-bois-des-filion",
};

export const BEACONSFIELD_PV_CONFIG: PvCityConfig = {
  citySlug: "beaconsfield",
  pvIndexUrl: "https://www.beaconsfield.ca/fr/ma-ville/votre-conseil/ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-beaconsfield",
};

export const LERY_PV_CONFIG: PvCityConfig = {
  citySlug: "lery",
  pvIndexUrl: "https://www.lery.ca/la-ville/conseil-municipal",
  sourceId: "proces-verbaux-lery",
};

export const SAINT_MATHIAS_SUR_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-mathias-sur-richelieu",
  pvIndexUrl: "https://www.saint-mathias-sur-richelieu.org/seances-du-conseil",
  sourceId: "proces-verbaux-saint-mathias-sur-richelieu",
};

export const SAINT_MATHIEU_DE_BELOEIL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-mathieu-de-beloeil",
  pvIndexUrl: "https://stmathieudebeloeil.ca/municipalite/democratie/ordre-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-mathieu-de-beloeil",
};

export const SAINT_AMABLE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-amable",
  pvIndexUrl: "https://st-amable.qc.ca/ville/gouvernance/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-amable",
};

export const OTTERBURN_PARK_PV_CONFIG: PvCityConfig = {
  citySlug: "otterburn-park",
  pvIndexUrl: "https://www.opark.ca/ville/seances-publiques/",
  sourceId: "proces-verbaux-otterburn-park",
};

export const RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "richelieu",
  pvIndexUrl: "https://ville.richelieu.qc.ca/a-propos/democratie-et-participation-citoyenne/seances-du-conseil-municipal/",
  sourceId: "proces-verbaux-richelieu",
};

export const BAIE_DURFE_PV_CONFIG: PvCityConfig = {
  citySlug: "baie-durfe",
  pvIndexUrl: "https://www.baie-durfe.qc.ca/fr/vie-democratique/seances-du-conseil/categories/seances-du-conseil-2026",
  sourceId: "proces-verbaux-baie-durfe",
};

export const SAINTE_MARTHE_SUR_LE_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-marthe-sur-le-lac",
  pvIndexUrl: "https://vsmsll.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-marthe-sur-le-lac",
};

export const SAINT_JEAN_SUR_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jean-sur-richelieu",
  pvIndexUrl: "https://sjsr.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-jean-sur-richelieu",
};

export const NOTRE_DAME_DE_LILE_PERROT_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-lile-perrot",
  pvIndexUrl: "https://www.ndip.org/seances-du-conseil",
  sourceId: "proces-verbaux-notre-dame-de-lile-perrot",
};

export const SAINT_MICHEL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-michel",
  pvIndexUrl: "https://municipalite-saint-michel.ca/documents-dinformation/proces-verbaux/",
  sourceId: "proces-verbaux-saint-michel",
};

export const BLAINVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "blainville",
  pvIndexUrl: "https://blainville.ca/ville/portrait-de-blainville/proces-verbaux-des-seances-du-conseil",
  sourceId: "proces-verbaux-blainville",
};

export const SENNEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "senneville",
  pvIndexUrl: "https://www.senneville.ca/municipalite/vie-democratique/ordres-du-jour-proces-verbaux-et-visioconference/",
  sourceId: "proces-verbaux-senneville",
};

export const LILE_PERROT_PV_CONFIG: PvCityConfig = {
  citySlug: "lile-perrot",
  pvIndexUrl: "https://www.ile-perrot.qc.ca/la-ville/democratie/seances-du-conseil",
  sourceId: "proces-verbaux-lile-perrot",
};

export const VERCHERES_PV_CONFIG: PvCityConfig = {
  citySlug: "vercheres",
  pvIndexUrl: "https://ville.vercheres.qc.ca/municipalite/seances-et-proces-verbaux/",
  sourceId: "proces-verbaux-vercheres",
};

export const SAINT_MARC_SUR_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-marc-sur-richelieu",
  pvIndexUrl: "https://smsr.quebec/seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-marc-sur-richelieu",
};

export const SAINTE_ANNE_DES_PLAINES_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-des-plaines",
  pvIndexUrl: "https://www.villesadp.ca/ma-ville/vie-democratique/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-sainte-anne-des-plaines",
};

export const SAINT_URBAIN_PREMIER_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-urbain-premier",
  pvIndexUrl: "https://www.saint-urbain-premier.com/fr/municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-urbain-premier",
};

export const TERRASSE_VAUDREUIL_PV_CONFIG: PvCityConfig = {
  citySlug: "terrasse-vaudreuil",
  pvIndexUrl: "https://www.terrasse-vaudreuil.ca/proces-verbaux/",
  sourceId: "proces-verbaux-terrasse-vaudreuil",
};

export const SAINT_JOSEPH_DU_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-joseph-du-lac",
  pvIndexUrl: "https://www.sjdl.qc.ca/decouvrir-saint-joseph-du-lac/vie-democratique/proces-verbal/",
  sourceId: "proces-verbaux-saint-joseph-du-lac",
};

export const SAINT_JEAN_BAPTISTE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jean-baptiste",
  pvIndexUrl: "https://msjb.qc.ca/ma-municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-saint-jean-baptiste",
};

export const CALIXA_LAVALLEE_PV_CONFIG: PvCityConfig = {
  citySlug: "calixa-lavallee",
  pvIndexUrl: "https://calixa-lavallee.ca/municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-calixa-lavallee",
};

export const LILE_CADIEUX_PV_CONFIG: PvCityConfig = {
  citySlug: "lile-cadieux",
  pvIndexUrl: "http://www.ilecadieux.ca/conseil/?id=46",
  sourceId: "proces-verbaux-lile-cadieux",
};

export const POINTE_DES_CASCADES_PV_CONFIG: PvCityConfig = {
  citySlug: "pointe-des-cascades",
  pvIndexUrl: "https://www.pointe-des-cascades.com/la-municipalite/vie-democratique/proces-verbaux",
  sourceId: "proces-verbaux-pointe-des-cascades",
};

export const SAINT_CHARLES_SUR_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-charles-sur-richelieu",
  pvIndexUrl: "https://www.saint-charles-sur-richelieu.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-charles-sur-richelieu",
};

export const VAUDREUIL_SUR_LE_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "vaudreuil-sur-le-lac",
  pvIndexUrl: "https://www.vsll.ca/pages-la-municipalite/proces-verbaux",
  sourceId: "proces-verbaux-vaudreuil-sur-le-lac",
};

export const SAINT_BLAISE_SUR_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-blaise-sur-richelieu",
  pvIndexUrl: "https://www.st-blaise.ca/pv",
  sourceId: "proces-verbaux-saint-blaise-sur-richelieu",
};

export const MONT_SAINT_GREGOIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-saint-gregoire",
  pvIndexUrl: "https://www.mmsg.ca/affaires-municipales/conseil-municipal/proces-verbaux",
  sourceId: "proces-verbaux-mont-saint-gregoire",
};

export const SAINT_PATRICE_DE_SHERRINGTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-patrice-de-sherrington",
  pvIndexUrl: "https://st-patrice-sherrington.com/ma-ville/proces-verbal/",
  sourceId: "proces-verbaux-saint-patrice-de-sherrington",
};

export const SAINT_ROCH_DE_LACHIGAN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-roch-de-lachigan",
  pvIndexUrl: "https://sra.quebec/seances-du-conseil",
  sourceId: "proces-verbaux-saint-roch-de-lachigan",
};

export const SAINTE_ANGELE_DE_MONNOIR_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-angele-de-monnoir",
  pvIndexUrl: "https://www.sainte-angele-de-monnoir.ca/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-angele-de-monnoir",
};

export const LEPIPHANIE_PV_CONFIG: PvCityConfig = {
  citySlug: "lepiphanie",
  pvIndexUrl: "https://lepiphanie.ca/seance-du-conseil",
  sourceId: "proces-verbaux-lepiphanie",
};

export const SAINTE_CLOTILDE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-clotilde",
  pvIndexUrl: "https://www.ste-clotilde.ca/fr/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-clotilde",
};

export const ROUGEMONT_PV_CONFIG: PvCityConfig = {
  citySlug: "rougemont",
  pvIndexUrl: "https://rougemont.ca/category/proces-verbaux/",
  sourceId: "proces-verbaux-rougemont",
};

export const SAINT_ROCH_OUEST_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-roch-ouest",
  pvIndexUrl: "https://www.saint-roch-ouest.ca/fr/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-roch-ouest",
};

export const SAINT_SULPICE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sulpice",
  pvIndexUrl: "https://municipalitesaintsulpice.com/vie-democratique/seances-du-conseil-municipal-saint-sulpice/proces-verbaux",
  sourceId: "proces-verbaux-saint-sulpice",
};

export const SAINT_LIN_LAURENTIDES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-lin-laurentides",
  pvIndexUrl: "https://www.saint-lin-laurentides.com/decouvrir/votre-conseil/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-saint-lin-laurentides",
};

export const LA_PRESENTATION_PV_CONFIG: PvCityConfig = {
  citySlug: "la-presentation",
  pvIndexUrl: "https://www.municipalitelapresentation.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-la-presentation",
};

export const SAINTE_BRIGIDE_DIBERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-brigide-diberville",
  pvIndexUrl: "https://www.sainte-brigide.qc.ca/fr/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-brigide-diberville",
};

export const SAINT_ESPRIT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-esprit",
  pvIndexUrl: "https://www.saint-esprit.ca/municipalite/vie-municipale/seances-du-conseil",
  sourceId: "proces-verbaux-saint-esprit",
};

export const SAINTE_SOPHIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-sophie",
  pvIndexUrl: "https://www.stesophie.ca/municipalite/vie-democratique/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-sainte-sophie",
};

export const HUDSON_PV_CONFIG: PvCityConfig = {
  citySlug: "hudson",
  pvIndexUrl: "https://hudson.quebec/elus-municipaux/ordre-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-hudson",
};

export const SAINT_CHRYSOSTOME_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-chrysostome",
  pvIndexUrl: "https://www.mun-sc.ca/services-aux-citoyens/greffe-et-administration/proces-verbaux/",
  sourceId: "proces-verbaux-saint-chrysostome",
};

export const SAINT_CESAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-cesaire",
  pvIndexUrl: "https://www.villesaintcesaire.com/ma-ville/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-cesaire",
};

export const SAINT_PAUL_DE_LILE_AUX_NOIX_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-paul-de-lile-aux-noix",
  pvIndexUrl: "https://ileauxnoix.qc.ca/ordres-du-jour-et-proces-verbaux-2026/",
  sourceId: "proces-verbaux-saint-paul-de-lile-aux-noix",
};

export const SAINT_LOUIS_DE_GONZAGUE_BEAUHARNOIS_SALABERRY_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-louis-de-gonzague--beauharnois-salaberry",
  pvIndexUrl: "https://saint-louis-de-gonzague.com/services-aux-citoyens/greffe-et-administration/proces-verbaux/",
  sourceId: "proces-verbaux-saint-louis-de-gonzague--beauharnois-salaberry",
};

export const SAINT_ALEXIS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-alexis",
  pvIndexUrl: "https://st-alexis.com/municipalite/vie-democratique/proces-verbaux",
  sourceId: "proces-verbaux-saint-alexis",
};

export const CONTRECOEUR_PV_CONFIG: PvCityConfig = {
  citySlug: "contrecoeur",
  pvIndexUrl: "https://www.ville.contrecoeur.qc.ca/ville/democratie/proces-verbaux",
  sourceId: "proces-verbaux-contrecoeur",
};

export const SAINT_JEROME_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jerome",
  pvIndexUrl: "https://www.vsj.ca/conseil-municipal-et-comite-executif/proces-verbaux/",
  sourceId: "proces-verbaux-saint-jerome",
};

export const SAINT_JACQUES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jacques",
  pvIndexUrl: "https://www.st-jacques.org/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-saint-jacques",
};

export const SAINT_COLOMBAN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-colomban",
  pvIndexUrl: "https://st-colomban.qc.ca/vie-municipale/conseil-municipal/seances-du-conseil/proces-verbaux/",
  sourceId: "proces-verbaux-saint-colomban",
};

export const SAINT_HYACINTHE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-hyacinthe",
  pvIndexUrl: "https://www.st-hyacinthe.ca/ville/vie-democratique/seances-publiques",
  sourceId: "proces-verbaux-saint-hyacinthe",
};

export const LACOLLE_PV_CONFIG: PvCityConfig = {
  citySlug: "lacolle",
  pvIndexUrl: "https://lacolle.com/documentation/proces-verbaux/",
  sourceId: "proces-verbaux-lacolle",
};

export const SAINT_SEBASTIEN_LE_HAUT_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sebastien--le-haut-richelieu",
  pvIndexUrl: "https://www.paroisse-saint-sebastien.ca/fr/municipalite/vie-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-saint-sebastien--le-haut-richelieu",
};

export const SAINT_PAUL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-paul",
  pvIndexUrl: "https://saintpaul.quebec/municipalite/vie-democratique/seances-du-conseil-ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-saint-paul",
};

export const SAINT_PIE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-pie",
  pvIndexUrl: "https://villest-pie.ca/ville/conseil-municipal/calendrier-des-seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-pie",
};

export const HAVELOCK_PV_CONFIG: PvCityConfig = {
  citySlug: "havelock",
  pvIndexUrl: "https://mun-havelock.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-havelock",
};

export const SAINTE_SABINE_BROME_MISSISQUOI_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-sabine--brome-missisquoi",
  pvIndexUrl: "https://municipalites-du-quebec.com/sainte-sabine/f-pv-2026.php",
  sourceId: "proces-verbaux-sainte-sabine--brome-missisquoi",
};

export const SAINT_BERNARD_DE_MICHAUDVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-bernard-de-michaudville",
  pvIndexUrl: "https://saintbernarddemichaudville.qc.ca/pages/c_proces_verbaux.htm",
  sourceId: "proces-verbaux-saint-bernard-de-michaudville",
};

export const SAINTE_JULIENNE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-julienne",
  pvIndexUrl: "https://www.sainte-julienne.com/municipalite/seance-du-conseil/",
  sourceId: "proces-verbaux-sainte-julienne",
};

export const FARNHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "farnham",
  pvIndexUrl: "https://ville.farnham.qc.ca/ville/democratie/seances-du-conseil/seances-du-conseil-2026/",
  sourceId: "proces-verbaux-farnham",
};

export const SAINT_PAUL_DABBOTSFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-paul-dabbotsford",
  pvIndexUrl: "https://www.saintpauldabbotsford.qc.ca/administration-municipale/assemblees/proces-verbaux/",
  sourceId: "proces-verbaux-saint-paul-dabbotsford",
};

export const SAINT_ROCH_DE_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-roch-de-richelieu",
  pvIndexUrl: "https://saintrochderichelieu.qc.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-roch-de-richelieu",
};

export const SAINT_JUDE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jude",
  pvIndexUrl: "https://www.saint-jude.ca/proces-verbaux.html",
  sourceId: "proces-verbaux-saint-jude",
};


// ─────────────────────────────────────────────────────────────────────────────
// Lot « agglo-mtl-3 » — round 2 (71 villes config-only, S3-first).
// URLs d'index vérifiées HTTP 200 le 2026-06-11 (preuve par ville en PR).
// ─────────────────────────────────────────────────────────────────────────────

export const SAINT_OURS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-ours",
  pvIndexUrl: "https://saintours.qc.ca/notre-ville/seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-ours",
};

export const PREVOST_PV_CONFIG: PvCityConfig = {
  citySlug: "prevost",
  pvIndexUrl: "https://ville.prevost.qc.ca/guichet-citoyen/informations/seances-du-conseil",
  sourceId: "proces-verbaux-prevost",
};

export const SAINT_STANISLAS_DE_KOSTKA_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-stanislas-de-kostka",
  pvIndexUrl: "https://st-stanislas-de-kostka.ca/municipalite/administration/seances-conseil",
  sourceId: "proces-verbaux-saint-stanislas-de-kostka",
};

export const SAINT_BARNABE_SUD_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-barnabe-sud",
  pvIndexUrl: "https://saintbarnabesud.ca/Conseil-municipal/proces-verbaux/proces-verbaux-2026/",
  sourceId: "proces-verbaux-saint-barnabe-sud",
};

export const FRANKLIN_PV_CONFIG: PvCityConfig = {
  citySlug: "franklin",
  pvIndexUrl: "https://municipalitedefranklin.ca/proces-verbaux/",
  sourceId: "proces-verbaux-franklin",
};

export const SAINT_HIPPOLYTE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-hippolyte",
  pvIndexUrl: "https://saint-hippolyte.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-hippolyte",
};

export const VENISE_EN_QUEBEC_PV_CONFIG: PvCityConfig = {
  citySlug: "venise-en-quebec",
  pvIndexUrl: "https://www.veniseenquebec.ca/municipalite/conseil-municipal/proces-verbaux",
  sourceId: "proces-verbaux-venise-en-quebec",
};

export const CLARENCEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "clarenceville",
  pvIndexUrl: "https://www.clarenceville.qc.ca/fr/vie-municipale/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-clarenceville",
};

export const JOLIETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "joliette",
  pvIndexUrl: "https://www.joliette.ca/la-ville/democratie/seances-ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-joliette",
};

export const SAINT_DOMINIQUE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-dominique",
  pvIndexUrl: "https://www.st-dominique.ca/fr/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-dominique",
};

export const PIKE_RIVER_PV_CONFIG: PvCityConfig = {
  citySlug: "pike-river",
  pvIndexUrl: "https://www.pikeriver.com/produits-et-services",
  sourceId: "proces-verbaux-pike-river",
};

export const RIGAUD_PV_CONFIG: PvCityConfig = {
  citySlug: "rigaud",
  pvIndexUrl: "https://www.ville.rigaud.qc.ca/seances-du-conseil",
  sourceId: "proces-verbaux-rigaud",
};

export const LANORAIE_PV_CONFIG: PvCityConfig = {
  citySlug: "lanoraie",
  pvIndexUrl: "https://www.lanoraie.ca/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-lanoraie",
};

export const SAINTE_ANNE_DES_LACS_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-des-lacs",
  pvIndexUrl: "https://www.sadl.qc.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-anne-des-lacs",
};

export const SAINT_ANDRE_DARGENTEUIL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-andre-dargenteuil",
  pvIndexUrl: "https://stada.ca/seances-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-andre-dargenteuil",
};

export const LACHUTE_PV_CONFIG: PvCityConfig = {
  citySlug: "lachute",
  pvIndexUrl: "https://lachute.ca/proces-verbaux/",
  sourceId: "proces-verbaux-lachute",
};

export const SAINT_LOUIS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-louis",
  pvIndexUrl: "https://www.saint-louis.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-louis",
};

export const SAINT_SIMON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-simon",
  pvIndexUrl: "https://www.saint-simon.ca/proces-verbaux.html",
  sourceId: "proces-verbaux-saint-simon",
};

export const SAINT_THOMAS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-thomas",
  pvIndexUrl: "https://www.saintthomas.qc.ca/municipalite/vie-democratique/ordre-du-jour-et-enregistrement-des-seances-du-conseil",
  sourceId: "proces-verbaux-saint-thomas",
};

export const GORE_PV_CONFIG: PvCityConfig = {
  citySlug: "gore",
  pvIndexUrl: "https://www.cantondegore.qc.ca/fr/publications/proces-verbaux",
  sourceId: "proces-verbaux-gore",
};

export const SAINT_CHARLES_BORROMEE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-charles-borromee",
  pvIndexUrl: "https://www.vivrescb.com/informations-pratiques/seances-du-conseil-et-assemblees-publiques-de-consultation",
  sourceId: "proces-verbaux-saint-charles-borromee",
};

export const PIEDMONT_PV_CONFIG: PvCityConfig = {
  citySlug: "piedmont",
  pvIndexUrl: "https://www.piedmont.ca/fr/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-piedmont",
};

export const SAINT_ZOTIQUE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-zotique",
  pvIndexUrl: "https://st-zotique.com/seances-proces-verbaux/",
  sourceId: "proces-verbaux-saint-zotique",
};

export const BEDFORD_BROME_MISSISQUOI_PV_CONFIG: PvCityConfig = {
  citySlug: "bedford--brome-missisquoi",
  pvIndexUrl: "https://ville.bedford.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-bedford--brome-missisquoi",
};

export const NOTRE_DAME_DES_PRAIRIES_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-des-prairies",
  pvIndexUrl: "https://www.notredamedesprairies.com/notre-ville/conseils/",
  sourceId: "proces-verbaux-notre-dame-des-prairies",
};

export const POINTE_FORTUNE_PV_CONFIG: PvCityConfig = {
  citySlug: "pointe-fortune",
  pvIndexUrl: "https://pointefortune.ca/municipalite/",
  sourceId: "proces-verbaux-pointe-fortune",
};

export const SAINT_POLYCARPE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-polycarpe",
  pvIndexUrl: "https://stpolycarpe.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-polycarpe",
};

export const RAWDON_PV_CONFIG: PvCityConfig = {
  citySlug: "rawdon",
  pvIndexUrl: "https://rawdon.ca/fr/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-rawdon",
};

export const TRES_SAINT_REDEMPTEUR_PV_CONFIG: PvCityConfig = {
  citySlug: "tres-saint-redempteur",
  pvIndexUrl: "https://tressaintredempteur.ca/administration-municipale/proces-verbaux-ordres-du-jour-et-avis-publics/proces-verbaux/",
  sourceId: "proces-verbaux-tres-saint-redempteur",
};

export const SAINT_SAUVEUR_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sauveur",
  pvIndexUrl: "https://www.vss.ca/ville/vie-democratique/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-saint-sauveur",
};

export const SAINTE_CECILE_DE_MILTON_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-cecile-de-milton",
  pvIndexUrl: "https://www.miltonqc.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-cecile-de-milton",
};

export const SAINT_AMBROISE_DE_KILDARE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-ambroise-de-kildare",
  pvIndexUrl: "https://www.saintambroise.ca/vie-democratique/proces-verbaux/",
  sourceId: "proces-verbaux-saint-ambroise-de-kildare",
};

export const GRANBY_PV_CONFIG: PvCityConfig = {
  citySlug: "granby",
  pvIndexUrl: "https://www.granby.ca/fr/ville/seances-du-conseil-municipal-2026",
  sourceId: "proces-verbaux-granby",
};

export const SAINT_HUGUES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-hugues",
  pvIndexUrl: "https://www.saint-hugues.com/proces-verbaux.html",
  sourceId: "proces-verbaux-saint-hugues",
};

export const HINCHINBROOKE_PV_CONFIG: PvCityConfig = {
  citySlug: "hinchinbrooke",
  pvIndexUrl: "https://hinchinbrooke.com/seances-du-conseil/",
  sourceId: "proces-verbaux-hinchinbrooke",
};

export const SAINT_MARCEL_DE_RICHELIEU_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-marcel-de-richelieu",
  pvIndexUrl: "https://saintmarcelderichelieu.ca/documents-et-reglements.wfs",
  sourceId: "proces-verbaux-saint-marcel-de-richelieu",
};

export const BRIGHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "brigham",
  pvIndexUrl: "https://brigham.ca/proces-verbaux/",
  sourceId: "proces-verbaux-brigham",
};

export const HUNTINGDON_PV_CONFIG: PvCityConfig = {
  citySlug: "huntingdon",
  pvIndexUrl: "https://villehuntingdon.com/proces-verbaux/",
  sourceId: "proces-verbaux-huntingdon",
};

export const SAINT_VALERIEN_DE_MILTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-valerien-de-milton",
  pvIndexUrl: "https://www.st-valerien-de-milton.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-valerien-de-milton",
};

export const STANBRIDGE_EAST_PV_CONFIG: PvCityConfig = {
  citySlug: "stanbridge-east",
  pvIndexUrl: "https://www.stanbridgeeast.ca/fr/seances_conseil.php",
  sourceId: "proces-verbaux-stanbridge-east",
};

export const SAINT_ARMAND_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-armand",
  pvIndexUrl: "http://www.municipalite.saint-armand.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-armand",
};

export const RIVIERE_BEAUDETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "riviere-beaudette",
  pvIndexUrl: "https://riviere-beaudette.com/pv5/",
  sourceId: "proces-verbaux-riviere-beaudette",
};

export const NOTRE_DAME_DE_LOURDES_JOLIETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-lourdes--joliette",
  pvIndexUrl: "https://www.notredamedelourdes.ca/fr/vie-municipale/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-notre-dame-de-lourdes--joliette",
};

export const SAINTE_ADELE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-adele",
  pvIndexUrl: "https://vdsa.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-adele",
};

export const SAINT_AIME_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-aime",
  pvIndexUrl: "https://saintaime.qc.ca/proces-verbaux.html",
  sourceId: "proces-verbaux-saint-aime",
};

export const SAINTE_JUSTINE_DE_NEWTON_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-justine-de-newton",
  pvIndexUrl: "https://sainte-justine-de-newton.ca/municipalite/administration/seances-du-conseil-ordre-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-sainte-justine-de-newton",
};

export const SAINTE_MARCELLINE_DE_KILDARE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-marcelline-de-kildare",
  pvIndexUrl: "https://ste-marcelline.com/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-marcelline-de-kildare",
};

export const SAINT_TELESPHORE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-telesphore",
  pvIndexUrl: "https://saint-telesphore.com/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-telesphore",
};

export const WENTWORTH_PV_CONFIG: PvCityConfig = {
  citySlug: "wentworth",
  pvIndexUrl: "https://www.wentworth.ca/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-wentworth",
};

export const ESTEREL_PV_CONFIG: PvCityConfig = {
  citySlug: "esterel",
  pvIndexUrl: "https://villedesterel.com/documents-et-publications/proces-verbaux/",
  sourceId: "proces-verbaux-esterel",
};

export const COWANSVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "cowansville",
  pvIndexUrl: "https://www.cowansville.ca/vie-municipale/democratie/proces-verbaux",
  sourceId: "proces-verbaux-cowansville",
};

export const GODMANCHESTER_PV_CONFIG: PvCityConfig = {
  citySlug: "godmanchester",
  pvIndexUrl: "https://godmanchester.ca/municipalite/proces-verbaux/2026/",
  sourceId: "proces-verbaux-godmanchester",
};

export const UPTON_PV_CONFIG: PvCityConfig = {
  citySlug: "upton",
  pvIndexUrl: "https://www.upton.ca/dates-des-seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-upton",
};

export const BROWNSBURG_CHATHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "brownsburg-chatham",
  pvIndexUrl: "https://brownsburgchatham.ca/ma-ville/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-brownsburg-chatham",
};

export const BERTHIERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "berthierville",
  pvIndexUrl: "https://www.ville.berthierville.qc.ca/ville/vie-democratique/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-berthierville",
};

export const SAINTE_ANNE_DE_SOREL_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-de-sorel",
  pvIndexUrl: "https://msads.ca/categorie/documentation/ordres-du-jour-proces-verbaux/",
  sourceId: "proces-verbaux-sainte-anne-de-sorel",
};

export const SAINTE_MELANIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-melanie",
  pvIndexUrl: "https://www.sainte-melanie.ca/municipalite/vie-democratique/seance-du-conseil",
  sourceId: "proces-verbaux-sainte-melanie",
};

export const BROMONT_PV_CONFIG: PvCityConfig = {
  citySlug: "bromont",
  pvIndexUrl: "https://www.bromont.net/administration-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-bromont",
};

export const ROXTON_POND_PV_CONFIG: PvCityConfig = {
  citySlug: "roxton-pond",
  pvIndexUrl: "https://www.roxtonpond.ca/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-roxton-pond",
};

export const SAINTE_MARGUERITE_DU_LAC_MASSON_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-marguerite-du-lac-masson",
  pvIndexUrl: "https://lacmasson.com/ma-ville/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-marguerite-du-lac-masson",
};

export const CHERTSEY_PV_CONFIG: PvCityConfig = {
  citySlug: "chertsey",
  pvIndexUrl: "https://chertsey.ca/municipalite/vie-democratique/proces-verbaux",
  sourceId: "proces-verbaux-chertsey",
};

export const VAL_MORIN_PV_CONFIG: PvCityConfig = {
  citySlug: "val-morin",
  pvIndexUrl: "https://www.val-morin.ca/vie-municipale/conseil-municipal/ordre-du-jour-et-proces-verbaux/documents",
  sourceId: "proces-verbaux-val-morin",
};

export const SAINT_GUILLAUME_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-guillaume",
  pvIndexUrl: "https://www.saintguillaume.ca/fr/vie-municipale/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-guillaume",
};

export const SAINT_DAVID_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-david",
  pvIndexUrl: "https://www.stdavid.qc.ca/municipalite/seances-du-conseil-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-david",
};

export const ELGIN_PV_CONFIG: PvCityConfig = {
  citySlug: "elgin",
  pvIndexUrl: "https://municipalites-du-quebec.com/elgin/f-pv-2026.php",
  sourceId: "proces-verbaux-elgin",
};

export const SAINT_ANICET_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-anicet",
  pvIndexUrl: "https://stanicet.com/proces-verbaux",
  sourceId: "proces-verbaux-saint-anicet",
};

export const SAINT_EUGENE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-eugene",
  pvIndexUrl: "https://www.saint-eugene.ca/fr/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-eugene",
};

export const SAINT_FELIX_DE_VALOIS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-felix-de-valois",
  pvIndexUrl: "https://st-felix-de-valois.com/municipalite/vie-democratique/proces-verbaux/",
  sourceId: "proces-verbaux-saint-felix-de-valois",
};

export const YAMASKA_PV_CONFIG: PvCityConfig = {
  citySlug: "yamaska",
  pvIndexUrl: "https://www.yamaska.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-yamaska",
};

export const SAINT_ALPHONSE_RODRIGUEZ_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-alphonse-rodriguez",
  pvIndexUrl: "https://www.municipalite.saintalphonserodriguez.qc.ca/categorie-publication/proces-verbaux-et-ordres-du-jour",
  sourceId: "proces-verbaux-saint-alphonse-rodriguez",
};

export const SAINT_NORBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-norbert",
  pvIndexUrl: "https://www.saint-norbert.net/administration-municipale/Seance-du-conseil-municipal",
  sourceId: "proces-verbaux-saint-norbert",
};


// ---------------------------------------------------------------------------
// Lot cities-round6 -- 21 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const COURCELLES_SAINT_EVARISTE_PV_CONFIG: PvCityConfig = {
  citySlug: "courcelles-saint-evariste",
  pvIndexUrl: "https://www.muncste.ca/pages/proces-verbaux-regroupement",
  sourceId: "proces-verbaux-courcelles-saint-evariste",
};

export const SAINT_SEBASTIEN_LE_GRANIT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sebastien--le-granit",
  pvIndexUrl: "https://www.st-sebastien.com/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-sebastien--le-granit",
};

export const SAINT_PATRICE_DE_BEAURIVAGE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-patrice-de-beaurivage",
  pvIndexUrl: "https://www.spdb.ca/fr/municipalite/conseil-municipal/ordres-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-patrice-de-beaurivage",
};

export const AUMOND_PV_CONFIG: PvCityConfig = {
  citySlug: "aumond",
  pvIndexUrl: "https://www.aumond.ca/index.php/proces-verbaux-2025",
  sourceId: "proces-verbaux-aumond",
};

export const SAINTE_CLOTILDE_DE_BEAUCE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-clotilde-de-beauce",
  pvIndexUrl: "https://www.ste-clotilde.com/pages/proces-verbaux",
  sourceId: "proces-verbaux-sainte-clotilde-de-beauce",
};

export const LAC_SERGENT_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-sergent",
  pvIndexUrl: "https://www.villelacsergent.com/pages/la-ville/proc%C3%A8s-verbaux-et-ordre-du-jour",
  sourceId: "proces-verbaux-lac-sergent",
};

export const EAST_BROUGHTON_PV_CONFIG: PvCityConfig = {
  citySlug: "east-broughton",
  pvIndexUrl: "https://www.municipaliteeastbroughton.com/fr/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-east-broughton",
};

export const SACRE_COEUR_DE_JESUS_PV_CONFIG: PvCityConfig = {
  citySlug: "sacre-coeur-de-jesus",
  pvIndexUrl: "https://municipalites-du-quebec.com/sacre-coeur-de-jesus/f-pv-2026.php",
  sourceId: "proces-verbaux-sacre-coeur-de-jesus",
};

export const BLUE_SEA_PV_CONFIG: PvCityConfig = {
  citySlug: "blue-sea",
  pvIndexUrl: "https://www.bluesea.ca/fr/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-blue-sea",
};

export const SAINT_NARCISSE_DE_BEAURIVAGE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-narcisse-de-beaurivage",
  pvIndexUrl: "https://www.saintnarcissedebeaurivage.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-narcisse-de-beaurivage",
};

export const SAINTE_ANNE_DU_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-du-lac",
  pvIndexUrl: "https://www.steannedulac.ca/proces-verbaux",
  sourceId: "proces-verbaux-sainte-anne-du-lac",
};

export const MANIWAKI_PV_CONFIG: PvCityConfig = {
  citySlug: "maniwaki",
  pvIndexUrl: "https://www.ville.maniwaki.qc.ca/index.php/hotel-de-ville/proces-verbaux",
  sourceId: "proces-verbaux-maniwaki",
};

export const MESSINES_PV_CONFIG: PvCityConfig = {
  citySlug: "messines",
  pvIndexUrl: "https://www.messines.ca/fr/conseil/seances-du-conseil/proces-verbaux",
  sourceId: "proces-verbaux-messines",
};

export const LA_GUADELOUPE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-guadeloupe",
  pvIndexUrl: "https://www.munlaguadeloupe.qc.ca/pages/seances-du-conseil",
  sourceId: "proces-verbaux-la-guadeloupe",
};

export const SAINT_RAYMOND_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-raymond",
  pvIndexUrl: "https://villesaintraymond.com/a-propos-de-la-ville/conseil-municipal/ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-saint-raymond",
};

export const FERME_NEUVE_PV_CONFIG: PvCityConfig = {
  citySlug: "ferme-neuve",
  pvIndexUrl: "https://municipalite.ferme-neuve.qc.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-ferme-neuve",
};

export const SAINTE_CATHERINE_DE_LA_JACQUES_CARTIER_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-catherine-de-la-jacques-cartier",
  pvIndexUrl: "https://www.villescjc.com/vie-municipale/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-catherine-de-la-jacques-cartier",
};

export const ALLEYN_ET_CAWOOD_PV_CONFIG: PvCityConfig = {
  citySlug: "alleyn-et-cawood",
  pvIndexUrl: "https://alleyn-cawood.ca/fr/municipalite-alleyn-cawood/avis-publics-minutes",
  sourceId: "proces-verbaux-alleyn-et-cawood",
};

export const SAINT_AUGUSTIN_DE_DESMAURES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-augustin-de-desmaures",
  pvIndexUrl: "https://vsad.ca/seances",
  sourceId: "proces-verbaux-saint-augustin-de-desmaures",
};

export const SAINT_AUGUSTIN_DE_WOBURN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-augustin-de-woburn",
  pvIndexUrl: "https://www.saintaugustindewoburn.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-augustin-de-woburn",
};

export const SAINT_EPHREM_DE_BEAUCE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-ephrem-de-beauce",
  pvIndexUrl: "https://www.saint-ephrem.com/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-ephrem-de-beauce",
};

// ---------------------------------------------------------------------------
// Lot cities-round5 -- 76 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const MONT_TREMBLANT_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-tremblant",
  pvIndexUrl: "https://vdmt.ca/informations-municipales/democratie-et-participation-citoyenne/seances-des-conseils",
  sourceId: "proces-verbaux-mont-tremblant",
};

export const MONTEBELLO_PV_CONFIG: PvCityConfig = {
  citySlug: "montebello",
  pvIndexUrl: "https://www.montebello.ca/fr/municipalite/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-montebello",
};

export const SAINT_LUCIEN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-lucien",
  pvIndexUrl: "https://www.saint-lucien.ca/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-lucien",
};

export const MELBOURNE_PV_CONFIG: PvCityConfig = {
  citySlug: "melbourne",
  pvIndexUrl: "https://melbournecanton.ca/proces-verbaux/",
  sourceId: "proces-verbaux-melbourne",
};

export const AMHERST_PV_CONFIG: PvCityConfig = {
  citySlug: "amherst",
  pvIndexUrl: "https://municipalite.amherst.qc.ca/conseil-municipal/",
  sourceId: "proces-verbaux-amherst",
};

export const KINGSBURY_PV_CONFIG: PvCityConfig = {
  citySlug: "kingsbury",
  pvIndexUrl: "https://www.kingsbury.ca/administration-2/proces-verbaux/",
  sourceId: "proces-verbaux-kingsbury",
};

export const SAINT_FELIX_DE_KINGSEY_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-felix-de-kingsey",
  pvIndexUrl: "https://www.saintfelixdekingsey.ca/fr/municipalite/vie-municipale/assemblees-du-conseil/",
  sourceId: "proces-verbaux-saint-felix-de-kingsey",
};

export const SAINT_ALEXIS_DES_MONTS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-alexis-des-monts",
  pvIndexUrl: "https://www.saint-alexis-des-monts.ca/fr/la-municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-alexis-des-monts",
};

export const GRAND_SAINT_ESPRIT_PV_CONFIG: PvCityConfig = {
  citySlug: "grand-saint-esprit",
  pvIndexUrl: "https://www.grandsaintesprit.qc.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-grand-saint-esprit",
};

export const RICHMOND_PV_CONFIG: PvCityConfig = {
  citySlug: "richmond",
  pvIndexUrl: "https://richmond.quebec/proces-verbaux/",
  sourceId: "proces-verbaux-richmond",
};

export const SAINT_BARNABE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-barnabe",
  pvIndexUrl: "https://saint-barnabe.ca/la-municipalite/vie-municipale/seances-du-conseil-proces-verbaux-ordres-du-jour-baladodiffusions/",
  sourceId: "proces-verbaux-saint-barnabe",
};

export const MAGOG_PV_CONFIG: PvCityConfig = {
  citySlug: "magog",
  pvIndexUrl: "https://www.ville.magog.qc.ca/category/proces-verbaux/",
  sourceId: "proces-verbaux-magog",
};

export const LAC_SUPERIEUR_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-superieur",
  pvIndexUrl: "https://muni.lacsuperieur.qc.ca/espace-citoyens/proces-verbaux-et-ordre-du-jour/",
  sourceId: "proces-verbaux-lac-superieur",
};

export const NOTRE_DAME_DE_LA_PAIX_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-la-paix",
  pvIndexUrl: "https://www.notredamedelapaix.qc.ca/publications/proces-verbaux/",
  sourceId: "proces-verbaux-notre-dame-de-la-paix",
};

export const SAINT_LEONARD_DASTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-leonard-daston",
  pvIndexUrl: "https://saint-leonard-daston.net/organisation-municipale/",
  sourceId: "proces-verbaux-saint-leonard-daston",
};

export const STANSTEAD_MEMPHREMAGOG_PV_CONFIG: PvCityConfig = {
  citySlug: "stanstead--memphremagog",
  pvIndexUrl: "https://stanstead.ca/proces-verbaux/",
  sourceId: "proces-verbaux-stanstead--memphremagog",
};

export const CHARETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "charette",
  pvIndexUrl: "https://www.municipalite-charette.ca/documentation/",
  sourceId: "proces-verbaux-charette",
};

export const SAINT_DENIS_DE_BROMPTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-denis-de-brompton",
  pvIndexUrl: "https://www.sddb.ca/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-denis-de-brompton",
};

export const SAINT_CHRISTOPHE_DARTHABASKA_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-christophe-darthabaska",
  pvIndexUrl: "https://www.saint-christophe-darthabaska.ca/fr/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-christophe-darthabaska",
};

export const SAINT_CAMILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-camille",
  pvIndexUrl: "https://saint-camille.ca/administration-municipale/documents-administratifs/",
  sourceId: "proces-verbaux-saint-camille",
};

export const CHESTERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "chesterville",
  pvIndexUrl: "https://www.chesterville.net/fr/municipalite/vie-municipale/seances-du-conseil/?id=66",
  sourceId: "proces-verbaux-chesterville",
};

export const LANGE_GARDIEN_LES_COLLINES_DE_LOUTAOUAIS_PV_CONFIG: PvCityConfig = {
  citySlug: "lange-gardien--les-collines-de-loutaouais",
  pvIndexUrl: "https://municipalitedelangegardien.com/document-category/proces-verbaux/",
  sourceId: "proces-verbaux-lange-gardien--les-collines-de-loutaouais",
};

export const WESTBURY_PV_CONFIG: PvCityConfig = {
  citySlug: "westbury",
  pvIndexUrl: "https://www.westbury.ca/proces-verbaux/",
  sourceId: "proces-verbaux-westbury",
};

export const COOKSHIRE_EATON_PV_CONFIG: PvCityConfig = {
  citySlug: "cookshire-eaton",
  pvIndexUrl: "https://cookshire-eaton.qc.ca/ville/la-ville/proces-verbaux/",
  sourceId: "proces-verbaux-cookshire-eaton",
};

export const EAST_ANGUS_PV_CONFIG: PvCityConfig = {
  citySlug: "east-angus",
  pvIndexUrl: "https://eastangus.ca/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-east-angus",
};

export const MARTINVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "martinville",
  pvIndexUrl: "https://martinville.ca/f-pv-2026.php",
  sourceId: "proces-verbaux-martinville",
};

export const HEROUXVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "herouxville",
  pvIndexUrl: "https://www.municipalite.herouxville.qc.ca/gestion-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-herouxville",
};

export const SAINTE_GENEVIEVE_DE_BATISCAN_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-genevieve-de-batiscan",
  pvIndexUrl: "https://www.stegenevieve.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-genevieve-de-batiscan",
};

export const PRINCEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "princeville",
  pvIndexUrl: "https://princeville.quebec/proces-verbaux/",
  sourceId: "proces-verbaux-princeville",
};

export const DIXVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "dixville",
  pvIndexUrl: "https://www.dixville.ca/municipalite/proces-verbaux.php",
  sourceId: "proces-verbaux-dixville",
};

export const SAINTE_EDWIDGE_DE_CLIFTON_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-edwidge-de-clifton",
  pvIndexUrl: "https://www.ste-edwidge.ca/fr/municipalite/proces-verbaux.php",
  sourceId: "proces-verbaux-sainte-edwidge-de-clifton",
};

export const NOTRE_DAME_DE_HAM_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-ham",
  pvIndexUrl: "https://www.notre-dame-de-ham.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-notre-dame-de-ham",
};

export const LASCENSION_PV_CONFIG: PvCityConfig = {
  citySlug: "lascension",
  pvIndexUrl: "https://www.municipalite-lascension.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-lascension",
};

export const SAINTE_CECILE_DE_LEVRARD_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-cecile-de-levrard",
  pvIndexUrl: "https://stececiledelevrard.com/la-municipalite/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-cecile-de-levrard",
};

export const NOMININGUE_PV_CONFIG: PvCityConfig = {
  citySlug: "nominingue",
  pvIndexUrl: "https://nominingue.ca/vie-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-nominingue",
};

export const SAINT_STANISLAS_DES_CHENAUX_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-stanislas--des-chenaux",
  pvIndexUrl: "https://www.saint-stanislas.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-stanislas--des-chenaux",
};

export const SAINT_SEVERIN_MEKINAC_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-severin--mekinac",
  pvIndexUrl: "https://www.st-severin.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-severin--mekinac",
};

export const DUDSWELL_PV_CONFIG: PvCityConfig = {
  citySlug: "dudswell",
  pvIndexUrl: "https://municipalitededudswell.ca/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-dudswell",
};

export const RIVIERE_ROUGE_PV_CONFIG: PvCityConfig = {
  citySlug: "riviere-rouge",
  pvIndexUrl: "https://www.riviere-rouge.ca/ville/conseil-municipal/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-riviere-rouge",
};

export const HAM_NORD_PV_CONFIG: PvCityConfig = {
  citySlug: "ham-nord",
  pvIndexUrl: "https://www.ham-nord.ca/seances",
  sourceId: "proces-verbaux-ham-nord",
};

export const SAINTE_HELENE_DE_CHESTER_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-helene-de-chester",
  pvIndexUrl: "https://municipalites-du-quebec.com/sainte-helene-de-chester/f-pv-2026.php",
  sourceId: "proces-verbaux-sainte-helene-de-chester",
};

export const HAM_SUD_PV_CONFIG: PvCityConfig = {
  citySlug: "ham-sud",
  pvIndexUrl: "https://ham-sud.ca/gestion-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-ham-sud",
};

export const NOTRE_DAME_DE_LA_SALETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-de-la-salette",
  pvIndexUrl: "http://www.muni-ndsalette.qc.ca/conseil/?id=11",
  sourceId: "proces-verbaux-notre-dame-de-la-salette",
};

export const VAL_DES_BOIS_PV_CONFIG: PvCityConfig = {
  citySlug: "val-des-bois",
  pvIndexUrl: "https://val-des-bois.ca/la-municipalite/document-municipaux/proces-verbaux/",
  sourceId: "proces-verbaux-val-des-bois",
};

export const SAINT_PROSPER_DE_CHAMPLAIN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-prosper-de-champlain",
  pvIndexUrl: "https://www.st-prosper.ca/ma-municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-prosper-de-champlain",
};

export const PLESSISVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "plessisville",
  pvIndexUrl: "https://plessisville.quebec/ma-ville/democratie/seances-du-conseil",
  sourceId: "proces-verbaux-plessisville",
};

export const SAINTE_SOPHIE_DHALIFAX_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-sophie-dhalifax",
  pvIndexUrl: "https://www.saintesophiedhalifax.com/ordre-du-jour-et-proc%C3%A8s-verbaux",
  sourceId: "proces-verbaux-sainte-sophie-dhalifax",
};

export const SAINT_FORTUNAT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-fortunat",
  pvIndexUrl: "http://www.municipalitesaint-fortunat.net/documents/?c=8&sc=57",
  sourceId: "proces-verbaux-saint-fortunat",
};

export const SAINTE_ANNE_DE_LA_PERADE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-anne-de-la-perade",
  pvIndexUrl: "https://sadlp.ca/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-anne-de-la-perade",
};

export const DESCHAILLONS_SUR_SAINT_LAURENT_PV_CONFIG: PvCityConfig = {
  citySlug: "deschaillons-sur-saint-laurent",
  pvIndexUrl: "https://www.deschaillons.ca/ordre-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-deschaillons-sur-saint-laurent",
};

export const FORTIERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "fortierville",
  pvIndexUrl: "https://www.fortierville.com/show.php?id=5599/proces-verbaux_des_seances_2026",
  sourceId: "proces-verbaux-fortierville",
};

export const PARISVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "parisville",
  pvIndexUrl: "https://www.municipalite.parisville.qc.ca/seances-conseil",
  sourceId: "proces-verbaux-parisville",
};

export const SAINTE_FRANCOISE_BECANCOUR_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-francoise--becancour",
  pvIndexUrl: "https://ste-francoise.com/administration/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-francoise--becancour",
};

export const SAINT_ADELPHE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-adelphe",
  pvIndexUrl: "https://www.st-adelphe.qc.ca/accueil/municipalite/communication/proces-verbaux/",
  sourceId: "proces-verbaux-saint-adelphe",
};

export const SAINTS_MARTYRS_CANADIENS_PV_CONFIG: PvCityConfig = {
  citySlug: "saints-martyrs-canadiens",
  pvIndexUrl: "https://www.saints-martyrs-canadiens.ca/seances",
  sourceId: "proces-verbaux-saints-martyrs-canadiens",
};

export const GATINEAU_PV_CONFIG: PvCityConfig = {
  citySlug: "gatineau",
  pvIndexUrl: "https://www.gatineau.ca/portail/default.aspx?p=publications_cartes_statistiques_donnees_ouvertes/proces_verbaux",
  sourceId: "proces-verbaux-gatineau",
};

export const BURY_PV_CONFIG: PvCityConfig = {
  citySlug: "bury",
  pvIndexUrl: "https://municipalitedebury.qc.ca/proces-verbaux-2026/",
  sourceId: "proces-verbaux-bury",
};

export const SAINT_ISIDORE_DE_CLIFTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-isidore-de-clifton",
  pvIndexUrl: "https://www.st-isidore-clifton.qc.ca/democratie/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-isidore-de-clifton",
};

export const SAINT_MALO_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-malo",
  pvIndexUrl: "https://www.saint-malo.ca/municipalite/proces-verbaux.php",
  sourceId: "proces-verbaux-saint-malo",
};

export const VAL_DES_MONTS_PV_CONFIG: PvCityConfig = {
  citySlug: "val-des-monts",
  pvIndexUrl: "https://www.val-des-monts.net/municipalite-val-des-monts/conseil-municipal-val-des-monts/seance-du-conseil-municipal-val-des-monts/",
  sourceId: "proces-verbaux-val-des-monts",
};

export const NEWPORT_PV_CONFIG: PvCityConfig = {
  citySlug: "newport",
  pvIndexUrl: "https://www.municipalitenewport.ca/proc%C3%A8s-verbaux-r%C3%A9unions-municipales",
  sourceId: "proces-verbaux-newport",
};

export const EAST_HEREFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "east-hereford",
  pvIndexUrl: "http://www.easthereford.ca/fr/municipalite/proces-verbaux.php",
  sourceId: "proces-verbaux-east-hereford",
};

export const WEEDON_PV_CONFIG: PvCityConfig = {
  citySlug: "weedon",
  pvIndexUrl: "https://weedon.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-weedon",
};

export const LAC_SAGUAY_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-saguay",
  pvIndexUrl: "https://www.lacsaguay.qc.ca/index.php/hotel-de-ville/proces-verbaux",
  sourceId: "proces-verbaux-lac-saguay",
};

export const SAINT_JULIEN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-julien",
  pvIndexUrl: "https://www.st-julien.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-julien",
};

export const SAINT_VENANT_DE_PAQUETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-venant-de-paquette",
  pvIndexUrl: "https://municipalites-du-quebec.com/st-venant-de-paquette/f-pv-2026.php",
  sourceId: "proces-verbaux-saint-venant-de-paquette",
};

export const SAINT_JACQUES_LE_MAJEUR_DE_WOLFESTOWN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jacques-le-majeur-de-wolfestown",
  pvIndexUrl: "http://www.st-jacques-le-majeur-de-wolfestown.ca/documents/?c=26&sc=42",
  sourceId: "proces-verbaux-saint-jacques-le-majeur-de-wolfestown",
};

export const SAINTE_THECLE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-thecle",
  pvIndexUrl: "https://ste-thecle.qc.ca/vie-municipale/ma-municipalite/seances-conseil-proces-verbaux/",
  sourceId: "proces-verbaux-sainte-thecle",
};

export const SAINT_CASIMIR_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-casimir",
  pvIndexUrl: "https://www.saint-casimir.com/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-casimir",
};

export const KIAMIKA_PV_CONFIG: PvCityConfig = {
  citySlug: "kiamika",
  pvIndexUrl: "https://www.kiamika.ca/conseil-municipal-et-proces-verbaux/",
  sourceId: "proces-verbaux-kiamika",
};

export const LECLERCVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "leclercville",
  pvIndexUrl: "https://www.munleclercville.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-leclercville",
};

export const CANTLEY_PV_CONFIG: PvCityConfig = {
  citySlug: "cantley",
  pvIndexUrl: "https://cantley.ca/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-cantley",
};

export const DENHOLM_PV_CONFIG: PvCityConfig = {
  citySlug: "denholm",
  pvIndexUrl: "https://www.denholm.ca/fr/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-denholm",
};

export const VAL_ALAIN_PV_CONFIG: PvCityConfig = {
  citySlug: "val-alain",
  pvIndexUrl: "https://www.val-alain.com/seances-du-conseil2/",
  sourceId: "proces-verbaux-val-alain",
};

export const LAC_DU_CERF_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-du-cerf",
  pvIndexUrl: "https://www.lacducerf.ca/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-lac-du-cerf",
};

export const SAINT_MATHIEU_DU_PARC_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-mathieu-du-parc",
  pvIndexUrl: "https://www.saint-mathieu-du-parc.ca/fr/municipalite/vie-municipale/seances-du-conseil",
  sourceId: "proces-verbaux-saint-mathieu-du-parc",
};

// ---------------------------------------------------------------------------
// Lot cities-round4 -- 54 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const SAINTE_CLOTILDE_DE_HORTON_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-clotilde-de-horton",
  pvIndexUrl: "https://steclotildehorton.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-clotilde-de-horton",
};

export const CLEVELAND_PV_CONFIG: PvCityConfig = {
  citySlug: "cleveland",
  pvIndexUrl: "https://cleveland.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-cleveland",
};

export const SAINTE_SERAPHINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-seraphine",
  pvIndexUrl: "https://www.munsainteseraphine.ca/fr/vie-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-seraphine",
};

export const LAC_TREMBLANT_NORD_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-tremblant-nord",
  pvIndexUrl: "https://lac-tremblant-nord.qc.ca/ordres-jour-proces-verbaux/",
  sourceId: "proces-verbaux-lac-tremblant-nord",
};

export const SAINT_FRANCOIS_XAVIER_DE_BROMPTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-francois-xavier-de-brompton",
  pvIndexUrl: "https://sfxb.qc.ca/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-francois-xavier-de-brompton",
};

export const OGDEN_PV_CONFIG: PvCityConfig = {
  citySlug: "ogden",
  pvIndexUrl: "https://www.munogden.ca/seances_conseil.html",
  sourceId: "proces-verbaux-ogden",
};

export const CHENEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "cheneville",
  pvIndexUrl: "https://www.ville-cheneville.com/proces-verbaux",
  sourceId: "proces-verbaux-cheneville",
};

export const SAINT_ETIENNE_DES_GRES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-etienne-des-gres",
  pvIndexUrl: "https://mun-stedg.qc.ca/calendrier-des-seances-ordinaires-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-etienne-des-gres",
};

export const KINGSEY_FALLS_PV_CONFIG: PvCityConfig = {
  citySlug: "kingsey-falls",
  pvIndexUrl: "https://www.kingseyfalls.ca/fr/municipalite/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-kingsey-falls",
};

export const SAINT_ELIE_DE_CAXTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-elie-de-caxton",
  pvIndexUrl: "https://www.st-elie-de-caxton.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-elie-de-caxton",
};

export const SAINT_WENCESLAS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-wenceslas",
  pvIndexUrl: "https://www.municipalitestwenceslas.com/fr/municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-wenceslas",
};

export const SAINTE_CATHERINE_DE_HATLEY_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-catherine-de-hatley",
  pvIndexUrl: "https://www.sainte-catherine-de-hatley.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-catherine-de-hatley",
};

export const WINDSOR_PV_CONFIG: PvCityConfig = {
  citySlug: "windsor",
  pvIndexUrl: "https://www.villedewindsor.qc.ca/seances-ordinaires/",
  sourceId: "proces-verbaux-windsor",
};

export const SAINTE_ELIZABETH_DE_WARWICK_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-elizabeth-de-warwick",
  pvIndexUrl: "https://www.sainte-elizabeth-de-warwick.ca/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-elizabeth-de-warwick",
};

export const SAINTE_EULALIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-eulalie",
  pvIndexUrl: "https://www.municipalite.sainte-eulalie.qc.ca/pv/",
  sourceId: "proces-verbaux-sainte-eulalie",
};

export const AYERS_CLIFF_PV_CONFIG: PvCityConfig = {
  citySlug: "ayers-cliff",
  pvIndexUrl: "https://ayerscliff.ca/en/minutes/",
  sourceId: "proces-verbaux-ayers-cliff",
};

export const DANVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "danville",
  pvIndexUrl: "https://danville.ca/vie-municipale/conseil-municipal/proces-verbaux-ordre-du-jour-et-diffusion-des-seances/",
  sourceId: "proces-verbaux-danville",
};

export const LABELLE_PV_CONFIG: PvCityConfig = {
  citySlug: "labelle",
  pvIndexUrl: "https://municipalite.labelle.qc.ca/municipalite/vie-democratique/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-labelle",
};

export const VAL_JOLI_PV_CONFIG: PvCityConfig = {
  citySlug: "val-joli",
  pvIndexUrl: "https://www.val-joli.ca/fr/municipalite/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-val-joli",
};

export const SHERBROOKE_PV_CONFIG: PvCityConfig = {
  citySlug: "sherbrooke",
  pvIndexUrl: "https://www.sherbrooke.ca/fr/vie-municipale/publications/proces-verbaux",
  sourceId: "proces-verbaux-sherbrooke",
};

export const SAINT_ALBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-albert",
  pvIndexUrl: "https://www.munstalbert.ca/conseil-municipal#seances-du-conseil",
  sourceId: "proces-verbaux-saint-albert",
};

export const RIPON_PV_CONFIG: PvCityConfig = {
  citySlug: "ripon",
  pvIndexUrl: "https://www.ripon.ca/fr/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-ripon",
};

export const STANSTEAD_MEMPHREMAGOG_2_PV_CONFIG: PvCityConfig = {
  citySlug: "stanstead--memphremagog--2",
  pvIndexUrl: "https://www.cantonstanstead.ca/la-municipalite/seance-du-conseil/",
  sourceId: "proces-verbaux-stanstead--memphremagog--2",
};

export const SAINT_BONIFACE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-boniface",
  pvIndexUrl: "https://saint-bo.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-boniface",
};

export const SAINT_CLAUDE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-claude",
  pvIndexUrl: "https://www.municipalite.st-claude.ca/documents/",
  sourceId: "proces-verbaux-saint-claude",
};

export const ASTON_JONCTION_PV_CONFIG: PvCityConfig = {
  citySlug: "aston-jonction",
  pvIndexUrl: "https://www.aston-jonction.ca/documents/",
  sourceId: "proces-verbaux-aston-jonction",
};

export const STANSTEAD_EST_PV_CONFIG: PvCityConfig = {
  citySlug: "stanstead-est",
  pvIndexUrl: "https://www.stansteadest.ca/proces-verbaux/",
  sourceId: "proces-verbaux-stanstead-est",
};

export const SAINT_SIXTE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sixte",
  pvIndexUrl: "https://saintsixte.ca/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-sixte",
};

export const HATLEY_TOWNSHIP_MUNICIPALITY_PV_CONFIG: PvCityConfig = {
  citySlug: "hatley-township-municipality",
  pvIndexUrl: "https://cantondehatley.ca/administration/proces-verbaux/",
  sourceId: "proces-verbaux-hatley-township-municipality",
};

export const VAL_DES_SOURCES_PV_CONFIG: PvCityConfig = {
  citySlug: "val-des-sources",
  pvIndexUrl: "https://valdessources.ca/a-propos-de-la-ville/vie-democratique/seances-du-conseil-municipal/",
  sourceId: "proces-verbaux-val-des-sources",
};

export const BECANCOUR_PV_CONFIG: PvCityConfig = {
  citySlug: "becancour",
  pvIndexUrl: "https://becancour.net/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-becancour",
};

export const NOTRE_DAME_DU_MONT_CARMEL_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-du-mont-carmel",
  pvIndexUrl: "https://www.mont-carmel.org/proces-verbaux",
  sourceId: "proces-verbaux-notre-dame-du-mont-carmel",
};

export const SAINT_VALERE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-valere",
  pvIndexUrl: "https://www.msvalere.qc.ca/seances",
  sourceId: "proces-verbaux-saint-valere",
};

export const THURSO_PV_CONFIG: PvCityConfig = {
  citySlug: "thurso",
  pvIndexUrl: "https://www.ville.thurso.qc.ca/municipalite/conseil-municipal/",
  sourceId: "proces-verbaux-thurso",
};

export const WARWICK_PV_CONFIG: PvCityConfig = {
  citySlug: "warwick",
  pvIndexUrl: "https://villedewarwick.quebec/seances-du-conseil-municipal/",
  sourceId: "proces-verbaux-warwick",
};

export const SAINT_SYLVERE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-sylvere",
  pvIndexUrl: "https://www.saint-sylvere.ca/fr/municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-sylvere",
};

export const TINGWICK_PV_CONFIG: PvCityConfig = {
  citySlug: "tingwick",
  pvIndexUrl: "https://www.tingwick.ca/seances",
  sourceId: "proces-verbaux-tingwick",
};

export const BARNSTON_OUEST_PV_CONFIG: PvCityConfig = {
  citySlug: "barnston-ouest",
  pvIndexUrl: "https://www.barnston-ouest.ca/fr/municipalite/proces-verbaux.php",
  sourceId: "proces-verbaux-barnston-ouest",
};

export const HATLEY_PV_CONFIG: PvCityConfig = {
  citySlug: "hatley",
  pvIndexUrl: "https://www.municipalitehatley.com/municipalite/assemblees-publiques-2/",
  sourceId: "proces-verbaux-hatley",
};

export const SAINT_MAURICE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-maurice",
  pvIndexUrl: "https://st-maurice.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-maurice",
};

export const LA_MINERVE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-minerve",
  pvIndexUrl: "https://municipalite.laminerve.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-la-minerve",
};

export const SHAWINIGAN_PV_CONFIG: PvCityConfig = {
  citySlug: "shawinigan",
  pvIndexUrl: "https://www.shawinigan.ca/ville/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-shawinigan",
};

export const WATERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "waterville",
  pvIndexUrl: "https://www.waterville.ca/fr/ville/assemblee-publique.php",
  sourceId: "proces-verbaux-waterville",
};

export const LOCHABER_PARTIE_OUEST_PV_CONFIG: PvCityConfig = {
  citySlug: "lochaber-partie-ouest",
  pvIndexUrl: "http://www.lochaber-ouest.ca/documents/?c=1&sc=25",
  sourceId: "proces-verbaux-lochaber-partie-ouest",
};

export const DAVELUYVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "daveluyville",
  pvIndexUrl: "https://www.ville.daveluyville.qc.ca/seances-du-conseil",
  sourceId: "proces-verbaux-daveluyville",
};

export const MADDINGTON_FALLS_PV_CONFIG: PvCityConfig = {
  citySlug: "maddington-falls",
  pvIndexUrl: "https://www.maddington.ca/seances-du-conseil",
  sourceId: "proces-verbaux-maddington-falls",
};

export const MAYO_PV_CONFIG: PvCityConfig = {
  citySlug: "mayo",
  pvIndexUrl: "https://mayo.ca/en/municipal-life/minutes-of-the-council-meetings/",
  sourceId: "proces-verbaux-mayo",
};

export const VICTORIAVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "victoriaville",
  pvIndexUrl: "https://victoriaville.ca/conseil-municipal-et-elections/seances-du-conseil-et-proces-verbaux/passees",
  sourceId: "proces-verbaux-victoriaville",
};

export const STOKE_PV_CONFIG: PvCityConfig = {
  citySlug: "stoke",
  pvIndexUrl: "https://stoke.ca/municipalite/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-stoke",
};

export const CHAMPLAIN_PV_CONFIG: PvCityConfig = {
  citySlug: "champlain",
  pvIndexUrl: "https://www.municipalite.champlain.qc.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-champlain",
};

export const SAINT_ROSAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-rosaire",
  pvIndexUrl: "https://www.strosaire.ca/fr/vie-municipale/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-saint-rosaire",
};

export const DUHAMEL_PV_CONFIG: PvCityConfig = {
  citySlug: "duhamel",
  pvIndexUrl: "https://www.municipalite.duhamel.qc.ca/fr/municipalite/Conseil-municipal/seances-du-conseil/proces-verbaux",
  sourceId: "proces-verbaux-duhamel",
};

export const COATICOOK_PV_CONFIG: PvCityConfig = {
  citySlug: "coaticook",
  pvIndexUrl: "https://www.coaticook.ca/fr/ville/seances-publiques.php",
  sourceId: "proces-verbaux-coaticook",
};

export const COMPTON_PV_CONFIG: PvCityConfig = {
  citySlug: "compton",
  pvIndexUrl: "https://www.compton.ca/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-compton",
};


// ---------------------------------------------------------------------------
// Lot cities-round7 -- 49 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const SALABERRY_DE_VALLEYFIELD_PV_CONFIG: PvCityConfig = {
  citySlug: "salaberry-de-valleyfield",
  pvIndexUrl: "https://www.ville.valleyfield.qc.ca/seances-du-conseil",
  sourceId: "proces-verbaux-salaberry-de-valleyfield",
};

export const SAINT_MARC_DES_CARRIERES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-marc-des-carrieres",
  pvIndexUrl: "https://st-marc-des-carrieres.qc.ca/fr/ma-ville/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-marc-des-carrieres",
};

export const DISRAELI_LES_APPALACHES_PV_CONFIG: PvCityConfig = {
  citySlug: "disraeli--les-appalaches",
  pvIndexUrl: "https://www.villededisraeli.ca/fr/municipalite/vie-municipale/assemblees-du-conseil/",
  sourceId: "proces-verbaux-disraeli--les-appalaches",
};

export const TROIS_RIVES_PV_CONFIG: PvCityConfig = {
  citySlug: "trois-rives",
  pvIndexUrl: "https://trois-rives.com/proces-verbaux/",
  sourceId: "proces-verbaux-trois-rives",
};

export const SCOTSTOWN_PV_CONFIG: PvCityConfig = {
  citySlug: "scotstown",
  pvIndexUrl: "https://scotstown.ca/proces-verbaux/",
  sourceId: "proces-verbaux-scotstown",
};

export const LAC_DES_ECORCES_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-des-ecorces",
  pvIndexUrl: "https://lacdesecorces.ca/administration/proces-verbaux/",
  sourceId: "proces-verbaux-lac-des-ecorces",
};

export const STRATFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "stratford",
  pvIndexUrl: "https://stratford.quebec/vie-municipale/seancesduconseil/",
  sourceId: "proces-verbaux-stratford",
};

export const SAINT_JEAN_DE_BREBEUF_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jean-de-brebeuf",
  pvIndexUrl: "https://www.st-jean-de-brebeuf.ca/documents/?c=6",
  sourceId: "proces-verbaux-saint-jean-de-brebeuf",
};

export const CHUTE_SAINT_PHILIPPE_PV_CONFIG: PvCityConfig = {
  citySlug: "chute-saint-philippe",
  pvIndexUrl: "https://www.chute-saint-philippe.ca/fr/vie-municipale/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-chute-saint-philippe",
};

export const INVERNESS_PV_CONFIG: PvCityConfig = {
  citySlug: "inverness",
  pvIndexUrl: "https://www.invernessquebec.ca/fr/ma-municipalite/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-inverness",
};

export const SAINT_GILBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gilbert",
  pvIndexUrl: "https://saint-gilbert.ca/ma-municipalite/seances-du-conseil",
  sourceId: "proces-verbaux-saint-gilbert",
};

export const SAINT_AIME_DU_LAC_DES_ILES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-aime-du-lac-des-iles",
  pvIndexUrl: "https://saldi.ca/affaires-municipales/conseil-municipal/proces-verbaux",
  sourceId: "proces-verbaux-saint-aime-du-lac-des-iles",
};

export const CHARTIERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "chartierville",
  pvIndexUrl: "https://chartierville.ca/sample-page/zone-citoyen__trashed-affaires-municipales-profil-municipal-proces-verbaux/",
  sourceId: "proces-verbaux-chartierville",
};

export const LAC_SAINTE_MARIE_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-sainte-marie",
  pvIndexUrl: "https://www.lac-sainte-marie.com/le-conseil/proces-verbaux",
  sourceId: "proces-verbaux-lac-sainte-marie",
};

export const PORTNEUF_PV_CONFIG: PvCityConfig = {
  citySlug: "portneuf",
  pvIndexUrl: "https://villedeportneuf.com/fr/ma-ville/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-portneuf",
};

export const SAINTE_CROIX_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-croix",
  pvIndexUrl: "https://saintecroix.ca/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-croix",
};

export const LOW_PV_CONFIG: PvCityConfig = {
  citySlug: "low",
  pvIndexUrl: "https://www.lowquebec.ca/fr/municipalite/vie-municipale/proces-verbaux-et-ordre-du-jour/",
  sourceId: "proces-verbaux-low",
};

export const LAURIER_STATION_PV_CONFIG: PvCityConfig = {
  citySlug: "laurier-station",
  pvIndexUrl: "https://laurierstation.ca/municipalite/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-laurier-station",
};

export const THETFORD_MINES_PV_CONFIG: PvCityConfig = {
  citySlug: "thetford-mines",
  pvIndexUrl: "https://www.villethetford.ca/vie-municipale/seances-publiques/",
  sourceId: "proces-verbaux-thetford-mines",
};

export const KINNEARS_MILLS_PV_CONFIG: PvCityConfig = {
  citySlug: "kinnears-mills",
  pvIndexUrl: "https://www.kinnearsmills.com/fr/municipalite/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-kinnears-mills",
};

export const DOSQUET_PV_CONFIG: PvCityConfig = {
  citySlug: "dosquet",
  pvIndexUrl: "https://www.municipalitedosquet.com/ma-municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-dosquet",
};

export const NOTRE_DAME_DU_SACRE_COEUR_DISSOUDUN_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-du-sacre-coeur-dissoudun",
  pvIndexUrl: "http://www.issoudun.qc.ca/documentation/",
  sourceId: "proces-verbaux-notre-dame-du-sacre-coeur-dissoudun",
};

export const CAP_SANTE_PV_CONFIG: PvCityConfig = {
  citySlug: "cap-sante",
  pvIndexUrl: "https://capsante.qc.ca/séances-du-conseil",
  sourceId: "proces-verbaux-cap-sante",
};

export const DONNACONA_PV_CONFIG: PvCityConfig = {
  citySlug: "donnacona",
  pvIndexUrl: "https://villededonnacona.com/fr/vivre-a-donnacona/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-donnacona",
};

export const SAINT_JACQUES_DE_LEEDS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jacques-de-leeds",
  pvIndexUrl: "https://www.saintjacquesdeleeds.ca/proces-verbaux",
  sourceId: "proces-verbaux-saint-jacques-de-leeds",
};

export const VAL_RACINE_PV_CONFIG: PvCityConfig = {
  citySlug: "val-racine",
  pvIndexUrl: "https://www.val-racine.com/fr/municipalite/affaires-municipales/seances-et-proces-verbaux/",
  sourceId: "proces-verbaux-val-racine",
};

export const SAINT_ROMAIN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-romain",
  pvIndexUrl: "https://www.st-romain.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-romain",
};

export const LA_PECHE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-peche",
  pvIndexUrl: "https://www.villelapeche.qc.ca/municipalite/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-la-peche",
};

export const SAINT_BASILE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-basile",
  pvIndexUrl: "https://saintbasile.qc.ca/democratie/seances-du-conseil/",
  sourceId: "proces-verbaux-saint-basile",
};

export const MONT_LAURIER_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-laurier",
  pvIndexUrl: "https://www.villemontlaurier.qc.ca/vie-municipale/seances-conseil",
  sourceId: "proces-verbaux-mont-laurier",
};

export const NOTRE_DAME_DES_BOIS_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-des-bois",
  pvIndexUrl: "https://www.notredamedesbois.qc.ca/fr/ma-municipalite/conseil-municipal/proces-verbaux-et-ordre-du-jour/",
  sourceId: "proces-verbaux-notre-dame-des-bois",
};

export const GRACEFIELD_PV_CONFIG: PvCityConfig = {
  citySlug: "gracefield",
  pvIndexUrl: "https://www.gracefield.ca/fr/hotel-de-ville/le-conseil/proces-verbaux/",
  sourceId: "proces-verbaux-gracefield",
};

export const LAMBTON_PV_CONFIG: PvCityConfig = {
  citySlug: "lambton",
  pvIndexUrl: "https://www.lambton.ca/fr/vie-municipale/conseil-municipal/seance-du-conseil-proces-verbaux/",
  sourceId: "proces-verbaux-lambton",
};

export const SAINTE_THERESE_DE_LA_GATINEAU_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-therese-de-la-gatineau",
  pvIndexUrl: "https://www.sainte-therese-de-la-gatineau.ca/fr/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-sainte-therese-de-la-gatineau",
};

export const MONT_SAINT_MICHEL_PV_CONFIG: PvCityConfig = {
  citySlug: "mont-saint-michel",
  pvIndexUrl: "https://www.montsaintmichel.ca/proces-verbaux",
  sourceId: "proces-verbaux-mont-saint-michel",
};

export const BOUCHETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "bouchette",
  pvIndexUrl: "https://www.bouchette.ca/fr/ma-municipalite/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-bouchette",
};

export const ADSTOCK_PV_CONFIG: PvCityConfig = {
  citySlug: "adstock",
  pvIndexUrl: "https://www.adstock.ca/vie-municipale/seances-du-conseil/",
  sourceId: "proces-verbaux-adstock",
};

export const SAINT_LEONARD_DE_PORTNEUF_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-leonard-de-portneuf",
  pvIndexUrl: "https://st-leonard.com/municipalite/seances-du-conseil/proces-verbaux",
  sourceId: "proces-verbaux-saint-leonard-de-portneuf",
};

export const NANTES_PV_CONFIG: PvCityConfig = {
  citySlug: "nantes",
  pvIndexUrl: "https://municipalites-du-quebec.com/nantes/f-pv-2026.php",
  sourceId: "proces-verbaux-nantes",
};

export const RIVIERE_A_PIERRE_PV_CONFIG: PvCityConfig = {
  citySlug: "riviere-a-pierre",
  pvIndexUrl: "https://riviereapierre.com/la-municipalite/proces-verbaux",
  sourceId: "proces-verbaux-riviere-a-pierre",
};

export const DELEAGE_PV_CONFIG: PvCityConfig = {
  citySlug: "deleage",
  pvIndexUrl: "https://www.deleage.ca/index.php/hotel-de-ville/conseil-municipal/proces-verbaux",
  sourceId: "proces-verbaux-deleage",
};

export const KAZABAZUA_PV_CONFIG: PvCityConfig = {
  citySlug: "kazabazua",
  pvIndexUrl: "https://www.kazabazua.ca/index.php/fr/hotel-de-ville/proces-verbaux",
  sourceId: "proces-verbaux-kazabazua",
};

export const SAINT_AGAPIT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-agapit",
  pvIndexUrl: "https://st-agapit.qc.ca/pages/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-saint-agapit",
};

export const SAINT_APOLLINAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-apollinaire",
  pvIndexUrl: "https://www.st-apollinaire.com/ma-municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-apollinaire",
};

export const SAINT_PIERRE_DE_BROUGHTON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-pierre-de-broughton",
  pvIndexUrl: "https://www.saintpierredebroughton.ca/fr/vie-municipale/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-pierre-de-broughton",
};

export const NEUVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "neuville",
  pvIndexUrl: "https://www.ville.neuville.qc.ca/ma-ville/vie-democratique/ordres-du-jour-et-proces-verbaux",
  sourceId: "proces-verbaux-neuville",
};

export const SAINT_GILLES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gilles",
  pvIndexUrl: "https://www.st-gilles.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-gilles",
};

export const PONT_ROUGE_PV_CONFIG: PvCityConfig = {
  citySlug: "pont-rouge",
  pvIndexUrl: "https://www.ville.pontrouge.qc.ca/vie-municipale/vie-democratique/conseil-municipal/seances-du-conseil-municipal/",
  sourceId: "proces-verbaux-pont-rouge",
};

export const MARSTON_PV_CONFIG: PvCityConfig = {
  citySlug: "marston",
  pvIndexUrl: "https://www.munmarston.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-marston",
};


// ---------------------------------------------------------------------------
// Lot cities-round8 -- 27 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const EGAN_SUD_PV_CONFIG: PvCityConfig = {
  citySlug: "egan-sud",
  pvIndexUrl: "https://www.egan-sud.ca/index.php/conseil/proces-verbaux-et-ordres-du-jour",
  sourceId: "proces-verbaux-egan-sud",
};

export const LAC_DROLET_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-drolet",
  pvIndexUrl: "https://lacdrolet.ca/proces-verbaux/",
  sourceId: "proces-verbaux-lac-drolet",
};

export const FOSSAMBAULT_SUR_LE_LAC_PV_CONFIG: PvCityConfig = {
  citySlug: "fossambault-sur-le-lac",
  pvIndexUrl: "https://fossambault-sur-le-lac.com/ville/democratie/diffusion-des-seances-du-conseil/",
  sourceId: "proces-verbaux-fossambault-sur-le-lac",
};

export const SAINT_BERNARD_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-bernard",
  pvIndexUrl: "https://saint-bernard.quebec/ma-municipalite/proces-verbaux-ordre-jour/",
  sourceId: "proces-verbaux-saint-bernard",
};

export const FRONTENAC_PV_CONFIG: PvCityConfig = {
  citySlug: "frontenac",
  pvIndexUrl: "https://municipalitefrontenac.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-frontenac",
};

export const LAC_SAINT_JOSEPH_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-saint-joseph",
  pvIndexUrl: "https://www.villelacstjoseph.com/fr/vie-municipale/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-lac-saint-joseph",
};

export const SAINT_ELZEAR_LA_NOUVELLE_BEAUCE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-elzear--la-nouvelle-beauce",
  pvIndexUrl: "https://st-elzear.ca/gestion-municipale/proces-verbaux-avis-publics-2/",
  sourceId: "proces-verbaux-saint-elzear--la-nouvelle-beauce",
};

export const BOIS_FRANC_PV_CONFIG: PvCityConfig = {
  citySlug: "bois-franc",
  pvIndexUrl: "https://bois-franc.ca/index.php/page-3/proces-verbaux",
  sourceId: "proces-verbaux-bois-franc",
};

export const SAINT_VICTOR_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-victor",
  pvIndexUrl: "https://st-victor.qc.ca/municipalite/vie-democratique/proces-verbaux/",
  sourceId: "proces-verbaux-saint-victor",
};

export const SAINT_FREDERIC_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-frederic",
  pvIndexUrl: "https://www.st-frederic.com/municipalite/proces-verbaux",
  sourceId: "proces-verbaux-saint-frederic",
};

export const CAYAMANT_PV_CONFIG: PvCityConfig = {
  citySlug: "cayamant",
  pvIndexUrl: "https://www.cayamant.ca/fr/vie-municipale/conseil-municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-cayamant",
};

export const SHANNON_PV_CONFIG: PvCityConfig = {
  citySlug: "shannon",
  pvIndexUrl: "https://shannon.ca/vie-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-shannon",
};

export const SAINT_HONORE_DE_SHENLEY_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-honore-de-shenley",
  pvIndexUrl: "https://sthonoredeshenley.com/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-saint-honore-de-shenley",
};

export const SCOTT_PV_CONFIG: PvCityConfig = {
  citySlug: "scott",
  pvIndexUrl: "https://www.municipalitescott.com/municipal/seances-du-conseil/",
  sourceId: "proces-verbaux-scott",
};

export const LANCIENNE_LORETTE_PV_CONFIG: PvCityConfig = {
  citySlug: "lancienne-lorette",
  pvIndexUrl: "https://lancienne-lorette.org/rapports-et-publications/proces-verbaux",
  sourceId: "proces-verbaux-lancienne-lorette",
};

export const SAINTE_MARIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-marie",
  pvIndexUrl: "https://www.sainte-marie.ca/gestion-municipale/conseil-municipal/",
  sourceId: "proces-verbaux-sainte-marie",
};

export const SAINT_BENOIT_LABRE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-benoit-labre",
  pvIndexUrl: "https://saintbenoitlabre.com/proces-verbal/",
  sourceId: "proces-verbaux-saint-benoit-labre",
};

export const SAINT_LUDGER_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-ludger",
  pvIndexUrl: "https://st-ludger.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-ludger",
};

export const MONTCERF_LYTTON_PV_CONFIG: PvCityConfig = {
  citySlug: "montcerf-lytton",
  pvIndexUrl: "https://www.montcerf-lytton.com/fr/municipalite/vie-municipale/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-montcerf-lytton",
};

export const SAINT_GABRIEL_DE_VALCARTIER_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-gabriel-de-valcartier",
  pvIndexUrl: "https://saint-gabriel-de-valcartier.ca/municipalite/conseil-municipal/?accordion=proces-verbaux",
  sourceId: "proces-verbaux-saint-gabriel-de-valcartier",
};

export const CLARENDON_PV_CONFIG: PvCityConfig = {
  citySlug: "clarendon",
  pvIndexUrl: "https://clarendon.ca/municipality/council-meetings/",
  sourceId: "proces-verbaux-clarendon",
};

export const SAINTE_HENEDINE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-henedine",
  pvIndexUrl: "https://www.ste-henedine.com/fr/proces-verbaux",
  sourceId: "proces-verbaux-sainte-henedine",
};

export const SAINT_JOSEPH_DE_BEAUCE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-joseph-de-beauce",
  pvIndexUrl: "https://vsjb.ca/la-ville/proces-verbaux/",
  sourceId: "proces-verbaux-saint-joseph-de-beauce",
};

export const SAINTS_ANGES_PV_CONFIG: PvCityConfig = {
  citySlug: "saints-anges",
  pvIndexUrl: "https://www.saintsanges.com/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-saints-anges",
};

export const BEAUCEVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "beauceville",
  pvIndexUrl: "https://ville.beauceville.qc.ca/proces-verbaux/",
  sourceId: "proces-verbaux-beauceville",
};

export const SAINTE_MARGUERITE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-marguerite",
  pvIndexUrl: "https://sainte-marguerite.ca/municipalite/municipalites/seances-du-conseil",
  sourceId: "proces-verbaux-sainte-marguerite",
};

export const SAINT_GEORGES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-georges",
  pvIndexUrl: "https://www.saint-georges.ca/ville/vie-democratique/seances-du-conseil",
  sourceId: "proces-verbaux-saint-georges",
};


// ---------------------------------------------------------------------------
// Lot cities-round10 -- 20 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const WALTHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "waltham",
  pvIndexUrl: "https://pontiacouest.ca/en/waltham/minutes/",
  sourceId: "proces-verbaux-waltham",
};

export const ARMAGH_PV_CONFIG: PvCityConfig = {
  citySlug: "armagh",
  pvIndexUrl: "https://armagh.ca/proces-verbaux.php",
  sourceId: "proces-verbaux-armagh",
};

export const BERTHIER_SUR_MER_PV_CONFIG: PvCityConfig = {
  citySlug: "berthier-sur-mer",
  pvIndexUrl: "https://berthiersurmer.ca/municipalite/conseil-municipal/",
  sourceId: "proces-verbaux-berthier-sur-mer",
};

export const SAINTE_SABINE_LES_ETCHEMINS_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-sabine--les-etchemins",
  pvIndexUrl: "https://municipalites-du-quebec.com/sainte-sabine/f-pv-2025.php",
  sourceId: "proces-verbaux-sainte-sabine--les-etchemins",
};

export const SAINT_FERREOL_LES_NEIGES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-ferreol-les-neiges",
  pvIndexUrl: "https://www.saintferreollesneiges.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-ferreol-les-neiges",
};

export const MONTMAGNY_PV_CONFIG: PvCityConfig = {
  citySlug: "montmagny",
  pvIndexUrl: "https://www.ville.montmagny.qc.ca/fr/ville/vie-democratique/seances-du-conseil/",
  sourceId: "proces-verbaux-montmagny",
};

export const SAINT_TITE_DES_CAPS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-tite-des-caps",
  pvIndexUrl: "https://sainttitedescaps.com/assemblees-du-conseil-municipal/",
  sourceId: "proces-verbaux-saint-tite-des-caps",
};

export const NOTRE_DAME_DU_ROSAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "notre-dame-du-rosaire",
  pvIndexUrl: "https://www.notredamedurosaire.com/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-notre-dame-du-rosaire",
};

export const SAINT_ANTOINE_DE_LISLE_AUX_GRUES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-antoine-de-lisle-aux-grues",
  pvIndexUrl: "https://www.isle-aux-grues.com/fr/vie-municipale/conseil-municipal/proces-verbaux-et-ordres-du-jour/",
  sourceId: "proces-verbaux-saint-antoine-de-lisle-aux-grues",
};

export const SAINT_JUST_DE_BRETENIERES_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-just-de-bretenieres",
  pvIndexUrl: "https://www.saintjustdebretenieres.com/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-just-de-bretenieres",
};

export const SAINT_FABIEN_DE_PANET_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-fabien-de-panet",
  pvIndexUrl: "https://www.saintfabiendepanet.com/la-ville/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-saint-fabien-de-panet",
};

export const CAP_SAINT_IGNACE_PV_CONFIG: PvCityConfig = {
  citySlug: "cap-saint-ignace",
  pvIndexUrl: "https://www.capsaintignace.ca/fr/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-cap-saint-ignace",
};

export const PETITE_RIVIERE_SAINT_FRANCOIS_PV_CONFIG: PvCityConfig = {
  citySlug: "petite-riviere-saint-francois",
  pvIndexUrl: "https://www.petiteriviere.com/municipalite/proces-verbaux/",
  sourceId: "proces-verbaux-petite-riviere-saint-francois",
};

export const SAINTE_LUCIE_DE_BEAUREGARD_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-lucie-de-beauregard",
  pvIndexUrl: "https://www.sainteluciedebeauregard.com/municipalite/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-lucie-de-beauregard",
};

export const LISLET_PV_CONFIG: PvCityConfig = {
  citySlug: "lislet",
  pvIndexUrl: "https://www.lislet.com/municipalite/vie-democratique/seances-du-conseil-et-proces-verbaux",
  sourceId: "proces-verbaux-lislet",
};

export const BAIE_SAINT_PAUL_PV_CONFIG: PvCityConfig = {
  citySlug: "baie-saint-paul",
  pvIndexUrl: "https://baiesaintpaul.com/ville/vie-democratique/seances-publiques",
  sourceId: "proces-verbaux-baie-saint-paul",
};

export const SAINT_JEAN_PORT_JOLI_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-jean-port-joli",
  pvIndexUrl: "https://saintjeanportjoli.com/municipalite/conseil-municipal/",
  sourceId: "proces-verbaux-saint-jean-port-joli",
};

export const SAINT_AUBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-aubert",
  pvIndexUrl: "https://saint-aubert.net/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-saint-aubert",
};

export const LISLE_AUX_COUDRES_PV_CONFIG: PvCityConfig = {
  citySlug: "lisle-aux-coudres",
  pvIndexUrl: "https://www.municipaliteiac.ca/fr/municipalite/vie-municipale/proces-verbaux/",
  sourceId: "proces-verbaux-lisle-aux-coudres",
};

export const SAINTE_FELICITE_LISLET_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-felicite--lislet",
  pvIndexUrl: "https://www.saintefelicite.ca/municipalite/conseil-municipal/",
  sourceId: "proces-verbaux-sainte-felicite--lislet",
};

// ---------------------------------------------------------------------------
// Lot cities-round9 -- 34 villes config-only (S3-first), verifie 2026-06-11.
// ---------------------------------------------------------------------------

export const SAINT_HENRI_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-henri",
  pvIndexUrl: "https://www.saint-henri.ca/seances/",
  sourceId: "proces-verbaux-saint-henri",
};

export const LITCHFIELD_PV_CONFIG: PvCityConfig = {
  citySlug: "litchfield",
  pvIndexUrl: "https://litchfield-qc.ca/minutes_fr.html",
  sourceId: "proces-verbaux-litchfield",
};

export const CAMPBELLS_BAY_PV_CONFIG: PvCityConfig = {
  citySlug: "campbells-bay",
  pvIndexUrl: "https://campbellsbay.ca/fr/proces-verbaux/",
  sourceId: "proces-verbaux-campbells-bay",
};

export const SAINT_ROBERT_BELLARMIN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-robert-bellarmin",
  pvIndexUrl: "https://www.st-robertbellarmin.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-robert-bellarmin",
};

export const FRAMPTON_PV_CONFIG: PvCityConfig = {
  citySlug: "frampton",
  pvIndexUrl: "https://frampton.ca/pages/affaires-conseil-municipal",
  sourceId: "proces-verbaux-frampton",
};

export const LAC_BEAUPORT_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-beauport",
  pvIndexUrl: "https://lac-beauport.quebec/la-municipalite/conseil-municipal/",
  sourceId: "proces-verbaux-lac-beauport",
};

export const SAINTE_PETRONILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-petronille",
  pvIndexUrl: "https://stepetronille.com/seances-du-conseil/",
  sourceId: "proces-verbaux-sainte-petronille",
};

export const PORTAGE_DU_FORT_PV_CONFIG: PvCityConfig = {
  citySlug: "portage-du-fort",
  pvIndexUrl: "https://portage-du-fort.com/2026-minutes",
  sourceId: "proces-verbaux-portage-du-fort",
};

export const SAINTE_CLAIRE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-claire",
  pvIndexUrl: "https://ste-claire.ca/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-claire",
};

export const BOISCHATEL_PV_CONFIG: PvCityConfig = {
  citySlug: "boischatel",
  pvIndexUrl: "https://www.boischatel.ca/ma-ville/vie-democratique/seance-du-conseil",
  sourceId: "proces-verbaux-boischatel",
};

export const SAINT_ODILON_DE_CRANBOURNE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-odilon-de-cranbourne",
  pvIndexUrl: "https://www.saint-odilon.qc.ca/conseil-municipal/greffe/proces-verbaux/",
  sourceId: "proces-verbaux-saint-odilon-de-cranbourne",
};

export const LILE_DU_GRAND_CALUMET_PV_CONFIG: PvCityConfig = {
  citySlug: "lile-du-grand-calumet",
  pvIndexUrl: "https://xn--le-du-grand-calumet-41b.ca/administration/proces-verbaux/proces-verbaux-2026/",
  sourceId: "proces-verbaux-lile-du-grand-calumet",
};

export const SAINT_PHILIBERT_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-philibert",
  pvIndexUrl: "https://www.st-philibert.qc.ca/pages/seances-du-conseil",
  sourceId: "proces-verbaux-saint-philibert",
};

export const SAINT_COME_LINIERE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-come-liniere",
  pvIndexUrl: "https://www.stcomeliniere.com/municipalite/conseil-municipal-saint-come-liniere",
  sourceId: "proces-verbaux-saint-come-liniere",
};

export const STONEHAM_ET_TEWKESBURY_PV_CONFIG: PvCityConfig = {
  citySlug: "stoneham-et-tewkesbury",
  pvIndexUrl: "https://www.villestoneham.com/ma-municipalite/democratie/seances-du-conseil",
  sourceId: "proces-verbaux-stoneham-et-tewkesbury",
};

export const SAINT_CHARLES_DE_BELLECHASSE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-charles-de-bellechasse",
  pvIndexUrl: "https://www.saint-charles.ca/proces-verbaux/",
  sourceId: "proces-verbaux-saint-charles-de-bellechasse",
};

export const SAINT_BENJAMIN_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-benjamin",
  pvIndexUrl: "https://www.st-benjamin.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-benjamin",
};

export const LANGE_GARDIEN_LA_COTE_DE_BEAUPRE_PV_CONFIG: PvCityConfig = {
  citySlug: "lange-gardien--la-cote-de-beaupre",
  pvIndexUrl: "https://municipalitedelangegardien.com/document-category/proces-verbaux/",
  sourceId: "proces-verbaux-lange-gardien--la-cote-de-beaupre",
};

export const SAINT_LAURENT_DE_LILE_DORLEANS_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-laurent-de-lile-dorleans",
  pvIndexUrl: "https://saintlaurentio.com/proces-verbaux-et-videos/",
  sourceId: "proces-verbaux-saint-laurent-de-lile-dorleans",
};

export const SAINT_THEOPHILE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-theophile",
  pvIndexUrl: "https://www.sainttheophile.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-theophile",
};

export const SAINTE_BRIGITTE_DE_LAVAL_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-brigitte-de-laval",
  pvIndexUrl: "https://sbdl.net/notre-ville/conseil-municipal/proces-verbaux/",
  sourceId: "proces-verbaux-sainte-brigitte-de-laval",
};

export const SAINT_LAZARE_DE_BELLECHASSE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-lazare-de-bellechasse",
  pvIndexUrl: "https://www.st-lazare-qc.com/conseil-municipal",
  sourceId: "proces-verbaux-saint-lazare-de-bellechasse",
};

export const SAINT_LEON_DE_STANDON_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-leon-de-standon",
  pvIndexUrl: "https://www.st-leon-de-standon.com/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-leon-de-standon",
};

export const SAINT_NAZAIRE_DE_DORCHESTER_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-nazaire-de-dorchester",
  pvIndexUrl: "https://saint-nazaire-de-dorchester.com/proces-verbaux/",
  sourceId: "proces-verbaux-saint-nazaire-de-dorchester",
};

export const LAC_EDOUARD_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-edouard",
  pvIndexUrl: "https://www.lacedouard.ca/fr/ma-municipalite/conseil-municipal/seances-du-conseil",
  sourceId: "proces-verbaux-lac-edouard",
};

export const LA_DURANTAYE_PV_CONFIG: PvCityConfig = {
  citySlug: "la-durantaye",
  pvIndexUrl: "https://www.munladurantaye.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-la-durantaye",
};

export const CHATEAU_RICHER_PV_CONFIG: PvCityConfig = {
  citySlug: "chateau-richer",
  pvIndexUrl: "https://www.chateauricher.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-chateau-richer",
};

export const LAC_ETCHEMIN_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-etchemin",
  pvIndexUrl: "https://lac-etchemin.ca/municipalite/seances-du-conseil-municipal/",
  sourceId: "proces-verbaux-lac-etchemin",
};

export const SAINT_DAMIEN_DE_BUCKLAND_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-damien-de-buckland",
  pvIndexUrl: "https://saint-damien.com/conseilmunicipal/",
  sourceId: "proces-verbaux-saint-damien-de-buckland",
};

export const SAINT_NEREE_DE_BELLECHASSE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-neree-de-bellechasse",
  pvIndexUrl: "https://www.st-neree.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-neree-de-bellechasse",
};

export const SAINT_ZACHARIE_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-zacharie",
  pvIndexUrl: "https://www.st-zacharie.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-saint-zacharie",
};

export const SAINTE_ROSE_DE_WATFORD_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-rose-de-watford",
  pvIndexUrl: "https://www.sainterosedewatford.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-sainte-rose-de-watford",
};

export const SAINTE_AURELIE_PV_CONFIG: PvCityConfig = {
  citySlug: "sainte-aurelie",
  pvIndexUrl: "https://www.ste-aurelie.qc.ca/pages/proces-verbaux",
  sourceId: "proces-verbaux-sainte-aurelie",
};

export const SAINT_RAPHAEL_PV_CONFIG: PvCityConfig = {
  citySlug: "saint-raphael",
  pvIndexUrl: "https://www.saint-raphael.ca/fr/vie-municipale/conseil-municipal/ordre-du-jour-et-proces-verbaux/",
  sourceId: "proces-verbaux-saint-raphael",
};

// ── Lot cities-round11 (VPlus/Portail Citoyen, verifie 2026-06-14) ──────────
// VPlus SPA: PDFs servis depuis vplus-documents.s3.ca-central-1.amazonaws.com
// pvIndexUrl = page publique (SPA, contenu dynamique — scraper direct non applicable).
// Téléchargement via API: GET /api/{hostname}/structure/detail/{uuid}?inStructure=true&localisation=fr

export const BATISCAN_PV_CONFIG: PvCityConfig = {
  citySlug: "batiscan",
  pvIndexUrl: "https://batiscan.ca/proces-verbaux",
  sourceId: "proces-verbaux-batiscan",
};

export const BOILEAU_PV_CONFIG: PvCityConfig = {
  citySlug: "boileau",
  pvIndexUrl: "https://boileau.ca/proces-verbaux",
  sourceId: "proces-verbaux-boileau",
};

export const BOWMAN_PV_CONFIG: PvCityConfig = {
  citySlug: "bowman",
  pvIndexUrl: "https://bowman.ca/les-proces-verbaux",
  sourceId: "proces-verbaux-bowman",
};

export const CHIBOUGAMAU_PV_CONFIG: PvCityConfig = {
  citySlug: "chibougamau",
  pvIndexUrl: "https://ville.chibougamau.qc.ca/seances-du-conseil",
  sourceId: "proces-verbaux-chibougamau",
};

export const GRENVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "grenville",
  pvIndexUrl: "https://grenville.ca/seances-du-conseil",
  sourceId: "proces-verbaux-grenville",
};

export const LAC_SAINT_PAUL_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-saint-paul",
  pvIndexUrl: "https://lac-saint-paul.ca/proces-verbaux",
  sourceId: "proces-verbaux-lac-saint-paul",
};

export const LAURIERVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "laurierville",
  pvIndexUrl: "https://laurierville.ca/proces-verbaux",
  sourceId: "proces-verbaux-laurierville",
};

export const LORRAINVILLE_PV_CONFIG: PvCityConfig = {
  citySlug: "lorrainville",
  pvIndexUrl: "https://lorrainville.ca/proces-verbaux",
  sourceId: "proces-verbaux-lorrainville",
};

export const LYSTER_PV_CONFIG: PvCityConfig = {
  citySlug: "lyster",
  pvIndexUrl: "https://lyster.ca/proces-verbaux",
  sourceId: "proces-verbaux-lyster",
};

export const DUNHAM_PV_CONFIG: PvCityConfig = {
  citySlug: "dunham",
  pvIndexUrl: "https://ville.dunham.qc.ca/seances-du-conseil-municipal",
  sourceId: "proces-verbaux-dunham",
};

export const BAIE_DES_SABLES_PV_CONFIG: PvCityConfig = {
  citySlug: "baie-des-sables",
  pvIndexUrl: "https://baiedessables.ca/documents-et-publications/proces-verbaux",
  sourceId: "proces-verbaux-baie-des-sables",
};

export const GRAND_REMOUS_PV_CONFIG: PvCityConfig = {
  citySlug: "grand-remous",
  pvIndexUrl: "https://grandremous.ca/proces-verbaux",
  sourceId: "proces-verbaux-grand-remous",
};

export const BEAUPRE_PV_CONFIG: PvCityConfig = {
  citySlug: "beaupre",
  pvIndexUrl: "https://villedebeaupre.com/conseil-municipal/seance-du-conseil",
  sourceId: "proces-verbaux-beaupre",
};

export const LAC_FRONTIERE_PV_CONFIG: PvCityConfig = {
  citySlug: "lac-frontiere",
  pvIndexUrl: "https://www.lac-frontiere.ca/web/proces-verbaux/",
  sourceId: "proces-verbaux-lac-frontiere",
};

/**
 * Complete registry of generic PV cities — the single source of truth for
 * city wiring in the pipeline (adapter-registry) and seed (pv-seed).
 *
 * To add a new city:
 *   1. Create `proces-verbaux-<slug>.fixture.ts` with the real PV text (pdftotext).
 *   2. Add a `*_PV_CONFIG` constant above.
 *   3. Append one entry here — adapter-registry and pv-seed are AUTO-wired.
 */
export const ALL_PV_CITIES: readonly PvCityEntry[] = [
  // ── Round-0: Saint-Damase (easy-first, WordPress, MRC des Maskoutains) ─────
  {
    config: SAINT_DAMASE_PV_CONFIG,
    pvText: PV_SAINT_DAMASE_2025_05_POSITIVE,
    sourceUrl:
      "https://www.st-damase.qc.ca/wp-content/uploads/2025/05/Proces-verbal-manuscrit-6-mai.pdf",
  },
  // ── Rive-Sud / MRC Roussillon ─────────────────────────────────────────────
  {
    config: SAINTE_CATHERINE_PV_CONFIG,
    pvText: PV_SAINTE_CATHERINE_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.sainte-catherine.qc.ca/medias/documents/content/PvCm-20260512-vns-vp20260514.pdf",
  },
  {
    config: SAINT_CONSTANT_PV_CONFIG,
    pvText: PV_SAINT_CONSTANT_2026_05_TEXT,
    sourceUrl:
      "https://saint-constant.ca/uploads/attachments/Greffe/2026/2026-05-19/2026-05-19_PV_Seance_ordinaire_non_approuve_par_Conseil.pdf",
  },
  {
    config: LAPRAIRIE_PV_CONFIG,
    pvText: PV_LAPRAIRIE_2026_05_TEXT,
    sourceUrl:
      "https://laprairie.ca/storage/app/media/ville/democratie/seances-du-conseil/PV_2026/2026-05-19_pv_non_officiel.pdf",
  },
  {
    config: CHATEAUGUAY_PV_CONFIG,
    pvText: PV_CHATEAUGUAY_2026_02_TEXT,
    sourceUrl:
      "https://ville.chateauguay.qc.ca/wp-content/uploads/2026/03/PV_2026-02-23.pdf",
  },
  {
    config: DELSON_PV_CONFIG,
    pvText: PV_DELSON_2026_05_TEXT,
    sourceUrl:
      "https://ville.delson.qc.ca/wp-content/uploads/2026/05/2026-05-12-ordinaire-20h-2.pdf",
  },
  // ── Vaudreuil-Soulanges ───────────────────────────────────────────────────
  {
    config: VAUDREUIL_DORION_PV_CONFIG,
    pvText: PV_VAUDREUIL_DORION_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.vaudreuil-dorion.qc.ca/uploads/sections/La_Ville/Mairie/Seances_publiques/PV_2026/20260519_pv.pdf",
  },
  // ── Beauharnois-Salaberry / Haut-St-Laurent ───────────────────────────────
  {
    config: SAINTE_MARTINE_PV_CONFIG,
    pvText: PV_SAINTE_MARTINE_2026_04_TEXT,
    sourceUrl:
      "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
  },
  // ── Les Jardins-de-Napierville ────────────────────────────────────────────
  {
    config: SAINT_REMI_PV_CONFIG,
    pvText: PV_SAINT_REMI_2026_04_TEXT,
    sourceUrl:
      "https://www.saint-remi.ca/wp-content/uploads/2026/05/20260420_pv.pdf",
  },
  // Roussillon
  {
    config: SAINT_JACQUES_LE_MINEUR_PV_CONFIG,
    pvText: PV_SAINT_JACQUES_LE_MINEUR_2026_02_TEXT,
    sourceUrl:
      "https://www.saint-jacques-le-mineur.ca/wp-content/uploads/2026/02/PV_2026-02-17.pdf",
  },
  // Roussillon
  {
    config: HEMMINGFORD_PV_CONFIG,
    pvText: PV_HEMMINGFORD_2026_04_TEXT,
    sourceUrl:
      "https://canton.hemmingford.ca/wp-content/uploads/2026/05/pv-2026-04-13-1.pdf",
  },
  // ── Vallée-du-Richelieu ───────────────────────────────────────────────────
  {
    config: MCMASTERVILLE_PV_CONFIG,
    pvText: PV_MCMASTERVILLE_2025_11_TEXT,
    sourceUrl:
      "https://www.mcmasterville.ca/wp-content/uploads/2025/12/pv-17-novembre-2025.pdf",
  },
  {
    config: BELOEIL_PV_CONFIG,
    pvText: PV_BELOEIL_2026_02_TEXT,
    sourceUrl:
      "https://beloeil.ca/wp-content/uploads/2026/03/conseil_20260223_pv.pdf",
  },
  // ── Marguerite-D'Youville ─────────────────────────────────────────────────
  {
    config: SAINTE_JULIE_PV_CONFIG,
    pvText: PV_SAINTE_JULIE_2026_03_TEXT,
    sourceUrl:
      "https://saintejulie.ca/uploads/html_content/S%C3%A9ances%20publiques/2026-03-10_-_Proces-verbal.pdf",
  },
  // Laurentides ──────────────────────────────────────────────────────────────
  {
    config: SAINTE_THERESE_PV_CONFIG,
    pvText: PV_SAINTE_THERESE_2026_03_TEXT,
    sourceUrl:
      "https://www.sainte-therese.ca/storage/app/media/ville/democratie/seances-du-conseil/proces-verbaux/2026/26-03-02_ordinaire.pdf",
  },
  {
    config: DEUX_MONTAGNES_PV_CONFIG,
    pvText: PV_DEUX_MONTAGNES_2026_04_TEXT,
    sourceUrl:
      "https://www.ville.deux-montagnes.qc.ca/storage/app/media/ville-de-deux-montagnes/vie-democratique/seances-du-conseil/proces-verbaux/2026/2026-04-09-proces-verbal-ordinaire.pdf",
  },
  {
    config: MIRABEL_PV_CONFIG,
    pvText: PV_MIRABEL_2026_04_TEXT,
    sourceUrl:
      "https://mirabel.ca/uploads/2._Ville/2.3_Vie_democratique/2.3.5_Seances_du_conseil/2026/2026-04-13_Proces-verbal_FINAL.pdf",
  },
  {
    config: SAINT_EUSTACHE_PV_CONFIG,
    pvText: PV_SAINT_EUSTACHE_2026_02_TEXT,
    sourceUrl:
      "https://www.saint-eustache.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/2026PV_internet.pdf",
  },
  // Lanaudière ───────────────────────────────────────────────────────────────
  {
    config: MASCOUCHE_PV_CONFIG,
    pvText: PV_MASCOUCHE_2026_04_TEXT,
    sourceUrl:
      "https://mascouche.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/proces-verbaux/20260609proces-verbaux-seances-du-conseil.pdf",
  },
  {
    config: CHARLEMAGNE_PV_CONFIG,
    pvText: PV_CHARLEMAGNE_2026_05_TEXT,
    sourceUrl:
      "https://www.charlemagne.ca/storage/app/media/la-ville/S%C3%A9ances%20du%20conseil/Proc%C3%A8s-verbal%20officiel_12%20mai%202026.pdf",
  },
  {
    config: LASSOMPTION_PV_CONFIG,
    pvText: PV_LASSOMPTION_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.lassomption.qc.ca/download.php?filename=pv20260512.pdf",
  },
  {
    config: LAVALTRIE_PV_CONFIG,
    pvText: PV_LAVALTRIE_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.lavaltrie.qc.ca/storage/app/media/Proc%C3%A8s-verbaux/2026/2026-05-04_PV_ord.pdf",
  },
  // Vaudreuil-Soulanges
  {
    config: LES_CEDRES_PV_CONFIG,
    pvText: PV_LES_CEDRES_2026_05_TEXT,
    sourceUrl:
      "https://www.ville.lescedres.qc.ca/sites/default/files/PDF/pv_ass_2026_05_12.pdf",
  },
  // Vaudreuil-Soulanges
  {
    config: PINCOURT_PV_CONFIG,
    pvText: PV_PINCOURT_2026_05_TEXT,
    sourceUrl:
      "https://www.villepincourt.qc.ca/uploads/Proces-verbaux/2026/2026-05-12_-_PV_OFFICIEL.pdf",
  },
  // Vaudreuil-Soulanges
  {
    config: COTEAU_DU_LAC_PV_CONFIG,
    pvText: PV_COTEAU_DU_LAC_2026_04_TEXT,
    sourceUrl:
      "https://coteau-du-lac.com/storage/app/media/vie-municipale/vie-democratique/seances-ordres-du-jour-et-proces-verbaux/proces-verbaux/2026/FINAL_PVSO14avril2026-version-approuve.pdf",
  },
  // Vaudreuil-Soulanges
  {
    config: LES_COTEAUX_PV_CONFIG,
    pvText: PV_LES_COTEAUX_2026_04_TEXT,
    sourceUrl:
      "https://les-coteaux.qc.ca/wp-content/uploads/2026/05/pv_so_20260420.pdf",
  },
  // Montérégie-Est
  {
    config: MONT_SAINT_HILAIRE_PV_CONFIG,
    pvText: PV_MSH_2026_03_TEXT,
    sourceUrl:
      "https://www.villemsh.ca/wp-content/uploads/2026/04/Proces_verbal_2026_03_09.pdf",
  },
  // Montérégie-Est
  {
    config: BOUCHERVILLE_PV_CONFIG,
    pvText: PV_BOUCHERVILLE_2026_03_TEXT,
    sourceUrl:
      "https://www.boucherville.ca/wp-content/uploads/2026/03/PV_seance_260316.pdf",
  },
  // Montérégie-Est
  {
    config: VARENNES_PV_CONFIG,
    pvText: PV_VARENNES_2026_04_TEXT,
    sourceUrl:
      "https://www.ville.varennes.qc.ca/uploads/conseil_municipal/2026/20260413-PV-SO.pdf",
  },
  // Rive-Nord
  {
    config: ROSEMERE_PV_CONFIG,
    pvText: PV_ROSEMERE_2026_03_TEXT,
    sourceUrl:
      "https://www.ville.rosemere.qc.ca/images/clients/PV%202026-03-09%20FINAL.pdf",
  },
  // Rive-Nord
  {
    config: LORRAINE_PV_CONFIG,
    pvText: PV_LORRAINE_2026_04_TEXT,
    sourceUrl:
      "https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-04-14_Signe.pdf",
  },
  // Rive-Nord
  {
    config: BOISBRIAND_PV_CONFIG,
    pvText: PV_BOISBRIAND_2026_04_TEXT,
    sourceUrl:
      "https://www.ville.boisbriand.qc.ca/storage/app/media/ville/vie-democratique/seances-du-conseil/PV/2026/2026-04-14_Seance-ordinaire.pdf",
  },
  // Haut-Richelieu
  {
    config: SAINT_ALEXANDRE_PV_CONFIG,
    pvText: PV_SAINT_ALEXANDRE_2026_03_TEXT,
    sourceUrl:
      "https://saint-alexandre.ca/wp-content/uploads/2026/03/Proces-verbal-preliminaire-2-mars-2026.pdf",
  },
  // Haut-Richelieu
  {
    config: SAINT_VALENTIN_PV_CONFIG,
    pvText: PV_SAINT_VALENTIN_2026_01_TEXT,
    sourceUrl:
      "https://municipalite.saint-valentin.qc.ca/documents/2026/PV%2013%20JANVIER.pdf",
  },
  // Haut-Richelieu
  {
    config: HENRYVILLE_PV_CONFIG,
    pvText: PV_HENRYVILLE_2026_01_TEXT,
    sourceUrl:
      "http://henryville.ca/wp-content/uploads/2026/03/proces-verbal-20260112.pdf",
  },
  // ── Lot « cities-round3 » (config-only, vérifié 2026-06-11) ────────────────
  { config: WENTWORTH_NORD_PV_CONFIG },
  { config: VAL_DAVID_PV_CONFIG },
  { config: FRELIGHSBURG_PV_CONFIG },
  { config: SAINT_NAZAIRE_DACTON_PV_CONFIG },
  { config: SAINT_ADOLPHE_DHOWARD_PV_CONFIG },
  { config: SAINT_GERARD_MAJELLA_PV_CONFIG },
  { config: ACTON_VALE_PV_CONFIG },
  { config: SHEFFORD_PV_CONFIG },
  { config: SAINT_CUTHBERT_PV_CONFIG },
  { config: SAINT_THEODORE_DACTON_PV_CONFIG },
  { config: SAINT_JOACHIM_DE_SHEFFORD_PV_CONFIG },
  { config: SAINT_CLEOPHAS_DE_BRANDON_PV_CONFIG },
  { config: ROXTON_PV_CONFIG },
  { config: LAC_DES_SEIZE_ILES_PV_CONFIG },
  { config: SAINT_JEAN_DE_MATHA_PV_CONFIG },
  { config: SAINT_FRANCOIS_DU_LAC_PV_CONFIG },
  { config: SAINT_BARTHELEMY_PV_CONFIG },
  { config: WATERLOO_PV_CONFIG },
  { config: WARDEN_PV_CONFIG },
  { config: LAC_BROME_PV_CONFIG },
  { config: SAINT_GERMAIN_DE_GRANTHAM_PV_CONFIG },
  { config: SAINT_PIE_DE_GUIRE_PV_CONFIG },
  { config: SAINTE_AGATHE_DES_MONTS_PV_CONFIG },
  { config: BROME_PV_CONFIG },
  { config: SAINT_COME_PV_CONFIG },
  { config: ABERCORN_PV_CONFIG },
  { config: DUNDEE_PV_CONFIG },
  { config: GRENVILLE_SUR_LA_ROUGE_PV_CONFIG },
  { config: WICKHAM_PV_CONFIG },
  { config: SAINT_GABRIEL_DE_BRANDON_PV_CONFIG },
  { config: PIERREVILLE_PV_CONFIG },
  { config: MONTCALM_PV_CONFIG },
  { config: MASKINONGE_PV_CONFIG },
  { config: SUTTON_PV_CONFIG },
  { config: NOTRE_DAME_DE_LA_MERCI_PV_CONFIG },
  { config: SAINTE_CHRISTINE_PV_CONFIG },
  { config: SAINTE_ANNE_DE_LA_ROCHELLE_PV_CONFIG },
  { config: SAINT_GABRIEL_PV_CONFIG },
  { config: STUKELY_SUD_PV_CONFIG },
  { config: LEFEBVRE_PV_CONFIG },
  { config: HARRINGTON_PV_CONFIG },
  { config: BOLTON_OUEST_PV_CONFIG },
  { config: SAINTE_EMELIE_DE_LENERGIE_PV_CONFIG },
  { config: BARKMERE_PV_CONFIG },
  { config: MONT_BLANC_PV_CONFIG },
  { config: VALCOURT_LE_VAL_SAINT_FRANCOIS_PV_CONFIG },
  { config: SAINT_DIDACE_PV_CONFIG },
  { config: LAWRENCEVILLE_PV_CONFIG },
  { config: SAINT_ZEPHIRIN_DE_COURVAL_PV_CONFIG },
  { config: SAINTE_URSULE_PV_CONFIG },
  { config: ARUNDEL_PV_CONFIG },
  { config: LOUISEVILLE_PV_CONFIG },
  { config: SAINT_ETIENNE_DE_BOLTON_PV_CONFIG },
  { config: SAINT_EDOUARD_DE_MASKINONGE_PV_CONFIG },
  { config: BAIE_DU_FEBVRE_PV_CONFIG },
  { config: VALCOURT_LE_VAL_SAINT_FRANCOIS_2_PV_CONFIG },
  { config: MARICOURT_PV_CONFIG },
  { config: DRUMMONDVILLE_PV_CONFIG },
  { config: EASTMAN_PV_CONFIG },
  { config: SAINT_CYRILLE_DE_WENDOVER_PV_CONFIG },
  { config: BOLTON_EST_PV_CONFIG },
  { config: VAL_DES_LACS_PV_CONFIG },
  { config: LAVENIR_PV_CONFIG },
  { config: SAINTE_BRIGITTE_DES_SAULTS_PV_CONFIG },
  { config: SAINT_LEON_LE_GRAND_MASKINONGE_PV_CONFIG },
  { config: SAINTE_ANGELE_DE_PREMONT_PV_CONFIG },
  { config: SAINT_DONAT_MATAWINIE_PV_CONFIG },
  { config: POTTON_PV_CONFIG },
  { config: ULVERTON_PV_CONFIG },
  { config: RACINE_PV_CONFIG },
  { config: BREBEUF_PV_CONFIG },
  { config: NOTRE_DAME_DU_BON_CONSEIL_DRUMMOND_2_PV_CONFIG },
  { config: YAMACHICHE_PV_CONFIG },
  { config: AUSTIN_PV_CONFIG },
  { config: SAINTE_PERPETUE_NICOLET_YAMASKA_PV_CONFIG },
  { config: ORFORD_PV_CONFIG },
  { config: SAINTE_MONIQUE_NICOLET_YAMASKA_PV_CONFIG },
  { config: NICOLET_PV_CONFIG },
  // ── Lot « agglo-mtl » (CONFIG-ONLY, S3-first) : Agglomération de Montréal (île)
  { config: WESTMOUNT_PV_CONFIG },
  { config: MONT_ROYAL_PV_CONFIG },
  { config: HAMPSTEAD_PV_CONFIG },
  { config: MONTREAL_OUEST_PV_CONFIG },
  { config: COTE_SAINT_LUC_PV_CONFIG },
  { config: MONTREAL_EST_PV_CONFIG },
  { config: DORVAL_PV_CONFIG },
  { config: DOLLARD_DES_ORMEAUX_PV_CONFIG },
  { config: POINTE_CLAIRE_PV_CONFIG },
  // ── Lot « agglo-mtl » : Agglomération de Longueuil / Rive-Sud ──────────────
  { config: BROSSARD_PV_CONFIG },
  { config: SAINT_BRUNO_DE_MONTARVILLE_PV_CONFIG },
  // ── Lot « agglo-mtl » : MRC La Vallée-du-Richelieu ─────────────────────────
  { config: CARIGNAN_PV_CONFIG },
  { config: SAINT_BASILE_LE_GRAND_PV_CONFIG },
  { config: CHAMBLY_PV_CONFIG },
  // ── Lot « agglo-mtl-2 » (round 1, config-only, vérifié 2026-06-11) ─────────
  { config: SAINT_LAMBERT_PV_CONFIG },
  { config: LONGUEUIL_PV_CONFIG },
  { config: SAINT_PHILIPPE_PV_CONFIG },
  { config: SAINT_MATHIEU_PV_CONFIG },
  { config: BOIS_DES_FILION_PV_CONFIG },
  { config: BEACONSFIELD_PV_CONFIG },
  { config: LERY_PV_CONFIG },
  { config: SAINT_MATHIAS_SUR_RICHELIEU_PV_CONFIG },
  { config: SAINT_MATHIEU_DE_BELOEIL_PV_CONFIG },
  { config: SAINT_AMABLE_PV_CONFIG },
  { config: OTTERBURN_PARK_PV_CONFIG },
  { config: RICHELIEU_PV_CONFIG },
  { config: BAIE_DURFE_PV_CONFIG },
  { config: SAINTE_MARTHE_SUR_LE_LAC_PV_CONFIG },
  { config: SAINT_JEAN_SUR_RICHELIEU_PV_CONFIG },
  { config: NOTRE_DAME_DE_LILE_PERROT_PV_CONFIG },
  { config: SAINT_MICHEL_PV_CONFIG },
  { config: BLAINVILLE_PV_CONFIG },
  { config: SENNEVILLE_PV_CONFIG },
  { config: LILE_PERROT_PV_CONFIG },
  { config: VERCHERES_PV_CONFIG },
  { config: SAINT_MARC_SUR_RICHELIEU_PV_CONFIG },
  { config: SAINTE_ANNE_DES_PLAINES_PV_CONFIG },
  { config: SAINT_URBAIN_PREMIER_PV_CONFIG },
  { config: TERRASSE_VAUDREUIL_PV_CONFIG },
  { config: SAINT_JOSEPH_DU_LAC_PV_CONFIG },
  { config: SAINT_JEAN_BAPTISTE_PV_CONFIG },
  { config: CALIXA_LAVALLEE_PV_CONFIG },
  { config: LILE_CADIEUX_PV_CONFIG },
  { config: POINTE_DES_CASCADES_PV_CONFIG },
  { config: SAINT_CHARLES_SUR_RICHELIEU_PV_CONFIG },
  { config: VAUDREUIL_SUR_LE_LAC_PV_CONFIG },
  { config: SAINT_BLAISE_SUR_RICHELIEU_PV_CONFIG },
  { config: MONT_SAINT_GREGOIRE_PV_CONFIG },
  { config: SAINT_PATRICE_DE_SHERRINGTON_PV_CONFIG },
  { config: SAINT_ROCH_DE_LACHIGAN_PV_CONFIG },
  { config: SAINTE_ANGELE_DE_MONNOIR_PV_CONFIG },
  { config: LEPIPHANIE_PV_CONFIG },
  { config: SAINTE_CLOTILDE_PV_CONFIG },
  { config: ROUGEMONT_PV_CONFIG },
  { config: SAINT_ROCH_OUEST_PV_CONFIG },
  { config: SAINT_SULPICE_PV_CONFIG },
  { config: SAINT_LIN_LAURENTIDES_PV_CONFIG },
  { config: LA_PRESENTATION_PV_CONFIG },
  { config: SAINTE_BRIGIDE_DIBERVILLE_PV_CONFIG },
  { config: SAINT_ESPRIT_PV_CONFIG },
  { config: SAINTE_SOPHIE_PV_CONFIG },
  { config: HUDSON_PV_CONFIG },
  { config: SAINT_CHRYSOSTOME_PV_CONFIG },
  { config: SAINT_CESAIRE_PV_CONFIG },
  { config: SAINT_PAUL_DE_LILE_AUX_NOIX_PV_CONFIG },
  { config: SAINT_LOUIS_DE_GONZAGUE_BEAUHARNOIS_SALABERRY_PV_CONFIG },
  { config: SAINT_ALEXIS_PV_CONFIG },
  { config: CONTRECOEUR_PV_CONFIG },
  { config: SAINT_JEROME_PV_CONFIG },
  { config: SAINT_JACQUES_PV_CONFIG },
  { config: SAINT_COLOMBAN_PV_CONFIG },
  { config: SAINT_HYACINTHE_PV_CONFIG },
  { config: LACOLLE_PV_CONFIG },
  { config: SAINT_SEBASTIEN_LE_HAUT_RICHELIEU_PV_CONFIG },
  { config: SAINT_PAUL_PV_CONFIG },
  { config: SAINT_PIE_PV_CONFIG },
  { config: HAVELOCK_PV_CONFIG },
  { config: SAINTE_SABINE_BROME_MISSISQUOI_PV_CONFIG },
  { config: SAINT_BERNARD_DE_MICHAUDVILLE_PV_CONFIG },
  { config: SAINTE_JULIENNE_PV_CONFIG },
  { config: FARNHAM_PV_CONFIG },
  { config: SAINT_PAUL_DABBOTSFORD_PV_CONFIG },
  { config: SAINT_ROCH_DE_RICHELIEU_PV_CONFIG },
  { config: SAINT_JUDE_PV_CONFIG },
  // ── Lot « agglo-mtl-3 » (round 2, config-only, vérifié 2026-06-11) ─────────
  { config: SAINT_OURS_PV_CONFIG },
  { config: PREVOST_PV_CONFIG },
  { config: SAINT_STANISLAS_DE_KOSTKA_PV_CONFIG },
  { config: SAINT_BARNABE_SUD_PV_CONFIG },
  { config: FRANKLIN_PV_CONFIG },
  { config: SAINT_HIPPOLYTE_PV_CONFIG },
  { config: VENISE_EN_QUEBEC_PV_CONFIG },
  { config: CLARENCEVILLE_PV_CONFIG },
  { config: JOLIETTE_PV_CONFIG },
  { config: SAINT_DOMINIQUE_PV_CONFIG },
  { config: PIKE_RIVER_PV_CONFIG },
  { config: RIGAUD_PV_CONFIG },
  { config: LANORAIE_PV_CONFIG },
  { config: SAINTE_ANNE_DES_LACS_PV_CONFIG },
  { config: SAINT_ANDRE_DARGENTEUIL_PV_CONFIG },
  { config: LACHUTE_PV_CONFIG },
  { config: SAINT_LOUIS_PV_CONFIG },
  { config: SAINT_SIMON_PV_CONFIG },
  { config: SAINT_THOMAS_PV_CONFIG },
  { config: GORE_PV_CONFIG },
  { config: SAINT_CHARLES_BORROMEE_PV_CONFIG },
  { config: PIEDMONT_PV_CONFIG },
  { config: SAINT_ZOTIQUE_PV_CONFIG },
  { config: BEDFORD_BROME_MISSISQUOI_PV_CONFIG },
  { config: NOTRE_DAME_DES_PRAIRIES_PV_CONFIG },
  { config: POINTE_FORTUNE_PV_CONFIG },
  { config: SAINT_POLYCARPE_PV_CONFIG },
  { config: RAWDON_PV_CONFIG },
  { config: TRES_SAINT_REDEMPTEUR_PV_CONFIG },
  { config: SAINT_SAUVEUR_PV_CONFIG },
  { config: SAINTE_CECILE_DE_MILTON_PV_CONFIG },
  { config: SAINT_AMBROISE_DE_KILDARE_PV_CONFIG },
  { config: GRANBY_PV_CONFIG },
  { config: SAINT_HUGUES_PV_CONFIG },
  { config: HINCHINBROOKE_PV_CONFIG },
  { config: SAINT_MARCEL_DE_RICHELIEU_PV_CONFIG },
  { config: BRIGHAM_PV_CONFIG },
  { config: HUNTINGDON_PV_CONFIG },
  { config: SAINT_VALERIEN_DE_MILTON_PV_CONFIG },
  { config: STANBRIDGE_EAST_PV_CONFIG },
  { config: SAINT_ARMAND_PV_CONFIG },
  { config: RIVIERE_BEAUDETTE_PV_CONFIG },
  { config: NOTRE_DAME_DE_LOURDES_JOLIETTE_PV_CONFIG },
  { config: SAINTE_ADELE_PV_CONFIG },
  { config: SAINT_AIME_PV_CONFIG },
  { config: SAINTE_JUSTINE_DE_NEWTON_PV_CONFIG },
  { config: SAINTE_MARCELLINE_DE_KILDARE_PV_CONFIG },
  { config: SAINT_TELESPHORE_PV_CONFIG },
  { config: WENTWORTH_PV_CONFIG },
  { config: ESTEREL_PV_CONFIG },
  { config: COWANSVILLE_PV_CONFIG },
  { config: GODMANCHESTER_PV_CONFIG },
  { config: UPTON_PV_CONFIG },
  { config: BROWNSBURG_CHATHAM_PV_CONFIG },
  { config: BERTHIERVILLE_PV_CONFIG },
  { config: SAINTE_ANNE_DE_SOREL_PV_CONFIG },
  { config: SAINTE_MELANIE_PV_CONFIG },
  { config: BROMONT_PV_CONFIG },
  { config: ROXTON_POND_PV_CONFIG },
  { config: SAINTE_MARGUERITE_DU_LAC_MASSON_PV_CONFIG },
  { config: CHERTSEY_PV_CONFIG },
  { config: VAL_MORIN_PV_CONFIG },
  { config: SAINT_GUILLAUME_PV_CONFIG },
  { config: SAINT_DAVID_PV_CONFIG },
  { config: ELGIN_PV_CONFIG },
  { config: SAINT_ANICET_PV_CONFIG },
  { config: SAINT_EUGENE_PV_CONFIG },
  { config: SAINT_FELIX_DE_VALOIS_PV_CONFIG },
  { config: YAMASKA_PV_CONFIG },
  { config: SAINT_ALPHONSE_RODRIGUEZ_PV_CONFIG },
  { config: SAINT_NORBERT_PV_CONFIG },
  // -- Lot cities-round6 (config-only, verifie 2026-06-11) --
  { config: COURCELLES_SAINT_EVARISTE_PV_CONFIG },
  { config: SAINT_SEBASTIEN_LE_GRANIT_PV_CONFIG },
  { config: SAINT_PATRICE_DE_BEAURIVAGE_PV_CONFIG },
  { config: AUMOND_PV_CONFIG },
  { config: SAINTE_CLOTILDE_DE_BEAUCE_PV_CONFIG },
  { config: LAC_SERGENT_PV_CONFIG },
  { config: EAST_BROUGHTON_PV_CONFIG },
  { config: SACRE_COEUR_DE_JESUS_PV_CONFIG },
  { config: BLUE_SEA_PV_CONFIG },
  { config: SAINT_NARCISSE_DE_BEAURIVAGE_PV_CONFIG },
  { config: SAINTE_ANNE_DU_LAC_PV_CONFIG },
  { config: MANIWAKI_PV_CONFIG },
  { config: MESSINES_PV_CONFIG },
  { config: LA_GUADELOUPE_PV_CONFIG },
  { config: SAINT_RAYMOND_PV_CONFIG },
  { config: FERME_NEUVE_PV_CONFIG },
  { config: SAINTE_CATHERINE_DE_LA_JACQUES_CARTIER_PV_CONFIG },
  { config: ALLEYN_ET_CAWOOD_PV_CONFIG },
  { config: SAINT_AUGUSTIN_DE_DESMAURES_PV_CONFIG },
  { config: SAINT_AUGUSTIN_DE_WOBURN_PV_CONFIG },
  { config: SAINT_EPHREM_DE_BEAUCE_PV_CONFIG },
  // -- Lot cities-round5 (config-only, verifie 2026-06-11) --
  { config: MONT_TREMBLANT_PV_CONFIG },
  { config: MONTEBELLO_PV_CONFIG },
  { config: SAINT_LUCIEN_PV_CONFIG },
  { config: MELBOURNE_PV_CONFIG },
  { config: AMHERST_PV_CONFIG },
  { config: KINGSBURY_PV_CONFIG },
  { config: SAINT_FELIX_DE_KINGSEY_PV_CONFIG },
  { config: SAINT_ALEXIS_DES_MONTS_PV_CONFIG },
  { config: GRAND_SAINT_ESPRIT_PV_CONFIG },
  { config: RICHMOND_PV_CONFIG },
  { config: SAINT_BARNABE_PV_CONFIG },
  { config: MAGOG_PV_CONFIG },
  { config: LAC_SUPERIEUR_PV_CONFIG },
  { config: NOTRE_DAME_DE_LA_PAIX_PV_CONFIG },
  { config: SAINT_LEONARD_DASTON_PV_CONFIG },
  { config: STANSTEAD_MEMPHREMAGOG_PV_CONFIG },
  { config: CHARETTE_PV_CONFIG },
  { config: SAINT_DENIS_DE_BROMPTON_PV_CONFIG },
  { config: SAINT_CHRISTOPHE_DARTHABASKA_PV_CONFIG },
  { config: SAINT_CAMILLE_PV_CONFIG },
  { config: CHESTERVILLE_PV_CONFIG },
  { config: LANGE_GARDIEN_LES_COLLINES_DE_LOUTAOUAIS_PV_CONFIG },
  { config: WESTBURY_PV_CONFIG },
  { config: COOKSHIRE_EATON_PV_CONFIG },
  { config: EAST_ANGUS_PV_CONFIG },
  { config: MARTINVILLE_PV_CONFIG },
  { config: HEROUXVILLE_PV_CONFIG },
  { config: SAINTE_GENEVIEVE_DE_BATISCAN_PV_CONFIG },
  { config: PRINCEVILLE_PV_CONFIG },
  { config: DIXVILLE_PV_CONFIG },
  { config: SAINTE_EDWIDGE_DE_CLIFTON_PV_CONFIG },
  { config: NOTRE_DAME_DE_HAM_PV_CONFIG },
  { config: LASCENSION_PV_CONFIG },
  { config: SAINTE_CECILE_DE_LEVRARD_PV_CONFIG },
  { config: NOMININGUE_PV_CONFIG },
  { config: SAINT_STANISLAS_DES_CHENAUX_PV_CONFIG },
  { config: SAINT_SEVERIN_MEKINAC_PV_CONFIG },
  { config: DUDSWELL_PV_CONFIG },
  { config: RIVIERE_ROUGE_PV_CONFIG },
  { config: HAM_NORD_PV_CONFIG },
  { config: SAINTE_HELENE_DE_CHESTER_PV_CONFIG },
  { config: HAM_SUD_PV_CONFIG },
  { config: NOTRE_DAME_DE_LA_SALETTE_PV_CONFIG },
  { config: VAL_DES_BOIS_PV_CONFIG },
  { config: SAINT_PROSPER_DE_CHAMPLAIN_PV_CONFIG },
  { config: PLESSISVILLE_PV_CONFIG },
  { config: SAINTE_SOPHIE_DHALIFAX_PV_CONFIG },
  { config: SAINT_FORTUNAT_PV_CONFIG },
  { config: SAINTE_ANNE_DE_LA_PERADE_PV_CONFIG },
  { config: DESCHAILLONS_SUR_SAINT_LAURENT_PV_CONFIG },
  { config: FORTIERVILLE_PV_CONFIG },
  { config: PARISVILLE_PV_CONFIG },
  { config: SAINTE_FRANCOISE_BECANCOUR_PV_CONFIG },
  { config: SAINT_ADELPHE_PV_CONFIG },
  { config: SAINTS_MARTYRS_CANADIENS_PV_CONFIG },
  { config: GATINEAU_PV_CONFIG },
  { config: BURY_PV_CONFIG },
  { config: SAINT_ISIDORE_DE_CLIFTON_PV_CONFIG },
  { config: SAINT_MALO_PV_CONFIG },
  { config: VAL_DES_MONTS_PV_CONFIG },
  { config: NEWPORT_PV_CONFIG },
  { config: EAST_HEREFORD_PV_CONFIG },
  { config: WEEDON_PV_CONFIG },
  { config: LAC_SAGUAY_PV_CONFIG },
  { config: SAINT_JULIEN_PV_CONFIG },
  { config: SAINT_VENANT_DE_PAQUETTE_PV_CONFIG },
  { config: SAINT_JACQUES_LE_MAJEUR_DE_WOLFESTOWN_PV_CONFIG },
  { config: SAINTE_THECLE_PV_CONFIG },
  { config: SAINT_CASIMIR_PV_CONFIG },
  { config: KIAMIKA_PV_CONFIG },
  { config: LECLERCVILLE_PV_CONFIG },
  { config: CANTLEY_PV_CONFIG },
  { config: DENHOLM_PV_CONFIG },
  { config: VAL_ALAIN_PV_CONFIG },
  { config: LAC_DU_CERF_PV_CONFIG },
  { config: SAINT_MATHIEU_DU_PARC_PV_CONFIG },
  // -- Lot cities-round4 (config-only, verifie 2026-06-11) --
  { config: SAINTE_CLOTILDE_DE_HORTON_PV_CONFIG },
  { config: CLEVELAND_PV_CONFIG },
  { config: SAINTE_SERAPHINE_PV_CONFIG },
  { config: LAC_TREMBLANT_NORD_PV_CONFIG },
  { config: SAINT_FRANCOIS_XAVIER_DE_BROMPTON_PV_CONFIG },
  { config: OGDEN_PV_CONFIG },
  { config: CHENEVILLE_PV_CONFIG },
  { config: SAINT_ETIENNE_DES_GRES_PV_CONFIG },
  { config: KINGSEY_FALLS_PV_CONFIG },
  { config: SAINT_ELIE_DE_CAXTON_PV_CONFIG },
  { config: SAINT_WENCESLAS_PV_CONFIG },
  { config: SAINTE_CATHERINE_DE_HATLEY_PV_CONFIG },
  { config: WINDSOR_PV_CONFIG },
  { config: SAINTE_ELIZABETH_DE_WARWICK_PV_CONFIG },
  { config: SAINTE_EULALIE_PV_CONFIG },
  { config: AYERS_CLIFF_PV_CONFIG },
  { config: DANVILLE_PV_CONFIG },
  { config: LABELLE_PV_CONFIG },
  { config: VAL_JOLI_PV_CONFIG },
  { config: SHERBROOKE_PV_CONFIG },
  { config: SAINT_ALBERT_PV_CONFIG },
  { config: RIPON_PV_CONFIG },
  { config: STANSTEAD_MEMPHREMAGOG_2_PV_CONFIG },
  { config: SAINT_BONIFACE_PV_CONFIG },
  { config: SAINT_CLAUDE_PV_CONFIG },
  { config: ASTON_JONCTION_PV_CONFIG },
  { config: STANSTEAD_EST_PV_CONFIG },
  { config: SAINT_SIXTE_PV_CONFIG },
  { config: HATLEY_TOWNSHIP_MUNICIPALITY_PV_CONFIG },
  { config: VAL_DES_SOURCES_PV_CONFIG },
  { config: BECANCOUR_PV_CONFIG },
  { config: NOTRE_DAME_DU_MONT_CARMEL_PV_CONFIG },
  { config: SAINT_VALERE_PV_CONFIG },
  { config: THURSO_PV_CONFIG },
  { config: WARWICK_PV_CONFIG },
  { config: SAINT_SYLVERE_PV_CONFIG },
  { config: TINGWICK_PV_CONFIG },
  { config: BARNSTON_OUEST_PV_CONFIG },
  { config: HATLEY_PV_CONFIG },
  { config: SAINT_MAURICE_PV_CONFIG },
  { config: LA_MINERVE_PV_CONFIG },
  { config: SHAWINIGAN_PV_CONFIG },
  { config: WATERVILLE_PV_CONFIG },
  { config: LOCHABER_PARTIE_OUEST_PV_CONFIG },
  { config: DAVELUYVILLE_PV_CONFIG },
  { config: MADDINGTON_FALLS_PV_CONFIG },
  { config: MAYO_PV_CONFIG },
  { config: VICTORIAVILLE_PV_CONFIG },
  { config: STOKE_PV_CONFIG },
  { config: CHAMPLAIN_PV_CONFIG },
  { config: SAINT_ROSAIRE_PV_CONFIG },
  { config: DUHAMEL_PV_CONFIG },
  { config: COATICOOK_PV_CONFIG },
  { config: COMPTON_PV_CONFIG },
  // -- Lot cities-round7 (config-only, verifie 2026-06-11) --
  { config: SALABERRY_DE_VALLEYFIELD_PV_CONFIG },
  { config: SAINT_MARC_DES_CARRIERES_PV_CONFIG },
  { config: DISRAELI_LES_APPALACHES_PV_CONFIG },
  { config: TROIS_RIVES_PV_CONFIG },
  { config: SCOTSTOWN_PV_CONFIG },
  { config: LAC_DES_ECORCES_PV_CONFIG },
  { config: STRATFORD_PV_CONFIG },
  { config: SAINT_JEAN_DE_BREBEUF_PV_CONFIG },
  { config: CHUTE_SAINT_PHILIPPE_PV_CONFIG },
  { config: INVERNESS_PV_CONFIG },
  { config: SAINT_GILBERT_PV_CONFIG },
  { config: SAINT_AIME_DU_LAC_DES_ILES_PV_CONFIG },
  { config: CHARTIERVILLE_PV_CONFIG },
  { config: LAC_SAINTE_MARIE_PV_CONFIG },
  { config: PORTNEUF_PV_CONFIG },
  { config: SAINTE_CROIX_PV_CONFIG },
  { config: LOW_PV_CONFIG },
  { config: LAURIER_STATION_PV_CONFIG },
  { config: THETFORD_MINES_PV_CONFIG },
  { config: KINNEARS_MILLS_PV_CONFIG },
  { config: DOSQUET_PV_CONFIG },
  { config: NOTRE_DAME_DU_SACRE_COEUR_DISSOUDUN_PV_CONFIG },
  { config: CAP_SANTE_PV_CONFIG },
  { config: DONNACONA_PV_CONFIG },
  { config: SAINT_JACQUES_DE_LEEDS_PV_CONFIG },
  { config: VAL_RACINE_PV_CONFIG },
  { config: SAINT_ROMAIN_PV_CONFIG },
  { config: LA_PECHE_PV_CONFIG },
  { config: SAINT_BASILE_PV_CONFIG },
  { config: MONT_LAURIER_PV_CONFIG },
  { config: NOTRE_DAME_DES_BOIS_PV_CONFIG },
  { config: GRACEFIELD_PV_CONFIG },
  { config: LAMBTON_PV_CONFIG },
  { config: SAINTE_THERESE_DE_LA_GATINEAU_PV_CONFIG },
  { config: MONT_SAINT_MICHEL_PV_CONFIG },
  { config: BOUCHETTE_PV_CONFIG },
  { config: ADSTOCK_PV_CONFIG },
  { config: SAINT_LEONARD_DE_PORTNEUF_PV_CONFIG },
  { config: NANTES_PV_CONFIG },
  { config: RIVIERE_A_PIERRE_PV_CONFIG },
  { config: DELEAGE_PV_CONFIG },
  { config: KAZABAZUA_PV_CONFIG },
  { config: SAINT_AGAPIT_PV_CONFIG },
  { config: SAINT_APOLLINAIRE_PV_CONFIG },
  { config: SAINT_PIERRE_DE_BROUGHTON_PV_CONFIG },
  { config: NEUVILLE_PV_CONFIG },
  { config: SAINT_GILLES_PV_CONFIG },
  { config: PONT_ROUGE_PV_CONFIG },
  { config: MARSTON_PV_CONFIG },
  // -- Lot cities-round8 (config-only, verifie 2026-06-11) --
  { config: EGAN_SUD_PV_CONFIG },
  { config: LAC_DROLET_PV_CONFIG },
  { config: FOSSAMBAULT_SUR_LE_LAC_PV_CONFIG },
  { config: SAINT_BERNARD_PV_CONFIG },
  { config: FRONTENAC_PV_CONFIG },
  { config: LAC_SAINT_JOSEPH_PV_CONFIG },
  { config: SAINT_ELZEAR_LA_NOUVELLE_BEAUCE_PV_CONFIG },
  { config: BOIS_FRANC_PV_CONFIG },
  { config: SAINT_VICTOR_PV_CONFIG },
  { config: SAINT_FREDERIC_PV_CONFIG },
  { config: CAYAMANT_PV_CONFIG },
  { config: SHANNON_PV_CONFIG },
  { config: SAINT_HONORE_DE_SHENLEY_PV_CONFIG },
  { config: SCOTT_PV_CONFIG },
  { config: LANCIENNE_LORETTE_PV_CONFIG },
  { config: SAINTE_MARIE_PV_CONFIG },
  { config: SAINT_BENOIT_LABRE_PV_CONFIG },
  { config: SAINT_LUDGER_PV_CONFIG },
  { config: MONTCERF_LYTTON_PV_CONFIG },
  { config: SAINT_GABRIEL_DE_VALCARTIER_PV_CONFIG },
  { config: CLARENDON_PV_CONFIG },
  { config: SAINTE_HENEDINE_PV_CONFIG },
  { config: SAINT_JOSEPH_DE_BEAUCE_PV_CONFIG },
  { config: SAINTS_ANGES_PV_CONFIG },
  { config: BEAUCEVILLE_PV_CONFIG },
  { config: SAINTE_MARGUERITE_PV_CONFIG },
  { config: SAINT_GEORGES_PV_CONFIG },
  // -- Lot cities-round10 (config-only, verifie 2026-06-11) --
  { config: WALTHAM_PV_CONFIG },
  { config: ARMAGH_PV_CONFIG },
  { config: BERTHIER_SUR_MER_PV_CONFIG },
  { config: SAINTE_SABINE_LES_ETCHEMINS_PV_CONFIG },
  { config: SAINT_FERREOL_LES_NEIGES_PV_CONFIG },
  { config: MONTMAGNY_PV_CONFIG },
  { config: SAINT_TITE_DES_CAPS_PV_CONFIG },
  { config: NOTRE_DAME_DU_ROSAIRE_PV_CONFIG },
  { config: SAINT_ANTOINE_DE_LISLE_AUX_GRUES_PV_CONFIG },
  { config: SAINT_JUST_DE_BRETENIERES_PV_CONFIG },
  { config: SAINT_FABIEN_DE_PANET_PV_CONFIG },
  { config: CAP_SAINT_IGNACE_PV_CONFIG },
  { config: PETITE_RIVIERE_SAINT_FRANCOIS_PV_CONFIG },
  { config: SAINTE_LUCIE_DE_BEAUREGARD_PV_CONFIG },
  { config: LISLET_PV_CONFIG },
  { config: BAIE_SAINT_PAUL_PV_CONFIG },
  { config: SAINT_JEAN_PORT_JOLI_PV_CONFIG },
  { config: SAINT_AUBERT_PV_CONFIG },
  { config: LISLE_AUX_COUDRES_PV_CONFIG },
  { config: SAINTE_FELICITE_LISLET_PV_CONFIG },
  // -- Lot cities-round9 (config-only, verifie 2026-06-11) --
  { config: SAINT_HENRI_PV_CONFIG },
  { config: LITCHFIELD_PV_CONFIG },
  { config: CAMPBELLS_BAY_PV_CONFIG },
  { config: SAINT_ROBERT_BELLARMIN_PV_CONFIG },
  { config: FRAMPTON_PV_CONFIG },
  { config: LAC_BEAUPORT_PV_CONFIG },
  { config: SAINTE_PETRONILLE_PV_CONFIG },
  { config: PORTAGE_DU_FORT_PV_CONFIG },
  { config: SAINTE_CLAIRE_PV_CONFIG },
  { config: BOISCHATEL_PV_CONFIG },
  { config: SAINT_ODILON_DE_CRANBOURNE_PV_CONFIG },
  { config: LILE_DU_GRAND_CALUMET_PV_CONFIG },
  { config: SAINT_PHILIBERT_PV_CONFIG },
  { config: SAINT_COME_LINIERE_PV_CONFIG },
  { config: STONEHAM_ET_TEWKESBURY_PV_CONFIG },
  { config: SAINT_CHARLES_DE_BELLECHASSE_PV_CONFIG },
  { config: SAINT_BENJAMIN_PV_CONFIG },
  { config: LANGE_GARDIEN_LA_COTE_DE_BEAUPRE_PV_CONFIG },
  { config: SAINT_LAURENT_DE_LILE_DORLEANS_PV_CONFIG },
  { config: SAINT_THEOPHILE_PV_CONFIG },
  { config: SAINTE_BRIGITTE_DE_LAVAL_PV_CONFIG },
  { config: SAINT_LAZARE_DE_BELLECHASSE_PV_CONFIG },
  { config: SAINT_LEON_DE_STANDON_PV_CONFIG },
  { config: SAINT_NAZAIRE_DE_DORCHESTER_PV_CONFIG },
  { config: LAC_EDOUARD_PV_CONFIG },
  { config: LA_DURANTAYE_PV_CONFIG },
  { config: CHATEAU_RICHER_PV_CONFIG },
  { config: LAC_ETCHEMIN_PV_CONFIG },
  { config: SAINT_DAMIEN_DE_BUCKLAND_PV_CONFIG },
  { config: SAINT_NEREE_DE_BELLECHASSE_PV_CONFIG },
  { config: SAINT_ZACHARIE_PV_CONFIG },
  { config: SAINTE_ROSE_DE_WATFORD_PV_CONFIG },
  { config: SAINTE_AURELIE_PV_CONFIG },
  { config: SAINT_RAPHAEL_PV_CONFIG },
  // -- Lot cities-round11 (VPlus/Portail Citoyen, config-only, verifie 2026-06-14) --
  { config: BATISCAN_PV_CONFIG },
  { config: BOILEAU_PV_CONFIG },
  { config: BOWMAN_PV_CONFIG },
  { config: CHIBOUGAMAU_PV_CONFIG },
  { config: GRENVILLE_PV_CONFIG },
  { config: LAC_SAINT_PAUL_PV_CONFIG },
  { config: LAURIERVILLE_PV_CONFIG },
  { config: LORRAINVILLE_PV_CONFIG },
  { config: LYSTER_PV_CONFIG },
  { config: DUNHAM_PV_CONFIG },
  { config: BAIE_DES_SABLES_PV_CONFIG },
  { config: GRAND_REMOUS_PV_CONFIG },
  { config: BEAUPRE_PV_CONFIG },
  { config: LAC_FRONTIERE_PV_CONFIG },
];
