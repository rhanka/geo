/**
 * _zones-autoseed-batch.ts — passe T2 `--auto-seed` en lot sur des slugs
 * `zones!=done` qui ont un plan sur disque et AUCUNE tentative enregistrée
 * (`work/gcp/<slug>*.report.json` absent).
 *
 * Ne sert rien lui-même : il produit les GcpFile + rapports numériques qui
 * décident ensuite d'un `t2-build`. Un échec est une PREUVE (résidu, raison),
 * pas un trou — c'est ce que la passe doit consigner.
 *
 * Usage:
 *   npx tsx acquisition/src/_zones-autoseed-batch.ts --slugs a,b,c [--outdir work/gcp]
 *     [--tag shard0of1-20260719] [--max-residual-m 15] [--min-gcps 8] [--timeout-s 330]
 * Le PDF retenu par slug = le plus GROS trouvé sous work/ dont le nom commence
 * par le slug (le nom de fichier nomme la muni ; cf. corpus-slug-owner-mismatch).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function opt(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slugs = (opt("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slugs.length) throw new Error("required: --slugs a,b,c");
const outdir = opt("outdir") ?? "work/gcp";
const tag = opt("tag") ?? "autoseed";
const maxResid = opt("max-residual-m") ?? "15";
const minGcps = opt("min-gcps") ?? "8";
const timeoutS = Number(opt("timeout-s") ?? "330");

function biggestPdf(slug: string): { path: string; size: number } | undefined {
  let best: { path: string; size: number } | undefined;
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    let ents: string[];
    try {
      ents = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of ents) {
      if (e === "node_modules" || e === ".git") continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.pdf$/i.test(e)) {
        const n = e.toLowerCase().replace(/_/g, "-");
        const rest = n.startsWith(slug) ? n.slice(slug.length) : null;
        if (rest !== null && (rest === "" || /^[-._]/.test(rest)) && (!best || st.size > best.size))
          best = { path: p, size: st.size };
      }
    }
  };
  walk("work", 0);
  return best;
}

interface Row {
  slug: string;
  pdf?: string;
  status: string;
  detail: string;
}
const rows: Row[] = [];

for (const slug of slugs) {
  const pdf = biggestPdf(slug);
  if (!pdf) {
    rows.push({ slug, status: "PAS-DE-PDF", detail: "aucun PDF sur disque dont le nom porte le slug" });
    console.log(`\n### ${slug}  → PAS-DE-PDF`);
    continue;
  }
  const report = `${outdir}/${slug}.${tag}.report.json`;
  const gcp = `${outdir}/${slug}.${tag}.gcp.json`;
  console.log(`\n### ${slug}  ${pdf.path} (${pdf.size}o)`);
  const r = spawnSync(
    "npx",
    [
      "tsx",
      "acquisition/src/t2-autogcp.ts",
      "--slug", slug,
      "--auto-seed",
      "--pdf", pdf.path,
      "--page", "1",
      "--out-gcp", gcp,
      "--report", report,
      "--max-residual-m", maxResid,
      "--min-gcps", minGcps,
      "--rotation-disambig", "lots",
    ],
    { encoding: "utf8", timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 },
  );
  let status = r.status === 0 ? "PASS" : "REJET";
  let detail = "";
  if (r.error && (r.error as any).code === "ETIMEDOUT") {
    status = "TIMEOUT";
    detail = `> ${timeoutS}s`;
  } else if (existsSync(report)) {
    try {
      const j = JSON.parse(readFileSync(report, "utf8"));
      detail =
        `pass=${j.pass} svg=${j.svg_points} resid=${j.residual_max_m ?? "-"} holdout=${j.holdout_max_m ?? "-"} ` +
        `gcps=${j.selected_gcps ?? "-"} :: ${String(j.reason ?? "").slice(0, 160)}`;
      if (j.pass) status = "PASS";
    } catch {
      detail = "(rapport illisible)";
    }
  } else {
    detail = (r.stderr ?? "").split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 200);
  }
  console.log(`   ${status}  ${detail}`);
  rows.push({ slug, pdf: pdf.path, status, detail });
}

console.log("\n=== RÉCAP ===");
for (const r of rows) console.log(`${r.status.padEnd(10)} ${r.slug.padEnd(34)} ${r.detail}`);
console.log(`\nPASS=${rows.filter((r) => r.status === "PASS").length} / ${rows.length}`);
