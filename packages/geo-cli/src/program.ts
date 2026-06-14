/**
 * Commander program builder. Keeps wiring thin: every action delegates to a
 * testable function in `./commands/*`. The program, its deps, and its output
 * sink are all injectable, so tests can build the program and assert parsing
 * and wiring without a real process, network, or stdout.
 */

import { Command } from "commander";

import { VERSION } from "./index.js";
import {
  fetchSource as defaultFetchSource,
  formatFetchResult,
} from "./commands/fetch.js";
import {
  buildLicenses as defaultBuildLicenses,
} from "./commands/licenses.js";
import {
  refresh as defaultRefresh,
  formatRefreshResult,
} from "./commands/refresh.js";
import {
  startServer as defaultStartServer,
} from "./commands/serve.js";
import {
  formatSourceDetail,
  formatSourceList,
  listSources as defaultListSources,
  showSource as defaultShowSource,
} from "./commands/sources.js";
import type { FetchDeps } from "./commands/fetch.js";
import type { RefreshDeps } from "./commands/refresh.js";
import type { ServeDeps } from "./commands/serve.js";

/** Injectable command implementations + IO, for testing and embedding. */
export interface ProgramDeps {
  out?: (line: string) => void;
  err?: (line: string) => void;
  listSources?: typeof defaultListSources;
  showSource?: typeof defaultShowSource;
  fetchSource?: typeof defaultFetchSource;
  buildLicenses?: typeof defaultBuildLicenses;
  refresh?: typeof defaultRefresh;
  startServer?: typeof defaultStartServer;
  /** Forwarded to fetch/refresh (e.g. injected `acquire`/`fetchImpl` in tests). */
  fetchDeps?: FetchDeps;
  refreshDeps?: RefreshDeps;
  serveDeps?: ServeDeps;
}

/**
 * Build the `geo` commander program. Does not call `process.exit`; callers
 * decide (the bin uses default behavior, tests use `exitOverride`).
 */
export function buildProgram(deps: ProgramDeps = {}): Command {
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));

  const listSources = deps.listSources ?? defaultListSources;
  const showSource = deps.showSource ?? defaultShowSource;
  const fetchSource = deps.fetchSource ?? defaultFetchSource;
  const buildLicenses = deps.buildLicenses ?? defaultBuildLicenses;
  const refresh = deps.refresh ?? defaultRefresh;
  const startServer = deps.startServer ?? defaultStartServer;

  const program = new Command();
  program
    .name("geo")
    .description("Acquire, normalize and serve licensed geographic data.")
    .version(VERSION);

  // geo sources list [--country <cc>] [--kind <kind>] | show <sourceId>
  const sources = program.command("sources").description("List/inspect the source catalog.");
  sources
    .command("list")
    .description("List the geo source catalog (from @sentropic/geo-sources).")
    .option("--country <cc>", "filter by ISO 3166-1 alpha-2 country code (e.g. CA, FR)")
    .option("--kind <kind>", "filter by source kind (e.g. administrative, postal, statistical)")
    .action((opts: { country?: string; kind?: string }) => {
      const filters: { country?: string; kind?: string } = {};
      if (opts.country !== undefined) filters.country = opts.country;
      if (opts.kind !== undefined) filters.kind = opts.kind;
      out(formatSourceList(listSources(filters)));
    });
  sources
    .command("show <sourceId>")
    .description("Inspect a source from the catalog.")
    .action((sourceId: string) => {
      out(formatSourceDetail(showSource(sourceId)));
    });

  // geo fetch <sourceId> [datasetId]
  program
    .command("fetch <sourceId> [datasetId]")
    .description("Acquire a dataset (or all of a source) and write normalized GeoJSON.")
    .option(
      "--out <target>",
      "output for normalized data: a directory, fs:<dir>, or s3://<bucket>/<prefix>",
    )
    .option("--force", "re-fetch over the network, bypassing the cache")
    .action(
      async (
        sourceId: string,
        datasetId: string | undefined,
        opts: { out?: string; force?: boolean },
      ) => {
        const options: { out?: string; force?: boolean } = {};
        if (opts.out !== undefined) options.out = opts.out;
        if (opts.force !== undefined) options.force = opts.force;
        const result = await fetchSource(sourceId, datasetId, options, deps.fetchDeps ?? {});
        out(formatFetchResult(result));
      },
    );

  // geo serve
  program
    .command("serve")
    .description("Boot the OGC API – Features server over the normalized data.")
    .option("--port <port>", "port to listen on", (v) => Number.parseInt(v, 10))
    .option(
      "--data <location>",
      "normalized data: a directory, fs:<dir>, or s3://<bucket>/<prefix>",
    )
    .action((opts: { port?: number; data?: string }) => {
      const options: { port?: number; data?: string } = {};
      if (opts.port !== undefined) options.port = opts.port;
      if (opts.data !== undefined) options.data = opts.data;
      const handle = startServer(options, deps.serveDeps ?? {});
      out(`geo serve listening on http://localhost:${handle.port} (data: ${handle.dataDir})`);
    });

  // geo licenses build
  const licenses = program.command("licenses").description("License registry tooling.");
  licenses
    .command("build")
    .description("Regenerate the markdown license registry from the JSON registry.")
    .option("--registry <path>", "path to the JSON registry")
    .option("--out <path>", "path to the generated markdown")
    .action(async (opts: { registry?: string; out?: string }) => {
      const options: { registry?: string; out?: string } = {};
      if (opts.registry !== undefined) options.registry = opts.registry;
      if (opts.out !== undefined) options.out = opts.out;
      const result = await buildLicenses(options);
      out(`Wrote ${result.entries} license entr(ies) to ${result.outPath}`);
    });

  // geo refresh
  program
    .command("refresh")
    .description("Re-fetch ledger entries whose update cadence has elapsed (ADR-0004).")
    .option("--stale", "only refresh entries judged stale")
    .option("--out <dir>", "output directory for normalized data")
    .option("--force", "re-fetch over the network, bypassing the cache")
    .action(async (opts: { stale?: boolean; out?: string; force?: boolean }) => {
      const options: { stale?: boolean; out?: string; force?: boolean } = {};
      if (opts.stale !== undefined) options.stale = opts.stale;
      if (opts.out !== undefined) options.out = opts.out;
      if (opts.force !== undefined) options.force = opts.force;
      const result = await refresh(options, deps.refreshDeps ?? {});
      out(formatRefreshResult(result));
    });

  // Route commander's own diagnostics through the injected error sink.
  program.configureOutput({
    writeErr: (str) => err(str.replace(/\n$/, "")),
  });

  return program;
}
