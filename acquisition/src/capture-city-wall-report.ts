/**
 * Read a completed cluster capture run and emit a closed, per-city wall report.
 * It only reads S3; no source URL is ever requested from the workstation.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCaptureWorklist,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { classifyCaptureCityWalls } from "./lib/capture-city-wall.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function option(name: string): string | null {
  const value = process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`));
  return value === undefined ? null : value.slice(name.length + 3);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function parseExitCode(value: unknown, key: string): number | null {
  if (value === null || typeof value === "number") return value;
  throw new Error(`invalid run header: ${key}`);
}

async function completedRunLines(runStamp: string): Promise<{ runIds: string[]; lines: CaptureManifestLine[] }> {
  const prefix = `capture/_runs/zones-${runStamp}-`;
  const entries = await listObjectEntries(s3Client(), prefix);
  const manifests = entries.map((entry) => entry.key).filter((key) => key.endsWith("/manifest.jsonl")).sort();
  if (manifests.length === 0) throw new Error(`no capture manifest for ${runStamp}`);
  const lines: CaptureManifestLine[] = [];
  const runIds: string[] = [];
  for (const manifestKey of manifests) {
    const headerKey = manifestKey.replace(/manifest\.jsonl$/, "run.json");
    const header = JSON.parse((await getBytes(s3Client(), headerKey)).toString("utf8")) as { run_id?: unknown; exit_code?: unknown };
    if (typeof header.run_id !== "string") throw new Error(`invalid run header: ${headerKey}`);
    if (parseExitCode(header.exit_code, headerKey) !== 0) throw new Error(`capture run did not complete: ${headerKey}`);
    runIds.push(header.run_id);
    lines.push(...parseManifestJsonl((await getBytes(s3Client(), manifestKey)).toString("utf8")));
  }
  return { runIds, lines };
}

async function main(): Promise<void> {
  const worklistArg = option("worklist");
  const runStamp = option("run-stamp");
  const outArg = option("out");
  if (!worklistArg || !runStamp || !outArg) {
    throw new Error("--worklist=<path> --run-stamp=<YYYYMMDDTHHMMSSZ> --out=<path> are required");
  }
  if (!/^\d{8}T\d{6}Z$/.test(runStamp)) throw new Error("--run-stamp must be YYYYMMDDTHHMMSSZ");
  const worklistPath = insideRepo(worklistArg, "worklist");
  const outPath = insideRepo(outArg, "out");
  if (existsSync(outPath)) throw new Error(`refusing to overwrite: ${relative(ROOT, outPath)}`);
  const worklist = parseCaptureWorklist(JSON.parse(readFileSync(worklistPath, "utf8")) as unknown);
  const { runIds, lines } = await completedRunLines(runStamp);
  const cities = classifyCaptureCityWalls(worklist, lines);
  const partition = Object.fromEntries(["captured-v2-input", "wall-http-404", "wall-http", "wall-transport"]
    .map((outcome) => [outcome, cities.filter((city) => city.outcome === outcome).length]));
  const report = {
    contract: "capture-city-wall-report/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    complete: true,
    worklist: relative(ROOT, worklistPath),
    run_stamp: runStamp,
    run_ids: runIds,
    cities,
    partition: { ...partition, total: cities.length, closed: Object.values(partition).reduce((sum, value) => sum + value, 0) === cities.length },
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output: relative(ROOT, outPath), run_ids: runIds, partition: report.partition }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
