/**
 * Incremental GeoJSON parsing shared by the file- and store-backed providers.
 *
 * A normalized GeoJSON object can be close to a gigabyte. Parsing it through
 * `TextDecoder` + `JSON.parse` first creates a whole-object string and then a
 * second complete object graph. This scanner keeps only one Feature's bytes at
 * a time, so callers can paginate and write the OGC response as a stream.
 */

import { isFeatureCollection, type CollectionMeta } from "@sentropic/geo-core";

import type { ServedFeature } from "../provider.js";

/** Type guard for a {@link CollectionMeta} (requires a string `datasetId`). */
export function isMeta(value: unknown): value is CollectionMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { datasetId?: unknown }).datasetId === "string"
  );
}

/** Parse JSON text into a {@link CollectionMeta}, or `undefined` if invalid. */
export function parseMeta(raw: string | undefined): CollectionMeta | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return isMeta(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Yield one GeoJSON Feature at a time from a FeatureCollection byte stream.
 * Only the current Feature is concatenated and decoded; all leading and
 * trailing collection bytes remain streamed. The parser handles JSON strings
 * and escaped quotes byte-by-byte, so braces in properties do not affect
 * feature boundaries.
 */
export async function* parseFeatureCollectionStream(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<ServedFeature> {
  let rootDepth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let stringParts: Uint8Array[] = [];
  let keyState: "none" | "features" = "none";
  let expectedValue: "none" | "features" = "none";
  let inFeatures = false;
  let featuresState: "value-or-end" | "value-required" | "comma-or-end" = "value-or-end";
  let featureDepth = 0;
  let featureStart = -1;
  let featureParts: Uint8Array[] = [];

  for await (const chunk of source) {
    for (let index = 0; index < chunk.byteLength; index++) {
      const byte = chunk[index]!;

      if (inFeatures) {
        if (featureDepth === 0) {
          if (featuresState === "comma-or-end") {
            if (isWhitespace(byte)) continue;
            if (byte === COMMA) {
              featuresState = "value-required";
              continue;
            }
            if (byte === CLOSE_ARRAY) return;
            throw new Error("invalid GeoJSON features array separator");
          }
          if (isWhitespace(byte)) continue;
          if (byte === CLOSE_ARRAY && featuresState === "value-or-end") return;
          if (byte !== OPEN_OBJECT) throw new Error("GeoJSON features array contains a non-object value");
          featureDepth = 1;
          featureStart = index;
          featureParts = [];
          inString = false;
          escaped = false;
          continue;
        }

        if (inString) {
          if (escaped) escaped = false;
          else if (byte === BACKSLASH) escaped = true;
          else if (byte === QUOTE) inString = false;
          continue;
        }
        if (byte === QUOTE) {
          inString = true;
          continue;
        }
        if (byte === OPEN_OBJECT) featureDepth++;
        if (byte !== CLOSE_OBJECT) continue;
        featureDepth--;
        if (featureDepth !== 0) continue;

        featureParts.push(chunk.subarray(featureStart, index + 1));
        const raw = decodeParts(featureParts);
        featureParts = [];
        featureStart = -1;
        featuresState = "comma-or-end";
        let feature: unknown;
        try {
          feature = JSON.parse(raw);
        } catch {
          throw new Error("invalid GeoJSON Feature in features array");
        }
        if (typeof feature !== "object" || feature === null) {
          throw new Error("GeoJSON features array contains a non-object value");
        }
        yield feature as ServedFeature;
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (byte === BACKSLASH) {
          escaped = true;
          continue;
        }
        if (byte !== QUOTE) continue;
        inString = false;
        stringParts.push(chunk.subarray(stringStart, index));
        const value = decodeJsonString(stringParts);
        stringParts = [];
        stringStart = -1;
        keyState = rootDepth === 1 && value === "features" ? value : "none";
        continue;
      }

      if (keyState !== "none") {
        if (isWhitespace(byte)) continue;
        expectedValue = byte === COLON ? keyState : "none";
        keyState = "none";
        continue;
      }
      if (expectedValue !== "none") {
        if (isWhitespace(byte)) continue;
        if (expectedValue === "features" && byte === OPEN_ARRAY) {
          inFeatures = true;
          expectedValue = "none";
          continue;
        }
        throw new Error("invalid GeoJSON FeatureCollection header");
      }

      if (byte === QUOTE) {
        inString = true;
        stringStart = index + 1;
        stringParts = [];
        continue;
      }
      if (byte === OPEN_OBJECT) rootDepth++;
      else if (byte === CLOSE_OBJECT) rootDepth--;
    }

    // A feature can straddle arbitrary S3/FS chunk boundaries. Retain only
    // that feature's bytes, not the collection prefix or previous features.
    if (inFeatures && featureDepth > 0 && featureStart >= 0) {
      featureParts.push(chunk.subarray(featureStart));
      featureStart = 0;
    } else if (inString && stringStart >= 0) {
      stringParts.push(chunk.subarray(stringStart));
      stringStart = 0;
    }
  }

  throw new Error("GeoJSON features array did not terminate");
}

/**
 * Validate a FeatureCollection without building its feature array. The source
 * is scanned once before an HTTP response starts, then opened again for the
 * response stream. This preserves the old JSON.parse contract: malformed
 * trailing bytes and a `type` member after `features` are both handled before
 * returning a 200, while only one feature is ever decoded at a time.
 *
 * The tiny collection envelope (everything except `features`) is retained and
 * reconstructed with an empty features array. Feature objects are individually
 * JSON.parse'd as they cross the scanner. Normalized GeoJSON has a bounded
 * envelope; the 912 MiB payload remains entirely outside V8's heap.
 */
export async function validateFeatureCollectionStream(
  source: AsyncIterable<Uint8Array>,
): Promise<void> {
  const prefix: Uint8Array[] = [];
  const suffix: Uint8Array[] = [];

  let mode: "prefix" | "features" | "suffix" = "prefix";
  let featuresComplete = false;
  let rootDepth = 0;
  let prefixInString = false;
  let prefixEscaped = false;
  let prefixStringStart = -1;
  let prefixStringParts: Uint8Array[] = [];
  let keyState: "none" | "features" = "none";
  let expectedFeatures = false;

  let featureDepth = 0;
  let featureStart = -1;
  let featureParts: Uint8Array[] = [];
  let featureInString = false;
  let featureEscaped = false;
  let featuresState: "value-or-end" | "value-required" | "comma-or-end" = "value-or-end";

  for await (const chunk of source) {
    let prefixStart = 0;
    let suffixStart = -1;

    for (let index = 0; index < chunk.byteLength; index++) {
      const byte = chunk[index]!;

      if (mode === "suffix") continue;

      if (mode === "features") {
        if (featureDepth === 0) {
          if (featuresState === "value-or-end" || featuresState === "value-required") {
            if (isWhitespace(byte)) continue;
            if (byte === CLOSE_ARRAY && featuresState === "value-or-end") {
              mode = "suffix";
              featuresComplete = true;
              suffixStart = index + 1;
              continue;
            }
            if (byte !== OPEN_OBJECT) {
              throw new Error("GeoJSON features array contains a non-object value");
            }
            featureDepth = 1;
            featureStart = index;
            featureParts = [];
            featureInString = false;
            featureEscaped = false;
            continue;
          }

          if (isWhitespace(byte)) continue;
          if (byte === COMMA) {
            featuresState = "value-required";
            continue;
          }
          if (byte === CLOSE_ARRAY) {
            mode = "suffix";
            featuresComplete = true;
            suffixStart = index + 1;
            continue;
          }
          throw new Error("invalid GeoJSON features array separator");
        }

        if (featureInString) {
          if (featureEscaped) featureEscaped = false;
          else if (byte === BACKSLASH) featureEscaped = true;
          else if (byte === QUOTE) featureInString = false;
          continue;
        }
        if (byte === QUOTE) {
          featureInString = true;
          continue;
        }
        if (byte === OPEN_OBJECT) {
          featureDepth++;
          continue;
        }
        if (byte !== CLOSE_OBJECT) continue;
        featureDepth--;
        if (featureDepth !== 0) continue;

        featureParts.push(chunk.subarray(featureStart, index + 1));
        let feature: unknown;
        try {
          feature = JSON.parse(decodeParts(featureParts));
        } catch {
          throw new Error("invalid GeoJSON Feature in features array");
        }
        if (typeof feature !== "object" || feature === null) {
          throw new Error("GeoJSON features array contains a non-object value");
        }
        featureParts = [];
        featureStart = -1;
        featuresState = "comma-or-end";
        continue;
      }

      if (prefixInString) {
        if (prefixEscaped) {
          prefixEscaped = false;
          continue;
        }
        if (byte === BACKSLASH) {
          prefixEscaped = true;
          continue;
        }
        if (byte !== QUOTE) continue;
        prefixInString = false;
        prefixStringParts.push(chunk.subarray(prefixStringStart, index));
        const value = decodeJsonString(prefixStringParts);
        prefixStringParts = [];
        prefixStringStart = -1;
        keyState = rootDepth === 1 && value === "features" ? "features" : "none";
        continue;
      }

      if (keyState !== "none") {
        if (isWhitespace(byte)) continue;
        expectedFeatures = byte === COLON;
        keyState = "none";
        continue;
      }
      if (expectedFeatures) {
        if (isWhitespace(byte)) continue;
        if (byte !== OPEN_ARRAY) throw new Error("invalid GeoJSON FeatureCollection header");
        prefix.push(chunk.subarray(prefixStart, index));
        mode = "features";
        expectedFeatures = false;
        continue;
      }

      if (byte === QUOTE) {
        prefixInString = true;
        prefixStringStart = index + 1;
        prefixStringParts = [];
        continue;
      }
      if (byte === OPEN_OBJECT) rootDepth++;
      else if (byte === CLOSE_OBJECT) rootDepth--;
    }

    if (mode === "prefix") {
      prefix.push(chunk.subarray(prefixStart));
      if (prefixInString && prefixStringStart >= 0) {
        prefixStringParts.push(chunk.subarray(prefixStringStart));
        prefixStringStart = 0;
      }
    } else if (mode === "features" && featureDepth > 0 && featureStart >= 0) {
      featureParts.push(chunk.subarray(featureStart));
      featureStart = 0;
    } else if (mode === "suffix") {
      suffix.push(chunk.subarray(suffixStart === -1 ? 0 : suffixStart));
    }
  }

  if (!featuresComplete) throw new Error("GeoJSON features array did not terminate");

  const envelope = decodeParts([...prefix, new TextEncoder().encode("[]"), ...suffix]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("invalid GeoJSON FeatureCollection envelope");
  }
  if (!isFeatureCollection(parsed)) throw new Error("expected GeoJSON FeatureCollection");
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COLON = 0x3a;
const COMMA = 0x2c;

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function decodeParts(parts: readonly Uint8Array[]): string {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Decode a JSON string body (without its surrounding quotes). */
function decodeJsonString(parts: readonly Uint8Array[]): string | undefined {
  try {
    const value = JSON.parse(`"${decodeParts(parts)}"`) as unknown;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
