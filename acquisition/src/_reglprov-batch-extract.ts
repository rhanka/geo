/**
 * _reglprov-batch-extract.ts — lane PROVENANCE RÈGLEMENT (P0_1 immo), triage EXTRACT.
 *
 * Pour chaque cible {slug,url} d'un fichier de travail: télécharge le PDF via le
 * fetcher tolérant committé (_fetch-pdf-tolerant.ts, magic-byte %PDF), puis extrait
 * le texte avec poppler `pdftotext -layout` ($0, aucun OCR) et imprime VERBATIM les
 * lignes candidates numéro/millésime (regex éprouvées de _reglement-numero-probe.ts),
 * avec leur page. On LIT ensuite ces lignes à l'œil pour décider le numéro verbatim
 * (anti-invention: jamais déduit du nom de fichier).
 *
 * Usage (depuis acquisition/):
 *   npx tsx src/_reglprov-batch-extract.ts --in acquisition/config/_reglprov-extract-shard1.json
 *   npx tsx src/_reglprov-batch-extract.ts --in <file> --slugs a,b   # sous-ensemble
 *   npx tsx src/_reglprov-batch-extract.ts --in <file> --pages 40 --head 1400
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH = "/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-geo/22a5fa1f-c477-4022-8e52-66c681ff7df4/scratchpad/reglprov";

const NUM_RE =
  /(r[eè]glement[s]?\s+(de\s+)?(zonage|d[eu]\s+zonage)|zonage\s+(num[eé]ro|n[°ºo]))|r[eè]glement\s*(num[eé]ro|n[°ºo]|#)\s*[:.]?\s*[0-9]|porte\s+(le\s+)?(num[eé]ro|titre)/i;
const DATE_RE =
  /(entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le|adopt[eé]|adoption|codification\s+administrative|mise\s+[àa]\s+jour|consolid)/i;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function fetchPdf(url: string, out: string): string {
  try {
    const o = execFileSync("npx", ["tsx", resolve(ROOT, "acquisition", "src", "_fetch-pdf-tolerant.ts"), "--url", url, "--out", out],
      { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });
    return o.trim().split("\n").slice(-2).join(" | ");
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return `FETCH-ERR ${(err.stdout || "") + (err.stderr || "") || err.message || ""}`.replace(/\s+/g, " ").slice(0, 200);
  }
}

function pdftext(pdf: string, pages: number): string {
  return execFileSync("pdftotext", ["-f", "1", "-l", String(pages), "-layout", "-enc", "UTF-8", pdf, "-"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 120_000 });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inFile = arg(argv, "in");
  if (!inFile) { console.error("pass --in <file.json>"); process.exit(2); }
  const pages = Number(arg(argv, "pages") ?? "30");
  const head = Number(arg(argv, "head") ?? "1200");
  const only = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const cfg = JSON.parse(readFileSync(resolve(ROOT, inFile), "utf8")) as { targets: Array<{ slug: string; url: string }> };
  let targets = cfg.targets;
  if (only.length) targets = targets.filter((t) => only.includes(t.slug));
  if (!existsSync(SCRATCH)) mkdirSync(SCRATCH, { recursive: true });

  for (const { slug, url } of targets) {
    console.log(`\n########## ${slug}\nurl=${url}`);
    const out = resolve(SCRATCH, `${slug}.pdf`);
    if (!existsSync(out)) {
      console.log(`fetch: ${fetchPdf(url, out)}`);
    } else {
      console.log("fetch: (cache)");
    }
    if (!existsSync(out)) { console.log("=> PAS-DE-PDF"); continue; }
    let txt = "";
    try { txt = pdftext(out, pages); }
    catch (e) { console.log(`=> ERR-PDFTOTEXT ${e instanceof Error ? e.message : String(e)}`); continue; }
    if (txt.replace(/\s/g, "").length < 40) { console.log("=> NO-TEXT-LAYER (scan image)"); continue; }
    // Head of page 1 (title page: grille annexes name their parent règlement here)
    console.log(`--- tête p1 (${head}c) ---`);
    console.log(txt.slice(0, head).replace(/\n{2,}/g, "\n").trim());
    // Candidate lines with page numbers
    const pagesArr = txt.split("\f");
    const hits: string[] = [];
    pagesArr.forEach((pg, idx) => {
      pg.split("\n").forEach((ln) => {
        const t = ln.trim();
        if (t.length < 3) return;
        if (NUM_RE.test(t) || DATE_RE.test(t)) hits.push(`p${idx + 1}\t${NUM_RE.test(t) ? "NUM " : "DATE"}\t${t.slice(0, 160)}`);
      });
    });
    console.log(`--- candidats (${hits.length}) ---`);
    for (const h of hits.slice(0, 40)) console.log(h);
    if (hits.length === 0) console.log("(aucun — NO-CANDIDATE-LINE)");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
