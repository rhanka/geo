import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Lockstep guard for the all-6-packages release (npm-publish.yml release-guard checks only `version == tag`,
 * NOT the internal dependency ranges). A minor/major bump is a trap: e.g. `@sentropic/geo-core: ^0.5.0`
 * EXCLUDES 0.6.0, so at 0.6.0 npm DE-LINKS the workspace and resolves the published 0.5.x from the registry
 * — silently building against stale code. This bit `apps/site` (a private member, outside the 6 publishable),
 * so the guard sweeps EVERY workspace member (packages/*, apps/*, acquisition), not just the publishable ones.
 *
 * Enforced, version-agnostically: (a) all 6 publishable packages share ONE version, and (b) every workspace
 * member's SEMVER range on a publishable `@sentropic/geo*` package is pinned to `^<major>.<minor>.0` of that
 * version. `file:` / `workspace:` / `link:` links are exempt (they always resolve to the workspace).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // repo root (ends with "/")

interface Pkg {
  name?: string;
  version?: string;
  private?: boolean;
  [field: string]: unknown;
}

const DEP_FIELDS = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"] as const;

/** The 6 version-locked publishable packages — the only @sentropic/geo* that resolve from the REGISTRY (a
 * private member is never published, so a dep on it is always a file:/workspace: link, exempt below). */
const PUBLISHABLE = new Set([
  "@sentropic/geo-core",
  "@sentropic/geo",
  "@sentropic/geo-sources-americas",
  "@sentropic/geo-sources-europe",
  "@sentropic/geo-ui-svelte",
  "@sentropic/geo-map-engine",
]);

const WORKSPACE_PROTOCOL = /^(file:|link:|workspace:|portal:)/;

function readJson(rel: string): Pkg {
  return JSON.parse(readFileSync(`${ROOT}${rel}`, "utf8")) as Pkg;
}

/** All workspace member dirs, resolved from the root `workspaces` globs (supports `dir/*` and plain `dir`). */
function memberDirs(): string[] {
  const globs = (readJson("package.json").workspaces as string[] | undefined) ?? [];
  const dirs: string[] = [];
  for (const glob of globs) {
    if (glob.endsWith("/*")) {
      const base = glob.slice(0, -2);
      let entries: string[] = [];
      try {
        entries = readdirSync(`${ROOT}${base}`);
      } catch {
        entries = [];
      }
      for (const name of entries) {
        if (existsSync(`${ROOT}${base}/${name}/package.json`)) dirs.push(`${base}/${name}`);
      }
    } else if (existsSync(`${ROOT}${glob}/package.json`)) {
      dirs.push(glob);
    }
  }
  return dirs;
}

describe("workspace lockstep (release-cut invariant)", () => {
  const members = memberDirs().map((dir) => ({ dir, pkg: readJson(`${dir}/package.json`) }));
  const publishable = members.filter((m) => m.pkg.name !== undefined && PUBLISHABLE.has(m.pkg.name));

  it("all publishable packages share ONE lockstep version", () => {
    expect(publishable.length, "publishable members found").toBe(PUBLISHABLE.size);
    const versions = new Set(publishable.map((m) => m.pkg.version));
    expect([...versions], publishable.map((m) => `${m.pkg.name}@${m.pkg.version}`).join(", ")).toHaveLength(1);
  });

  it("every workspace member's range on a publishable @sentropic/geo* pins the lockstep minor (file: links exempt)", () => {
    const version = publishable[0]!.pkg.version!;
    const [major, minor] = version.split(".");
    const expected = `^${major}.${minor}.0`;
    for (const { dir, pkg } of members) {
      for (const field of DEP_FIELDS) {
        const deps = (pkg[field] ?? {}) as Record<string, string>;
        for (const [name, range] of Object.entries(deps)) {
          if (PUBLISHABLE.has(name) && !WORKSPACE_PROTOCOL.test(range)) {
            expect(range, `${dir} → ${field}.${name}`).toBe(expected);
          }
        }
      }
    }
  });
});
