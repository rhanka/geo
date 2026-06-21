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
  parseAdressesQuebec,
  type AdressesQuebecT,
} from "./adresses-quebec-parser.js";

/**
 * RECUEIL SourceAdapter for the terrAPI / Adresses Québec open-data product
 * (WP4 Source #4).
 *
 * This makes Adresses Québec a REAL collectible source — not just committed seed
 * bytes. It flows through the SAME recueil → exploitation pipeline as the avis
 * (#49/#53) and rôle (#54) adapters: `list()` discovers the single per-
 * municipality address resource, `fetch()` does the real public HTTP GET from the
 * MERN/MSP territorial REST API (terrAPI) and returns raw bytes + provenance,
 * `hash()` is the sha256 used for idempotent storage. The adapter NEVER throws on
 * a fetch failure: it raises the shared typed `SourceFetchError` the RECUEIL job
 * turns into a typed outcome.
 *
 * The resource is parameterized by municipality code (70052 = Salaberry-de-
 * Valleyfield, 70022 = Beauharnois). terrAPI returns the addresses intersecting a
 * municipality as a GeoJSON FeatureCollection; the bytes are parsed by the REUSED
 * `parseAdressesQuebec` (anti-invention: every field is verbatim from the JSON).
 *
 * Public, open data: the terrAPI / Adresses Québec product is robots-allowed and
 * requires no login, paywall or CAPTCHA. The committed sample was fetched with
 * `geometry=0`, so it carries NO geometry coordinates and NO lot numbers — the
 * resulting Adresse has a NULL geom (`geomSource: none`) and NO cross-source lot
 * link is ever fabricated. A full municipality's address list is large; tests run
 * against the committed first-records sample (deterministic, anti-invention). A
 * live network fetch is best-effort only and is NEVER required for the test gate.
 */

/** Stable source-id prefix; the concrete id appends the MAMH code (e.g. -70052). */
export const ADRESSES_QUEBEC_SOURCE_ID_PREFIX = "adresses-quebec";

/** Adapter version stamped into RawDocument provenance. */
export const ADRESSES_QUEBEC_ADAPTER_VERSION = "0.1.0";

/**
 * Données Québec dataset landing page (provenance / human-discoverable origin).
 * The per-municipality address lists are served by the terrAPI host below.
 */
export const ADRESSES_QUEBEC_DATASET_URL =
  "https://www.donneesquebec.ca/recherche/dataset/adresses-quebec";

/** Public MERN/MSP terrAPI host (no auth, open data). */
const TERRAPI_HOST = "https://geoegl.msp.gouv.qc.ca/apis/terrapi";

/**
 * Default geometry mode. `geometry=0` returns address attributes only (the shape
 * of the committed sample): code / nom / nbUnite, NO coordinates. Anti-invention:
 * radar never fabricates a polygon it did not obtain, so the seed corpus uses the
 * attribute-only response and the Adresse geom stays null.
 */
export const ADRESSES_QUEBEC_DEFAULT_GEOMETRY = "0";

/** Hard cap on a fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 30000;

/** Build the public per-municipality terrAPI `adresses` resource URL. */
export function adressesResourceUrl(
  codeMamh: string,
  geometry: string = ADRESSES_QUEBEC_DEFAULT_GEOMETRY,
): string {
  return `${TERRAPI_HOST}/municipalites/${codeMamh}/adresses?geometry=${geometry}`;
}

/** Concrete source id for a given MAMH code (matches the seed-ontology ids). */
export function adressesSourceId(codeMamh: string): string {
  return `${ADRESSES_QUEBEC_SOURCE_ID_PREFIX}-${codeMamh}`;
}

export interface AdressesQuebecOptions {
  /** Municipality code, e.g. "70052" (Valleyfield) or "70022" (Beauharnois). */
  readonly codeMamh: string;
  /** terrAPI geometry mode; defaults to "0" (attributes only, no coordinates). */
  readonly geometry?: string;
  /** City slug carried on the RawDocument (per-city graphify project, D1). */
  readonly city?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * RECUEIL SourceAdapter for one municipality's terrAPI / Adresses Québec list.
 */
export class AdressesQuebecAdapter implements SourceAdapter {
  readonly kind: SourceKind = "adresses-quebec";
  readonly city?: string;
  readonly version = ADRESSES_QUEBEC_ADAPTER_VERSION;

  readonly codeMamh: string;
  readonly geometry: string;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: AdressesQuebecOptions) {
    this.codeMamh = options.codeMamh;
    this.geometry = options.geometry ?? ADRESSES_QUEBEC_DEFAULT_GEOMETRY;
    if (options.city !== undefined) this.city = options.city;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** Stable source id (matches the seed-ontology source id for this code). */
  get sourceId(): string {
    return adressesSourceId(this.codeMamh);
  }

  /** The public per-municipality terrAPI address resource URL. */
  get resourceUrl(): string {
    return adressesResourceUrl(this.codeMamh, this.geometry);
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    yield {
      sourceKind: this.kind,
      ...(this.city !== undefined ? { city: this.city } : {}),
      url: this.resourceUrl,
      discoveredAt: this.now().toISOString(),
      title: `Adresses Québec (terrAPI) — municipalité ${this.codeMamh}`,
      contentType: "application/json",
      metadata: { codeMamh: this.codeMamh, geometry: this.geometry },
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
            accept: "application/json, application/geo+json",
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
        res.headers.get("content-type") ?? ref.contentType ?? "application/json";

      const document: RawDocument = {
        ref,
        sourceKind: this.kind,
        ...(this.city !== undefined ? { city: this.city } : {}),
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

  /** Parse the fetched terrAPI JSON bytes into typed addresses (EXPLOITATION input). */
  parseAdresses(raw: RawDocument): AdressesQuebecT {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseAdressesQuebec(text);
  }
}

/** Factory — keeps construction uniform with the other RECUEIL adapters. */
export function createAdressesQuebecAdapter(
  options: AdressesQuebecOptions,
): AdressesQuebecAdapter {
  return new AdressesQuebecAdapter(options);
}
