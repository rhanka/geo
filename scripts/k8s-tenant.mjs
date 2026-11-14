#!/usr/bin/env node
/**
 * kubectl wrapper for geo's own tenant-admin access (RoleBinding tenant-admin in ns geo-preprod).
 *
 *   node scripts/k8s-tenant.mjs <kubectl args...>
 *   node scripts/k8s-tenant.mjs --prod-ok --namespace geo <kubectl args...>   # prod: explicit opt-in
 *
 * Credential handling (owner rule — the kubeconfig is used BY VARIABLE NAME ONLY):
 *   - reads ONLY the line `K8S_TENANT_ADMIN_KUBECONFIG_B64=` of the repo `.env` (path override:
 *     env K8S_TENANT_ENV_FILE); no other line is kept, nothing is printed;
 *   - base64-decodes it into a temp file (dir 0700, file 0600, under os.tmpdir());
 *   - passes it to kubectl with `--kubeconfig <tmpfile>` (never the value on a command line);
 *   - deletes the temp dir at exit, on error and on SIGINT/SIGTERM/SIGHUP.
 *
 * Namespace guard:
 *   - no namespace flag      → `--namespace=geo-preprod` is injected (a manifest whose objects
 *                              name another namespace is then rejected by kubectl itself);
 *   - `geo-preprod`          → allowed;
 *   - `geo`                  → allowed only with `--prod-ok` (consumed here, not passed to kubectl);
 *   - anything else, `-A` / `--all-namespaces` → refused.
 * Also refused: `config` (would print the kubeconfig), connection overrides (`--kubeconfig`,
 * `--context`, `--cluster`, `--user`, `--token`, `--server`/`-s`, `--as*`), and reading Secret
 * contents (`get secret… -o …`).
 *
 * Exit code: kubectl's own; 64 on a refused invocation, 65 on a missing/invalid credential.
 */

import { execFileSync, spawn } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ENV_KEY = "K8S_TENANT_ADMIN_KUBECONFIG_B64";
export const PREPROD_NS = "geo-preprod";
export const PROD_NS = "geo";

const CONNECTION_OVERRIDES = ["--kubeconfig", "--context", "--cluster", "--user", "--token", "--server", "--as", "--as-group", "--as-uid", "--username", "--password"];

export class RefusedError extends Error {}

/**
 * Validate kubectl args against the namespace guard. Returns the args to pass to kubectl
 * (with `--prod-ok` removed and a default namespace injected when none is given).
 */
export function guardArgs(argv) {
  let prodOk = false;
  const args = [];
  const namespaces = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prod-ok") { prodOk = true; continue; }
    if (a === "-A" || a === "--all-namespaces" || a.startsWith("--all-namespaces=")) {
      throw new RefusedError("all-namespaces is refused (tenant scope only)");
    }
    if (a === "-s" || a.startsWith("-s=")) throw new RefusedError(`connection override refused: ${a.split("=")[0]}`);
    for (const flag of CONNECTION_OVERRIDES) {
      if (a === flag || a.startsWith(`${flag}=`)) throw new RefusedError(`connection override refused: ${flag}`);
    }
    if (a === "-n" || a === "--namespace") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) throw new RefusedError(`${a} needs a value`);
      namespaces.push(v);
      args.push(a, v);
      i++;
      continue;
    }
    if (a.startsWith("--namespace=")) { namespaces.push(a.slice("--namespace=".length)); args.push(a); continue; }
    if (a.startsWith("-n=")) { namespaces.push(a.slice(3)); args.push(a); continue; }
    if (/^-n[^-]/.test(a)) { namespaces.push(a.slice(2)); args.push(a); continue; }
    args.push(a);
  }

  for (const ns of namespaces) {
    if (ns === PREPROD_NS) continue;
    if (ns === PROD_NS) {
      if (!prodOk) throw new RefusedError(`namespace ${PROD_NS} needs the explicit --prod-ok flag`);
      continue;
    }
    throw new RefusedError(`namespace ${ns} is refused (allowed: ${PREPROD_NS}; ${PROD_NS} with --prod-ok)`);
  }
  if (prodOk && !namespaces.includes(PROD_NS)) {
    throw new RefusedError(`--prod-ok needs an explicit --namespace ${PROD_NS}`);
  }
  if (new Set(namespaces).size > 1) throw new RefusedError("conflicting namespace flags");

  const positionals = args.filter((a) => !a.startsWith("-"));
  if (positionals[0] === "config") throw new RefusedError("`config` is refused (it would print the kubeconfig)");
  const readsSecret = positionals.some((p) => /^secrets?(\/|$)/.test(p) || /(^|,)secrets?(,|$)/.test(p));
  const hasOutput = args.some((a) => a === "-o" || a === "--output" || a.startsWith("-o") || a.startsWith("--output="));
  if (positionals[0] === "get" && readsSecret && hasOutput) {
    throw new RefusedError("reading Secret contents (get secret -o …) is refused");
  }

  if (namespaces.length === 0) args.push(`--namespace=${PREPROD_NS}`);
  return args;
}

/** Stream the env file and return ONLY the value of `key` (undefined if absent). Nothing else is kept. */
export async function readEnvValue(file, key = ENV_KEY) {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  const prefixes = [`${key}=`, `export ${key}=`];
  try {
    for await (const line of rl) {
      const trimmed = line.trimStart();
      const prefix = prefixes.find((p) => trimmed.startsWith(p));
      if (!prefix) continue;
      let value = trimmed.slice(prefix.length).trim();
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
      return value;
    }
  } finally {
    rl.close();
  }
  return undefined;
}

/** Decode the base64 kubeconfig into a fresh 0700 dir / 0600 file. Returns { path, cleanup }. */
export function materializeKubeconfig(b64, baseDir = tmpdir()) {
  const decoded = Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8");
  if (!/\bclusters\s*:/.test(decoded) || !/\bapiVersion\s*:/.test(decoded)) {
    throw new Error(`${ENV_KEY} does not decode to a kubeconfig`);
  }
  const dir = mkdtempSync(join(baseDir, "k8s-tenant-"));
  const path = join(dir, "kubeconfig");
  writeFileSync(path, decoded, { mode: 0o600 });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    rmSync(dir, { recursive: true, force: true });
  };
  return { path, cleanup };
}

function defaultEnvFile() {
  if (process.env.K8S_TENANT_ENV_FILE) return resolve(process.env.K8S_TENANT_ENV_FILE);
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from the main checkout and from any linked worktree: the .env sits next to the common .git.
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: here, encoding: "utf8" }).trim();
  const commonAbs = isAbsolute(common) ? common : resolve(here, common);
  return join(dirname(commonAbs), ".env");
}

async function main(argv) {
  let kubectlArgs;
  try {
    kubectlArgs = guardArgs(argv);
  } catch (error) {
    if (error instanceof RefusedError) {
      console.error(`k8s-tenant: refused: ${error.message}`);
      return 64;
    }
    throw error;
  }

  const envFile = defaultEnvFile();
  let b64;
  try {
    b64 = await readEnvValue(envFile);
  } catch (error) {
    console.error(`k8s-tenant: cannot read env file ${envFile}: ${error.code ?? "error"}`);
    return 65;
  }
  if (!b64) {
    console.error(`k8s-tenant: ${ENV_KEY} not found in ${envFile}`);
    return 65;
  }

  let kube;
  try {
    kube = materializeKubeconfig(b64);
  } catch (error) {
    console.error(`k8s-tenant: ${error.message}`);
    return 65;
  }
  b64 = undefined;
  process.on("exit", kube.cleanup);

  return await new Promise((resolveCode) => {
    const child = spawn("kubectl", ["--kubeconfig", kube.path, ...kubectlArgs], { stdio: "inherit" });
    const forward = (signal) => { if (child.exitCode === null) child.kill(signal); };
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => forward(s));
    child.on("error", (error) => {
      kube.cleanup();
      console.error(`k8s-tenant: cannot run kubectl: ${error.code ?? error.message}`);
      resolveCode(127);
    });
    child.on("exit", (code, signal) => {
      kube.cleanup();
      resolveCode(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
  });
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`k8s-tenant: fatal: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
