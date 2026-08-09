/**
 * _am-band-probe.ts — $0 diagnostic: which affectation-matrix BANDS does the parser
 * actually see on a page, and what does each one bind?
 *
 * Usage: npx tsx acquisition/src/_am-band-probe.ts --pdf <path> [--page 1]
 */
import { spawnSync } from "node:child_process";

import {
  affectationNumberRun,
  stackedAffectationZones,
  looksLikeAffectationMatrixGrille,
  parseAffectationMatrixGrille,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf) throw new Error("--pdf <path> required");
const page = Number(arg("page") ?? "1");

const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
});
const text = (r.stdout ?? "").split("\f")[page - 1] ?? "";
const lines = text.split(/\r?\n/);

console.log(`lines=${lines.length} looksLike=${looksLikeAffectationMatrixGrille(text)}`);

for (let i = 0; i < lines.length; i++) {
  const run = affectationNumberRun(lines[i] ?? "");
  if (!run.length) continue;
  console.log(`\nL${i}: NUMBER RUN n=${run.length} (${run[0]!.t}@${run[0]!.start} … ${run[run.length - 1]!.t}@${run[run.length - 1]!.start})`);
  for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
    if (!(lines[j] ?? "").trim()) continue;
    const z = stackedAffectationZones(lines[i]!, lines[j]!);
    console.log(`   → L${j}: zones=${z.length} ${z.length ? z.slice(0, 6).map((x) => x.code).join(",") : "(no pairing)"}`);
    if (z.length) break;
  }
}

const zs = parseAffectationMatrixGrille(text, page, {
  source_url: "probe",
  snapshot: "probe",
  methode: "probe",
});
console.log(`\nPARSED zones=${zs.length}`);
for (const z of zs.slice(0, 6)) {
  const f = z.marges.avant_min;
  console.log(
    `  ${z.zone_code}: av raw=${JSON.stringify(f?.raw ?? null)} value=${f?.value ?? "null"} unit=${f?.unit ?? "null"} flag=${(f as { flag?: string } | null)?.flag ?? "-"} conf=${f?.confidence ?? "-"}`,
  );
}
