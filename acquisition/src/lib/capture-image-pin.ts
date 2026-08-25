/**
 * Épinglage d'image de capture + descripteur de récupération de run.
 *
 * Deux frictions du canal de capture cluster, en logique pure (testable, sans
 * I/O ni réseau) :
 *   1. IMAGE : le launcher acceptait un tag mutable (Scaleway :0.1.1) par défaut.
 *      Un tag peut glisser vers une autre image sans signal. `assertPinnedImage`
 *      REFUSE tout ce qui n'est pas un digest GHCR immuable, sauf dérogation
 *      explicite de debug.
 *   2. RUN_ID : `run_id = <lane>-<stamp>-<shard>-<POD_UID>` ; le POD_UID n'est
 *      connu qu'après le démarrage du pod, et il n'existe pas d'index. Le
 *      descripteur donne le préfixe S3 déterministe pour retrouver le run sans
 *      deviner le POD_UID.
 */

/** Digest GHCR immuable de l'image de capture. Un tag (mutable) est refusé. */
export const PINNED_CAPTURE_IMAGE_RE = /^ghcr\.io\/rhanka\/geo-capture@sha256:[0-9a-f]{64}$/;

export function isPinnedCaptureImage(image: string): boolean {
  return PINNED_CAPTURE_IMAGE_RE.test(image);
}

/**
 * Refuse une image non épinglée par digest GHCR. `allowUnpinned` (drapeau
 * `--allow-unpinned-image`) n'est là que pour un debug explicite ; il ne doit
 * jamais être le chemin par défaut d'un run réel.
 */
export function assertPinnedImage(image: string, opts: { allowUnpinned?: boolean } = {}): void {
  if (opts.allowUnpinned) return;
  if (!isPinnedCaptureImage(image)) {
    throw new Error(
      "--image doit etre epingle par digest GHCR immuable " +
        "(ghcr.io/rhanka/geo-capture@sha256:<64hex>), recu: " +
        `${image}. Un tag mutable (ex. Scaleway :0.1.1) peut pointer sur une autre ` +
        "image demain sans que rien ne le signale. Passe l'image depuis " +
        "acquisition/config/capture-image.json, ou --allow-unpinned-image pour un debug explicite.",
    );
  }
}

export interface CaptureRetrievalDescriptor {
  lane: string;
  run_stamp: string;
  shards: number;
  image: string;
  s3_manifest_prefix: string;
  note: string;
}

/**
 * Préfixe S3 déterministe des manifestes d'un run. Le run_id complet ajoute
 * `<shard>-<POD_UID>` que seul le pod connaît ; lister ce préfixe résout le(s)
 * run_id sans connaissance externe du Job.
 */
export function captureRetrievalPrefix(lane: string, runStamp: string): string {
  return `capture/_runs/${lane}-${runStamp}-`;
}

export function captureRetrievalDescriptor(input: {
  lane: string;
  runStamp: string;
  shards: number;
  image: string;
}): CaptureRetrievalDescriptor {
  const prefix = captureRetrievalPrefix(input.lane, input.runStamp);
  return {
    lane: input.lane,
    run_stamp: input.runStamp,
    shards: input.shards,
    image: input.image,
    s3_manifest_prefix: prefix,
    note:
      `run_id complet = ${input.lane}-${input.runStamp}-<shard>-<POD_UID> ` +
      "(POD_UID connu seulement post-run). Lister s3://<bucket>/" +
      `${prefix} pour resoudre le(s) run_id, puis relire via ` +
      "acquisition/src/_capture-e2e-probe.ts --run <run-id> ou capture-cas-materialize.ts.",
  };
}
