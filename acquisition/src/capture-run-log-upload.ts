/**
 * Persiste le stdout/stderr redigé d'un pod sous son `run.log` durable.
 *
 * Le runner de worklist dépose déjà un log applicatif au fil de l'eau. Cet
 * adaptateur le remplace à la fin du pod par le journal complet du processus,
 * après rédaction C-6. Il n'écrit jamais en dehors de `capture/_runs/`.
 */
import { readFileSync } from "node:fs";

import {
  captureRunKeys,
  redactCaptureLog,
} from "../../packages/qc-sources/src/capture/index.js";
import { s3CaptureStore } from "./lib/capture-s3.js";
import { s3Client } from "./lib/s3.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

async function main(): Promise<void> {
  const runId = requireEnv("RUN_ID");
  const path = requireEnv("RUN_LOG_PATH");
  const body = redactCaptureLog(readFileSync(path, "utf8"));
  const store = s3CaptureStore(s3Client());
  await store.put(captureRunKeys(runId).log, body, "text/plain; charset=utf-8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
