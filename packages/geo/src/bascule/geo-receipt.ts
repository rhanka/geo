/**
 * geo.json — the geo tenant's per-cycle bascule receipt, written to
 * `sets/<cycleId>/geo.json` (one object per tenant, no write race). immo reads
 * every tenant receipt for the join-verify and cycle status transitions.
 *
 * Reflects the ratified asymmetry (amendment C): PostGIS is re-derivable and NOT
 * restored to preprod (`pg` may be null); the IRREPLACEABLE S3 set is proven by
 * sha256 inventory reconciliation; the SERVED layer (`normalized/`) is proven by
 * verify-through-API + a served-ids set diff.
 */
export interface GeoReceiptPgLeg {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}

export interface GeoReceiptInput {
  readonly cycleId: string;
  /** T0 (ISO 8601) copied from the immo cycle head, when passed through. */
  readonly snapshotAt?: string;
  /** Coherence watermark shared across the cycle (= the shared cycle id / coherence_id). */
  readonly watermark: string;
  /** ISO timestamp stamped on each leg. */
  readonly at: string;
  /** DR-only PostGIS dump, or null when skipped (re-derivable, no preprod target). */
  readonly pg?: GeoReceiptPgLeg | null;
  readonly irremplacable: {
    readonly inventoryKey: string;
    readonly sha256set: string;
    readonly count: number;
  };
  readonly servi: {
    readonly prefix: string;
    readonly servedCount: number;
    readonly setHash: string;
    readonly servedIdsKey: string;
    /** sha256 of the sorted, newline-terminated served-ids set. */
    readonly sha256: string;
  };
}

export interface GeoReceipt {
  readonly tenant: "geo";
  readonly cycleId: string;
  readonly snapshotAt?: string;
  readonly watermark: string;
  readonly legs: {
    readonly pg: null | (GeoReceiptPgLeg & { readonly at: string });
    readonly s3_irremplacable: {
      readonly inventory_key: string;
      readonly sha256set: string;
      readonly count: number;
      readonly at: string;
    };
    readonly s3_servi: {
      readonly prefix: string;
      readonly served_count: number;
      readonly set_hash: string;
      readonly served_ids_key: string;
      readonly sha256: string;
      readonly at: string;
    };
  };
}

function req(value: string | undefined, field: string): string {
  if (!value) throw new Error(`geo-receipt: champ requis manquant: ${field}`);
  return value;
}

/**
 * Assemble + validate the geo receipt, fail-closed: a missing required field
 * throws rather than emitting a receipt immo cannot join against. Timestamps are
 * stamped per leg from `at`.
 */
export function buildGeoReceipt(input: GeoReceiptInput): GeoReceipt {
  const at = req(input.at, "at");
  const irr = input.irremplacable;
  const servi = input.servi;
  if (!Number.isInteger(irr?.count) || irr.count < 0) throw new Error("geo-receipt: irremplacable.count invalide");
  if (!Number.isInteger(servi?.servedCount) || servi.servedCount < 0) {
    throw new Error("geo-receipt: servi.servedCount invalide");
  }
  const pg = input.pg
    ? { key: req(input.pg.key, "pg.key"), sha256: req(input.pg.sha256, "pg.sha256"), size: input.pg.size, at }
    : null;
  return {
    tenant: "geo",
    cycleId: req(input.cycleId, "cycleId"),
    ...(input.snapshotAt ? { snapshotAt: input.snapshotAt } : {}),
    watermark: req(input.watermark, "watermark"),
    legs: {
      pg,
      s3_irremplacable: {
        inventory_key: req(irr?.inventoryKey, "irremplacable.inventoryKey"),
        sha256set: req(irr?.sha256set, "irremplacable.sha256set"),
        count: irr.count,
        at,
      },
      s3_servi: {
        prefix: req(servi?.prefix, "servi.prefix"),
        served_count: servi.servedCount,
        set_hash: req(servi?.setHash, "servi.setHash"),
        served_ids_key: req(servi?.servedIdsKey, "servi.servedIdsKey"),
        sha256: req(servi?.sha256, "servi.sha256"),
        at,
      },
    },
  };
}

/** Deterministic JSON for `geo.json` (2-space, stable key order from the builder). */
export function serializeGeoReceipt(receipt: GeoReceipt): string {
  return JSON.stringify(receipt, null, 2) + "\n";
}
