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
  AVIS_PUBLICS_SOURCE_URL,
  parseAvisPublics,
  type AvisPublicItemT,
} from "./avis-publics-parser.js";

/** Stable source id used for the RECUEIL endpoint and storage keys. */
export const AVIS_PUBLICS_SOURCE_ID = "avis-publics-valleyfield";
export const AVIS_PUBLICS_CITY = "salaberry-de-valleyfield";
export const AVIS_PUBLICS_ADAPTER_VERSION = "0.1.0";

/** Honest, identifiable user-agent per rules/MASTER.md Scraping Policy. */
export const AVIS_PUBLICS_USER_AGENT =
  "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)";

/** Hard cap on a fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15000;

/** Typed adapter failure — returned, never thrown (patron avis-publics). */
export type SourceErrorKind = "timeout" | "network" | "http" | "parse";

export class SourceFetchError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    readonly detail: string,
    readonly url: string,
  ) {
    super(`[${kind}] ${detail}`);
    this.name = "SourceFetchError";
  }
}

/** Minimal fetch signature so the adapter is testable without globals. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

interface AdapterOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * RECUEIL SourceAdapter for the Valleyfield avis-publics index (Tier A1).
 *
 * `list()` discovers the single index page (the parseable artifact carrying all
 * current notices). `fetch()` performs the real HTTP GET and returns the raw
 * bytes + provenance. `hash()` is the sha256 used for idempotent storage. The
 * adapter NEVER throws on a fetch failure: it raises a typed `SourceFetchError`
 * that the RECUEIL job converts into a typed outcome.
 */
export class AvisPublicsValleyfieldAdapter implements SourceAdapter {
  readonly kind: SourceKind = "avis-publics";
  readonly city = AVIS_PUBLICS_CITY;
  readonly version = AVIS_PUBLICS_ADAPTER_VERSION;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: AdapterOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    yield {
      sourceKind: this.kind,
      city: this.city,
      url: AVIS_PUBLICS_SOURCE_URL,
      discoveredAt: this.now().toISOString(),
      title: "Avis publics — Salaberry-de-Valleyfield (index)",
      contentType: "text/html",
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
          headers: { "user-agent": AVIS_PUBLICS_USER_AGENT, accept: "text/html" },
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
          userAgent: AVIS_PUBLICS_USER_AGENT,
          fetchedViaObscura: false,
          obtentionMode: "scraping",
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

  /** Parse the fetched index bytes into structured notices (EXPLOITATION input). */
  parseItems(raw: RawDocument): AvisPublicItemT[] {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseAvisPublics(text);
  }
}

/** Factory — keeps construction uniform with future adapters. */
export function createAvisPublicsValleyfieldAdapter(
  options: AdapterOptions = {},
): AvisPublicsValleyfieldAdapter {
  return new AvisPublicsValleyfieldAdapter(options);
}
