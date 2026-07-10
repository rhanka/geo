/**
 * norms-key-probe — READ-ONLY diagnostic. Reports WHICH candidate env-files exist
 * and WHICH known credential key NAMES they carry (MISTRAL_API_KEY / OCR_API_KEY /
 * S3_*), so the normes-via-Mistral lane can be pointed at the right secret file.
 *
 * ANTI-SECRET-LEAK: it prints only booleans (present/absent) and the length of the
 * value — NEVER the value itself. No secret ever reaches stdout/logs.
 *
 * Usage: npx tsx acquisition/src/norms-key-probe.ts
 */
import { existsSync } from "node:fs";
import { loadEnv } from "./lib/s3.js";

const CANDIDATES = [
  "/home/antoinefa/src/_acquisition-shared/s3.env",
  "/home/antoinefa/src/_acquisition-shared/sentropic.env",
  "/home/antoinefa/src/_acquisition-shared/.env",
  "/home/antoinefa/src/_acquisition-shared/ocr.env",
  "/home/antoinefa/src/sentropic/.env",
  "/home/antoinefa/src/sentropic/.env.local",
  "/home/antoinefa/.config/sentropic/.env",
  "/home/antoinefa/src/geo/.env",
];

const WANT = ["MISTRAL_API_KEY", "OCR_API_KEY", "OCR_PROVIDER", "OCR_API_BASE", "S3_ACCESS_KEY"];

function report(label: string, env: Record<string, string | undefined>): void {
  const present = WANT.filter((k) => typeof env[k] === "string" && env[k]!.length > 0);
  const detail = present.map((k) => `${k}(len=${env[k]!.length})`).join(", ");
  console.log(`${present.length > 0 ? "HIT " : "--- "}${label} :: ${detail || "(none of the wanted keys)"}`);
}

report("process.env", process.env);
for (const p of CANDIDATES) {
  if (!existsSync(p)) {
    console.log(`--- ${p} :: (absent)`);
    continue;
  }
  try {
    report(p, loadEnv(p));
  } catch (e) {
    console.log(`ERR ${p} :: ${e instanceof Error ? e.message : String(e)}`);
  }
}
