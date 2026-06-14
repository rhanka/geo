/**
 * Pure parser for the terrAPI / Adresses Québec address FeatureCollection — the
 * JSON returned by the MERN/MSP territorial REST API (terrAPI) when listing the
 * civic addresses that intersect a municipality:
 *
 *   GET https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/<code>/adresses
 *
 * Reproduced faithfully (ADR-0013, P-immo Lot 2) from radar-immobilier's
 * `adresses-quebec-parser.ts`. The REAL terrAPI sample carries, per `Feature`,
 * only these properties:
 *
 *   properties.code     Adresses Québec provincial address key (province-wide id)
 *   properties.nom       full municipal address label, verbatim
 *                        (e.g. "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5")
 *   properties.nbUnite   number of dwelling units at the address (string)
 *
 * ANTI-INVENTION / HONESTY: the committed terrAPI samples were fetched with
 * `geometry=0`, so a Feature carries NO `geometry` and NO lot number. This parser
 * therefore NEVER yields coordinates and NEVER yields a lot. A property absent
 * from the bytes becomes `null` (count) or causes the feature to be skipped (no
 * value is ever fabricated).
 *
 * ANTI-PII (Loi 25): civic addresses are PUBLIC open data. No owner / person name
 * is present in this product and none is ever derived. The parser is
 * dependency-free (JSON.parse only — geo-core carries no Zod dependency).
 */

/** One terrAPI civic address — the clean public Address type (geo-core friendly). */
export interface QcCivicAddress {
  /** Adresses Québec provincial key (`properties.code`), province-wide id. */
  readonly code: string;
  /** Full municipal address label (`properties.nom`), verbatim. */
  readonly nom: string;
  /** Dwelling-unit count (`properties.nbUnite`); `null` when absent/unparseable. */
  readonly nbUnite: number | null;
}

/** The parsed result: the typed civic addresses extracted from one municipality. */
export interface QcCivicAddresses {
  readonly adresses: readonly QcCivicAddress[];
}

/** Parse a non-negative integer count; `null` when absent/unparseable (anti-invention). */
function toCount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

interface RawFeature {
  type?: unknown;
  properties?: {
    code?: unknown;
    nom?: unknown;
    nbUnite?: unknown;
  };
}

interface RawFeatureCollection {
  type?: unknown;
  features?: unknown;
}

/**
 * Parse a terrAPI `adresses` FeatureCollection JSON string into typed civic
 * addresses. A feature with no usable `code`/`nom` is skipped (never invented).
 * Non-JSON, or a non-array `features`, yields an empty list rather than throwing.
 */
export function parseQcCivicAddresses(json: string): QcCivicAddresses {
  let parsed: RawFeatureCollection;
  try {
    parsed = JSON.parse(json) as RawFeatureCollection;
  } catch {
    return { adresses: [] };
  }

  const features: unknown[] = Array.isArray(parsed.features) ? parsed.features : [];
  const adresses: QcCivicAddress[] = [];
  for (const f of features as RawFeature[]) {
    const props = f?.properties;
    if (!props) continue;
    const code = typeof props.code === "string" ? props.code.trim() : "";
    const nom = typeof props.nom === "string" ? props.nom.trim() : "";
    if (!code || !nom) continue;
    adresses.push({ code, nom, nbUnite: toCount(props.nbUnite) });
  }

  return { adresses };
}
