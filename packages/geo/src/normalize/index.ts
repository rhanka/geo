/**
 * @sentropic/geo/normalize — the generic, declarative normalizer (ADR-0017).
 *
 * Exposes {@link makeFieldMapNormalizer}: a {@link FieldMap}-driven
 * {@link Normalizer} factory that normalizes most GeoJSON sources without
 * bespoke code. Bespoke recipes (kept verbatim during packages-v2) live in the
 * continent source libraries and are referenced by `recipe: "<id>"`.
 */

export { makeFieldMapNormalizer } from "./field-map.js";
