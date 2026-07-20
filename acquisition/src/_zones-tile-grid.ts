/**
 * Rend une GRILLE de tuiles pour la voie `--labels claude` (lecture des glyphes
 * tuile par tuile) en une seule invocation, et imprime le squelette `tiles`
 * prêt à coller dans work/reads/<slug>.tiles.json.
 *
 * Il ne fait QUE de la découpe déterministe : aucune lecture, aucune étiquette.
 *
 * Usage :
 *   npx tsx acquisition/src/_zones-tile-grid.ts --pdf <file> \
 *     --box x0,y0,x1,y1 --cols 4 --rows 4 [--page 1] [--dpi 150]
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const pdf = arg("pdf");
const box = (arg("box", "0,0,1,1") as string).split(",").map(Number);
const cols = Number(arg("cols", "4"));
const rows = Number(arg("rows", "4"));
const page = arg("page", "1")!;
const dpi = arg("dpi", "150")!;
if (!pdf || box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
  throw new Error("required: --pdf <file> --box x0,y0,x1,y1 [--cols 4] [--rows 4] [--page 1] [--dpi 150]");
}
const [bx0, by0, bx1, by1] = box as [number, number, number, number];
const dx = (bx1 - bx0) / cols;
const dy = (by1 - by0) / rows;

const r = (n: number) => Number(n.toFixed(4));
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < cols; i++) {
    const crop = [r(bx0 + i * dx), r(by0 + j * dy), r(bx0 + (i + 1) * dx), r(by0 + (j + 1) * dy)];
    const id = `r${j + 1}c${i + 1}`;
    const out = execFileSync(
      "npx",
      [
        "tsx",
        "acquisition/src/zones-tile-render.ts",
        "--pdf",
        pdf,
        "--crop",
        crop.join(","),
        "--page",
        page,
        "--dpi",
        dpi,
        "--id",
        id,
      ],
      { encoding: "utf8" },
    );
    const png = out.trim().split("\n").pop()!.trim();
    console.log(`${id}\t${crop.join(",")}\t${png}`);
  }
}
