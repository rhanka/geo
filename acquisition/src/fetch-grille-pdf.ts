/**
 * fetch-grille-pdf.ts — download ONE known grille / règlement-de-zonage PDF to the
 * local `work/zonage-norms/<slug>/grille.pdf` path the norms runner consumes.
 *
 * Used when grille-discovery-run.ts cannot surface a grille-keyword PDF link (the
 * grille lives INSIDE a codified zoning by-law, e.g. Salaberry's consolidated
 * Règlement 150), but the official PDF URL is known from the muni's own portal.
 * Anti-invention: the URL is passed EXPLICITLY by the operator; nothing is guessed.
 * Confirms the body is a real PDF (%PDF magic bytes) before writing.
 *
 * Pure HTTP GET, 0 S3, 0 LLM, 0 secret. One committed command:
 *   npx tsx acquisition/src/fetch-grille-pdf.ts --slug <slug> --url <pdf-url>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK_DIR = join(REPO, "work", "zonage-norms");

// Honest UA (mirrors the PV/urbanisme adapters).
const USER_AGENT =
  "sentropic-geo/1.0 (+https://github.com/sentropic; municipal open-data acquisition)";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = arg(argv, "slug");
  const url = arg(argv, "url");
  if (!slug || !url) {
    throw new Error("required: --slug <slug> --url <pdf-url>");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const isPdf =
    buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
  if (!isPdf) throw new Error(`not a PDF (first bytes ${[...buf.slice(0, 4)].join(",")}) — ${url}`);

  const dir = join(WORK_DIR, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pdfPath = join(dir, "grille.pdf");
  writeFileSync(pdfPath, buf);

  const info = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pages = info.stdout?.match(/Pages:\s+(\d+)/)?.[1] ?? "?";
  console.log(
    `OK ${slug} downloaded ${(buf.length / 1e6).toFixed(1)} Mo pages=${pages} → ${pdfPath}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
