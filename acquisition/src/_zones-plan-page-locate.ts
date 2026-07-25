/**
 * _zones-plan-page-locate.ts — trouve LA page qui porte le plan de zonage dans un
 * CORPS de règlement (150-270 pages), au lieu de chamfrer la page 1.
 *
 * MESURÉ cette passe : `saint-robert`, `hebertville`, `cacouna`, `sainte-marthe`,
 * `sainte-louise`, `sainte-angele-de-premont` sont des CORPS de règlement, pas des
 * plans. Un lot qui chamfre la page 1 travaille sur un AVIS PUBLIC — et
 * `t3-chamfer-seed` + `t2-raster-register` ont quand même rendu « pass=true » avec
 * 14 GCP « indépendants » à 16 m sur une page A4 SANS AUCUNE CARTE. Le résidu est
 * auto-référentiel (spec §8) : il ne prouve rien sur l'existence d'une carte.
 * Localiser la page est donc un GATE, pas un confort.
 *
 * Deux signaux, tous deux $0 :
 *  1. la page du plan a une TAILLE différente du gabarit du corps (un plan est
 *     tiré en 24x36, le corps en letter) ;
 *  2. sa couche texte est PAUVRE en mots mais porte le titre (« PLAN DE ZONAGE »,
 *     « ANNEXE ») — une page de prose en a des centaines.
 *
 * Usage: npx tsx acquisition/src/_zones-plan-page-locate.ts <pdf> [--max-pages 400]
 */
import { execFileSync } from "node:child_process";

const pdf = process.argv[2];
if (!pdf) throw new Error("usage: _zones-plan-page-locate.ts <pdf>");
const mi = process.argv.indexOf("--max-pages");
const maxPages = mi >= 0 ? Number(process.argv[mi + 1]) : 400;

const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
const nPages = Math.min(Number((info.match(/Pages:\s*(\d+)/) ?? [])[1] ?? 0), maxPages);
if (!nPages) throw new Error("pdfinfo: 0 page");

const all = execFileSync("pdfinfo", ["-f", "1", "-l", String(nPages), pdf], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

interface Page {
  n: number;
  w: number;
  h: number;
  area: number;
}
const pages: Page[] = [];
const re = /Page\s+(\d+)\s+size:\s*([\d.]+)\s*x\s*([\d.]+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(all))) {
  const w = Number(m[2]);
  const h = Number(m[3]);
  pages.push({ n: Number(m[1]), w, h, area: w * h });
}
if (!pages.length) throw new Error("pdfinfo: aucune taille de page lue");

// Gabarit = taille modale (le corps du règlement).
const counts = new Map<string, number>();
for (const p of pages) counts.set(`${Math.round(p.w)}x${Math.round(p.h)}`, (counts.get(`${Math.round(p.w)}x${Math.round(p.h)}`) ?? 0) + 1);
const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
const [mw, mh] = modal[0].split("x").map(Number);
const modalArea = mw! * mh!;

console.log(`${pdf}\n  ${pages.length} pages · gabarit modal ${modal[0]} (${modal[1]} pages)`);

const oversize = pages.filter((p) => p.area > modalArea * 1.6);
console.log(`\n=== pages HORS-GABARIT (>1,6x l'aire modale) : ${oversize.length} ===`);
for (const p of oversize.slice(0, 40))
  console.log(`  p${String(p.n).padStart(4)}  ${p.w.toFixed(0)} x ${p.h.toFixed(0)} pt  (x${(p.area / modalArea).toFixed(2)})`);

// Titre + pauvreté de texte, sur les pages hors-gabarit d'abord, sinon balayage.
const scan = oversize.length ? oversize : pages;
console.log(`\n=== signature TEXTE des ${Math.min(scan.length, 40)} pages candidates ===`);
for (const p of scan.slice(0, 40)) {
  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-f", String(p.n), "-l", String(p.n), pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    /* page illisible */
  }
  const words = txt.split(/\s+/).filter(Boolean).length;
  const flat = txt.replace(/\s+/g, " ");
  const title = (flat.match(/(PLAN\s+DE\s+ZONAGE|ANNEXE\s+[A-Z0-9]{1,3}|PLAN\s+D'?URBANISME|GRILLE\s+DES\s+(SP[ÉE]CIFICATIONS|NORMES))/i) ?? [""])[0];
  const codes = [...new Set(flat.match(/\b[A-Z]{1,3}-\d{1,4}\b/g) ?? [])];
  console.log(
    `  p${String(p.n).padStart(4)}  mots=${String(words).padStart(5)}  codes=${String(codes.length).padStart(3)}  ${title || "-"}`,
  );
}
