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
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
  parseAvisPublics,
  type AvisPublicItemT,
} from "./avis-publics-parser.js";
import {
  AVIS_PUBLICS_USER_AGENT,
  SourceFetchError,
  type FetchLike,
} from "./avis-publics-valleyfield.js";

/**
 * RECUEIL SourceAdapter for the Beauharnois avis-publics index (WP4 Source #2).
 *
 * Beauharnois is the SECOND pilot city and the FIRST on a different CMS: its
 * site runs WordPress (block editor) where Valleyfield runs Craft. The adapter
 * mirrors the Valleyfield one exactly — `list()` discovers the single index
 * page, `fetch()` does the real HTTP GET and returns raw bytes + provenance,
 * `hash()` is the sha256 for idempotent storage — and NEVER throws on a fetch
 * failure (it raises a typed `SourceFetchError`, shared with the Valleyfield
 * adapter). Only the base URL and the CMS-specific parse differ; the shared
 * `parseAvisPublics` dispatches on markup (`<details>` blocks here), so there is
 * ONE parser for both cities (No Legacy Fallback).
 *
 * Public, open data: the page and `/wp-content/uploads/` are robots-allowed
 * (only `/wp-admin/` is disallowed) — no login, paywall or CAPTCHA.
 */

/** Stable source id used for the RECUEIL endpoint and storage keys. */
export const AVIS_PUBLICS_BEAUHARNOIS_SOURCE_ID = "avis-publics-beauharnois";
export const AVIS_PUBLICS_BEAUHARNOIS_CITY = "beauharnois";
export const AVIS_PUBLICS_BEAUHARNOIS_ADAPTER_VERSION = "0.1.0";

/** Hard cap on a fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15000;

interface AdapterOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

export class AvisPublicsBeauharnoisAdapter implements SourceAdapter {
  readonly kind: SourceKind = "avis-publics";
  readonly city = AVIS_PUBLICS_BEAUHARNOIS_CITY;
  readonly version = AVIS_PUBLICS_BEAUHARNOIS_ADAPTER_VERSION;

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
      url: AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
      discoveredAt: this.now().toISOString(),
      title: "Avis publics — Beauharnois (index)",
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

/** Factory — keeps construction uniform with the Valleyfield adapter. */
export function createAvisPublicsBeauharnoisAdapter(
  options: AdapterOptions = {},
): AvisPublicsBeauharnoisAdapter {
  return new AvisPublicsBeauharnoisAdapter(options);
}
