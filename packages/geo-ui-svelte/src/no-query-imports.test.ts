// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard: shipped runtime code never imports a bundler query specifier
 * (`?url`, `?worker`, `?raw`, ...). A consumer's dependency optimizer pre-bundles
 * this package, and neither esbuild (Vite 6/7) nor Rolldown (Vite 8) can load such
 * a specifier inside a dependency: `vite dev` then stops at startup
 * (geo-ui-svelte <= 0.6.4, `maplibre-gl-worker.mjs?url`). Test files are not
 * imported by the package entry, so they may use the application recipe.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));
const QUERY_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'`])([^"'`]*\?[^"'`]*)\1/g;
/** Comments document the application recipe; only code is pre-bundled. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");

function shippedRuntimeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...shippedRuntimeFiles(path));
    else if (/\.(ts|js|svelte)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

describe("shipped runtime code", () => {
  it("scans a non-empty file set that includes the map components", () => {
    const names = shippedRuntimeFiles(SRC).map((p) => p.slice(SRC.length));
    expect(names).toEqual(expect.arrayContaining(["GeoMap.svelte", "GcpCalageUI.svelte", "maplibre-worker.ts", "index.ts"]));
  });

  it("imports no bundler query specifier (?url, ?worker, ...)", () => {
    const offenders: string[] = [];
    for (const file of shippedRuntimeFiles(SRC)) {
      for (const m of stripComments(readFileSync(file, "utf8")).matchAll(QUERY_IMPORT)) offenders.push(`${file.slice(SRC.length)}: ${m[2]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("detects the specifier shape that broke consumers, and ignores it in comments", () => {
    const sample = [
      "/** e.g. import url from \"x.mjs?url\" */",
      "// await import(\"y.mjs?url\")",
      'return (await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url")).default;',
      'import W from "./w.ts?worker";',
    ].join("\n");
    expect([...stripComments(sample).matchAll(QUERY_IMPORT)].map((m) => m[2])).toEqual([
      "maplibre-gl/dist/maplibre-gl-worker.mjs?url",
      "./w.ts?worker",
    ]);
  });
});
