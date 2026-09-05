import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Lockstep guard for the all-6-packages release (npm-publish.yml release-guard checks only `version == tag`,
 * NOT the internal dependency ranges). A minor/major bump is a trap: e.g. `@sentropic/geo-core: ^0.5.0`
 * EXCLUDES 0.6.0, so a published 0.6.0 engine would resolve geo-core 0.5.x from the registry. This test
 * enforces, version-agnostically, that (a) all 6 publishable packages share ONE version, and (b) every
 * internal `@sentropic/geo*` dependency range is pinned to `^<major>.<minor>.0` of that version.
 */
const PUBLISHABLE = [
  "geo-core",
  "geo",
  "geo-sources-americas",
  "geo-sources-europe",
  "geo-ui-svelte",
  "geo-map-engine",
] as const;

const DEP_FIELDS = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"] as const;

interface Pkg {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(new URL(`../../${dir}/package.json`, import.meta.url), "utf8")) as Pkg;
}

describe("workspace lockstep (release-cut invariant)", () => {
  const pkgs = PUBLISHABLE.map(readPkg);

  it("all 6 publishable packages share ONE lockstep version", () => {
    const versions = new Set(pkgs.map((p) => p.version));
    expect([...versions], `versions: ${pkgs.map((p) => `${p.name}@${p.version}`).join(", ")}`).toHaveLength(1);
  });

  it("every internal @sentropic/geo* dependency range is pinned to the lockstep minor (^<maj>.<min>.0)", () => {
    const [major, minor] = pkgs[0]!.version.split(".");
    const expected = `^${major}.${minor}.0`;
    for (const p of pkgs) {
      for (const field of DEP_FIELDS) {
        const deps = p[field] ?? {};
        for (const [name, range] of Object.entries(deps)) {
          if (name.startsWith("@sentropic/geo")) {
            expect(range, `${p.name} → ${field}.${name}`).toBe(expected);
          }
        }
      }
    }
  });
});
