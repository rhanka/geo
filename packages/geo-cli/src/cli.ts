#!/usr/bin/env node
/**
 * `geo` CLI executable. Builds the commander program and runs it. Errors
 * (including the acquisition `LicenseError`) are printed clearly and turned into
 * a non-zero exit code.
 */

import { buildProgram } from "./program.js";

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${name}: ${message}\n`);
  process.exitCode = 1;
});
