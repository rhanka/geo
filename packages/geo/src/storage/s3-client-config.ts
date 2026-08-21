/**
 * OVH/Scaleway-safe S3 client options — shared factory config (capitalise le
 * pattern déjà appris côté acquisition, « Scaleway rejects aws-chunked »).
 *
 * `@aws-sdk/client-s3` v3 (≥ 3.729) ajoute PAR DÉFAUT un checksum flexible
 * (CRC32) via un content-encoding `aws-chunked` sur les uploads. L'Object
 * Storage OVH (BHS) — et Scaleway — rejettent la taille de chunk résultante :
 *
 *   S3ServiceException [InvalidChunkSizeError] (403): "Only the last chunk is
 *   allowed to have a size less than 8192 bytes."
 *
 * Ces options rétablissent « checksum seulement si l'opération l'exige » (donc
 * PLUS d'`aws-chunked` par défaut) et bufferisent le flux de requête pour que
 * les chunks dépassent le plancher de 8192 octets. REQUIS pour tout WRITE vers
 * l'S3 OVH/Scaleway (le read n'en a pas besoin, mais l'appliquer est sans
 * effet néfaste : `WHEN_REQUIRED` ne fait que relâcher la validation).
 */

/** Buffer de flux de requête (octets) — au-dessus du plancher OVH de 8192. */
export const OVH_S3_STREAM_BUFFER_BYTES = 65_536;

/** Options client S3 sûres pour OVH/Scaleway (coupe le aws-chunked par défaut). */
export interface OvhSafeS3ClientOptions {
  requestChecksumCalculation: "WHEN_REQUIRED";
  responseChecksumValidation: "WHEN_REQUIRED";
  requestStreamBufferSize: number;
}

/**
 * Options à fusionner dans un `new S3Client({...})` (ou `createStore`) pour
 * écrire sur l'S3 OVH/Scaleway sans déclencher l'`aws-chunked` refusé.
 */
export function ovhSafeS3ClientOptions(): OvhSafeS3ClientOptions {
  return {
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestStreamBufferSize: OVH_S3_STREAM_BUFFER_BYTES,
  };
}
