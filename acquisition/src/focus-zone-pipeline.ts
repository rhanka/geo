/**
 * focus-zone-pipeline.ts -- one-slug trigger for the immo zone/grid refresh chain.
 *
 * Scope: assumes the current official zoning geometry is already deposited. This
 * script does not acquire zoning. It runs the existing lot->zone and served lots
 * materialization tools, reconciles coverage, then re-runs the coherence gate.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildGateReport,
  DEFAULT_REPORT,
  evaluateCoherenceSlugs,
  printGateReport,
  writeGateReport,
} from "./zone-grille-coherence-gate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, "..");
const DEFAULT_THRESHOLD = 0.5;

interface Args {
  slugs: string[];
  threshold: number;
  noReconcile: boolean;
  lotsExtra: string[];
}

function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf("--" + key);
  return i >= 0 ? argv[i + 1] : undefined;
}

function uniqueList(csv: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of csv.split(",")) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function parseArgs(argv: string[]): Args {
  const csv = arg(argv, "slugs") ?? arg(argv, "slug");
  if (!csv) throw new Error("usage: npx tsx src/focus-zone-pipeline.ts --slug <s> OR --slugs <a,b>");
  const threshold = Number(arg(argv, "threshold") ?? String(DEFAULT_THRESHOLD));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("--threshold must be a number between 0 and 1");
  }
  const lotsExtra: string[] = [];
  if (argv.includes("--no-role")) lotsExtra.push("--no-role");
  if (argv.includes("--no-fsa")) lotsExtra.push("--no-fsa");
  const timeBox = arg(argv, "time-box");
  if (timeBox) lotsExtra.push("--time-box", timeBox);
  const maxMb = arg(argv, "max-mb");
  if (maxMb) lotsExtra.push("--max-mb", maxMb);
  return {
    slugs: uniqueList(csv),
    threshold,
    noReconcile: argv.includes("--no-reconcile"),
    lotsExtra,
  };
}

function runStep(label: string, scriptArgs: string[]): void {
  const nodeArgs = ["--import", "tsx", ...scriptArgs];
  console.log("ETAPE " + label + " : node " + nodeArgs.join(" "));
  const r = spawnSync(process.execPath, nodeArgs, {
    cwd: ACQ,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.stdout && r.stdout.trim()) console.log(r.stdout.trim());
  if (r.stderr && r.stderr.trim()) console.error(r.stderr.trim());
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(label + " failed with status " + String(r.status));
}

function percent(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

async function runSlug(slug: string, args: Args): Promise<void> {
  const beforeRows = await evaluateCoherenceSlugs([slug], args.threshold);
  const before = beforeRows[0];
  if (!before) throw new Error("gate returned no row for " + slug);
  console.log(
    "AVANT " +
      slug +
      " strict=" +
      percent(before.recouvrement_strict) +
      " bridged=" +
      percent(before.recouvrement_bridged) +
      " flags=" +
      before.flags.join(","),
  );

  runStep("lot-zone-join " + slug, ["src/lot-zone-join-run.ts", "--slugs", slug]);
  runStep("lots-enriched " + slug, ["src/lots-enriched-run.ts", "--slugs", slug, ...args.lotsExtra]);
  if (!args.noReconcile) runStep("coverage-reconcile " + slug, ["src/coverage-reconcile.ts"]);

  const afterRows = await evaluateCoherenceSlugs([slug], args.threshold);
  const after = afterRows[0];
  if (!after) throw new Error("gate returned no post-run row for " + slug);
  const report = buildGateReport(afterRows, args.threshold);
  writeGateReport(report, DEFAULT_REPORT);
  printGateReport(report);
  console.log(
    "APRES " +
      slug +
      " strict=" +
      percent(after.recouvrement_strict) +
      " bridged=" +
      percent(after.recouvrement_bridged) +
      " flags=" +
      after.flags.join(","),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const slug of args.slugs) await runSlug(slug, args);
  console.log("PIPELINE DONE slugs=" + args.slugs.join(","));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
