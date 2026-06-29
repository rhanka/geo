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
  parseReglementDocument,
  parseReglementListing,
  REGLEMENTS_URBANISME_PDF_PREFIX,
  REGLEMENTS_URBANISME_SOURCE_URL,
  type ReglementDocumentT,
  type ReglementListingEntryT,
} from "./reglements-urbanisme-parser.js";

/**
 * RECUEIL SourceAdapter for the Salaberry-de-Valleyfield "Règlements d'urbanisme"
 * source (WP4 Source #5 — the regulatory backbone behind the avis/designation
 * events). It flows through the SAME recueil → exploitation pipeline as the avis
 * (#49/#53), rôle (#54) and Adresses Québec (#55) adapters:
 *
 *   - `list()` discovers the public urbanisme-bylaw HTML *listing* plus the bylaw
 *     PDFs the caller scopes in (defaulting to the real zoning règlement 150-51
 *     and the plan-d'urbanisme amendment 450-02 named in the WP4 brief).
 *   - `fetch()` does the real public HTTP GET from the public CloudFront CDN (open
 *     data, no auth) and returns raw bytes + provenance. For a PDF it ALSO runs
 *     `pdftotext` (poppler) to attach the extracted UTF-8 text (`RawDocument.text`),
 *     so EXPLOITATION reconciles on real legal text without re-parsing the binary.
 *   - `hash()` is the sha256 used for idempotent storage.
 *
 * The adapter NEVER throws on a failure: it raises the SHARED typed
 * `SourceFetchError` the RECUEIL job turns into a typed outcome (a missing/failed
 * `pdftotext` becomes `kind: "parse"`, an `AbortController` timeout becomes
 * `kind: "timeout"`). The committed real text excerpts (the verbatim pdftotext
 * output) back the deterministic tests; a live network fetch is best-effort only
 * and is NEVER required for the test gate.
 *
 * PDF→text approach: `pdftotext - -` (poppler) reading the fetched bytes on stdin
 * and emitting UTF-8 text on stdout. poppler is a small, ubiquitous system binary
 * (already installed here and in the API image's toolchain); shelling out keeps
 * the package free of a heavyweight node PDF dependency, and the binary's output
 * is the SAME text committed as the fixture (so tests stay deterministic).
 */

/** Stable source id used for the RECUEIL endpoint and storage keys. */
export const REGLEMENTS_URBANISME_SOURCE_ID = "reglements-urbanisme-valleyfield";
export const REGLEMENTS_URBANISME_CITY = "salaberry-de-valleyfield";
export const REGLEMENTS_URBANISME_ADAPTER_VERSION = "0.1.0";

/** Hard cap on a fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 30000;

/** Hard cap on the pdftotext child process. */
const PDFTOTEXT_TIMEOUT_MS = 15000;

/**
 * The bylaw PDFs the adapter collects by default. REAL public CloudFront URLs
 * (open data, HTTP 200), the two committed-fixture documents:
 *   - 150-51 (zonage) — the zoning règlement that names real zone codes, and
 *   - 450-02 (plan d'urbanisme) — the amendment named in the WP4 brief.
 */
export const DEFAULT_REGLEMENT_PDFS: ReadonlyArray<{ name: string; title: string }> =
  [
    {
      name: "Reglement-150-51-zonage.pdf",
      title: "Règlement 150-51 — modifiant le Règlement 150 concernant le zonage",
    },
    {
      name: "Reglement-450-02.pdf",
      title: "Règlement 450-02 — modifiant le Règlement 450 concernant le plan d'urbanisme",
    },
  ];

/** Build the public CloudFront URL for a règlement PDF by filename. */
export function reglementPdfUrl(name: string): string {
  return `${REGLEMENTS_URBANISME_PDF_PREFIX}${name}`;
}

/** A minimal spawn signature so the PDF→text step is testable without poppler. */
export type PdfToText = (bytes: Uint8Array, timeoutMs: number) => Promise<string>;

/**
 * Probe whether the `pdftotext` (poppler) binary is callable in this runtime.
 * The PDF→text step shells out to it; when it is ABSENT every PV PDF yields
 * empty text and the scrape produces 0 signal *silently* (the adapter swallows
 * the spawn error by design). Callers (e.g. the live-scrape worker) use this at
 * start-up to turn that silent false-negative into a LOUD diagnostic instead of
 * scraping into the void. Resolves `true` iff `pdftotext -v` exits 0.
 */
export async function isPdftotextAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawn("pdftotext", ["-v"], { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    // poppler prints its version banner to stderr and exits 0 for `-v`.
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Convert PDF bytes to UTF-8 text via `pdftotext - -` (poppler). Reads the bytes
 * on stdin, returns stdout. Throws a typed `SourceFetchError(kind: "parse")` on a
 * non-zero exit, a spawn failure (binary absent), or a timeout — the adapter
 * never lets a raw child-process error escape.
 */
export function pdfToTextViaPoppler(url: string): PdfToText {
  return (bytes, timeoutMs) =>
    new Promise<string>((resolve, reject) => {
      let child;
      try {
        child = spawn("pdftotext", ["-q", "-enc", "UTF-8", "-", "-"], {
          stdio: ["pipe", "pipe", "pipe"],
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

export interface ReglementsUrbanismeOptions {
  readonly fetchImpl?: FetchLike;
  /** Override the PDF→text step (tests inject a pure function; default = poppler). */
  readonly pdfToText?: PdfToText;
  readonly timeoutMs?: number;
  readonly pdfToTextTimeoutMs?: number;
  readonly now?: () => Date;
  /** The bylaw PDFs to collect (defaults to 150-51 + 450-02). */
  readonly pdfs?: ReadonlyArray<{ name: string; title: string }>;
}

/**
 * RECUEIL SourceAdapter for the Valleyfield urbanisme-bylaw source.
 */
export class ReglementsUrbanismeValleyfieldAdapter implements SourceAdapter {
  readonly kind: SourceKind = "reglement";
  readonly city = REGLEMENTS_URBANISME_CITY;
  readonly version = REGLEMENTS_URBANISME_ADAPTER_VERSION;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly pdfToTextTimeoutMs: number;
  private readonly now: () => Date;
  private readonly pdfs: ReadonlyArray<{ name: string; title: string }>;
  /** Lazily built per-fetch so the URL is bound for typed errors. */
  private readonly pdfToTextOverride: PdfToText | undefined;

  constructor(options: ReglementsUrbanismeOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.pdfToTextTimeoutMs = options.pdfToTextTimeoutMs ?? PDFTOTEXT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.pdfs = options.pdfs ?? DEFAULT_REGLEMENT_PDFS;
    this.pdfToTextOverride = options.pdfToText;
  }

  get sourceId(): string {
    return REGLEMENTS_URBANISME_SOURCE_ID;
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    const discoveredAt = this.now().toISOString();
    // 1) The public HTML listing of urbanisme bylaws (discoverable index).
    yield {
      sourceKind: this.kind,
      city: this.city,
      url: REGLEMENTS_URBANISME_SOURCE_URL,
      discoveredAt,
      title: "Règlements d'urbanisme — Salaberry-de-Valleyfield (listing)",
      contentType: "text/html",
    };
    // 2) The scoped bylaw PDFs (the parseable legal documents).
    for (const pdf of this.pdfs) {
      yield {
        sourceKind: this.kind,
        city: this.city,
        url: reglementPdfUrl(pdf.name),
        discoveredAt,
        title: pdf.title,
        contentType: "application/pdf",
        metadata: { filename: pdf.name },
      };
    }
  }

  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const isPdf =
      ref.contentType === "application/pdf" || /\.pdf(?:$|\?)/i.test(ref.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(ref.url, {
          signal: controller.signal,
          headers: {
            "user-agent": AVIS_PUBLICS_USER_AGENT,
            accept: isPdf ? "application/pdf" : "text/html",
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
        res.headers.get("content-type") ??
        ref.contentType ??
        (isPdf ? "application/pdf" : "text/html");

      // For a PDF, attach the extracted text so EXPLOITATION reconciles on real
      // legal text (the binary bytes stay the canonical evidence; the text is the
      // parseable projection). A pdftotext failure raises a typed parse error.
      let text: string | undefined;
      if (isPdf) {
        const toText =
          this.pdfToTextOverride ?? pdfToTextViaPoppler(ref.url);
        text = await toText(body, this.pdfToTextTimeoutMs);
      }

      const document: RawDocument = {
        ref,
        sourceKind: this.kind,
        city: this.city,
        url: ref.url,
        fetchedAt,
        contentType,
        body,
        ...(text !== undefined ? { text } : {}),
        httpStatus: res.status,
        sha256: sha256Hex(body),
        provenance: {
          adapterVersion: this.version,
          userAgent: AVIS_PUBLICS_USER_AGENT,
          fetchedViaObscura: false,
          obtentionMode: isPdf ? "download" : "scraping",
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

  /** Parse a fetched règlement PDF's extracted text into a structured record. */
  parseDocument(raw: RawDocument): ReglementDocumentT {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseReglementDocument(text);
  }

  /** Parse the fetched HTML listing into detail-page entries. */
  parseListing(raw: RawDocument): ReglementListingEntryT[] {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseReglementListing(text);
  }
}

/** Factory — keeps construction uniform with the other RECUEIL adapters. */
export function createReglementsUrbanismeValleyfieldAdapter(
  options: ReglementsUrbanismeOptions = {},
): ReglementsUrbanismeValleyfieldAdapter {
  return new ReglementsUrbanismeValleyfieldAdapter(options);
}
