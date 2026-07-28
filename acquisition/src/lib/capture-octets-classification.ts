/** Classifie des octets de capture sans jamais inférer leur nature de la clé CAS. */

export const CAPTURE_OCTET_CLASSES = ["GEOMETRIE", "PAGE HTML", "AUTRE"] as const;
export type CaptureOctetClass = (typeof CAPTURE_OCTET_CLASSES)[number];

export interface CaptureOctetClassification {
  classification: CaptureOctetClass;
  /** Motif lisible, stable pour les agrégats du rapport de couverture. */
  detail: string;
  /** Le nombre de features porteuses de coordonnées quand le JSON en contient. */
  coordinate_features: number | null;
}

/** Une capture ne peut porter une attestation de géométrie que dans ce cas. */
export function isGeometryCapture(classification: CaptureOctetClassification): boolean {
  return classification.classification === "GEOMETRIE";
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Une paire (x,y) ou (longitude,latitude), même à l'intérieur de rings/paths. */
function containsCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])) return true;
  return value.some(containsCoordinatePair);
}

/**
 * Accepte les géométries GeoJSON (`coordinates`) et ArcGIS REST
 * (`x`/`y`, `points`, `paths`, `rings`). Les attributs de la feature ne sont
 * volontairement jamais inspectés : une paire de nombres dans un attribut ne
 * suffit pas à transformer une réponse en géométrie.
 */
function geometryHasCoordinates(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isFiniteNumber(value.x) && isFiniteNumber(value.y)) return true;
  return (
    containsCoordinatePair(value.coordinates) ||
    containsCoordinatePair(value.points) ||
    containsCoordinatePair(value.paths) ||
    containsCoordinatePair(value.rings)
  );
}

function jsonFeatureCoordinateCount(value: unknown): number | null {
  if (!isRecord(value) || !Array.isArray(value.features)) return null;
  return value.features.reduce((count, feature) => {
    if (!isRecord(feature)) return count;
    return count + (geometryHasCoordinates(feature.geometry) ? 1 : 0);
  }, 0);
}

function startsLikeHtml(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 4096)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(prefix);
}

function isHtmlContentType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/html";
}

function otherDetail(bytes: Uint8Array, contentType: string | null): string {
  if (bytes.length === 0) return "empty-body";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf-bytes";
  if (contentType) return `non-geometry-content-type:${contentType}`;
  return "non-json-bytes";
}

/**
 * Classe un corps tel qu'il a été lu. Une géométrie exige un JSON réellement
 * parsé, une liste `features` non vide et au moins une géométrie avec des
 * coordonnées. Une extension `.json` ou `.html` ne participe jamais au test.
 */
export function classifyCapturedOctets(bytes: Uint8Array, contentType: string | null): CaptureOctetClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    if (startsLikeHtml(bytes) || isHtmlContentType(contentType)) {
      return { classification: "PAGE HTML", detail: startsLikeHtml(bytes) ? "html-document" : "text-html-content-type", coordinate_features: null };
    }
    return { classification: "AUTRE", detail: otherDetail(bytes, contentType), coordinate_features: null };
  }

  const coordinateFeatures = jsonFeatureCoordinateCount(parsed);
  if (coordinateFeatures !== null && coordinateFeatures > 0) {
    return { classification: "GEOMETRIE", detail: "json-features-with-coordinates", coordinate_features: coordinateFeatures };
  }
  if (coordinateFeatures === 0) {
    return { classification: "AUTRE", detail: "json-features-without-coordinates", coordinate_features: 0 };
  }
  return { classification: "AUTRE", detail: "json-without-features", coordinate_features: null };
}
