/** Publie une worklist PV immuable avant l'application de son Job committé. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCaptureWorklist } from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, putBytesIfAbsent, s3Client } from "./lib/s3.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");

function value(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function required(name: string): string {
  const found = value(name);
  if (!found) throw new Error(`--${name}=... est requis`);
  return found;
}

async function main(): Promise<void> {
  const file = resolve(ROOT, required("worklist"));
  if (!file.startsWith(`${ROOT}/`)) throw new Error("--worklist doit rester dans le dépôt");
  const key = required("key");
  if (!/^registry\/capture-worklists\/pv-[a-z0-9-]+\.json$/.test(key)) {
    throw new Error("--key doit être une worklist PV sous registry/capture-worklists/");
  }
  const targets = parseCaptureWorklist(JSON.parse(readFileSync(file, "utf8")) as unknown);
  const body = `${JSON.stringify(targets, null, 2)}\n`;
  const s3 = s3Client();
  try {
    await putBytesIfAbsent(s3, key, body, "application/json");
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode;
    if (status !== 412) throw error;
    if ((await getBytes(s3, key)).toString("utf8") !== body) throw new Error(`worklist S3 existante divergente: ${key}`);
  }
  process.stdout.write(`${JSON.stringify({ key, targets: targets.length, immutable: true }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
