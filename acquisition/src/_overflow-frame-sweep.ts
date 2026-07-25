/**
 * _overflow-frame-sweep.ts — find every on-disk plan that the STRICT `inPage`
 * containment gate drops but the page-ANCHORED relaxation recovers.
 *
 * gaspe proved the family exists (ArcGIS export, ROTATED data frame, /VP /BBox
 * larger than the /MediaBox). This sweep asks the same question of every cached
 * plan at $0: extract the georef twice — once with the historical gate, once with
 * `allowOverflowFrame` — and report only the plans where the SECOND finds a
 * registration the first did not. Those are the newly-servable candidates.
 *
 * It DECIDES nothing and DEPOSITS nothing: a hit still has to clear t1-build's
 * residual / min-codes / spatial gates before anything is served.
 *
 *   npx tsx acquisition/src/_overflow-frame-sweep.ts [--dir work/zonage-plans] [--limit N]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractGeoRef } from "./lib/t1-georef.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const dir = arg("dir") ?? "work/zonage-plans";
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const maxBytes = arg("max-mb") ? Number(arg("max-mb")) * 1024 * 1024 : 120 * 1024 * 1024;

  const pdfs = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .slice(0, limit);
  console.log(`# scanning ${pdfs.length} plan(s) in ${dir}`);

  let nStrict = 0;
  let nUnlocked = 0;
  let nNeither = 0;
  for (const f of pdfs) {
    const path = join(dir, f);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size > maxBytes) {
      console.log(`SKIP-BIG   ${f} (${(size / 1e6).toFixed(0)} Mo)`);
      continue;
    }
    let buf: Buffer;
    try {
      buf = readFileSync(path);
    } catch {
      console.log(`SKIP-READ  ${f}`);
      continue;
    }
    let strict = null;
    let relaxed = null;
    try {
      strict = extractGeoRef(buf, path);
    } catch {
      /* a parse failure is itself the answer: no registration */
    }
    try {
      relaxed = extractGeoRef(buf, path, { allowOverflowFrame: true });
    } catch {
      /* idem */
    }
    if (strict) {
      nStrict++;
      continue; // already worked before this change — nothing new here
    }
    if (relaxed) {
      nUnlocked++;
      console.log(
        `⭐ UNLOCKED ${f}  crs=${relaxed.crsName} residual=${relaxed.maxResidualM.toFixed(2)}m ` +
          `scale=${relaxed.scaleMPerPt.toFixed(2)}m/pt`,
      );
    } else {
      nNeither++;
    }
  }
  console.log(
    `\n# strict-already-OK=${nStrict} · NEWLY-UNLOCKED=${nUnlocked} · no-georef-either-way=${nNeither}`,
  );
}

main();
