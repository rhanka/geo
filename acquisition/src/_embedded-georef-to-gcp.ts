/**
 * _embedded-georef-to-gcp.ts — turn a plan's EMBEDDED T1 georef into a GcpFile so
 * the composite/dict serving lane (t2-build, t2-build-multisheet) can consume it.
 *
 * WHY: some ArcGIS-exported plans carry a real embedded GeoPDF georef (/VP /GPTS,
 * `extractGeoRef` → sub-metre residual), but their zone codes are NUMÉRO⊕DOMINANCE
 * (`201-` + `AF`) that only the composite lane in t2-build/t2-build-multisheet can
 * read — and t1-build has no composite join. The auto-seed path (t2-autogcp) can be
 * rejected for a spurious anisotropy on a partial extent even though the embedded
 * transform is isotropic and exact (bonaventure: auto-seed aniso 1.44 REJECTED, yet
 * embedded resid 0.30 m). This wrapper samples the AUTHORITATIVE embedded transform
 * on a grid inside the neatline and writes those page-fraction↔lon/lat pairs as a
 * GcpFile. It invents nothing: the lon/lat come from the PDF's own /GPTS, and every
 * downstream anti-invention gate (spatial, ≥3 codes, cadastre coverage) still runs.
 *
 * Usage:
 *   npx tsx acquisition/src/_embedded-georef-to-gcp.ts --slug <slug> --pdf <local.pdf> \
 *     --out-gcp <file.gcp.json> [--page 1] [--grid 4]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { extractGeoRef } from "./lib/t1-georef.js";
import type { Gcp, GcpFile } from "./lib/t2-georef.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main(): void {
  const pdf = arg("pdf");
  const slug = arg("slug");
  const out = arg("out-gcp");
  const page = Number(arg("page", "1"));
  const grid = Math.max(2, Number(arg("grid", "4")));
  if (!pdf || !slug || !out) {
    console.error("required: --slug <slug> --pdf <local.pdf> --out-gcp <file.gcp.json> [--page 1] [--grid 4]");
    process.exit(2);
  }

  const buf = readFileSync(pdf);
  const geo = extractGeoRef(buf, pdf);
  if (!geo) {
    console.error(`[embedded-georef-to-gcp] ABORT: no embedded /VP /Measure /GEO georef in ${pdf}`);
    process.exit(2);
  }

  const { bbox, pageW, pageH } = geo;
  // Neatline bbox is in PDF user-space (origin bottom-left, y up); normalise corners.
  const xa = Math.min(bbox[0], bbox[2]);
  const xb = Math.max(bbox[0], bbox[2]);
  const ya = Math.min(bbox[1], bbox[3]);
  const yb = Math.max(bbox[1], bbox[3]);

  const gcps: Gcp[] = [];
  const pushPt = (ux: number, uy: number): void => {
    const yTopDown = pageH - uy; // topLeftToLonLat expects a top-left, y-down point
    const [lon, lat] = geo.topLeftToLonLat(ux, yTopDown);
    gcps.push({
      fx: ux / pageW,
      fy: yTopDown / pageH,
      lon,
      lat,
      source: "t1-embedded-georef-sample",
      independent: true,
    });
  };
  // Emit the four neatline CORNERS first so the leading triple is maximally spread
  // (the affine calibration's collinearity guard only inspects gcps[0..2]); a
  // column-major grid would put three same-x points first and be rejected as a line.
  pushPt(xa, ya);
  pushPt(xb, yb);
  pushPt(xa, yb);
  pushPt(xb, ya);
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      pushPt(xa + ((xb - xa) * i) / (grid - 1), ya + ((yb - ya) * j) / (grid - 1));
    }
  }

  const gcpFile: GcpFile = { slug, pdf, page, pageW, pageH, gcps, crs: "epsg:4326" };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(gcpFile, null, 2)}\n`);
  console.log(
    `[embedded-georef-to-gcp] ${slug}: ${gcps.length} GCPs from embedded ${geo.crsName} ` +
      `(resid ${geo.maxResidualM.toFixed(2)} m, scale ${geo.scaleMPerPt.toFixed(3)} m/pt)`,
  );
  console.log(
    `  neatline user-space [${xa.toFixed(0)},${ya.toFixed(0)},${xb.toFixed(0)},${yb.toFixed(0)}] on page ${pageW}×${pageH} pt → ${out}`,
  );
}

main();
