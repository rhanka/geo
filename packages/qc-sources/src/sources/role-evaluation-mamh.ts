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
  parseRoleEvaluation,
  type RoleEvaluationT,
} from "./role-evaluation-parser.js";

/**
 * RECUEIL SourceAdapter for the MAMH "rôle d'évaluation foncière" (WP4 Source #3).
 *
 * This makes the rôle a REAL collectible source — not just committed seed bytes.
 * It flows through the SAME recueil → exploitation pipeline as the avis-publics
 * adapters (Valleyfield #49, Beauharnois #53): `list()` discovers the single
 * per-municipality XML resource, `fetch()` does the real public HTTP GET from the
 * Données Québec / MAMH open-data product and returns raw bytes + provenance,
 * `hash()` is the sha256 used for idempotent storage. The adapter NEVER throws on
 * a fetch failure: it raises the shared typed `SourceFetchError` the RECUEIL job
 * turns into a typed outcome.
 *
 * The resource is parameterized by MAMH municipality code (70052 = Salaberry-de-
 * Valleyfield, 70022 = Beauharnois) and rôle year. Bytes are parsed by the REUSED
 * `parseRoleEvaluation` (anti-invention: every field is verbatim from the XML;
 * owner/PII is NEVER surfaced — always `non-disponible`, per Loi 25 / LFM 72).
 *
 * Public, open data: the Données Québec rôle product and the affmunqc.net file
 * host are robots-allowed and require no login, paywall or CAPTCHA. The rôle file
 * for a full municipality can be large; tests run against the committed first-
 * record sample (deterministic, anti-invention). A live network fetch is best-
 * effort only and is NEVER required for the test gate.
 */

/** Stable source-id prefix; the concrete id appends the MAMH code (e.g. -70052). */
export const ROLE_EVALUATION_MAMH_SOURCE_ID_PREFIX = "role-evaluation-mamh";

/** Default rôle year of the committed corpus (2026 dépôt). */
export const ROLE_EVALUATION_MAMH_DEFAULT_YEAR = "2026";

/** Adapter version stamped into RawDocument provenance. */
export const ROLE_EVALUATION_MAMH_ADAPTER_VERSION = "0.1.0";

/**
 * Données Québec dataset landing page (provenance / human-discoverable origin).
 * The per-municipality XML files are distributed by the MAMH file host below.
 */
export const ROLE_EVALUATION_MAMH_DATASET_URL =
  "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec";

/** Public MAMH/affmunqc open-data file host (no auth). */
const ROLE_FILE_HOST = "https://donneesouvertes.affmunqc.net/role";

/** Hard cap on a fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 30000;

/** Build the public per-municipality rôle XML resource URL. */
export function roleResourceUrl(codeMamh: string, year: string): string {
  return `${ROLE_FILE_HOST}/RL${codeMamh}_${year}.xml`;
}

/** Concrete source id for a given MAMH code (matches the seed-ontology ids). */
export function roleSourceId(codeMamh: string): string {
  return `${ROLE_EVALUATION_MAMH_SOURCE_ID_PREFIX}-${codeMamh}`;
}

export interface RoleEvaluationMamhOptions {
  /** MAMH municipality code, e.g. "70052" (Valleyfield) or "70022" (Beauharnois). */
  readonly codeMamh: string;
  /** Rôle year; defaults to the committed corpus year (2026). */
  readonly year?: string;
  /** City slug carried on the RawDocument (per-city graphify project, D1). */
  readonly city?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * RECUEIL SourceAdapter for one municipality's MAMH rôle d'évaluation XML.
 */
export class RoleEvaluationMamhAdapter implements SourceAdapter {
  readonly kind: SourceKind = "role-evaluation";
  readonly city?: string;
  readonly version = ROLE_EVALUATION_MAMH_ADAPTER_VERSION;

  readonly codeMamh: string;
  readonly year: string;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: RoleEvaluationMamhOptions) {
    this.codeMamh = options.codeMamh;
    this.year = options.year ?? ROLE_EVALUATION_MAMH_DEFAULT_YEAR;
    if (options.city !== undefined) this.city = options.city;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** Stable source id (matches the seed-ontology source id for this code). */
  get sourceId(): string {
    return roleSourceId(this.codeMamh);
  }

  /** The public per-municipality rôle XML resource URL. */
  get resourceUrl(): string {
    return roleResourceUrl(this.codeMamh, this.year);
  }

  async *list(opts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (opts.signal?.aborted) return;
    yield {
      sourceKind: this.kind,
      ...(this.city !== undefined ? { city: this.city } : {}),
      url: this.resourceUrl,
      discoveredAt: this.now().toISOString(),
      title: `Rôle d'évaluation foncière MAMH ${this.codeMamh} (${this.year})`,
      contentType: "application/xml",
      metadata: { codeMamh: this.codeMamh, year: this.year },
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
            accept: "application/xml, text/xml",
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
        res.headers.get("content-type") ?? ref.contentType ?? "application/xml";

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

  /** Parse the fetched rôle XML bytes into header + units (EXPLOITATION input). */
  parseRole(raw: RawDocument): RoleEvaluationT {
    const text = raw.text ?? new TextDecoder("utf-8").decode(raw.body);
    return parseRoleEvaluation(text);
  }
}

/** Factory — keeps construction uniform with the avis-publics adapters. */
export function createRoleEvaluationMamhAdapter(
  options: RoleEvaluationMamhOptions,
): RoleEvaluationMamhAdapter {
  return new RoleEvaluationMamhAdapter(options);
}
