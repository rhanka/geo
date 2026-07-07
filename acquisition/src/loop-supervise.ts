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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

// 2b. FOCUS-30 par couche (zones/normes/pv) — cohérence démo
section("FOCUS-30 PAR COUCHE");
const f30all = sh("npx tsx src/focus30-allayers.ts", ACQ);
console.log(f30all.split("\n").filter((l) => /TOTAUX|MANQUE/.test(l)).join("\n").trim() || "(focus30-allayers indisponible)");

// 2c. ZONAGE QUALITÉ (servi ≠ bon) — lecture du cache qualité-aware (0 S3 dans le tick).
//     Rafraîchir le cache : `npx tsx src/zonage-reacquire-audit.ts` (recalcule overlap+pont).
section("ZONAGE QUALITÉ (servi ≠ bon)");
{
  const cache = join(ROOT, "work", "coverage", "zones-quality.json");
  if (existsSync(cache)) {
    try {
      const q = JSON.parse(readFileSync(cache, "utf8"));
      const age = Math.round((Date.now() - new Date(q.generatedAt).getTime()) / 3600000);
      console.log(
        `${q.zonesDone} servis — OK-joignable=${q.ok} | à-ré-acquérir(SIG)=${q.reacquire} ` +
          `(affectation ${q.reacquireAffectation} / sans-codes ${q.reacquireSigNoCodes} / disjoint ${q.reacquireDisjoint}) | ` +
          `normes-à-ré-extraire(SIG-ok)=${q.normesSuspect} | indéterminé=${q.indeterminate}` +
          (q.needsManifestRefresh ? ` | +${q.needsManifestRefresh} manifeste-à-rafraîchir` : "") +
          `  (cache ${age}h)`,
      );
      console.log(
        `  focus-30 : ${q.focus30.zonesServed} servis — OK=${q.focus30.ok} | à-réacq=${q.focus30.reacquire} ` +
          `| normes-suspect=${q.focus30.normesSuspect} | indét=${q.focus30.indeterminate}` +
          (q.focus30.reacquireSlugs?.length ? ` [réacq: ${q.focus30.reacquireSlugs.join(", ")}]` : ""),
      );
    } catch {
      console.log("(cache zones-quality.json illisible — relancer zonage-reacquire-audit.ts)");
    }
  } else {
    console.log("(pas de cache — lancer `npx tsx src/zonage-reacquire-audit.ts` pour l'indicateur qualité)");
  }
}

// 3. IMMO LOTS
section("IMMO LOTS");
{
  const cache = join(ROOT, "work", "coverage", "immo-lots.json");
  if (existsSync(cache)) {
    try {
      const q = JSON.parse(readFileSync(cache, "utf8"));
      const age = Math.round((Date.now() - new Date(q.generatedAt).getTime()) / 3600000);
      const byKey = new Map((q.fields ?? []).map((f: any) => [f.key, f]));
      const f = (key: string): string => {
        const x = byKey.get(key) as any;
        return x ? `${key}=${x.pct}% (${x.numWith}/${x.denom})` : `${key}=n/a`;
      };
      console.log(
        `${q.servedMunis} munis servis /${q.totalMunis} — ` +
          [f("surface_m2"), f("adresse"), f("code_postal"), f("folded-normes"), f("in_tod")].join(" | ") +
          ` | TOD true=${q.numInTod}/${q.todLots} lots | ${q.missingStats} sans-stats (cache ${age}h)`,
      );
    } catch {
      console.log("(cache immo-lots.json illisible — relancer immo-lots-audit.ts)");
    }
  } else {
    console.log("(pas de cache — lancer `npx tsx src/immo-lots-audit.ts` pour l'indicateur)");
  }
}

// 4. provenance normes
section("PROVENANCE NORMES");
const ls = sh("npx tsx src/loop-status.ts", ACQ);
console.log(ls.split("\n").find((l) => l.startsWith("provenance:"))?.trim() ?? "(n/a)");

// 5. rapports de délégation livrés (récents d'abord)
section("RAPPORTS LIVRÉS (work/delegation-mass)");
if (existsSync(DM)) {
  const mds = readdirSync(DM)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ f, mtime: statSync(join(DM, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 12);
  for (const { f } of mds) console.log("  " + f);
}

// 6. drumbeat vivant ?
section("DRUMBEAT");
// Politique worker: pas de sondage process dans cette supervision. On expose
// l'état à partir du heartbeat durable écrit par drumbeat.sh, si présent.
{
  const heartbeat = join(DM, "drumbeat.heartbeat.json");
  if (existsSync(heartbeat)) {
    try {
      const h = JSON.parse(readFileSync(heartbeat, "utf8"));
      const at = String(h.at ?? h.timestamp ?? h.updatedAt ?? "");
      const ageMin = at ? Math.round((Date.now() - new Date(at).getTime()) / 60000) : NaN;
      console.log(Number.isFinite(ageMin) ? `heartbeat ${ageMin}min (${at})` : `heartbeat présent (${heartbeat})`);
    } catch {
      console.log("heartbeat présent mais illisible");
    }
  } else {
    console.log("heartbeat absent (état process non sondé par politique)");
  }
}

// 7. code non-commité (à committer)
section("CODE NON-COMMITÉ (acquisition/src, packages)");
const st = sh("git status --short -- acquisition/src packages");
console.log(st.trim() || "  (rien)");
