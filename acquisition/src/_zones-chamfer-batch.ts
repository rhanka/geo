/**
 * _zones-chamfer-batch.ts — passe T3 §6.5 en lot : `t3-chamfer-seed` puis
 * `t2-raster-register` sur des plans RASTER (`svg_points = 0`), le motif
 * dominant du residu mesure cette passe (12/12 slugs jamais tentes rejetes par
 * `--auto-seed` faute de coins vectoriels).
 *
 * Le seed n'est JAMAIS servi : T3 doit re-deriver des controles INDEPENDANTS
 * patch-verifies, et la couverture-lots arbitre en aval (spec §8).
 *
 * Usage: npx tsx acquisition/src/_zones-chamfer-batch.ts --slugs a,b,c
 *          [--tag t] [--page 1] [--dpi 150] [--timeout-s 330] [--rotations 0,90,180,270]
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
const tag = opt("tag") ?? "chamfer";
const page = opt("page") ?? "1";
const dpi = opt("dpi") ?? "150";
const rotations = opt("rotations") ?? "0";
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

const rows: { slug: string; seed: string; t3: string }[] = [];

for (const slug of slugs) {
  const pdf = biggestPdf(slug);
  console.log(`\n### ${slug}  ${pdf?.path ?? "(aucun pdf)"}`);
  if (!pdf) {
    rows.push({ slug, seed: "PAS-DE-PDF", t3: "-" });
    continue;
  }
  const seedGcp = `work/gcp/${slug}.${tag}-seed.gcp.json`;
  const seedRep = `work/gcp/${slug}.${tag}-seed.report.json`;
  const cadDump = `work/cadastre/${slug}.geojson`;

  const s = spawnSync(
    "npx",
    [
      "tsx", "acquisition/src/t3-chamfer-seed.ts",
      "--slug", slug, "--pdf", pdf.path, "--page", page, "--dpi", dpi,
      "--rotations", rotations,
      "--out-gcp", seedGcp, "--report", seedRep, "--dump-cadastre", cadDump,
    ],
    { encoding: "utf8", timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 },
  );
  let seedVerdict = s.status === 0 ? "SEED-OK" : "SEED-REJET";
  if (s.error && (s.error as any).code === "ETIMEDOUT") seedVerdict = "SEED-TIMEOUT";
  let detail = "";
  if (existsSync(seedRep)) {
    try {
      const j = JSON.parse(readFileSync(seedRep, "utf8"));
      detail = `pass=${j.pass} rot=${j.rotation_deg ?? "-"} ratio=${j.scale_ratio ?? "-"} score=${j.score_m ?? "-"}m inliers=${j.inlier_pct ?? "-"}% marge=${j.margin_pct ?? "-"}%`;
    } catch {
      detail = "(rapport illisible)";
    }
  } else {
    detail = (s.stderr ?? "").split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 200);
  }
  console.log(`   ${seedVerdict}  ${detail}`);

  let t3Verdict = "-";
  if (seedVerdict === "SEED-OK" && existsSync(seedGcp)) {
    const t3Rep = `work/gcp/${slug}.${tag}-t3.report.json`;
    const t3Gcp = `work/gcp/${slug}.${tag}-t3.gcp.json`;
    const t = spawnSync(
      "npx",
      [
        "tsx", "acquisition/src/t2-raster-register.ts",
        "--slug", slug, "--pdf", pdf.path, "--page", page,
        "--gcp", seedGcp, "--cadastre", cadDump,
        "--out-gcp", t3Gcp, "--report", t3Rep,
      ],
      { encoding: "utf8", timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 },
    );
    t3Verdict = t.status === 0 ? "T3-OK" : "T3-REJET";
    if (t.error && (t.error as any).code === "ETIMEDOUT") t3Verdict = "T3-TIMEOUT";
    let td = "";
    if (existsSync(t3Rep)) {
      try {
        const j = JSON.parse(readFileSync(t3Rep, "utf8"));
        td = `pass=${j.pass} gcps=${j.selected_gcps ?? "-"} resid=${j.residual_max_m ?? "-"} holdout=${j.holdout_max_m ?? "-"} :: ${String(j.reason ?? "").slice(0, 140)}`;
      } catch {
        td = "(rapport illisible)";
      }
    } else td = (t.stderr ?? "").split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 200);
    console.log(`   ${t3Verdict}  ${td}`);
    t3Verdict += " " + td;
  }
  rows.push({ slug, seed: `${seedVerdict} ${detail}`, t3: t3Verdict });
}

console.log("\n=== RÉCAP ===");
for (const r of rows) console.log(`${r.slug.padEnd(32)} | ${r.seed}\n${"".padEnd(32)} | ${r.t3}`);
