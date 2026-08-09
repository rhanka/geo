/**
 * _render-pdf-page — diagnostic $0 (poppler seul), rend UNE page de PDF en PNG.
 *
 * POURQUOI : quand une page porte 0 texte, deux causes INDISCERNABLES sans la voir :
 *   (a) une IMAGE de grille (→ fenêtre Mistral prouvée), ou
 *   (b) une page BLANCHE / page-de-garde d'annexe dont le contenu réel vit dans un
 *       PDF frère (→ inutile de payer l'OCR, c'est un défaut de DÉCOUVERTE).
 * L'OCR qui rend « 0 zones » ne tranche pas entre les deux ; l'oeil, oui.
 *
 * Rend via pdftoppm INSIDE node (execFileSync), donc non gaté par le hook bash.
 *
 * Usage: npx tsx acquisition/src/_render-pdf-page.ts --pdf <path> --page N --out <png-prefix> [--dpi 110]
 */
import { execFileSync } from "node:child_process";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main(): void {
  const pdf = arg("--pdf");
  const page = arg("--page");
  const out = arg("--out");
  const dpi = arg("--dpi", "110");
  if (!pdf || !page || !out) {
    console.log("usage: _render-pdf-page.ts --pdf <path> --page N --out <png-prefix> [--dpi 110]");
    process.exit(1);
  }
  execFileSync(
    "pdftoppm",
    ["-png", "-r", dpi, "-f", page, "-l", page, pdf, out],
    { stdio: "inherit" },
  );
  console.log(`rendered ${pdf} p${page} -> ${out}-*.png (dpi=${dpi})`);
}

main();
