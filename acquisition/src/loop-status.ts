/**
 * loop-status — statut propre du tick de la boucle geo QC (lecture pure, 0 LLM, 0 crédit).
 *
 * Remplace les `npx tsx -e '...'` inline jetables du tick par un script committé :
 *   1. régénère le TRACK REPORT (work/coverage/TRACK-REPORT.md) depuis la matrice ;
 *   2. résume le registre de provenance normes 2-moteurs (work/coverage/normes-provenance.json)
 *      par gagnant (kept-existing / ocr-4.0 / claude-4.8 / error), coût et recall.
 *
 * Usage : `npx tsx src/loop-status.ts`  (depuis acquisition/)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateReport } from "./coverage-report.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROVENANCE_JSON = join(REPO_ROOT, "work", "coverage", "normes-provenance.json");

interface ProvenanceRow {
  slug: string;
  winner?: string;
  existing_recall?: number;
  engineA_ocr_recall?: number;
  engineB_claude_recall?: number;
  engineA_ocr_usd?: number;
  deposited?: boolean;
}

function summarizeProvenance(): void {
  if (!existsSync(PROVENANCE_JSON)) {
    console.log("provenance: (aucun registre)");
    return;
  }
  const raw = JSON.parse(readFileSync(PROVENANCE_JSON, "utf8")) as { updated_at?: string; rows?: ProvenanceRow[] };
  const rows = raw.rows ?? [];
  const byWinner: Record<string, number> = {};
  let deposited = 0;
  let usd = 0;
  for (const r of rows) {
    const w = r.winner ?? "?";
    byWinner[w] = (byWinner[w] ?? 0) + 1;
    if (r.deposited) deposited++;
    usd += r.engineA_ocr_usd ?? 0;
  }
  const winnerStr = Object.entries(byWinner)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  console.log(
    `provenance: ${rows.length} villes [${winnerStr}] · déposés=${deposited} · OCR≈$${usd.toFixed(3)}` +
      (raw.updated_at ? ` · maj=${raw.updated_at}` : ""),
  );
}

function main(): void {
  generateReport(); // régénère work/coverage/TRACK-REPORT.md (le SCOREBOARD /1106 vient de coverage-reconcile)
  console.log("report régénéré");
  summarizeProvenance();
}

main();
