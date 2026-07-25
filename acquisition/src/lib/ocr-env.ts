/**
 * ocr-env — bootstrap the Mistral / OCR credentials into `process.env` from the
 * never-committed env files, when the caller's shell does not already export them.
 *
 * WHY: the OCR call (`lib/ocr.ts` → `liveMistralOcrLib`, and `resolveOcrConfig` in
 * the package) reads `OCR_API_KEY` / `MISTRAL_API_KEY` straight from `process.env`
 * at call-time. The fleet's tmux panes inherit that key from their launcher, but a
 * FRESH dispatched-agent shell (or a one-off `npx tsx` run) does NOT — so the OCR
 * pass silently degrades to "0 native-read zones". This mirrors exactly what
 * `s3Client()` already does for the S3 creds: if the process env lacks the key,
 * read it from a known `.env`-style file (the design's `sentropic/.env`).
 *
 * ANTI-SECRET-LEAK: never logs a value; only sets `process.env` in-process.
 */
import { existsSync } from "node:fs";

import { loadEnv } from "./s3.js";

/** Candidate env files, in priority order. `OCR_ENV_FILE` overrides. */
export function ocrEnvCandidates(): string[] {
  return [
    process.env["OCR_ENV_FILE"] ?? "",
    `${process.cwd()}/.env`,
    "/home/antoinefa/src/geo/.env",
    "/home/antoinefa/src/sentropic/.env",
  ].filter(Boolean);
}

/**
 * Ensure `MISTRAL_API_KEY` (and `OCR_API_KEY` if present) are loaded into
 * `process.env`. No-op when the shell already exports one of them. Returns the
 * file the key was loaded from (or null when already present / not found).
 */
export function ensureOcrKeyLoaded(): string | null {
  if (process.env["OCR_API_KEY"] || process.env["MISTRAL_API_KEY"]) return null;
  for (const p of ocrEnvCandidates()) {
    if (!existsSync(p)) continue;
    let env: Record<string, string>;
    try {
      env = loadEnv(p);
    } catch {
      continue;
    }
    if (env["MISTRAL_API_KEY"]) process.env["MISTRAL_API_KEY"] = env["MISTRAL_API_KEY"];
    if (env["OCR_API_KEY"]) process.env["OCR_API_KEY"] = env["OCR_API_KEY"];
    // Also carry OCR routing overrides if the file pins them (never secrets-only).
    for (const k of ["OCR_PROVIDER", "OCR_MODEL", "OCR_API_BASE", "OCR_API_PATH"]) {
      if (!process.env[k] && env[k]) process.env[k] = env[k];
    }
    if (process.env["MISTRAL_API_KEY"] || process.env["OCR_API_KEY"]) return p;
  }
  return null;
}
