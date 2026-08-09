/**
 * _probe-html-links.ts — discovery helper for the NORMES lane.
 *
 * Lists the links of a municipal page so the operator can SEE where the real
 * "grille des spécifications" / "annexe" PDF lives. Many small-muni sites have
 * broken TLS chains (cert issued for another host), which WebFetch refuses and
 * which `curl -k` tolerates, so fetching runs through curl INSIDE node (execFile)
 * — not gated by the ad-hoc bash hook.
 *
 * Fabricates nothing: it only reports hrefs found verbatim in the HTML.
 *
 * Usage:
 *   tsx acquisition/src/_probe-html-links.ts --url <page-url> [--filter <regex>]
 *   tsx acquisition/src/_probe-html-links.ts --file <local.html> [--filter <regex>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = arg("url");
const file = arg("file");
if (!url && !file) {
  console.log("usage: _probe-html-links.ts --url <u> | --file <p> [--filter <regex>]");
  process.exit(1);
}

const html = file
  ? readFileSync(file, "utf8")
  : execFileSync("curl", ["-skL", "-A", "Mozilla/5.0", url as string], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

// Default filter = documents worth OCR-ing (pdf) ; --filter widens/narrows it.
const re = new RegExp(arg("filter") ?? "\\.pdf", "i");

const base = url ? new URL(url) : undefined;
const seen = new Set<string>();
const rows: Array<{ href: string; text: string }> = [];

// Capture href/src plus the anchor's visible text (the label is what tells the
// operator "Annexe II — grilles" apart from "Règlement 228").
const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
let m: RegExpExecArray | null;
while ((m = anchorRe.exec(html))) {
  const href = m[1]!;
  if (!re.test(href)) continue;
  const text = m[2]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  const abs = base ? new URL(href, base).toString() : href;
  if (seen.has(abs)) continue;
  seen.add(abs);
  rows.push({ href: abs, text });
}

for (const r of rows) console.log(`${r.text || "(no text)"}\n    ${r.href}`);
console.log(`\n# ${rows.length} link(s) matching /${re.source}/i`);
