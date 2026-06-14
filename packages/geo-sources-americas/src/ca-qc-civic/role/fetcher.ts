/**
 * MAMH « rôle d'évaluation foncière » FETCHER — FETCHER ONLY.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ANTI-PII / SEPARATION BOUNDARY (Loi 25 du Québec, étude /tmp/etude-geo)  │
 * │                                                                         │
 * │ This module downloads the RAW public rôle XML for a municipality and    │
 * │ returns it as bytes. It DOES NOT, and MUST NOT, parse the XML or extract │
 * │ any RL field (RL0101 owner names, RL0103 lots, RL0104 matricule, …).    │
 * │                                                                         │
 * │ The rôle XML can carry owner / person-identifying fields. Per the       │
 * │ separation study, geo publishes ONLY the fetcher; the parser and ALL    │
 * │ PII exploitation (RL0101/RL0302 parsing, Loi 25 filtering, joins) STAY  │
 * │ with the consumer (radar-immobilier). Do NOT add a parser here.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The REAL public endpoint is reproduced verbatim (ADR-0013, P-immo Lot 2) from
 * radar-immobilier's `role-evaluation-mamh.ts`:
 *
 *   GET https://donneesouvertes.affmunqc.net/role/RL<codeMamh>_<year>.xml
 *
 * Public, open data: the Données Québec rôle product and the affmunqc.net file
 * host require no login, paywall or CAPTCHA. The `fetch` implementation is
 * injectable (defaults to Node's global `fetch`) so tests stay hermetic.
 */

import { sha256Hex } from "@sentropic/geo";
import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the MAMH rôle source. */
export const ROLE_SOURCE_ID = "ca-qc/role-evaluation-mamh";

/** Stable source-id prefix used for the per-municipality concrete id. */
export const ROLE_EVALUATION_MAMH_SOURCE_ID_PREFIX = "role-evaluation-mamh";

/** Default rôle year (2026 dépôt — matches immo's committed corpus). */
export const ROLE_EVALUATION_MAMH_DEFAULT_YEAR = "2026";

/** Fetcher version stamped into provenance. */
export const ROLE_EVALUATION_MAMH_FETCHER_VERSION = "0.1.0";

/**
 * Données Québec dataset landing page (human-discoverable origin). The
 * per-municipality XML files are distributed by the MAMH/affmunqc file host.
 */
export const ROLE_EVALUATION_MAMH_DATASET_URL =
  "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec";

/** Public MAMH/affmunqc open-data file host (no auth). Verbatim from immo. */
export const ROLE_FILE_HOST = "https://donneesouvertes.affmunqc.net/role";

/** Hard cap on a fetch so a slow/hanging source never blocks the caller. */
const FETCH_TIMEOUT_MS = 30_000;

/** Build the public per-municipality rôle XML resource URL. */
export function roleResourceUrl(
  codeMamh: string,
  year: string = ROLE_EVALUATION_MAMH_DEFAULT_YEAR,
): string {
  return `${ROLE_FILE_HOST}/RL${codeMamh}_${year}.xml`;
}

/** Concrete per-municipality source id (matches immo's seed-ontology ids). */
export function roleSourceId(codeMamh: string): string {
  return `${ROLE_EVALUATION_MAMH_SOURCE_ID_PREFIX}-${codeMamh}`;
}

/**
 * Declarative {@link SourceManifest} for the MAMH rôle d'évaluation foncière.
 * Open data, CC-BY 4.0, attribution to the MAMH. The single dataset is the
 * per-municipality XML file; the concrete URL is parameterized by MAMH code and
 * year at fetch time via {@link roleResourceUrl}.
 *
 * NOTE: the manifest describes the SOURCE only. There is deliberately no
 * normalizer / parser wired here — geo publishes the fetcher; parsing stays with
 * the consumer (anti-PII boundary above).
 */
export const roleManifest: SourceManifest = {
  id: ROLE_SOURCE_ID,
  title: "Rôle d'évaluation foncière du Québec (MAMH)",
  description:
    "Fichier XML public du rôle d'évaluation foncière par municipalité, distribué " +
    "par le MAMH (Données Québec). FETCHER SEULEMENT : geo télécharge le XML brut ; " +
    "l'analyse et tout traitement de renseignements personnels (Loi 25) restent côté " +
    "consommateur (radar-immobilier).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Gouvernement du Québec — Ministère des Affaires municipales et de l'Habitation (MAMH)",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: ROLE_EVALUATION_MAMH_DATASET_URL,
  datasets: [
    {
      id: "qc-role-evaluation",
      title: "Rôle d'évaluation foncière par municipalité (XML)",
      description:
        "Fichier XML brut du rôle d'évaluation foncière d'une municipalité " +
        "(RL<codeMamh>_<année>.xml). Bytes publics non analysés.",
      // geo-core has no dedicated "xml" DatasetFormat; the raw payload is served
      // as a file and consumed downstream. "csv" is the closest passthrough kind
      // but would mislead — the role file is opaque XML, so we keep it explicit
      // in the description and use the manifest as a provenance record only.
      format: "wfs",
      url: `${ROLE_FILE_HOST}/RL{codeMamh}_{year}.xml`,
      updateCadence: "P1Y",
      access: "open",
    },
  ],
};

/** Options for {@link fetchRoleXml}. */
export interface FetchRoleXmlOptions {
  /** Rôle year; defaults to {@link ROLE_EVALUATION_MAMH_DEFAULT_YEAR} (2026). */
  readonly year?: string;
  /** Injected fetch implementation; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Abort timeout in ms; defaults to 30 000. */
  readonly timeoutMs?: number;
  /** Clock injection (provenance timestamp); defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/** Raw fetch result: the public rôle XML bytes plus provenance. NO parsed fields. */
export interface FetchRoleXmlResult {
  /** The rôle XML resource URL that was fetched. */
  readonly url: string;
  /** Concrete per-municipality source id. */
  readonly sourceId: string;
  /** Raw, UNPARSED rôle XML body. */
  readonly body: Uint8Array;
  /** Decode {@link body} as UTF-8 text (still RAW XML — caller parses it). */
  text(): string;
  /** SHA-256 of {@link body}, hex-encoded. */
  readonly sha256: string;
  /** Response content-type (or the default `application/xml`). */
  readonly contentType: string;
  /** ISO 8601 timestamp of the fetch. */
  readonly fetchedAt: string;
  /** Fetcher version stamped for provenance. */
  readonly fetcherVersion: string;
}

/**
 * Fetch one municipality's MAMH rôle XML over the real public HTTP endpoint
 * (injectable `fetch`). Returns the RAW bytes + provenance.
 *
 * FETCHER ONLY: this never parses the XML and never surfaces any RL field. The
 * returned `body`/`text()` is the verbatim public payload — the consumer
 * (radar-immobilier) owns parsing + Loi 25 PII handling.
 *
 * Throws a plain `Error` (with a `kind` tag) on a non-2xx response, a network
 * failure, or a timeout.
 */
export async function fetchRoleXml(
  codeMamh: string,
  options: FetchRoleXmlOptions = {},
): Promise<FetchRoleXmlResult> {
  const year = options.year ?? ROLE_EVALUATION_MAMH_DEFAULT_YEAR;
  const url = roleResourceUrl(codeMamh, year);
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
        headers: { accept: "application/xml, text/xml" },
      });
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const err = new Error(
        `mamh role fetch ${isAbort ? "timeout" : "network"} error for ${url}: ` +
          (e instanceof Error ? e.message : String(e)),
      );
      (err as Error & { kind: string }).kind = isAbort ? "timeout" : "network";
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`mamh role fetch failed: HTTP ${res.status} for ${url}`);
      (err as Error & { kind: string }).kind = "http";
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const contentType = res.headers.get("content-type") ?? "application/xml";

    return {
      url,
      sourceId: roleSourceId(codeMamh),
      body,
      text: () => new TextDecoder("utf-8").decode(body),
      sha256: sha256Hex(body),
      contentType,
      fetchedAt,
      fetcherVersion: ROLE_EVALUATION_MAMH_FETCHER_VERSION,
    };
  } finally {
    clearTimeout(timer);
  }
}
