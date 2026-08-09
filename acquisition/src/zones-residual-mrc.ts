/**
 * zones-residual-mrc.ts — liste les munis dont `zones` ≠ done, groupés par MRC,
 * pour prioriser la découverte SIG (agrégats FeatureServer multi-muni). Lecture
 * pure de la matrice + registre (0 réseau, 0 LLM). N'écrit rien.
 *
 * Usage :
 *   npx tsx src/zones-residual-mrc.ts                 # top MRC par nb de résidus
 *   npx tsx src/zones-residual-mrc.ts --mrc "Coaticook"  # slugs résiduels d'une MRC
 *   npx tsx src/zones-residual-mrc.ts --min 4          # MRC avec ≥4 résidus
 */
import { allMunicipalities, loadMatrix } from "./coverage-matrix.js";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const mrcFilter = get("mrc");
  const min = Number(get("min") ?? 1);

  const matrix = loadMatrix();
  if (!matrix) { console.error("matrice absente"); process.exit(1); return; }
  const munis = allMunicipalities();

  interface Row { mrc: string; total: number; residual: string[] }
  const byMrc = new Map<string, Row>();
  for (const m of munis) {
    const mrc = m.mrc ?? "(sans MRC)";
    let row = byMrc.get(mrc);
    if (!row) byMrc.set(mrc, (row = { mrc, total: 0, residual: [] }));
    row.total++;
    const cell = matrix.cities[m.slug]?.zones;
    if (!cell || cell.status !== "done") row.residual.push(m.slug);
  }

  if (mrcFilter) {
    const hit = [...byMrc.values()].filter((r) => norm(r.mrc).includes(norm(mrcFilter)));
    for (const r of hit) {
      console.log(`\n${r.mrc}  (${r.residual.length}/${r.total} résidus)`);
      console.log(r.residual.join(","));
    }
    return;
  }

  const rows = [...byMrc.values()].filter((r) => r.residual.length >= min)
    .sort((a, b) => b.residual.length - a.residual.length);
  let totalResidual = 0;
  for (const r of byMrc.values()) totalResidual += r.residual.length;
  console.log(`RÉSIDU zones≠done : ${totalResidual} munis / ${munis.length}  |  ${rows.length} MRC avec ≥${min}`);
  console.log("résidus  total  MRC");
  for (const r of rows) {
    console.log(`${String(r.residual.length).padStart(7)}  ${String(r.total).padStart(5)}  ${r.mrc}`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
