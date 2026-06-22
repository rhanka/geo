import { z } from "zod";

/**
 * Pure parser for the terrAPI / Adresses Québec address FeatureCollection — the
 * JSON returned by the MERN/MSP territorial REST API (terrAPI) when listing the
 * addresses that intersect a municipality:
 *
 *   GET https://geoegl.msp.gouv.qc.ca/apis/terrapi/municipalites/<code>/adresses
 *
 * The REAL committed samples (`_spikes/adresses-quebec-igo-geocoder/samples`)
 * carry, per `Feature`, only these properties:
 *
 *   properties.code     Adresses Québec provincial address key (province-wide id)
 *   properties.nom       full municipal address label, verbatim
 *                        (e.g. "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5")
 *   properties.nbUnite   number of dwelling units at the address (string)
 *
 * HONESTY / anti-invention (rules cardinales §0.2): the committed terrAPI sample
 * was fetched with `geometry=0`, so a Feature carries NO `geometry` and NO lot
 * number. This parser therefore NEVER yields coordinates and NEVER yields a lot:
 * `geom` stays null downstream and no cross-source Lot candidate is fabricated. A
 * property absent from the bytes becomes `null` (number) or is dropped (no value
 * is ever invented). No owner / PII is present in this product (Loi 25 safe).
 *
 * The parser is dependency-free (JSON.parse + Zod), mirroring the regex-based
 * `role-evaluation-parser` / `avis-publics-parser`: terrAPI is a flat, stable
 * GeoJSON-ish shape.
 */

/** One terrAPI address feature — the real fields radar models as an Adresse. */
export const AdresseQuebec = z.object({
  /** Adresses Québec provincial key (`properties.code`), province-wide id. */
  code: z.string().min(1),
  /** Full municipal address label (`properties.nom`), verbatim. */
  nom: z.string().min(1),
  /** Dwelling-unit count (`properties.nbUnite`); null when absent. */
  nbUnite: z.number().int().nonnegative().nullable().default(null),
});
export type AdresseQuebecT = z.infer<typeof AdresseQuebec>;

export const AdressesQuebec = z.object({
  adresses: z.array(AdresseQuebec).default([]),
});
export type AdressesQuebecT = z.infer<typeof AdressesQuebec>;

/** Parse an integer count; null when absent/unparseable (anti-invention). */
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
 * Parse a terrAPI `adresses` FeatureCollection JSON string into typed addresses.
 * A feature with no usable `code`/`nom` is skipped (never invented). Non-JSON or
 * a non-array `features` yields an empty list rather than throwing.
 */
export function parseAdressesQuebec(json: string): AdressesQuebecT {
  let parsed: RawFeatureCollection;
  try {
    parsed = JSON.parse(json) as RawFeatureCollection;
  } catch {
    return AdressesQuebec.parse({ adresses: [] });
  }

  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const adresses: AdresseQuebecT[] = [];
  for (const f of features as RawFeature[]) {
    const props = f?.properties;
    if (!props) continue;
    const code = typeof props.code === "string" ? props.code.trim() : "";
    const nom = typeof props.nom === "string" ? props.nom.trim() : "";
    if (!code || !nom) continue;
    adresses.push(
      AdresseQuebec.parse({
        code,
        nom,
        nbUnite: toCount(props.nbUnite),
      }),
    );
  }

  return AdressesQuebec.parse({ adresses });
}
