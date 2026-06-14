/**
 * terrAPI / Adresses Québec address adapter — an injectable-`fetch` async
 * function that fetches the civic addresses intersecting a Québec municipality
 * from the public MERN/MSP territorial REST API (terrAPI), plus a matching
 * {@link SourceManifest}.
 *
 * Reproduced faithfully (ADR-0013, P-immo Lot 2) from radar-immobilier's
 * `adresses-quebec.ts`. The REAL terrAPI endpoint, host and params are verbatim:
 *
 *   GET https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/<code>/adresses?geometry=0
 *
 * `geometry=0` returns address attributes only (code / nom / nbUnite) — NO
 * coordinates, NO lot numbers. ANTI-INVENTION: this adapter never fabricates a
 * geometry it did not obtain. ANTI-PII (Loi 25): civic addresses are public open
 * data; no owner / person name is present or derived.
 *
 * The `fetch` implementation is injectable (defaults to Node's global `fetch`)
 * so callers and tests stay fully hermetic.
 */

import { sha256Hex } from "@sentropic/geo";
import type { SourceManifest } from "@sentropic/geo-core";

import { parseQcCivicAddresses, type QcCivicAddresses } from "./parser.js";

/** Globally unique source id for the terrAPI / Adresses Québec source. */
export const ADRESSES_SOURCE_ID = "ca-qc/adresses-quebec";

/** Stable source-id prefix used for the per-municipality concrete id. */
export const ADRESSES_QUEBEC_SOURCE_ID_PREFIX = "adresses-quebec";

/** Adapter version stamped into fetch provenance. */
export const ADRESSES_QUEBEC_ADAPTER_VERSION = "0.1.0";

/**
 * Données Québec dataset landing page (human-discoverable origin). The
 * per-municipality address lists are served by the terrAPI host below.
 */
export const ADRESSES_QUEBEC_DATASET_URL =
  "https://www.donneesquebec.ca/recherche/dataset/adresses-quebec";

/** Public MERN/MSP terrAPI host (no auth, open data). Verbatim from immo. */
export const TERRAPI_HOST = "https://geoegl.msp.gouv.qc.ca/apis/terrapi";

/**
 * Default geometry mode. `geometry=0` returns address attributes only (the shape
 * of immo's committed sample): code / nom / nbUnite, NO coordinates. The geo
 * adapter keeps the attribute-only response so no polygon is ever fabricated.
 */
export const ADRESSES_QUEBEC_DEFAULT_GEOMETRY = "0";

/** Hard cap on a fetch so a slow/hanging source never blocks the caller. */
const FETCH_TIMEOUT_MS = 30_000;

/** Build the public per-municipality terrAPI `adresses` resource URL. */
export function adressesResourceUrl(
  codeMamh: string,
  geometry: string = ADRESSES_QUEBEC_DEFAULT_GEOMETRY,
): string {
  return `${TERRAPI_HOST}/municipalites/${codeMamh}/adresses?geometry=${geometry}`;
}

/** Concrete per-municipality source id (matches immo's seed-ontology ids). */
export function adressesSourceId(codeMamh: string): string {
  return `${ADRESSES_QUEBEC_SOURCE_ID_PREFIX}-${codeMamh}`;
}

/**
 * Declarative {@link SourceManifest} for the terrAPI / Adresses Québec product.
 * Open data, CC-BY 4.0, attribution to the Gouvernement du Québec (MERN/MSP).
 * The single dataset is the per-municipality address resource; the concrete URL
 * is parameterized by MAMH code at fetch time via {@link adressesResourceUrl}.
 */
export const adressesManifest: SourceManifest = {
  id: ADRESSES_SOURCE_ID,
  title: "Adresses Québec (terrAPI)",
  description:
    "Adresses civiques du Québec servies par l'API territoriale (terrAPI) du " +
    "MERN/MSP, par municipalité. Données publiques ouvertes (aucun renseignement " +
    "personnel — Loi 25).",
  kind: "postal",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Gouvernement du Québec — MERN / MSP (terrAPI)",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: ADRESSES_QUEBEC_DATASET_URL,
  datasets: [
    {
      id: "qc-adresses",
      title: "Adresses civiques par municipalité (terrAPI)",
      description:
        "Liste des adresses civiques intersectant une municipalité (geometry=0, " +
        "attributs seulement : code / nom / nbUnite).",
      format: "geojson",
      url: `${TERRAPI_HOST}/municipalites/{codeMamh}/adresses?geometry=0`,
      query: { geometry: ADRESSES_QUEBEC_DEFAULT_GEOMETRY },
      updateCadence: "P1M",
      access: "open",
    },
  ],
};

/** Options for {@link fetchQcCivicAddresses}. */
export interface FetchAddressesOptions {
  /** Municipality code, e.g. "70052" (Valleyfield) or "70022" (Beauharnois). */
  readonly codeMamh: string;
  /** terrAPI geometry mode; defaults to "0" (attributes only, no coordinates). */
  readonly geometry?: string;
  /** Injected fetch implementation; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Abort timeout in ms; defaults to 30 000. */
  readonly timeoutMs?: number;
  /** Clock injection (provenance timestamp); defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/** Raw fetch result: the public terrAPI bytes plus provenance. */
export interface FetchAddressesResult {
  /** The terrAPI resource URL that was fetched. */
  readonly url: string;
  /** Concrete per-municipality source id. */
  readonly sourceId: string;
  /** Raw response body (the terrAPI FeatureCollection JSON). */
  readonly body: Uint8Array;
  /** Decode {@link body} as UTF-8 text. */
  text(): string;
  /** SHA-256 of {@link body}, hex-encoded. */
  readonly sha256: string;
  /** Response content-type (or the default `application/json`). */
  readonly contentType: string;
  /** ISO 8601 timestamp of the fetch. */
  readonly fetchedAt: string;
  /** Adapter version stamped for provenance. */
  readonly adapterVersion: string;
}

/**
 * Fetch one municipality's terrAPI / Adresses Québec address list over the real
 * public HTTP endpoint (injectable `fetch`). Returns the raw bytes + provenance;
 * does not parse. Throws a plain `Error` (with a `kind` tag) on a non-2xx
 * response, a network failure, or a timeout — callers turn it into an outcome.
 */
export async function fetchQcCivicAddresses(
  options: FetchAddressesOptions,
): Promise<FetchAddressesResult> {
  const geometry = options.geometry ?? ADRESSES_QUEBEC_DEFAULT_GEOMETRY;
  const url = adressesResourceUrl(options.codeMamh, geometry);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const fetchedAt = now().toISOString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json, application/geo+json" },
      });
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const err = new Error(
        `terrApi fetch ${isAbort ? "timeout" : "network"} error for ${url}: ` +
          (e instanceof Error ? e.message : String(e)),
      );
      (err as Error & { kind: string }).kind = isAbort ? "timeout" : "network";
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`terrApi fetch failed: HTTP ${res.status} for ${url}`);
      (err as Error & { kind: string }).kind = "http";
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const contentType = res.headers.get("content-type") ?? "application/json";

    return {
      url,
      sourceId: adressesSourceId(options.codeMamh),
      body,
      text: () => new TextDecoder("utf-8").decode(body),
      sha256: sha256Hex(body),
      contentType,
      fetchedAt,
      adapterVersion: ADRESSES_QUEBEC_ADAPTER_VERSION,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: fetch one municipality's terrAPI addresses and parse them into
 * the clean public {@link QcCivicAddresses}. Anti-invention / anti-PII: geometry
 * stays absent and no owner is ever derived.
 */
export async function fetchAndParseQcCivicAddresses(
  options: FetchAddressesOptions,
): Promise<QcCivicAddresses> {
  const raw = await fetchQcCivicAddresses(options);
  return parseQcCivicAddresses(raw.text());
}
