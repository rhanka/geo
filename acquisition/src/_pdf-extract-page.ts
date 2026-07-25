/**
 * _pdf-extract-page.ts — extrait UNE page d'un PDF en préservant les objets
 * (pdfseparate), contrairement à `_pdf-crop-page.ts` qui RÉ-ÉMET la page via
 * pdftocairo et détruirait un géoréf embarqué (/VP /Measure /GPTS).
 *
 * Sert la voie « le plan de zonage est une planche A0 DANS un corps de 270
 * pages » : `t1-build` travaille sur la page 1, il faut donc lui donner la
 * planche seule.
 *
 * Usage: npx tsx acquisition/src/_pdf-extract-page.ts <pdf> <page> <out.pdf>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const [pdf, page, out] = process.argv.slice(2);
if (!pdf || !page || !out) throw new Error("usage: _pdf-extract-page.ts <pdf> <page> <out.pdf>");
mkdirSync(dirname(out), { recursive: true });

execFileSync("pdfseparate", ["-f", page, "-l", page, pdf, out], { stdio: "inherit" });
const st = statSync(out);
console.log(`WROTE ${out} (${st.size} o) — page ${page} de ${pdf}`);
const info = execFileSync("pdfinfo", [out], { encoding: "utf8" });
console.log(info.split("\n").filter((l) => /^(Pages|Page size|Page rot|Producer|Creator)/.test(l)).join("\n"));
