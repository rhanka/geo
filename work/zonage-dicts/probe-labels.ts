/**
 * probe-labels.ts — decisive test of the pdftotext TEXT label lane on a plan,
 * independent of georef precision. Extracts the embedded georef (whatever its
 * residual) and runs the committed t1-labels text extractor, then prints the
 * distinct zone-code tokens it recovers. Tells us if the text lane is viable
 * before investing in georef recalage.
 *
 *   npx tsx work/zonage-dicts/probe-labels.ts <pdf> [page]
 */
import { readFileSync } from "node:fs";
import { extractGeoRef } from "../../acquisition/src/lib/t1-georef.js";
import { extractLabels } from "../../acquisition/src/lib/t1-labels.js";

function main(): void {
  const pdf = process.argv[2];
  const page = process.argv[3] ? Number(process.argv[3]) : 1;
  if (!pdf) { console.error("usage: <pdf> [page]"); process.exit(2); }
  const buf = readFileSync(pdf);
  const geo = extractGeoRef(buf, pdf);
  if (!geo) { console.error("no embedded georef (VP/Measure/GPTS) — cannot position labels"); process.exit(1); }
  console.error(`georef ${geo.crsName} residual ${geo.maxResidualM.toFixed(1)}m scale ${geo.scaleMPerPt.toFixed(2)} m/pt`);
  const lab = extractLabels(pdf, geo, { page });
  const distinct = [...new Set(lab.codePoints.map((c) => c.code))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  console.error(`words=${lab.nWords} codeLike=${lab.nCodeLike} inFrame=${lab.nInsideFrame} rejectedOutside=${lab.rejectedOutsideFrame} distinctCodes=${distinct.length}`);
  console.error(`distinct: ${JSON.stringify(distinct)}`);
}
main();
