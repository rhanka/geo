/**
 * render-pages — committed helper to rasterize arbitrary grille pages to PNG for
 * VISUAL verification of the benchmark window (no LLM, no S3). Poppler pdftoppm only.
 *
 * Usage:
 *   npx tsx acquisition/src/bench/render-pages.ts --out <dir> --dpi 150 \
 *     --spec saint-narcisse:63 --spec ferme-neuve:188 --spec baie-comeau:16 ...
 * (--spec <slug>:<page> repeated). PDFs are read from work/zonage-norms/<slug>/grille.pdf.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WORK = join(REPO, "work", "zonage-norms");

function localGrille(slug: string): string | null {
  const dir = join(WORK, slug);
  if (!existsSync(dir)) return null;
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) return null;
  return join(dir, pdfs.find((f) => /grille/i.test(f)) ?? pdfs[0]!);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1]! : join(REPO, "work", "bench", "renders");
  const dpiIdx = argv.indexOf("--dpi");
  const dpi = dpiIdx >= 0 ? argv[dpiIdx + 1]! : "150";
  mkdirSync(out, { recursive: true });
  const specs: Array<[string, string]> = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--spec" && argv[i + 1]) {
      const [slug, page] = argv[i + 1]!.split(":");
      if (slug && page) specs.push([slug, page]);
    }
  }
  for (const [slug, page] of specs) {
    const pdf = localGrille(slug);
    if (!pdf) {
      console.error(`[render] ${slug}: no staged pdf`);
      continue;
    }
    const prefix = join(out, `${slug}-p${page}`);
    try {
      await execFileP("pdftoppm", ["-png", "-r", dpi, "-f", page, "-l", page, "-singlefile", pdf, prefix]);
      console.error(`[render] ${slug} p${page} -> ${prefix}.png`);
    } catch (e) {
      console.error(`[render] ${slug} p${page}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(JSON.stringify({ rendered: specs.length, out }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
