/**
 * S3 adapter for the immutable capture-proof index.  It deliberately exposes
 * only the port consumed by `publishCaptureProofIndex`: manifests and closed
 * run headers may be read, while writes are limited to content-addressed index
 * snapshots through conditional create-or-byte-equal semantics.
 */
import type { S3Client } from "@aws-sdk/client-s3";

import type { CaptureProofIndexSnapshotStore } from "./capture-proof-index.js";
import { getBytes, listObjectEntries, putBytesIfAbsentOrEqual, s3Client } from "./s3.js";

const MANIFEST_KEY_RE = /^capture\/_runs\/[^/]+\/manifest\.jsonl$/;

/** Real S3 implementation of the proof-index port; it performs no network work until called. */
export function s3CaptureProofIndexStore(s3: S3Client = s3Client()): CaptureProofIndexSnapshotStore {
  return {
    listManifestKeys: async () => (await listObjectEntries(s3, "capture/_runs/"))
      .map((entry) => entry.key)
      .filter((key) => MANIFEST_KEY_RE.test(key)),
    getBytes: (key: string) => getBytes(s3, key),
    putBytesIfAbsentOrEqual: (key: string, body: Buffer, contentType: string) =>
      putBytesIfAbsentOrEqual(s3, key, body, contentType),
  };
}
