/**
 * Materialise immutable restart worklists from a measured report. Only rows
 * still marked pending_capture are eligible; all target identity and excluded
 * old-source fields are copied from the original closed-scope worklists.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDensityDiscoveryResumeWorklists,
  parseDensityDiscoveryWorklist,
} from "../../packages/qc-sources/src/sources/density-document-discovery.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) =>
    value === `--${name}` && argv[index + 1] ? [argv[index + 1]!] : []);
}

function option(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

function repoPath(value: string, label: string): string {
  const path = resolve(value);
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`${label} doit rester dans le dépôt`);
  return path;
}

function main(): void {
  const argv = process.argv.slice(2);
  const worklistPaths = values(argv, "worklist").map((path) => repoPath(path, "--worklist"));
  const reportPath = repoPath(
    option(argv, "report") ?? "work/coverage/density-document-discovery-report-20260728.json",
    "--report",
  );
  const outPrefix = repoPath(
    option(argv, "out-prefix") ?? "acquisition/config/density-document-discovery-20260728-resume-lot-",
    "--out-prefix",
  );
  const firstLot = Number(option(argv, "first-lot") ?? "6");
  if (worklistPaths.length === 0) throw new Error("au moins un --worklist est requis");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    scopeCount?: unknown;
    rows?: Array<{ slug?: unknown; status?: unknown }>;
  };
  if (report.scopeCount !== 56 || !Array.isArray(report.rows) || report.rows.length !== 56) {
    throw new Error("rapport de reprise incomplet ou hors périmètre");
  }
  const pending = new Set(
    report.rows
      .filter((row) => row.status === "pending_capture")
      .map((row) => {
        if (typeof row.slug !== "string") throw new Error("slug pending invalide");
        return row.slug;
      }),
  );
  const source = worklistPaths.map((path) =>
    parseDensityDiscoveryWorklist(JSON.parse(readFileSync(path, "utf8"))));
  const resume = buildDensityDiscoveryResumeWorklists(source, pending, firstLot);
  for (const worklist of resume) {
    const path = `${outPrefix}${String(worklist.lot).padStart(2, "0")}.json`;
    if (existsSync(path)) throw new Error(`refus d'écraser la reprise immuable: ${path}`);
    writeFileSync(path, `${JSON.stringify(worklist, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${path.replace(`${ROOT}/`, "")}\t${worklist.targets.length}\n`);
  }
}

main();
