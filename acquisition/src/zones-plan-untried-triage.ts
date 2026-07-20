/**
 * Triage $0 : quels slugs zones!=done ont DÉJÀ un plan PDF sur disque
 * (work/zonage-plans/**) SANS avoir de fichier GCP dérivé (work/gcp/**) ?
 *
 * Ce sont les candidats « découverte déjà payée, recalage jamais tenté (ou tenté sans
 * rien produire) » — la cible la moins chère de la lane recalage.
 *
 * Usage : npx tsx acquisition/src/zones-plan-untried-triage.ts [--json] [--with-gcp]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const has = (name: string) => process.argv.includes(`--${name}`);

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

const matrix = JSON.parse(readFileSync(resolve("work/coverage/coverage-matrix.json"), "utf8"));
const cities: Record<string, any> = matrix.cities ?? {};
const nonDone = Object.keys(cities).filter(
  (s) => (cities[s]?.zones?.status ?? "unknown") !== "done",
);
const byLength = [...nonDone].sort((a, b) => b.length - a.length);

function matchSlug(name: string): string | null {
  const lower = name.toLowerCase();
  return byLength.find((s) => lower.startsWith(`${s}-`) || lower.startsWith(`${s}.`)) ?? null;
}

const plansRoot = resolve("work/zonage-plans");
const gcpRoot = resolve("work/gcp");

const plansBySlug = new Map<string, { path: string; bytes: number }[]>();
for (const p of walk(plansRoot)) {
  if (!p.toLowerCase().endsWith(".pdf")) continue;
  const name = p.split("/").pop()!;
  const slug = matchSlug(name);
  if (!slug) continue;
  let bytes = 0;
  try {
    bytes = statSync(p).size;
  } catch {
    /* ignore */
  }
  if (!plansBySlug.has(slug)) plansBySlug.set(slug, []);
  plansBySlug.get(slug)!.push({ path: p.slice(resolve(".").length + 1), bytes });
}

const gcpSlugs = new Set<string>();
for (const p of walk(gcpRoot)) {
  if (!p.endsWith(".gcp.json")) continue;
  const name = p.split("/").pop()!;
  const slug = byLength.find((s) => name === `${s}.gcp.json` || name.startsWith(`${s}.`));
  if (slug) gcpSlugs.add(slug);
}

const rows = [...plansBySlug.entries()]
  .filter(([slug]) => (has("with-gcp") ? true : !gcpSlugs.has(slug)))
  .map(([slug, plans]) => {
    plans.sort((a, b) => b.bytes - a.bytes);
    return { slug, hasGcp: gcpSlugs.has(slug), nPlans: plans.length, plans };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

// `--missing` : le COMPLÉMENT — les non-done qui n'ont AUCUN plan sur disque. C'est le
// gros du résidu et il relève de la DÉCOUVERTE, pas du recalage.
if (has("missing")) {
  const missing = nonDone.filter((s) => !plansBySlug.has(s)).sort();
  const shard = Number(process.argv[process.argv.indexOf("--shard") + 1]);
  const nShards = Number(process.argv[process.argv.indexOf("--shards") + 1]);
  const out =
    Number.isFinite(shard) && Number.isFinite(nShards)
      ? missing.filter((_, i) => i % nShards === shard)
      : missing;
  for (const s of out) console.log(s);
  console.log(`# non-done SANS plan sur disque : ${out.length}/${missing.length}`);
  process.exit(0);
}

if (has("json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const r of rows) {
    console.log(
      `${r.slug}\tgcp=${r.hasGcp ? "Y" : "-"}\tn=${r.nPlans}\t${r.plans
        .slice(0, 3)
        .map((p) => `${p.path} (${Math.round(p.bytes / 1024)}k)`)
        .join(" | ")}`,
    );
  }
}
console.log(
  `# non-done avec plan sur disque${has("with-gcp") ? "" : " et SANS gcp"} : ${rows.length} (non-done total ${nonDone.length}, plans indexés ${plansBySlug.size})`,
);
