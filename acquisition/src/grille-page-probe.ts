/**
 * grille-page-probe.ts — read-only STRUCTURE probe of a local grille / zoning
 * by-law PDF, to LOCATE the "grille des usages et normes" annex and reveal its
 * layout BEFORE choosing an extraction route (native / ocr / multizone / vision).
 *
 * For each page of `--pdf` it reports (from `pdftotext -layout`, $0, no LLM):
 *   - distinct zone-code tokens on the page and the MAX on a single line
 *     (a multi-zone "zones in columns" header shows many codes on one line);
 *   - whether the page carries a grille/usages-normes title marker;
 *   - the first non-empty header lines (a peek at the layout).
 * Then prints the candidate grille page span. Anti-invention: pure inspection,
 * deposits nothing.
 *
 * One committed command:
 *   npx tsx acquisition/src/grille-page-probe.ts --pdf <path> [--min-codes 4] [--peek 3]
 */
import { spawnSync } from "node:child_process";

const ZONE_CODE_TOKEN = /\b[A-Z]{1,4}-\d{2,4}(?:-\d{1,3})?\b/g;
const GRILLE_MARKER = /grille\s+des\s+(?:usages|sp.cifications)|usages\s+et\s+normes/i;

function arg(argv: string[], k: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : def;
}

function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed: ${r.stderr?.slice(0, 200)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function main(): void {
  const argv = process.argv.slice(2);
  const pdf = arg(argv, "pdf");
  if (!pdf) throw new Error("required: --pdf <path>");
  const minCodes = Number(arg(argv, "min-codes", "4"));
  const peek = Number(arg(argv, "peek", "2"));

  const pages = pageTexts(pdf);

  // --dump <pageNo>: print ONE page's full layout text (verbatim) and exit. Lets an
  // operator inspect where the zone code + norm values sit before routing.
  const dumpRaw = arg(argv, "dump");
  if (dumpRaw !== undefined) {
    const n = Number(dumpRaw);
    const txt = pages[n - 1] ?? "";
    console.log(`=== page ${n} of ${pages.length} (verbatim -layout) ===`);
    console.log(txt);
    return;
  }

  const hits: number[] = [];
  console.log(`pages=${pages.length} minCodes=${minCodes}`);
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    const distinct = new Set<string>();
    let maxOnLine = 0;
    let hdrLineCodes = "";
    for (const line of text.split(/\r?\n/)) {
      const onLine = new Set<string>();
      for (const m of line.matchAll(ZONE_CODE_TOKEN)) {
        onLine.add(m[0]);
        distinct.add(m[0]);
      }
      if (onLine.size > maxOnLine) {
        maxOnLine = onLine.size;
        hdrLineCodes = [...onLine].slice(0, 12).join(" ");
      }
    }
    const marker = GRILLE_MARKER.test(text);
    if (distinct.size >= minCodes || marker) {
      hits.push(i + 1);
      const header = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, peek)
        .join(" | ");
      console.log(
        `p${String(i + 1).padStart(3)} distinct=${String(distinct.size).padStart(3)} ` +
          `maxLine=${String(maxOnLine).padStart(2)} marker=${marker ? "Y" : "n"} ` +
          `| ${header.slice(0, 140)}` +
          (maxOnLine >= 3 ? `  <<codes: ${hdrLineCodes}>>` : ""),
      );
    }
  }
  if (hits.length > 0) {
    console.log(`\ncandidate grille pages: ${hits.length} | span ${Math.min(...hits)}..${Math.max(...hits)}`);
  } else {
    console.log("\nNO candidate grille pages (no page with >=minCodes zone codes or a grille marker)");
  }
}

main();
