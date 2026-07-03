/**
 * inspect-grille-native.ts — committed inspection helper for the native-text
 * ($0, `pdftotext -layout`) view of a staged grille PDF.
 *
 * WHY. The transposed-grille extractors (packages/qc-sources/grille-ocr-extractor)
 * are designed against the column-aligned `pdftotext -layout` projection. To design
 * a NEW format's parser we must SEE that exact projection — but ad-hoc `pdftotext`
 * one-liners are rejected by the geo Bash hook (memory
 * use-committed-scripts-not-inline-bash). This committed script is the sanctioned
 * way to look: it locates the grille pages (a signature regex) and dumps the
 * layout text of the pages we ask for, with the SAME options the ingester uses.
 *
 * Usage:
 *   # locate pages whose layout text matches a signature (grid header, a code, …):
 *   npx tsx acquisition/src/inspect-grille-native.ts --pdf work/zonage-norms/sept-iles/grille.pdf \
 *     --find "Grille des specifications|GRILLE|zonage"
 *   # dump the layout text of specific pages (1-based; "3", "1-5", "3,7,9"):
 *   npx tsx acquisition/src/inspect-grille-native.ts --pdf work/zonage-norms/sept-iles/grille.pdf \
 *     --pages 3-4
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** `pdftotext -layout` → per-page texts (page break = \f). SAME opts as the ingester. */
function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed on ${pdfPath}: ${r.stderr?.slice(0, 200)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Parse a page spec ("3", "1-5", "3,7,9") into 1-based page numbers. */
function parsePages(spec: string, total: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= total) out.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p >= 1 && p <= total) out.add(p);
    }
  }
  return [...out].sort((x, y) => x - y);
}

function main(): void {
  const argv = process.argv.slice(2);
  const pdf = arg(argv, "pdf");
  if (!pdf) throw new Error("--pdf <path> is required");
  if (!existsSync(pdf)) throw new Error(`missing PDF: ${pdf}`);
  const pages = pageTexts(pdf);
  const total = pages.length;

  const find = arg(argv, "find");
  if (find) {
    const re = new RegExp(find, "i");
    const hits: number[] = [];
    for (let i = 0; i < pages.length; i++) if (re.test(pages[i] ?? "")) hits.push(i + 1);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ pdf, totalPages: total, find, matchingPages: hits }, null, 2));
    return;
  }

  const pagesSpec = arg(argv, "pages");
  if (!pagesSpec) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ pdf, totalPages: total, hint: "pass --pages or --find" }, null, 2));
    return;
  }
  const maxLines = Number(arg(argv, "max") ?? "0");
  for (const p of parsePages(pagesSpec, total)) {
    const text = pages[p - 1] ?? "";
    const lines = text.split(/\r?\n/);
    const shown = maxLines > 0 ? lines.slice(0, maxLines) : lines;
    // eslint-disable-next-line no-console
    console.log(`\n===== PAGE ${p} / ${total} (${lines.length} lines) =====`);
    // eslint-disable-next-line no-console
    console.log(shown.join("\n"));
  }
}

main();
