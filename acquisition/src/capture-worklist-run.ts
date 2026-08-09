/**
 * Entrée unique du pod `geo-capture`.
 *
 * Lit une worklist durable depuis S3, la découpe de façon déterministe et passe
 * CHAQUE URL par `capturedFetch`. Ce runner ne dépose ni géométrie ni résultat
 * servi : seulement le CAS raw et les trois artefacts de run.
 *
 * L'entrée est volontairement GET-only : POST exigerait de rendre durable le
 * corps/rejeu du formulaire, et HEAD ne fournit pas de contenu prouvable. Les
 * deux sont hors contrat de la worklist minimale de SPEC_CAPTURE_ON_CLUSTER §5.2.
 */
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import type { PvFetchLike } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_LANES,
  capturedFetch,
  captureWorklist,
  parseCaptureWorklist,
  type CaptureFetchLike,
  type CaptureRun,
  type CaptureLane,
} from "../../packages/qc-sources/src/capture/index.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { getBytes, s3Client } from "./lib/s3.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function captureLane(value: string): CaptureLane {
  if ((CAPTURE_LANES as readonly string[]).includes(value)) return value as CaptureLane;
  throw new Error(`LANE invalide: ${value} (attendu ${CAPTURE_LANES.join(" | ")})`);
}

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} doit être un entier >= 0`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const value = nonNegativeInt(name, fallback);
  if (value < 1) throw new Error(`${name} doit être un entier positif`);
  return value;
}

function enabled(name: string): boolean {
  const value = process.env[name] ?? "0";
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${name} doit être 0|1|false|true`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * `RobotsCache` reste le parseur/cache REP de référence, mais son transport
 * passe lui aussi par le chokepoint. Il n'y a pas de récursion : cette requête
 * `robots.txt` appelle `capturedFetch` SANS gate robots, tandis que les URLs de
 * la worklist lui fournissent ensuite ce cache déjà alimenté.
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

async function main(): Promise<void> {
  const lane = captureLane(requireEnv("LANE"));
  const worklistKey = requireEnv("WORKLIST");
  const runId = requireEnv("RUN_ID");
  const shard = nonNegativeInt("SHARD", 0);
  const shards = positiveInt("SHARDS", 1);
  if (shard >= shards) throw new Error(`SHARD=${shard} doit être inférieur à SHARDS=${shards}`);
  const delayMs = nonNegativeInt("DELAY_MS", 2_000);
  const maxBytes = positiveInt("MAX_BYTES", 104_857_600);
  const dryRun = enabled("DRY_RUN");
  const egress = process.env["EGRESS"] ?? "direct";
  const s3 = s3Client();
  const run = openCaptureRun({
    lane,
    runId,
    shard,
    s3,
    userAgent: CAPTURE_USER_AGENT,
    egress,
    worklist: worklistKey,
    flushEvery: 1,
  });
  let exitCode = 0;
  try {
    run.log(
      `[capture-job] start lane=${lane} run=${runId} shard=${shard}/${shards} worklist=${worklistKey} dry_run=${dryRun}`,
    );
    const targets = parseCaptureWorklist(JSON.parse((await getBytes(s3, worklistKey)).toString("utf8")));
    const robots = new RobotsCache({
      userAgent: CAPTURE_USER_AGENT,
      log: (message) => run.log(message),
      fetchImpl: capturedRobotsFetch(run),
    });
    const result = await captureWorklist({
      run,
      targets,
      shard,
      shards,
      delayMs,
      maxBytes,
      store: !dryRun,
      robots,
    });
    run.log(
      `[capture-job] complete attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} durable=${result.durable}`,
    );
    // Une erreur HTTP est une ligne de manifeste attendue. Une réponse 2xx sans
    // CAS, en revanche, est un défaut de durabilité et doit relancer le Job.
    if (!dryRun && result.durable !== result.succeeded) {
      throw new Error(
        `capture incomplète: ${result.succeeded} réponses réussies mais ${result.durable} CAS durables`,
      );
    }
  } catch (error) {
    exitCode = 1;
    run.log(`[capture-job] fatal ${errorText(error)}`);
    throw error;
  } finally {
    await run.finish(exitCode);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
