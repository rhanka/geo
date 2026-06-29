/**
 * zones-gdal-validate.ts — AUTHORITATIVE TYPE-A test + deposit, runs on a GDAL pod.
 *
 * Designed to run on a k8s pod that has `gdal-bin` + `poppler-utils` installed
 * (the local session image lacks GDAL). For each candidate zoning-PLAN GeoPDF it:
 *   1. runs `recompose-zones-pdf.ts --dry-run` to MEASURE the real outcome
 *      (poly count, unique zone_codes spatially joined, classification),
 *   2. if uniqueCodes >= --min-codes (default 3), re-runs WITHOUT --dry-run so the
 *      recompose pipeline itself deposits the real zones to S3 (anti-invention
 *      gate lives inside recompose; this runner never fabricates anything).
 *
 * The dry-run measurement is the ONLY faithful recompose-ability test: poppler
 * GeoPDF markers are NOT predictive (a GeoPDF can lack a separable zone-polygon
 * layer). This runner produces the true TYPE-A yield.
 *
 * USAGE (on pod, after `apt-get install -y gdal-bin poppler-utils`):
 *   npx tsx src/zones-gdal-validate.ts --manifest ../work/zonage-norms/zones-gdal-candidates.json --shard 0/4
 *   npx tsx src/zones-gdal-validate.ts --pairs "acton-vale=https://…/plan.pdf"
 *
 * FLAGS:
 *   --manifest PATH   candidates json ({candidates:[{slug,pdfUrl,zoneTokens,...}]})
 *   --pairs s=u,s=u   explicit slug=url pairs (overrides manifest)
 *   --shard i/n       process only candidates where index % n == i (fleet sharding)
 *   --min-codes N     deposit threshold (default 3)
 *   --ocr-when-glyph  force --ocr when manifest zoneTokens < 3 (glyph labels)
 *   --out PATH        write JSON result (default ./zones-gdal-validate-result.json)
 *   --measure-only    never deposit (always --dry-run) — pure yield measurement
 *
 * Node/TS pure. No secret printed. Deposits happen ONLY via recompose's own gate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECOMPOSE = join(HERE, "recompose-zones-pdf.ts");

interface Cand { slug: string; pdfUrl: string; zoneTokens?: number; producer?: string; }
interface Args {
  manifest?: string; pairs?: string; shardI: number; shardN: number;
  minCodes: number; ocrWhenGlyph: boolean; out: string; measureOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  let shardI = 0, shardN = 1;
  const shard = get("shard");
  if (shard && shard.includes("/")) { const [a, b] = shard.split("/"); shardI = Number(a); shardN = Number(b); }
  return {
    ...(get("manifest") ? { manifest: get("manifest") } : {}),
    ...(get("pairs") ? { pairs: get("pairs") } : {}),
    shardI, shardN,
    minCodes: Number(get("min-codes") ?? "3"),
    ocrWhenGlyph: has("ocr-when-glyph"),
    out: get("out") ?? resolve("zones-gdal-validate-result.json"),
    measureOnly: has("measure-only"),
  };
}

function loadCandidates(args: Args): Cand[] {
  if (args.pairs) {
    return args.pairs.split(",").map((p) => { const i = p.indexOf("="); return { slug: p.slice(0, i).trim(), pdfUrl: p.slice(i + 1).trim() }; });
  }
  if (args.manifest && existsSync(args.manifest)) {
    const j = JSON.parse(readFileSync(args.manifest, "utf8")) as { candidates?: Cand[] };
    return (j.candidates ?? []).filter((c) => c.slug && c.pdfUrl);
  }
  return [];
}

interface Outcome {
  slug: string; pdfUrl: string;
  classification: string; polyCount: number; withCode: number; uniqueCodes: number;
  method: string; arcMap: boolean; usedOcr: boolean; deposited: boolean; examples: string[];
  exit: number;
}

function runRecompose(slug: string, url: string, dryRun: boolean, ocr: boolean): { out: string; code: number } {
  const a = ["tsx", RECOMPOSE, "--slug", slug, "--pdf", url];
  if (dryRun) a.push("--dry-run");
  if (ocr) a.push("--ocr");
  const r = spawnSync("npx", a, { encoding: "utf8", timeout: 1_500_000, maxBuffer: 64 * 1024 * 1024 });
  return { out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, code: r.status ?? -1 };
}

function parseOutcome(log: string): Omit<Outcome, "slug" | "pdfUrl" | "deposited" | "exit"> {
  const polyM = log.match(/(\d+)\s+polygone\(s\) vecteur extrait/);
  const codesM = log.match(/(\d+)\/(\d+) polygones avec zone_code \| (\d+) codes uniques/);
  const methodM = log.match(/TYPE A confirmé \(([^)]+)\)/);
  const exM = log.match(/Exemples\s*:\s*(.+)/);
  let classification = "unknown";
  if (/pdf-non-georef/.test(log)) classification = "non-georef";
  else if (/pdf-georef-raster/.test(log)) classification = "georef-raster";
  else if (/PUBLIÉ/.test(log)) classification = "type-a-deposited";
  else if (/trop peu de codes uniques/.test(log)) classification = "georef-no-zone-join";
  else if (codesM) classification = "georef-vector";
  return {
    classification,
    polyCount: polyM ? Number(polyM[1]) : 0,
    withCode: codesM ? Number(codesM[1]) : 0,
    uniqueCodes: codesM ? Number(codesM[3]) : 0,
    method: methodM ? methodM[1]! : "",
    arcMap: /Esri ArcMap détecté|ArcMap=true|creator=Esri/i.test(log),
    usedOcr: /Étape 3b\/7: V2 OCR|--ocr forcé|auto V2 OCR/.test(log),
    examples: exM ? exM[1]!.split(",").map((s) => s.trim()).slice(0, 8) : [],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let cands = loadCandidates(args);
  // de-dupe by slug+url, then shard
  const seen = new Set<string>();
  cands = cands.filter((c) => { const k = `${c.slug}|${c.pdfUrl}`; if (seen.has(k)) return false; seen.add(k); return true; });
  cands = cands.filter((_, i) => i % args.shardN === args.shardI);

  console.error(`[validate] ${cands.length} candidates (shard ${args.shardI}/${args.shardN}) minCodes=${args.minCodes} measureOnly=${args.measureOnly}`);

  const outcomes: Outcome[] = [];
  for (const c of cands) {
    const forceOcr = args.ocrWhenGlyph && (c.zoneTokens ?? 99) < 3;
    console.error(`\n[validate] === ${c.slug} === ocr=${forceOcr} ${c.pdfUrl}`);
    const dry = runRecompose(c.slug, c.pdfUrl, true, forceOcr);
    const m = parseOutcome(dry.out);
    let deposited = false;
    let finalClass = m.classification;
    // surface the tail for traceability
    const tail = dry.out.split("\n").filter((l) => /RÉSULTAT|RÉSUMÉ|codes uniques|polygone\(s\) vecteur|Géoréférencé|FATAL|ERREUR/.test(l)).slice(-8);
    for (const l of tail) console.error("   " + l.trim());

    if (!args.measureOnly && m.uniqueCodes >= args.minCodes) {
      console.error(`[validate] ${c.slug}: ${m.uniqueCodes} codes ≥ ${args.minCodes} → DEPOSIT`);
      const live = runRecompose(c.slug, c.pdfUrl, false, forceOcr);
      deposited = /PUBLIÉ/.test(live.out);
      if (deposited) finalClass = "type-a-deposited";
      console.error(`[validate] ${c.slug}: deposited=${deposited}`);
    }
    outcomes.push({ slug: c.slug, pdfUrl: c.pdfUrl, deposited, exit: dry.code, ...m, classification: finalClass });
  }

  const deposited = outcomes.filter((o) => o.deposited);
  const summary = {
    total: outcomes.length,
    deposited: deposited.length,
    depositedSlugs: deposited.map((o) => o.slug),
    byClass: outcomes.reduce<Record<string, number>>((a, o) => { a[o.classification] = (a[o.classification] ?? 0) + 1; return a; }, {}),
  };
  writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, outcomes }, null, 2));
  console.error(`\n[validate] ===== SUMMARY =====`);
  console.error(JSON.stringify(summary, null, 2));
  console.error(`[validate] result → ${args.out}`);
}

main().catch((e: unknown) => { console.error("[validate] FATAL:", e); process.exit(1); });
