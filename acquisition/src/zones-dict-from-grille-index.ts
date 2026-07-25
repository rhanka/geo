/**
 * CLI: derive a VERBATIM zone-code dictionary from a municipal "one grille PDF
 * per zone" index page.
 *
 * Why this exists: the anti-invention gate of `t2-build --labels claude` needs a
 * dictionary of REAL zone codes that is INDEPENDENT of the plan being read. For
 * a raster plan (no native text) whose codes are numeric, the corps of the bylaw
 * is usually useless: it enumerates zones only partially (e.g. "zones where a
 * fermette is allowed"), and often in a different form (`308A` vs the plan's
 * `308-A`).
 *
 * But a common Québec CMS pattern publishes the grille des usages et normes as
 * ONE PDF PER ZONE, and the FILE NAME IS THE ZONE CODE. That index is:
 *   - official (the muni's own server),
 *   - verbatim (the code is the filename, not a model's reading),
 *   - independent of the plan.
 *
 * It is NOT complete, and must not be trusted as a census of the zoning. Measured
 * on saint-come: the index answers 200 on all 109 codes, yet the plan prints a
 * zone `701` the index does not carry, and the corps cites `702` / `902` it does
 * not carry either. `--verify` proves each code EXISTS; nothing here proves no
 * zone is MISSING. That matters because an unread zone is not a hole downstream —
 * t1-zones gives its lots to the nearest label — so a dict short of a real zone
 * silently mislabels that zone's lots. Reconcile against the plan before serving.
 *
 * Anti-invention contract:
 *   - codes are extracted from RAW HTML by regex. No model is in the loop: a
 *     model summarising a page can silently drop or invent an entry.
 *   - `--verify` HEADs every derived URL and keeps ONLY codes whose PDF really
 *     answers 200. A code that does not resolve is not a code.
 *   - the emitted dict is a plain verbatim list. This tool never normalises a
 *     code's form (no dash insertion, no case folding): the served zone_code
 *     must match the muni's own spelling.
 *
 * $0: curl + pure TS. No model, no OCR.
 *
 * Usage:
 *   npx tsx acquisition/src/zones-dict-from-grille-index.ts --html <page.html> \
 *     --base https://example.qc.ca --out work/zonage-dicts/<slug>.codes.json \
 *     [--pattern 'Zone[%20 ]+([0-9A-Za-z\-]+)\.pdf'] [--verify] [--limit 200]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Args {
  html: string;
  base?: string;
  out?: string;
  pattern: string;
  verify: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[key] = true;
    else {
      a[key] = next;
      i++;
    }
  }
  if (!a["html"]) throw new Error("required: --html <raw page.html> [--base <origin>] [--out <dict.json>] [--verify]");
  const html = String(a["html"]);
  if (!existsSync(html)) throw new Error(`--html must be an existing local file (curl it first): ${html}`);
  return {
    html,
    base: a["base"] ? String(a["base"]) : undefined,
    out: a["out"] ? String(a["out"]) : undefined,
    // default: the "Zone <code>.pdf" convention, tolerant of %20 / + / spaces
    // and of a stray capitalisation in the word "Zone" (real indexes have typos).
    pattern: a["pattern"] ? String(a["pattern"]) : "[Zz][Oo][Nn][Ee](?:%20|\\+|\\s|_)+([0-9]{1,4}(?:-[0-9A-Za-z]{1,3})?)\\.pdf",
    verify: a["verify"] === true,
    limit: a["limit"] ? Number(a["limit"]) : 400,
  };
}

/** Decode the few HTML entities that actually appear in href attributes. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function httpStatus(url: string): number {
  try {
    const out = execFileSync(
      "curl",
      ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-A", "Mozilla/5.0 (compatible; geo-acquisition/1.0)", "-L", "--max-time", "25", "-I", url],
      { encoding: "utf8" },
    );
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const html = readFileSync(args.html, "utf8");

  // 1. every href that ends in .pdf, straight out of the raw markup
  const hrefRe = /(?:href|src)\s*=\s*["']([^"']+?\.pdf)["']/gi;
  const hrefs = new Set<string>();
  for (let m = hrefRe.exec(html); m; m = hrefRe.exec(html)) hrefs.add(decodeEntities(m[1]!));

  // 2. keep those whose FILENAME carries a zone code
  const codeRe = new RegExp(args.pattern);
  const byCode = new Map<string, string>();
  for (const href of hrefs) {
    const m = codeRe.exec(decodeURIComponent(href).replace(/\\/g, "/")) ?? codeRe.exec(href);
    if (!m || !m[1]) continue;
    const code = m[1].toUpperCase();
    const url = /^https?:/i.test(href) ? href : `${(args.base ?? "").replace(/\/$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
    if (!byCode.has(code)) byCode.set(code, url);
  }

  const found = [...byCode.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  console.error(`[grille-index] pdf hrefs=${hrefs.size} · zone-coded=${found.length}`);
  if (found.length > args.limit) throw new Error(`refusing: ${found.length} codes > --limit ${args.limit} (check --pattern)`);

  let kept = found;
  const verified: Record<string, number> = {};
  if (args.verify) {
    kept = [];
    for (const code of found) {
      const status = httpStatus(byCode.get(code)!);
      verified[code] = status;
      if (status === 200) kept.push(code);
      else console.error(`[grille-index] DROP ${code}: HTTP ${status}`);
    }
    console.error(`[grille-index] verified 200: ${kept.length}/${found.length}`);
  }

  const numericPure = kept.filter((c) => /^\d{1,4}$/.test(c));
  const lettered = kept.filter((c) => /[A-Za-z]/.test(c) && /\d/.test(c));
  const payload = {
    source_html: args.html,
    method: "grille-index-filename-verbatim",
    verified_http: args.verify,
    count: kept.length,
    numeric_pure: numericPure.length,
    lettered: lettered.length,
    codes: kept,
    ...(args.verify ? { http_status: verified } : {}),
  };

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(payload, null, 2));
    console.error(`[grille-index] wrote ${args.out}`);
  }
  console.log(JSON.stringify({ ...payload, http_status: undefined }, null, 2));
}

main();
