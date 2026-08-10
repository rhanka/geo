/**
 * @sentropic/geo/zonage — pure zonage compute shared by acquisition runners.
 *
 * The I/O layers still own fetching, persistence and publication. This surface
 * only exposes deterministic geometry/code joins that are safe to replay from
 * npm.
 */

export {
  assignLotZones,
  canonicalizeZoneCodeForJoin,
  enrichWithNorms,
  normalizeZoneCode,
  zoneNumberOf,
  type LotZoneAssignment,
  type LotZoneAssignmentMethod,
  type LotZoneJoinOptions,
  type LotZoneNormAssignment,
  type NormsRecord,
  type PolygonalFeature,
  type PolygonalGeometry,
} from "./lotZoneJoin.js";
