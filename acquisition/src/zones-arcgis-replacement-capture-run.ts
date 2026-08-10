/**
 * Job CAPTURE mono-ville pour un remplacement ArcGIS de zonage.
 *
 * Il ne lit qu'une worklist typée/hashée sur S3 et n'écrit que le CAS raw et
 * les trois artefacts `capture/_runs/`. Il ne transforme ni ne dépose jamais
 * `normalized/`: le Job DEPOSIT distinct devra vérifier ce reçu terminé.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import { capturedFetch } from "../../packages/qc-sources/src/capture/index.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { capturedRobotsFetch } from "./lib/captured-robots-fetch.js";
import { getBytes, s3Client } from "./lib/s3.js";
import {
  captureUrlForReplacementTarget,
  parseZonesArcgisReplacementWorklist,
  serializeZonesArcgisReplacementWorklist,
  assertReplacementTargetMatchesMunicipalityRegister,
  type ZonesArcgisReplacementWorklist,
} from "./lib/zones-arcgis-replacement-worklist.js";

const WORKLIST_PREFIX = "registry/capture-worklists/zones-arcgis-replacement/";
const RUN_ID_RE = /^zones-\d{8}T\d{6}Z-[a-z0-9][a-z0-9-]*$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const MUNICIPALITIES = new URL("../../packages/qc-sources/src/geo/municipalities.qc.json", import.meta.url);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = Number(raw || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} doit être un entier positif`);
  return value;
}

export function isZonesArcgisReplacementWorklistKey(value: string): boolean {
  return value.startsWith(WORKLIST_PREFIX)
    && value.endsWith(".json")
    && !value.includes("..")
    && /^[a-zA-Z0-9._/-]+$/.test(value);
}

export function parseReplacementRunId(value: string): string {
  if (!RUN_ID_RE.test(value)) throw new Error("RUN_ID doit être un identifiant de run zones horodaté et mono-ville");
  return value;
}

function municipalityRegister(): Array<{ slug: string; name: string }> {
  const value = JSON.parse(readFileSync(MUNICIPALITIES, "utf8")) as unknown;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "object" || entry === null
    || typeof (entry as Partial<{ slug: string; name: string }>).slug !== "string"
    || typeof (entry as Partial<{ slug: string; name: string }>).name !== "string")) {
    throw new Error("registre municipal invalide");
  }
  return value as Array<{ slug: string; name: string }>;
}

/** Vérifie les octets réellement lus de S3 AVANT de les interpréter. */
export function parseVerifiedReplacementWorklist(
  bytes: Uint8Array,
  expectedSha256: string,
): ZonesArcgisReplacementWorklist {
  if (!SHA256_RE.test(expectedSha256)) throw new Error("WORKLIST_SHA256 doit être sha256:<64 hex>");
  const actualSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualSha256 !== expectedSha256) {
    throw new Error(`worklist S3 divergente: ${actualSha256} != ${expectedSha256}`);
  }
  const body = Buffer.from(bytes).toString("utf8");
  const worklist = parseZonesArcgisReplacementWorklist(JSON.parse(body) as unknown);
  if (body !== serializeZonesArcgisReplacementWorklist(worklist)) {
    throw new Error("worklist S3 non canonique: refus avant GET tiers");
  }
  return worklist;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main(): Promise<void> {
  if (process.env["GEO_CAPTURE_EXECUTION"] !== "cluster") {
    throw new Error("GEO_CAPTURE_EXECUTION=cluster est requis pour le receipt de remplacement");
  }
  requireEnv("GEO_GIT_SHA");
  const worklistKey = requireEnv("WORKLIST");
  if (!isZonesArcgisReplacementWorklistKey(worklistKey)) {
    throw new Error(`WORKLIST hors préfixe de remplacement autorisé: ${worklistKey}`);
  }
  const runId = parseReplacementRunId(requireEnv("RUN_ID"));
  const expectedSha256 = requireEnv("WORKLIST_SHA256");
  const maxBytes = positiveIntEnv("MAX_BYTES", 268_435_456);
  const egress = process.env["EGRESS"]?.trim() || "direct";
  const s3 = s3Client();
  const run = openCaptureRun({
    lane: "zones",
    runId,
    s3,
    userAgent: CAPTURE_USER_AGENT,
    egress,
    worklist: worklistKey,
    flushEvery: 1,
  });
  let exitCode = 0;
  try {
    const worklist = parseVerifiedReplacementWorklist(await getBytes(s3, worklistKey), expectedSha256);
    const target = worklist.targets[0];
    assertReplacementTargetMatchesMunicipalityRegister(target, municipalityRegister());
    const url = captureUrlForReplacementTarget(target);
    const robots = new RobotsCache({
      userAgent: CAPTURE_USER_AGENT,
      log: (message) => run.log(message),
      fetchImpl: capturedRobotsFetch(run),
    });
    run.log(`[zones-arcgis-replacement-capture] start slug=${target.slug} run=${runId} worklist=${worklistKey}`);
    const captured = await capturedFetch(url, { method: "GET", headers: { Accept: "application/geo+json, application/json" } }, {
      run,
      source: "zones-arcgis",
      slugs: [target.slug],
      robots,
      maxBytes,
      retainBody: false,
      version: "zones-arcgis-replacement-capture/1",
    });
    // Une capture ne prétend jamais qu'un robots indéterminé satisfait C-0.
    if (captured.line.robots !== "allowed") {
      throw new Error(`capture refusée: verdict robots=${captured.line.robots}`);
    }
    if (captured.ok && (captured.line.storage_key === null || captured.line.sha256 === null || captured.line.retrieved_at === null)) {
      throw new Error("capture 2xx sans CAS, sha256 ou retrieved_at durable");
    }
    // HTTP 4xx/5xx documente un mur terminal. L'exit 0 garantit un run.json
    // clos, tandis que l'absence de CAS interdit mécaniquement tout dépôt.
    run.log(
      `[zones-arcgis-replacement-capture] terminal slug=${target.slug} status=${captured.line.http_status ?? "transport"} `
      + `durable=${captured.line.storage_key !== null} manifest=${run.keys.manifest}`,
    );
  } catch (error) {
    exitCode = 1;
    run.log(`[zones-arcgis-replacement-capture] fatal ${errorText(error)}`);
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
