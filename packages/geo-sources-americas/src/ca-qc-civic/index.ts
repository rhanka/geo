/**
 * @sentropic/geo-source-ca-qc-civic — Québec civic sources, capitalized from
 * radar-immobilier (ADR-0013, P-immo Lot 2).
 *
 * Two public-data sources:
 *  - **adresses/** — terrAPI / Adresses Québec civic-address adapter (injectable
 *    `fetch`) + a pure parser to a clean public Address type. Civic addresses are
 *    PUBLIC open data (no PII — Loi 25).
 *  - **role/** — MAMH rôle d'évaluation foncière **FETCHER ONLY**: downloads the
 *    raw public XML per municipality. The parser and ALL PII exploitation (RL
 *    field extraction, Loi 25 handling) STAY with the consumer (radar-immobilier)
 *    per the separation study. No parser is published here by design.
 */

export const VERSION = "0.1.0";

// ── Adresses Québec (terrAPI) — civic address adapter + parser ──────────────
export {
  ADRESSES_SOURCE_ID,
  ADRESSES_QUEBEC_SOURCE_ID_PREFIX,
  ADRESSES_QUEBEC_ADAPTER_VERSION,
  ADRESSES_QUEBEC_DATASET_URL,
  ADRESSES_QUEBEC_DEFAULT_GEOMETRY,
  TERRAPI_HOST,
  adressesResourceUrl,
  adressesSourceId,
  adressesManifest,
  fetchQcCivicAddresses,
  fetchAndParseQcCivicAddresses,
  type FetchAddressesOptions,
  type FetchAddressesResult,
} from "./adresses/adapter.js";

export {
  parseQcCivicAddresses,
  type QcCivicAddress,
  type QcCivicAddresses,
} from "./adresses/parser.js";

// ── MAMH rôle d'évaluation foncière — FETCHER ONLY (no parser, anti-PII) ─────
export {
  ROLE_SOURCE_ID,
  ROLE_EVALUATION_MAMH_SOURCE_ID_PREFIX,
  ROLE_EVALUATION_MAMH_DEFAULT_YEAR,
  ROLE_EVALUATION_MAMH_FETCHER_VERSION,
  ROLE_EVALUATION_MAMH_DATASET_URL,
  ROLE_FILE_HOST,
  roleResourceUrl,
  roleSourceId,
  roleManifest,
  fetchRoleXml,
  type FetchRoleXmlOptions,
  type FetchRoleXmlResult,
} from "./role/fetcher.js";
