/** Publie une campagne PV immuable puis, optionnellement, soumet son CronJob. */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";

import { parseCaptureWorklist } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, objectHead, putBytesIfAbsent, s3Client } from "./lib/s3.js";
import {
  assertContiguousWorklistLots,
  assertBacklogManifest,
  assertBacklogState,
  campaignManifestKey,
  campaignStateKey,
  captureBacklogCronManifest,
  captureJobName,
  createBacklogManifest,
  createBacklogState,
  sha256,
  worklistKey,
  type PvCaptureBacklogManifest,
  type PvCaptureBacklogState,
} from "./lib/pv-capture-backlog.js";

interface Args {
  id: string;
  worklistPrefix: string;
  image: string;
  namespace: string;
  delayMs: number;
  maxBytes: number;
  maxActiveJobs: number;
  egress: string;
  apply: boolean;
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : argv[index + 1];
}

function integer(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} doit être un entier >= 0`);
  return parsed;
}

function parseArgs(argv: string[]): Args {
  const id = option(argv, "id");
  const worklistPrefix = option(argv, "worklist-prefix");
  const image = option(argv, "image");
  if (!id || !worklistPrefix || !image) {
    throw new Error("--id, --worklist-prefix et --image sont requis");
  }
  if (/\s/.test(image)) throw new Error("--image ne peut contenir d'espace");
  const egress = option(argv, "egress") ?? "direct";
  if (!/^(direct|tor:[a-z0-9][a-z0-9-]*|proxy:[a-z0-9][a-z0-9-]*)$/.test(egress)) {
    throw new Error("--egress doit être direct | tor:<lane> | proxy:<id>");
  }
  return {
    id,
    worklistPrefix,
    image,
    namespace: option(argv, "namespace") ?? "geo",
    delayMs: integer("delay-ms", option(argv, "delay-ms"), 2_000),
    maxBytes: integer("max-bytes", option(argv, "max-bytes"), 104_857_600),
    maxActiveJobs: integer("max-active-jobs", option(argv, "max-active-jobs"), 10),
    egress,
    apply: argv.includes("--apply"),
  };
}

function statusOf(error: unknown): number | null {
  const detail = error as { $metadata?: { httpStatusCode?: unknown } } | null;
  return typeof detail?.$metadata?.httpStatusCode === "number" ? detail.$metadata.httpStatusCode : null;
}

async function putImmutable(s3: ReturnType<typeof s3Client>, key: string, body: string): Promise<void> {
  try {
    await putBytesIfAbsent(s3, key, body, "application/json");
  } catch (error) {
    if (statusOf(error) !== 412) throw error;
    const existing = (await getBytes(s3, key)).toString("utf8");
    if (existing !== body) throw new Error(`objet immuable déjà présent mais divergent: ${key}`);
  }
}

function worklistPaths(prefix: string): string[] {
  const absolute = resolve(prefix);
  const directory = dirname(absolute);
  const namePrefix = basename(absolute);
  const matched = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const match = entry.isFile() ? entry.name.match(new RegExp(`^${escapeRegex(namePrefix)}(\\d+)\\.json$`)) : null;
    return match ? [{ path: resolve(directory, entry.name), lot: Number(match[1]) }] : [];
  }).sort((left, right) => left.lot - right.lot);
  if (matched.length === 0) throw new Error(`aucune worklist trouvée pour ${prefix}`);
  assertContiguousWorklistLots(matched.map((entry) => entry.lot));
  return matched.map((entry) => entry.path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameManifest(left: PvCaptureBacklogManifest, right: PvCaptureBacklogManifest): boolean {
  const comparable = (manifest: PvCaptureBacklogManifest): unknown => ({ ...manifest, created_at: null });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function kubectlApply(manifest: string, cronJobName: string, namespace: string): void {
  const applied = spawnSync("kubectl", ["apply", "-f", "-"], { input: manifest, encoding: "utf8" });
  if (applied.status !== 0) throw new Error(`kubectl apply a échoué: ${(applied.stderr || applied.stdout).trim()}`);
  process.stderr.write(applied.stdout);
  // Job name is capped at 63 chars; keep the immediate tick deterministic
  // enough for observation without exceeding the CronJob-name maximum.
  const name = `${cronJobName.slice(0, 46)}-i-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14).toLowerCase()}`;
  const started = spawnSync("kubectl", ["create", "job", `--from=cronjob/${cronJobName}`, name, "-n", namespace], { encoding: "utf8" });
  if (started.status !== 0) throw new Error(`kubectl create job initial a échoué: ${(started.stderr || started.stdout).trim()}`);
  process.stderr.write(started.stdout);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const paths = worklistPaths(args.worklistPrefix);
  const lots = [];
  for (const [index, path] of paths.entries()) {
    const targets = parseCaptureWorklist(JSON.parse(readFileSync(path, "utf8")) as unknown);
    const body = `${JSON.stringify(targets, null, 2)}\n`;
    const lot = index + 1;
    const key = worklistKey(args.id, lot);
    await putImmutable(s3, key, body);
    lots.push({ lot, targets: targets.length, worklist_key: key, worklist_sha256: sha256(body), job_name: captureJobName(args.id, lot) });
  }
  const wanted = createBacklogManifest({
    id: args.id,
    created_at: new Date().toISOString(),
    lane: "pv",
    namespace: args.namespace,
    image: args.image,
    delay_ms: args.delayMs,
    max_bytes: args.maxBytes,
    max_active_jobs: args.maxActiveJobs,
    egress: args.egress,
    lots,
  });
  const manifestKey = campaignManifestKey(args.id);
  const manifestHead = await objectHead(s3, manifestKey);
  let manifest: PvCaptureBacklogManifest;
  if (manifestHead.exists) {
    manifest = JSON.parse((await getBytes(s3, manifestKey)).toString("utf8")) as PvCaptureBacklogManifest;
    assertBacklogManifest(manifest);
    if (!sameManifest(manifest, wanted)) throw new Error(`campagne existante divergente: ${manifestKey}`);
  } else {
    await putImmutable(s3, manifestKey, `${JSON.stringify(wanted, null, 2)}\n`);
    manifest = wanted;
  }
  const stateKey = campaignStateKey(args.id);
  const stateHead = await objectHead(s3, stateKey);
  let state: PvCaptureBacklogState;
  if (stateHead.exists) {
    state = JSON.parse((await getBytes(s3, stateKey)).toString("utf8")) as PvCaptureBacklogState;
    assertBacklogState(state, manifest);
  } else {
    state = createBacklogState(manifest, new Date().toISOString());
    await putImmutable(s3, stateKey, `${JSON.stringify(state, null, 2)}\n`);
  }
  const cronJobName = `geo-pv-backlog-${args.id}`;
  if (args.apply) {
    if (state.phase !== "running") throw new Error(`campagne ${args.id} ${state.phase}: refus de la redémarrer implicitement`);
    kubectlApply(captureBacklogCronManifest(manifest, cronJobName), cronJobName, manifest.namespace);
  }
  console.log(JSON.stringify({
    campaign: args.id,
    manifest_key: manifestKey,
    state_key: stateKey,
    lots: manifest.lots.length,
    targets: manifest.lots.reduce((total, lot) => total + lot.targets, 0),
    cronjob: cronJobName,
    applied: args.apply,
  }, null, 2));
}

// This is a standalone bootstrap (no module imports it). Do not gate `main`
// on an ESM loader-specific argv/import-meta comparison: a skipped invocation
// would leave worklists without their required durable campaign state.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

export { parseArgs, worklistPaths };
