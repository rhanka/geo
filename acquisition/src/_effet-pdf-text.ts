/**
 * $0 helper for the effet_densifiant (4a) lane: extract the verbatim text layer
 * of a (local or remote) PDF so a PPCMOI/amendment résolution can be read for
 * its zone_code + dwelling count (the APRÈS side), and a grille page for the
 * AVANT side. Uses the poppler `pdftotext -layout` text layer (verbatim, no OCR,
 * no invention). If a URL is given it is fetched to a temp path first.
 *
 * Usage:
 *   npx tsx acquisition/src/_effet-pdf-text.ts --file /path/a.pdf [--pages 1-3] [--grep "logement"]
 *   npx tsx acquisition/src/_effet-pdf-text.ts --url https://... [--pages 1-2]
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fetchToTmp(url: string): string {
  const out = `/tmp/effet-pdf-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
  execSync(`curl -skL -A "Mozilla/5.0" ${JSON.stringify(url)} -o ${JSON.stringify(out)}`);
  if (!existsSync(out)) throw new Error(`fetch failed: ${out}`);
  return out;
}

function main(): void {
  const url = arg("url");
  const file = url ? fetchToTmp(url) : arg("file");
  if (!file || !existsSync(file)) throw new Error("required: --file <path> or --url <u>");
  const pages = arg("pages");
  const grepTerm = arg("grep");

  const args = ["-layout", "-enc", "UTF-8"];
  if (pages) {
    const [f, l] = pages.split("-");
    if (f) args.push("-f", f);
    args.push("-l", l ?? f ?? "");
  }
  args.push(file, "-");

  let text: string;
  try {
    text = execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`pdftotext failed (installed? poppler-utils): ${e instanceof Error ? e.message : String(e)}`);
  }

  if (grepTerm) {
    const re = new RegExp(grepTerm, "i");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        const from = Math.max(0, i - 2);
        const to = Math.min(lines.length - 1, i + 2);
        console.log(`--- L${i + 1} ---`);
        for (let j = from; j <= to; j++) console.log(lines[j]);
      }
    }
  } else {
    console.log(text);
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
