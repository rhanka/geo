#!/usr/bin/env node
/**
 * `geo` CLI executable. Builds the commander program and runs it. Errors
 * (including the acquisition `LicenseError`) are printed clearly and turned into
 * a non-zero exit code.
 */

import { buildProgram } from "./program.js";
import { loadContinentRegistries } from "./continents.js";
import { buildInventory } from "../catalog/index.js";

async function main(): Promise<void> {
  // Build the source catalog from the dynamically-loaded continent libraries
  // (ADR-0017): the CLI never statically imports source packages. The inventory
  // is injected into the program so `sources list/show` and `serve`'s
  // `/sources` are populated wherever the continents are installed.
  const inventory = buildInventory(await loadContinentRegistries());
  const program = buildProgram({ inventory });
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${name}: ${message}\n`);
  process.exitCode = 1;
});
