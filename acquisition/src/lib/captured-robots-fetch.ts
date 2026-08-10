/** Transport Robots.txt qui passe lui aussi par le chokepoint de capture. */
import type { PvFetchLike } from "../../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import {
  capturedFetch,
  type CaptureFetchLike,
  type CaptureRun,
} from "../../../packages/qc-sources/src/capture/index.js";

/**
 * `RobotsCache` reste le parseur/cache REP de référence, mais son transport
 * passe par le chokepoint. Il n'y a pas de récursion : `robots.txt` est capturé
 * sans gate, puis la cible reçoit ce cache déjà alimenté.
 */
export function capturedRobotsFetch(
  run: CaptureRun,
  transport: CaptureFetchLike = globalThis.fetch as unknown as CaptureFetchLike,
): PvFetchLike {
  return async (url, init) => {
    const result = await capturedFetch(url, {
      ...(init?.method !== undefined ? { method: init.method } : {}),
      ...(init?.headers !== undefined ? { headers: init.headers } : {}),
      ...(init?.signal !== undefined ? { signal: init.signal } : {}),
    }, {
      run,
      source: "robots-txt",
      slugs: [],
      fetchImpl: transport,
      // RobotsCache doit parser ce petit document après la capture.
      retainBody: true,
    });
    if (result.response !== null) {
      // capturedFetch a consommé le body 2xx afin de le hasher. RobotsCache doit
      // le lire une seconde fois pour parser les règles : on lui présente donc
      // une réponse immuable reconstruite depuis les octets capturés.
      if (result.bytes !== null) {
        const snapshot = result.bytes.slice();
        return {
          status: result.response.status,
          ok: result.response.ok,
          headers: result.response.headers,
          arrayBuffer: async () =>
            snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength) as ArrayBuffer,
        };
      }
      return result.response;
    }
    throw new Error(result.line.error ?? "robots.txt sans réponse");
  };
}
