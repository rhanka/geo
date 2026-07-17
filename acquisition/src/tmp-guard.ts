#!/usr/bin/env node

/**
 * tmp-guard.ts — prove where geo's scratch actually lands.
 *
 * The host /tmp is tmpfs: filling it burns RAM. Commit e558e9b routed harness and
 * heavy scratch to the workspace-local .h2a/tmp, but a patch is only a claim until
 * the RUNNING processes are checked. This reports the ground truth:
 *   - the real filesystem type of /tmp (from /proc/mounts, not a guess);
 *   - what currently sits in /tmp vs .h2a/tmp;
 *   - the TMPDIR actually inherited by every live geo/tsx/claude process, read from
 *     /proc/<pid>/environ — the only evidence that the routing took effect.
 *
 *   npx tsx acquisition/src/tmp-guard.ts [--minutes 30]
 *
 * Read-only: it never deletes or writes anything.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WORKSPACE_TMP = join(REPO, ".h2a", "tmp");

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Mount points, longest first, so the deepest match wins. */
function mounts(): { target: string; fstype: string }[] {
  return readFileSync("/proc/mounts", "utf8")
    .split("\n")
    .map((line) => line.split(" "))
    .filter((parts) => parts.length > 2)
    .map((parts) => ({ target: parts[1]!, fstype: parts[2]! }))
    .sort((a, b) => b.target.length - a.target.length);
}

function fsTypeOf(target: string): string {
  const hit = mounts().find((m) => target === m.target || target.startsWith(`${m.target === "/" ? "" : m.target}/`));
  return hit?.fstype ?? "?";
}

/**
 * Only a tmpfs-backed scratch burns RAM. A TMPDIR on the ext4 root (e.g. the harness
 * cache) is not a leak, so flagging it would drown the real signal.
 */
function burnsRam(dir: string): boolean {
  return fsTypeOf(dir) === "tmpfs";
}

interface Entry {
  path: string;
  mtimeMs: number;
}

function listDir(dir: string): Entry[] {
  try {
    return readdirSync(dir).map((name) => {
      const path = join(dir, name);
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return { path, mtimeMs: 0 };
      }
    });
  } catch {
    return [];
  }
}

/** TMPDIR of every live process whose cmdline mentions geo work. */
function liveProcessTmpdirs(): { pid: string; tmpdir: string; cmd: string }[] {
  const out: { pid: string; tmpdir: string; cmd: string }[] = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd = "";
    let environ = "";
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      environ = readFileSync(`/proc/${pid}/environ`, "utf8");
    } catch {
      continue; // gone, or not ours
    }
    if (cmd.length === 0) continue;
    if (!/geo|tsx|claude|qc-lots|zonage|normes/i.test(cmd)) continue;
    const tmpdir = environ.split("\0").find((v) => v.startsWith("TMPDIR="))?.slice("TMPDIR=".length) ?? "/tmp";
    out.push({ pid, tmpdir, cmd: cmd.slice(0, 110) });
  }
  return out;
}

function main(argv: readonly string[]): number {
  const minutes = Number(arg(argv, "minutes") ?? "30");
  const cutoff = Date.now() - minutes * 60_000;

  console.log(`/tmp filesystem : ${fsTypeOf("/tmp")}`);
  console.log(`workspace tmp   : ${WORKSPACE_TMP}`);

  const tmpEntries = listDir("/tmp");
  const recentTmp = tmpEntries.filter((e) => e.mtimeMs >= cutoff);
  const geoTmp = tmpEntries.filter((e) => /\/geo-/.test(e.path));
  console.log(`\n/tmp entries total=${tmpEntries.length} geo-*=${geoTmp.length} touched<${minutes}min=${recentTmp.length}`);
  for (const entry of recentTmp.slice(0, 20)) {
    console.log(`  RECENT ${new Date(entry.mtimeMs).toISOString().slice(11, 19)} ${entry.path}`);
  }
  for (const entry of geoTmp.slice(0, 20)) console.log(`  GEO    ${entry.path}`);

  const wsEntries = listDir(WORKSPACE_TMP);
  console.log(`\n.h2a/tmp entries=${wsEntries.length}`);
  for (const entry of wsEntries.slice(0, 20)) console.log(`  ${entry.path}`);

  const procs = liveProcessTmpdirs();
  const leaking = procs.filter((p) => burnsRam(p.tmpdir));
  const safeElsewhere = procs.filter((p) => !burnsRam(p.tmpdir) && !p.tmpdir.startsWith(WORKSPACE_TMP));
  console.log(
    `\nlive geo-ish processes=${procs.length}` +
      ` workspace=${procs.filter((p) => p.tmpdir.startsWith(WORKSPACE_TMP)).length}` +
      ` other-non-tmpfs=${safeElsewhere.length}` +
      ` ON-TMPFS=${leaking.length}`,
  );
  for (const proc of leaking.slice(0, 25)) {
    console.log(`  BURNS-RAM pid=${proc.pid} TMPDIR=${proc.tmpdir}\n            ${proc.cmd}`);
  }
  return leaking.length > 0 ? 1 : 0;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
