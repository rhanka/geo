/**
 * KEEP-BEST re-OCR for the deployed `qc-zonage-norms-<slug>` corpus.
 *
 * For each target municipality whose grille is staged on S3
 * (`sources/qc-zonage-grilles/<slug>.pdf`), this:
 *   1. reads the CURRENT (chat-vision) deposit's recall from the live manifest
 *      (SIG-overlap when a grid exists, else distinct zone_codes) + its published
 *      norm-field count — the BASELINE,
 *   2. re-extracts via the HARDENED OCR path (mistral-ocr-4-0) over the SAME page
 *      range the original deposit used (munis.json first/last),
 *   3. cross-validates the OCR zone codes against the muni SIG grille,
 *   4. KEEP-BEST gate (zero regression, strict Pareto): deposit the OCR product
 *      ONLY when it does NOT regress recall AND does NOT regress published fields,
 *      AND strictly improves at least one. Otherwise the chat-vision deposit is
 *      kept untouched.
 *
 * Anti-invention is inherited WHOLE from the frozen extractor: every value is
 * verbatim-or-null. A global S3 backup must be taken BEFORE running with --apply
 * (depositZonageNorms overwrites in place). Default is DRY (measure only).
 *
 * Usage:
 *   tsx src/zonage-norms-reocr-keepbest.ts [slug ...] [--all-staged] \
 *       [--apply] [--budget-usd 4] [--min-pages-gridless N]
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";

import { mapMarkdownPageToZones, createMistralOcrHttpCall } from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const execFileP = promisify(execFile);

/**
 * Chunked OCR over a contiguous [first,last] page range of a (possibly very
 * large) source PDF. The `mistral-ocr` lib 400s on large multi-page uploads
 * (dense scanned grilles run 12+ MB for an 80-page annex), so we:
 *   1. `pdfseparate` the range out of the source in ONE parse (lossless),
 *   2. `pdfunite` consecutive pages into small CHUNK-page PDFs (preserves image
 *      quality — no gs downsampling that would wreck OCR),
 *   3. OCR each chunk independently (per-chunk try/catch so one bad chunk never
 *      loses the whole city), mapping each markdown page to its TRUE source page
 *      number for honest provenance.
 * Returns the per-page zones (caller merges by zone_code) + usd + billed pages.
 */
async function chunkedOcrRange(
  sourcePdf: string,
  first: number,
  last: number,
  chunkPages: number,
  ocrCall: (p: string) => Promise<{ pages: Array<{ markdown: string }>; pagesProcessed: number }>,
  costPerPage: number,
  opts: { source_url: string; snapshot: string; methode: string },
): Promise<{ zones: ZoneNormsT[]; usd: number; pagesBilled: number; chunksFailed: number; reasons: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "reocr-chunk-"));
  const zones: ZoneNormsT[] = [];
  let pagesBilled = 0;
  let chunksFailed = 0;
  const reasons: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let start = first; start <= last; start += chunkPages) {
      const end = Math.min(start + chunkPages - 1, last);
      const chunkPdf = join(dir, `chunk-${start}-${end}.pdf`);
      // COMPACT slice via ghostscript: pdfseparate+pdfunite duplicate a shared
      // resource into every page (8 pages → 25 MB) which breaks the OCR upload;
      // gs /prepress consolidates + never downsamples → ~200 KB, OCR-identical.
      try {
        await execFileP("gs", [
          "-sDEVICE=pdfwrite", "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
          "-dPDFSETTINGS=/prepress",
          `-dFirstPage=${start}`, `-dLastPage=${end}`,
          `-sOutputFile=${chunkPdf}`, sourcePdf,
        ], { maxBuffer: 256 * 1024 * 1024 });
      } catch (e) {
        chunksFailed++;
        reasons.push(`gs ${start}-${end}: ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`);
        continue;
      }
      if (!existsSync(chunkPdf)) { chunksFailed++; reasons.push(`gs ${start}-${end}: no output`); continue; }
      // OCR the chunk with one retry on transient failure.
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const res = await ocrCall(chunkPdf);
          pagesBilled += res.pagesProcessed;
          res.pages.forEach((pg, idx) => {
            zones.push(...mapMarkdownPageToZones(pg.markdown, start + idx, opts));
          });
          ok = true;
        } catch (e) {
          if (attempt === 0) { await sleep(1500); continue; }
          chunksFailed++;
          reasons.push(`ocr ${start}-${end}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
        }
      }
      await rm(chunkPdf, { force: true }).catch(() => undefined);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { zones, usd: pagesBilled * costPerPage, pagesBilled, chunksFailed, reasons };
}

import { s3Client, getBytes, exists, BUCKET } from "./lib/s3.js";
import { resolveOcrCall } from "./lib/ocr.js";
import {
  crossValidateZoneCodes,
  depositZonageNorms,
  depositParquetOnly,
  publishedFieldPct,
  type CrossValResult,
} from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MUNIS_JSON = join(REPO, "work", "zonage-norms", "munis.json");
const GRILLE_PREFIX = "sources/qc-zonage-grilles";
/** Pages per OCR call. Small enough that dense scanned annexes stay well under
 *  the mistral-ocr upload ceiling (12+ MB whole-range slices 400). */
const CHUNK_PAGES = 8;

interface MuniCfg {
  slug: string;
  route?: string;
  first?: number;
  last?: number;
  pages?: number;
  reglement?: string | number;
  sourceUrl?: string;
}

interface ManEntry {
  slug: string;
  source_url: string;
  methode: string;
  reglement?: string;
  zone_rows: number;
  unique_zone_codes: number;
  published_field_pct: number;
  crossval?: { gridFound: boolean; sigZoneCodes: number; overlap: number; recoupSig: number };
}

function loadMunis(): Map<string, MuniCfg> {
  const raw = JSON.parse(readFileSync(MUNIS_JSON, "utf8")) as unknown;
  const arr: MuniCfg[] = Array.isArray(raw)
    ? (raw as MuniCfg[])
    : ((raw as { munis?: MuniCfg[] }).munis ?? (Object.values(raw as object) as MuniCfg[]));
  const m = new Map<string, MuniCfg>();
  for (const x of arr) if (x && x.slug) m.set(x.slug, x);
  return m;
}

function publishedCount(z: ZoneNormsT): number {
  const fs = [
    z.densite, z.hauteur_min, z.hauteur_max, z.frontage_min, z.superficie_min,
    z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min,
  ];
  return fs.filter((f) => f && f.value !== null).length;
}
function totalPublished(zones: ZoneNormsT[]): number {
  return zones.reduce((s, z) => s + publishedCount(z), 0);
}

function pdfPageCount(pdfPath: string): number {
  const r = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const m = r.stdout?.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

interface Row {
  slug: string;
  gridFound: boolean;
  // baseline (chat-vision)
  cvUzc: number;
  cvOverlap: number;
  cvSig: number;
  cvPublished: number;
  // ocr
  ocrUzc: number;
  ocrOverlap: number;
  ocrPublished: number;
  ocrUsd: number;
  ocrPages: number;
  // decision
  recallBefore: number;
  recallAfter: number;
  decision: "DEPOSIT-OCR" | "KEEP-CV" | "ERROR" | "SKIP-NO-GRILLE";
  note: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const allStaged = argv.includes("--all-staged");
  const localDir = argv.indexOf("--local-dir") >= 0 ? argv[argv.indexOf("--local-dir") + 1] : undefined;
  const residuePath = argv.indexOf("--residue") >= 0 ? argv[argv.indexOf("--residue") + 1] : undefined;
  // MANIFEST-SAFE: write parquet only, never touch the shared manifest (avoids
  // racing a concurrent stock run's read-modify-write). Merge later from S3 truth.
  const noManifest = argv.includes("--no-manifest");
  // STRICT residue anti-invention gate (defaults are strict):
  //  - SIG grille present  → deposit iff overlap >= minSigOverlap (spatial gate);
  //  - no SIG grille        → deposit iff >= minGridlessPub published norm values
  //    (real grille tables publish dimensions; misread usage-lists publish ~0 → §4 noise).
  const argNum = (flag: string, def: number): number => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
  };
  const budgetUsd = argNum("--budget-usd", 4);
  const minSigOverlap = argNum("--min-sig-overlap", 3);
  const minGridlessPub = argNum("--min-gridless-pub", 3);
  const optVals = new Set(["--budget-usd", "--local-dir", "--residue", "--min-sig-overlap", "--min-gridless-pub"]);
  const slugsArg = argv.filter((a) => !a.startsWith("--") && !optVals.has(argv[argv.indexOf(a) - 1] ?? ""));

  // Residue mode: NEW deposits from a discovered-candidate manifest (slug +
  // direct PDF URL + route/first/last). PDFs are downloaded (not staged on S3).
  interface ResidueCand { slug: string; sourceUrl: string; route?: string; first?: number; last?: number; pages?: number; }
  const residueCands: ResidueCand[] = residuePath
    ? (JSON.parse(readFileSync(residuePath, "utf8")) as ResidueCand[])
    : [];
  const residueBySlug = new Map(residueCands.map((c) => [c.slug, c]));

  const s3 = s3Client();
  const ocr = resolveOcrCall();
  if (!ocr.config.apiKey) throw new Error("OCR_API_KEY/MISTRAL_API_KEY not set");
  // Force the DIRECT HTTP /v1/ocr call (inline base64): the npm-lib files-API
  // upload path 422s on repeated per-chunk uploads in one process. The inline
  // path is stateless per call and robust for the small chunk PDFs we send.
  const ocrCall = createMistralOcrHttpCall(ocr.config) as unknown as
    (p: string) => Promise<{ pages: Array<{ markdown: string }>; pagesProcessed: number }>;
  console.error(`[reocr] provider=${ocr.config.provider} model=${ocr.config.model} via=http apply=${apply}`);

  const man = JSON.parse((await getBytes(s3, "registry/qc-zonage-norms/manifest.json")).toString("utf8"));
  const entries = man.entries as ManEntry[];
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const munis = loadMunis();

  // Target slugs.
  let targets: string[];
  if (residuePath) targets = residueCands.map((c) => c.slug);
  else if (slugsArg.length > 0) targets = slugsArg;
  else if (allStaged) {
    const staged = (await import("./lib/s3.js")).listSlugs;
    targets = await staged(s3, `${GRILLE_PREFIX}/`, ".pdf");
  } else targets = [];
  console.error(`[reocr] ${targets.length} target slug(s)${residuePath ? " (residue mode)" : ""}`);

  const rows: Row[] = [];
  let totalUsd = 0;
  const snapshot = new Date().toISOString().slice(0, 10);

  for (const slug of targets) {
    const base = bySlug.get(slug);
    const rc = residueBySlug.get(slug);
    const cfg = rc
      ? { slug, route: rc.route, first: rc.first, last: rc.last, pages: rc.pages, sourceUrl: rc.sourceUrl }
      : munis.get(slug);
    const cvOverlap = base?.crossval?.overlap ?? 0;
    const cvSig = base?.crossval?.sigZoneCodes ?? 0;
    const gridFound = base?.crossval?.gridFound ?? false;
    const cvUzc = base?.unique_zone_codes ?? 0;
    const cvPublished = base ? Math.round((base.zone_rows * 8 * base.published_field_pct) / 100) : 0;

    const row: Row = {
      slug, gridFound, cvUzc, cvOverlap, cvSig, cvPublished,
      ocrUzc: 0, ocrOverlap: 0, ocrPublished: 0, ocrUsd: 0, ocrPages: 0,
      recallBefore: gridFound ? cvOverlap : cvUzc, recallAfter: 0,
      decision: "ERROR", note: "",
    };

    // Resolve grille PDF: residue → download from URL; else local copy / S3 staged.
    const key = `${GRILLE_PREFIX}/${slug}.pdf`;
    const localPdf = localDir ? join(localDir, `${slug}.pdf`) : undefined;
    const dir = await mkdtemp(join(tmpdir(), `reocr-${slug}-`));
    let pdfPath: string;
    if (rc) {
      pdfPath = join(dir, "grille.pdf");
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 60000);
        const resp = await fetch(rc.sourceUrl, { signal: ctrl.signal, redirect: "follow" });
        clearTimeout(t);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1024 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
        await writeFile(pdfPath, buf);
      } catch (e) {
        row.decision = "ERROR"; row.note = `download-failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        rows.push(row); console.error(`[${slug}] download-failed`); continue;
      }
    } else if (localPdf && existsSync(localPdf)) {
      pdfPath = localPdf;
    } else if (await exists(s3, key)) {
      pdfPath = join(dir, "grille.pdf");
      await writeFile(pdfPath, await getBytes(s3, key));
    } else {
      row.decision = "SKIP-NO-GRILLE"; row.note = "no staged grille";
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      rows.push(row); console.error(`[${slug}] SKIP no grille`); continue;
    }
    try {
      const pageCount = pdfPageCount(pdfPath);
      const first = cfg?.first ?? 1;
      const lastUnbounded = Math.min(cfg?.last ?? pageCount, pageCount);
      const maxByBudget = Math.max(1, Math.floor(budgetUsd / ocr.costPerPage));
      const last = Math.min(lastUnbounded, first - 1 + maxByBudget);
      row.ocrPages = last - first + 1;

      const res = await chunkedOcrRange(
        pdfPath, first, last, CHUNK_PAGES,
        ocrCall,
        ocr.costPerPage,
        { source_url: base?.source_url ?? cfg?.sourceUrl ?? "non-disponible", snapshot, methode: ocr.methode },
      );
      row.ocrUsd = res.usd; totalUsd += res.usd;
      const chunkNote = res.chunksFailed > 0 ? `${res.chunksFailed} chunk(s) failed; ` : "";
      if (res.reasons.length > 0) console.error(`[${slug}] chunk-reasons: ${res.reasons.slice(0, 3).join(" | ")}`);

      // Merge by zone_code, prefer the row with more published norm values.
      const byZone = new Map<string, ZoneNormsT>();
      for (const zn of res.zones) {
        const k = zn.zone_code.toUpperCase().replace(/\s+/g, "");
        const prev = byZone.get(k);
        if (!prev || publishedCount(zn) > publishedCount(prev)) byZone.set(k, zn);
      }
      const zones = [...byZone.values()];
      const cross: CrossValResult = await crossValidateZoneCodes(s3, slug, zones);
      row.ocrUzc = cross.extractedZoneCodes;
      row.ocrOverlap = cross.overlap;
      row.ocrPublished = totalPublished(zones);
      if (rc) row.gridFound = cross.gridFound; // residue: trust the LIVE crossval
      row.recallAfter = (rc ? cross.gridFound : gridFound) ? cross.overlap : cross.extractedZoneCodes;

      let improved: boolean;
      let why = "";
      if (rc) {
        // RESIDUE / MASS mode: NEW deposit (no chat-vision baseline). STRICT
        // anti-invention gate — never deposit unvalidated grilles (§4 noise lesson):
        //  - SIG grille present → require spatial overlap >= minSigOverlap;
        //  - no SIG grille      → require >= minGridlessPub published norm VALUES
        //    (a real grille table publishes dimensions; a misread usage list ~0).
        const hasRange = rc.first != null && rc.last != null;
        // Use the LIVE crossval (cross.gridFound), NOT the stale baseline `gridFound`
        // (which is always false for a NEW residue slug with no manifest entry).
        if (zones.length < 3) { improved = false; why = "below 3-code gate"; }
        else if (cross.gridFound) {
          // SIG present → spatial gate (noise-proof: full-doc OCR garbage does not
          // overlap the muni's real SIG codes — saint-guillaume 123 noise zones → overlap 0).
          improved = row.ocrOverlap >= minSigOverlap;
          if (!improved) why = `SIG overlap ${row.ocrOverlap} < ${minSigOverlap} (sig=${cross.sigZoneCodes})`;
        } else if (!hasRange) {
          // No SIG AND no located range → only the full doc to scan, which yields
          // §4 noise with no way to validate. Refuse.
          improved = false; why = "gridless + no located range (unvalidatable)";
        } else {
          // No SIG but a located grille range → require real published norm VALUES
          // (a misread usage list publishes ~0; a real grille table publishes many).
          improved = row.ocrPublished >= minGridlessPub;
          if (!improved) why = `gridless, published ${row.ocrPublished} < ${minGridlessPub} (unvalidated)`;
        }
      } else {
        // KEEP-BEST gate vs existing deposit: strict Pareto (no regression on
        // recall OR payload; strict gain on at least one).
        const recallOk = row.recallAfter >= row.recallBefore;
        const payloadOk = row.ocrPublished >= row.cvPublished;
        const strictGain = row.recallAfter > row.recallBefore || row.ocrPublished > row.cvPublished;
        improved = recallOk && payloadOk && strictGain && zones.length >= 3;
        why = !recallOk ? `recall would drop ${row.recallBefore}->${row.recallAfter}`
          : !payloadOk ? `payload would drop ${row.cvPublished}->${row.ocrPublished}`
          : !strictGain ? "no strict gain (tie)"
          : "below 3-code gate";
      }

      if (improved) {
        row.decision = "DEPOSIT-OCR";
        row.note = `${chunkNote}recall ${row.recallBefore}->${row.recallAfter}, published ${row.cvPublished}->${row.ocrPublished}`;
        if (apply) {
          const meta = {
            source_url: base?.source_url ?? cfg?.sourceUrl ?? "non-disponible",
            ...(base?.reglement ? { reglement: base.reglement } : {}),
            methode: ocr.methode, snapshot,
          };
          if (noManifest) {
            // Parquet-only: never touch the shared manifest (merge later from S3).
            await depositParquetOnly({ s3, slug, zones, meta, crossval: cross });
          } else {
            await depositZonageNorms({ s3, slug, zones, meta, crossval: cross, idempotent: false });
          }
        }
      } else {
        row.decision = "KEEP-CV";
        row.note = chunkNote + why;
      }
    } catch (e) {
      row.decision = "ERROR";
      row.note = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    rows.push(row);
    console.error(
      `[${slug}] ${row.decision} gridFound=${rc ? row.gridFound : gridFound} ` +
      `overlap ${cvOverlap}->${row.ocrOverlap} uzc ${cvUzc}->${row.ocrUzc} ` +
      `pub ${cvPublished}->${row.ocrPublished} $${row.ocrUsd.toFixed(3)} :: ${row.note}`,
    );
  }

  // Summary JSON to stdout.
  const deposited = rows.filter((r) => r.decision === "DEPOSIT-OCR");
  const keptCv = rows.filter((r) => r.decision === "KEEP-CV");
  console.log(JSON.stringify({
    apply, totalUsd: Math.round(totalUsd * 1000) / 1000,
    targets: targets.length,
    deposited: deposited.length, keptCv: keptCv.length,
    errors: rows.filter((r) => r.decision === "ERROR").length,
    skipNoGrille: rows.filter((r) => r.decision === "SKIP-NO-GRILLE").length,
    rows,
  }, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
