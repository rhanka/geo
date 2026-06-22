import { spawn } from "node:child_process";

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
  AVIS_PUBLICS_USER_AGENT,
  SourceFetchError,
  type FetchLike,
} from "./avis-publics-valleyfield.js";
import {
  parseGrillePage,
  isGrillePage,
  type GrilleRejection,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";

/**
 * LIVE SourceAdapter for the Ville de Sherbrooke "grille des usages et des
 * normes" annex of zoning bylaw 1200 — the FIRST production run of the proven
 * règlement→grille→ZoneNorms chain (until now exercised only on the committed
 * `grille-specifications.fixture.ts` golden pages).
 *
 * It is the production wiring of the FROZEN parser
 * (`grille-specifications-parser.ts`, 37/37): this adapter performs ZERO new
 * parsing logic and ZERO new normalisation. It only:
 *   1. fetches the real ~1990-page native-text grille PDF over public HTTP,
 *   2. runs `pdftotext -layout` ONCE over the whole document (the parser is built
 *      against `-layout` output — see the fixture header) and splits the result
 *      on the form-feed `\f` page separator (poppler's page-break convention),
 *   3. classifies each page with the parser's own `isGrillePage` (intro / légende
 *      / note pages are SKIPPED, never errored),
 *   4. feeds every grille page to the parser's `parseGrillePage`, and aggregates
 *      the ZoneNorms of EVERY Sherbrooke zone row across all pages.
 *
 * Anti-invention is inherited WHOLE from the parser: a page whose column band the
 * parser cannot resolve to the full canonical header set is REJECTED by its
 * anti-décalage guard (no partial publication, no silent correction) and counted,
 * NOT guessed at here. Every published field is `value=verbatim-cell`; everything
 * else stays `value:null` + `raw` + `flag`. `null` always beats a fabricated norm.
 *
 * The adapter NEVER throws on a per-page failure: a rejected grille page is
 * collected into `rejectedPages`, a non-grille page is silently skipped. A
 * pdftotext/network failure raises the SHARED typed `SourceFetchError` (the same
 * convention as the Valleyfield règlement adapter).
 */

/** Stable source id used for storage keys and the RECUEIL endpoint. */
export const ZONAGE_SHERBROOKE_SOURCE_ID = "reglements-zonage-sherbrooke";
export const ZONAGE_SHERBROOKE_CITY = "sherbrooke";
export const ZONAGE_SHERBROOKE_ADAPTER_VERSION = "0.1.0";

/** The consolidated zoning bylaw number whose grille annex this reads. */
export const ZONAGE_SHERBROOKE_REGLEMENT = "1200";

/**
 * The PUBLIC grille annex PDF (Excel-generated, native-text, ~1990 pages). Same
 * URL committed in the fixture provenance — open data, HTTP GET, no auth.
 */
export const ZONAGE_SHERBROOKE_GRILLE_URL =
  "https://contenu.maruche.ca/Fichiers/3337a882-4a53-e611-80ea-00155d09650f/Sites/333dd3d3-915d-e611-80ea-00155d09650f/Documents/Reglements%20municipaux/Urbanisme/Reglement-1200-grilles.pdf";

/** Snapshot label of the live fetch (the day of this production run). */
export const ZONAGE_SHERBROOKE_SNAPSHOT = "2026-06-21";

/** Hard cap on the HTTP fetch so a slow source never blocks indefinitely. */
const FETCH_TIMEOUT_MS = 120_000;

/**
 * Hard cap on the single `pdftotext -layout` child process. The whole 1990-page
 * native-text doc converts in well under a minute locally, but a generous cap
 * absorbs a cold disk / slow CI without false timeouts.
 */
const PDFTOTEXT_TIMEOUT_MS = 180_000;

/** poppler emits a form-feed between pages of a `pdftotext` run. */
const PAGE_SEPARATOR = "\f";

/** Minimal PDF→layout-text signature so the step is testable without poppler. */
export type PdfToLayoutText = (
  bytes: Uint8Array,
  timeoutMs: number,
) => Promise<string>;

/**
 * Convert PDF bytes to `pdftotext -layout` UTF-8 text via poppler, reading the
 * bytes on stdin and returning stdout. `-layout` (NOT the plain mode used by the
 * Valleyfield adapter) is REQUIRED: the grille parser clusters value cells by
 * their character column, which only the layout-preserving mode emits.
 *
 * Throws a typed `SourceFetchError(kind: "parse")` on a non-zero exit / spawn
 * failure (binary absent) and `kind: "timeout"` on the cap — never lets a raw
 * child-process error escape (same convention as `pdfToTextViaPoppler`).
 */
export function pdfToLayoutTextViaPoppler(url: string): PdfToLayoutText {
  return (bytes, timeoutMs) =>
    new Promise<string>((resolve, reject) => {
      let child;
      try {
        child = spawn("pdftotext", ["-q", "-layout", "-enc", "UTF-8", "-", "-"], {
          stdio: ["pipe", "pipe", "pipe"],
          // The full doc's UTF-8 text is several MB; lift the default buffer.
          // (spawn streams stdout, so this is belt-and-suspenders.)
        });
      } catch (e) {
        reject(
          new SourceFetchError(
            "parse",
            `pdftotext spawn failed: ${e instanceof Error ? e.message : String(e)}`,
            url,
          ),
        );
        return;
      }

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new SourceFetchError("timeout", "pdftotext timed out", url));
      }, timeoutMs);

      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.stderr.on("data", (d: Buffer) => errChunks.push(d));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new SourceFetchError("parse", `pdftotext error: ${e.message}`, url));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString("utf-8"));
        } else {
          const detail = Buffer.concat(errChunks).toString("utf-8").trim();
          reject(
            new SourceFetchError(
              "parse",
              `pdftotext exited ${code}${detail ? `: ${detail}` : ""}`,
              url,
            ),
          );
        }
      });

      child.stdin.on("error", () => {
        /* ignore EPIPE if poppler closes stdin early */
      });
      child.stdin.write(Buffer.from(bytes));
      child.stdin.end();
    });
}

/** Per-page accounting of one production grille extraction run. */
export interface GrilleExtractionStats {
  /** Pages emitted by pdftotext (form-feed-delimited, blanks dropped). */
  readonly totalPages: number;
  /** Pages the parser's `isGrillePage` classifier accepted as a grille. */
  readonly grillePages: number;
  /** Pages skipped because they are not a grille (intro / légende / notes). */
  readonly skippedNonGrille: number;
  /** Grille pages the anti-décalage guard REJECTED (column band unresolved). */
  readonly rejectedGrillePages: number;
  /** Total zone rows aggregated across all accepted grille pages. */
  readonly zoneRows: number;
  /** Distinct verbatim zone codes seen. */
  readonly uniqueZoneCodes: number;
}

/** The full result of one grille document extraction. */
export interface GrilleExtractionResult {
  readonly zones: ZoneNormsT[];
  readonly rejectedPages: GrilleRejection[];
  readonly stats: GrilleExtractionStats;
}

/**
 * Split a `pdftotext -layout` blob into its per-page texts (form-feed delimited),
 * dropping wholly-blank trailing pages. The grille parser consumes ONE page text
 * at a time, so this is the bridge from the single poppler run to per-page input.
 */
export function splitLayoutPages(layoutText: string): string[] {
  return layoutText
    .split(PAGE_SEPARATOR)
    .filter((page) => page.trim().length > 0);
}

/**
 * Run the FROZEN grille parser over every page of a `pdftotext -layout` blob and
 * aggregate the ZoneNorms. Non-grille pages are skipped; grille pages the parser
 * rejects (anti-décalage) are collected, not guessed at. This is pure (no I/O) so
 * it is unit-testable on a verbatim page string without poppler or the network.
 */
export function extractGrilleDocument(
  layoutText: string,
  opts: { source_url: string; snapshot: string; methode?: string },
): GrilleExtractionResult {
  const pages = splitLayoutPages(layoutText);

  const zones: ZoneNormsT[] = [];
  const rejectedPages: GrilleRejection[] = [];
  let grillePages = 0;
  let skippedNonGrille = 0;

  for (const page of pages) {
    if (!isGrillePage(page).isGrille) {
      skippedNonGrille++;
      continue;
    }
    grillePages++;
    const res = parseGrillePage(page, opts);
    if (res.rejected) {
      rejectedPages.push(res);
    } else {
      zones.push(...res.zones);
    }
  }

  const uniqueZoneCodes = new Set(zones.map((z) => z.zone_code)).size;
  return {
    zones,
    rejectedPages,
    stats: {
      totalPages: pages.length,
      grillePages,
      skippedNonGrille,
      rejectedGrillePages: rejectedPages.length,
      zoneRows: zones.length,
      uniqueZoneCodes,
    },
  };
}

export interface ReglementsZonageSherbrookeOptions {
  readonly fetchImpl?: FetchLike;
  /** Override the PDF→layout-text step (tests inject a pure fn; default=poppler). */
  readonly pdfToLayoutText?: PdfToLayoutText;
  readonly timeoutMs?: number;
  readonly pdfToTextTimeoutMs?: number;
  readonly now?: () => Date;
  /** Override the grille PDF URL (defaults to the live 1200 annex). */
  readonly grilleUrl?: string;
  /** Override the snapshot label (defaults to the run date). */
  readonly snapshot?: string;
}

/**
 * LIVE SourceAdapter for the Sherbrooke 1200 grille annex.
 *
 * `list()` yields the single grille-PDF ref; `fetch()` downloads it and attaches
 * the `pdftotext -layout` text; `extractZoneNorms()` runs the frozen parser over
 * the whole document and returns the aggregated ZoneNorms + per-page stats.
 */
export class ReglementsZonageSherbrookeAdapter implements SourceAdapter {
  readonly kind: SourceKind = "zonage";
  readonly city = ZONAGE_SHERBROOKE_CITY;
  readonly version = ZONAGE_SHERBROOKE_ADAPTER_VERSION;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly pdfToTextTimeoutMs: number;
  private readonly now: () => Date;
  private readonly grilleUrl: string;
  private readonly snapshot: string;
  private readonly pdfToLayoutTextOverride: PdfToLayoutText | undefined;

  constructor(options: ReglementsZonageSherbrookeOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.pdfToTextTimeoutMs = options.pdfToTextTimeoutMs ?? PDFTOTEXT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.grilleUrl = options.grilleUrl ?? ZONAGE_SHERBROOKE_GRILLE_URL;
    this.snapshot = options.snapshot ?? ZONAGE_SHERBROOKE_SNAPSHOT;
    this.pdfToLayoutTextOverride = options.pdfToLayoutText;
  }

  get sourceId(): string {
    return ZONAGE_SHERBROOKE_SOURCE_ID;
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    const discoveredAt = this.now().toISOString();
    yield {
      sourceKind: this.kind,
      city: this.city,
      url: this.grilleUrl,
      discoveredAt,
      title: `Règlement ${ZONAGE_SHERBROOKE_REGLEMENT} — grille des usages et des normes (Ville de Sherbrooke)`,
      contentType: "application/pdf",
      metadata: { reglement: ZONAGE_SHERBROOKE_REGLEMENT },
    };
  }

  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(ref.url, {
          signal: controller.signal,
          headers: {
            "user-agent": AVIS_PUBLICS_USER_AGENT,
            accept: "application/pdf",
          },
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
        res.headers.get("content-type") ?? ref.contentType ?? "application/pdf";

      // Attach the layout text so EXPLOITATION reads the parseable projection
      // (binary bytes stay the canonical evidence). A pdftotext failure → typed
      // parse error.
      const toText =
        this.pdfToLayoutTextOverride ?? pdfToLayoutTextViaPoppler(ref.url);
      const text = await toText(body, this.pdfToTextTimeoutMs);

      const document: RawDocument = {
        ref,
        sourceKind: this.kind,
        city: this.city,
        url: ref.url,
        fetchedAt,
        contentType,
        body,
        text,
        httpStatus: res.status,
        sha256: sha256Hex(body),
        provenance: {
          adapterVersion: this.version,
          userAgent: AVIS_PUBLICS_USER_AGENT,
          fetchedViaObscura: false,
          obtentionMode: "download",
        },
      };
      return document;
    } finally {
      clearTimeout(timer);
    }
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }

  /**
   * Run the frozen grille parser over a fetched document's `-layout` text and
   * return the aggregated ZoneNorms + per-page stats. The `source_url` and
   * `snapshot` recorded in each field's provenance come from the adapter config.
   */
  extractZoneNorms(raw: RawDocument): GrilleExtractionResult {
    const layoutText = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return extractGrilleDocument(layoutText, {
      source_url: this.grilleUrl,
      snapshot: this.snapshot,
    });
  }
}

/** Factory — keeps construction uniform with the other RECUEIL adapters. */
export function createReglementsZonageSherbrookeAdapter(
  options: ReglementsZonageSherbrookeOptions = {},
): ReglementsZonageSherbrookeAdapter {
  return new ReglementsZonageSherbrookeAdapter(options);
}
