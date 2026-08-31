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
import { fileURLToPath } from "node:url";
import {
  CAPTURE_LANES,
  captureWorklist,
  parseCaptureWorklist,
  type CaptureLane,
} from "../../packages/qc-sources/src/capture/index.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { capturedRobotsFetch } from "./lib/captured-robots-fetch.js";
import { isCampaignBucket, type CampaignBucket } from "./lib/object-store-campaign-gate.js";
import { getBytes, resolveBucket, s3Client } from "./lib/s3.js";

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

export { capturedRobotsFetch } from "./lib/captured-robots-fetch.js";

/**
 * §6 fail-closed (pod-side) : le bucket EFFECTIF du pod — `resolveBucket()` = `S3_BUCKET`
 * (injecté par le runner gaté) OU le défaut baké config-driven — DOIT appartenir à l'allowlist
 * campagne FERMÉE. Introduire l'override `S3_BUCKET` rend le bucket env-influençable ; cette
 * garde re-valide le résultat AVANT tout I/O pour que le pod n'écrive JAMAIS hors allowlist,
 * quelle que soit la provenance de `S3_BUCKET` (préserve « JAMAIS un ENV arbitraire », gate #293/§6).
 */
export function assertPodCaptureBucket(env: Record<string, string | undefined> = process.env): CampaignBucket {
  const bucket = resolveBucket(env);
  if (!isCampaignBucket(bucket)) {
    throw new Error(
      `capture pod refusé: bucket cible (${bucket}) hors de l'allowlist campagne — refus fail-closed (S3_BUCKET non-validé)`,
    );
  }
  return bucket;
}

async function main(): Promise<void> {
  // §6 fail-closed : re-valide le bucket EFFECTIF du pod (S3_BUCKET | config baké) contre
  // l'allowlist campagne AVANT toute lecture/écriture — le pod n'écrit JAMAIS hors allowlist,
  // quelle que soit la provenance de S3_BUCKET (defense-in-depth, gate #293/§6).
  assertPodCaptureBucket();
  const lane = captureLane(requireEnv("LANE"));
  const worklistKey = requireEnv("WORKLIST");
  // `k8s-capture-run` publishes RUN_STAMP as the immutable, operator-visible
  // run identity.  Keep RUN_ID as a compatibility override for specialised
  // runners, but never require an environment variable its standard manifest
  // does not provide.
  const runId = process.env["RUN_ID"]?.trim() || requireEnv("RUN_STAMP");
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
