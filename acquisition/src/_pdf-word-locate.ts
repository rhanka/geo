/**
 * _pdf-word-locate.ts — locate words matching a regex and report their bbox as
 * PAGE FRACTIONS, in the same frame `extractLabels` uses.
 *
 * Why: `--exclude-region` / `GcpFile.excludeRegions` are page fractions in the
 * pdftotext frame (origin top-left). A rendered PNG can be ROTATED relative to
 * that frame (an A0 sheet stored portrait with /Rotate 90 displays landscape), so
 * fractions eyeballed off the image are wrong. This measures them from the words
 * themselves — the title block is found by its own text, never by guesswork.
 *
 * $0: poppler only.
 *
 * Usage:
 *   npx tsx acquisition/src/_pdf-word-locate.ts --pdf <path> --page 3 --find 'VM-89'
 */
import { pdftotextWords } from "./lib/t1-labels.js";

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pdf = arg("pdf");
  const page = parseInt(arg("page") ?? "1", 10);
  const find = arg("find");
  if (!pdf || !find) {
    console.error("usage: --pdf <path> --page <n> --find <regex>");
    process.exit(2);
  }
  const re = new RegExp(find, "i");
  const { words, pageW, pageH } = pdftotextWords(pdf, { page });
  const hits = words.filter((w) => re.test(w.text) && w.xMin !== undefined);
  console.log(`page ${page}: ${pageW} x ${pageH} (pdftotext frame) | ${words.length} mots | ${hits.length} hits pour /${find}/i\n`);
  if (hits.length === 0) return;

  const fx0 = Math.min(...hits.map((w) => w.xMin!)) / pageW;
  const fx1 = Math.max(...hits.map((w) => w.xMax!)) / pageW;
  const fy0 = Math.min(...hits.map((w) => w.yMin!)) / pageH;
  const fy1 = Math.max(...hits.map((w) => w.yMax!)) / pageH;

  for (const w of hits.slice(0, 8)) {
    console.log(
      `  « ${w.text} »  fx=${(w.pageX / pageW).toFixed(4)} fy=${(w.pageY / pageH).toFixed(4)}`,
    );
  }
  if (hits.length > 8) console.log(`  … +${hits.length - 8}`);
  console.log(`\nbbox englobante (fractions de page, y vers le bas) :`);
  console.log(`  --exclude-region ${fx0.toFixed(4)},${fy0.toFixed(4)},${fx1.toFixed(4)},${fy1.toFixed(4)}`);
}

main();
