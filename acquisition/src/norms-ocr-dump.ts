/**
 * norms-ocr-dump — DIAGNOSTIC. OCR a local grille PDF (Mistral, the same seam the
 * production runner uses) and print the raw per-page markdown, so we can see WHY
 * the transposed-grille mapper produced codes-without-norm-values. Read-only: it
 * deposits nothing. Loads the Mistral key from the env file (never printed).
 *
 * Usage: npx tsx acquisition/src/norms-ocr-dump.ts --pdf <path> [--max-chars 8000]
 */
import { ensureOcrKeyLoaded } from "./lib/ocr-env.js";
import { resolveOcrCall } from "./lib/ocr.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const pdf = arg("--pdf", "");
  const maxChars = Number(arg("--max-chars", "8000"));
  if (!pdf) {
    console.error("usage: norms-ocr-dump --pdf <path> [--max-chars N]");
    process.exit(1);
  }
  const keyFrom = ensureOcrKeyLoaded();
  console.error(`[ocr-dump] key=${keyFrom ? "loaded:" + keyFrom : "from-env"} pdf=${pdf}`);
  const { call, config } = resolveOcrCall();
  console.error(`[ocr-dump] provider=${config.provider} model=${config.model}`);
  const res = await call(pdf);
  console.error(`[ocr-dump] pages=${res.pages.length} pagesBilled=${res.pagesProcessed}`);
  res.pages.forEach((p, i) => {
    console.log(`\n===== PAGE ${i + 1} (len=${p.markdown.length}) =====`);
    console.log(p.markdown.slice(0, maxChars));
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
