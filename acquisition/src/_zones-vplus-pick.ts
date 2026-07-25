/** $0: summarize the vplus-discover sweep — rank each slug's plan candidates,
 * flag the ones that look like an actual ZONING MAP (carte/plan de zonage) vs a
 * bylaw-text PDF. Usage: npx tsx acquisition/src/_zones-vplus-pick.ts <sweep.json> */
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const MAP_RE = /carte.{0,6}(de.{0,3})?zonage|plan.{0,6}(de.{0,3})?zonage|zonage.{0,4}plan|carte.{0,6}sommaire|carte\.pdf|plan.?durbanisme|plan.?urbanisme|affectation/i;
const TEXT_RE = /r[èe]gl|amend|modif|no-?\d|20\d\d-\d/i;
for (const r of j.withPlan) {
  const maps = r.plans.filter((p: any) => MAP_RE.test(p.name) && !/piia|forest|exploitation/i.test(p.name));
  console.log(`\n### ${r.slug}  (${r.host})  routes=${r.routes}`);
  for (const p of r.plans) {
    const isMap = MAP_RE.test(p.name) && !/piia|forest|exploitation/i.test(p.name);
    const tag = isMap ? "🗺️ MAP " : (TEXT_RE.test(p.name) ? "📄 text" : "  ??  ");
    console.log(`  ${tag} ${p.name}  [${p.route}]`);
  }
  if (maps.length) console.log(`  → ${maps.length} map-candidate(s)`);
}
console.log(`\nvplusNoPlan: ${(j.vplusNoPlan||[]).map((r:any)=>r.slug).join(", ")}`);
