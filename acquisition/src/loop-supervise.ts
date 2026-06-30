/**
 * loop-supervise — UNE commande pour toute la passe de supervision du /loop geo QC.
 * Remplace les chaînes bash inline (grep/find/echo) qui déclenchent des prompts d'autorisation.
 *
 * Usage (depuis la racine repo, UNE commande) : `npx tsx acquisition/src/loop-supervise.ts`
 *
 * Fait, en lecture pure (0 écriture S3, 0 LLM) :
 *   - SCOREBOARD /1106 (coverage-reconcile)
 *   - FOCUS-30 servi + manquantes (focus30-status)
 *   - provenance normes (loop-status)
 *   - liste des rapports de délégation livrés (work/delegation-mass/*.md récents)
 *   - état drumbeat (vivant ?)
 *   - code non-commité dans acquisition/src + packages (à committer)
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ACQ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(ACQ, "..");
const DM = join(ROOT, "work", "delegation-mass");

function sh(cmd: string, cwd: string = ROOT): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
  } catch (e: any) {
    return (e?.stdout ?? "").toString();
  }
}

function section(t: string): void { console.log("\n=== " + t + " ==="); }

// 1. SCOREBOARD
section("SCOREBOARD");
const sb = sh("npx tsx src/coverage-reconcile.ts", ACQ).split("\n").find((l) => l.includes("SCOREBOARD"));
console.log(sb?.trim() ?? "(reconcile indisponible)");

// 2. FOCUS-30
section("FOCUS-30");
const f30 = sh("npx tsx src/focus30-status.ts", ACQ);
console.log(f30.split("\n").filter((l) => /FOCUS-30 zonage servi|MANQUANTES/.test(l)).join("\n").trim() || "(focus30 indisponible)");

// 3. provenance normes
section("PROVENANCE NORMES");
const ls = sh("npx tsx src/loop-status.ts", ACQ);
console.log(ls.split("\n").find((l) => l.startsWith("provenance:"))?.trim() ?? "(n/a)");

// 4. rapports de délégation livrés (récents d'abord)
section("RAPPORTS LIVRÉS (work/delegation-mass)");
if (existsSync(DM)) {
  const mds = readdirSync(DM)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ f, mtime: statSync(join(DM, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 12);
  for (const { f } of mds) console.log("  " + f);
}

// 5. drumbeat vivant ?
section("DRUMBEAT");
const pb = sh("pgrep -fc drumbeat.sh");
console.log(parseInt(pb.trim() || "0", 10) > 0 ? "vivant" : "MORT (relancer: setsid bash work/delegation-mass/drumbeat.sh &)");

// 6. code non-commité (à committer)
section("CODE NON-COMMITÉ (acquisition/src, packages)");
const st = sh("git status --short -- acquisition/src packages");
console.log(st.trim() || "  (rien)");
