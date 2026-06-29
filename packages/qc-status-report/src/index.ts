/**
 * Générateur de rapport de statut QC — point d'entrée.
 *
 *   npm run report            # collecte live S3 + génère md + docx
 *   tsx src/index.ts          # idem
 *   tsx src/index.ts --offline  # n'appelle PAS S3 (fixture zéro) — pour smoke-test
 *
 * Sorties (dossier out/) :
 *   status-quebec-<YYYY-MM-DD>.md   + .docx   (tracé, daté)
 *   status-quebec-latest.md         + .docx   (alias stable)
 *
 * 100% TypeScript/Node. Lecture seule sur S3. Aucun secret écrit. Idempotent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectCoverage, type Coverage } from "./collect.js";
import { renderDocx } from "./docx.js";
import { isoDay, renderMarkdown } from "./markdown.js";
import { s3Client } from "./s3.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "out");

/** Couverture nulle (mode --offline / smoke-test, n'appelle pas S3). */
function emptyCoverage(): Coverage {
  return {
    collectedAt: new Date().toISOString(),
    provinceDenominator: 0,
    cadastreLots: 0,
    cadastrePreclipBackups: 0,
    roleFoncier: 0,
    indexImmo: 0,
    zonageGridsTotal: 0,
    zonageGridsWithZoneCode: 0,
    zonageGridsSampled: 0,
    zonageNorms: 0,
    pmtiles: 0,
    pmtilesFiles: [],
  };
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");

  let cov: Coverage;
  if (offline) {
    console.error("[qc-status-report] mode --offline : aucune requête S3.");
    cov = emptyCoverage();
  } else {
    console.error("[qc-status-report] collecte de la couverture LIVE depuis S3 (lecture seule)…");
    const s3 = s3Client();
    cov = await collectCoverage(s3);
  }

  console.error("[qc-status-report] couverture collectée :", {
    province: cov.provinceDenominator,
    cadastreLots: cov.cadastreLots,
    preclip: cov.cadastrePreclipBackups,
    roleFoncier: cov.roleFoncier,
    indexImmo: cov.indexImmo,
    zonageGrids: cov.zonageGridsTotal,
    zonageWithCode: cov.zonageGridsWithZoneCode,
    zonageSampled: cov.zonageGridsSampled,
    norms: cov.zonageNorms,
    pmtiles: cov.pmtiles,
    pmtilesFiles: cov.pmtilesFiles,
  });

  const md = renderMarkdown(cov);
  const docxBuf = await renderDocx(cov);

  mkdirSync(OUT_DIR, { recursive: true });
  const day = isoDay(cov.collectedAt);

  const targets: Array<[string, string | Buffer]> = [
    [`status-quebec-${day}.md`, md],
    [`status-quebec-${day}.docx`, docxBuf],
    ["status-quebec-latest.md", md],
    ["status-quebec-latest.docx", docxBuf],
  ];

  for (const [name, content] of targets) {
    const p = join(OUT_DIR, name);
    writeFileSync(p, content);
    console.error(`[qc-status-report] écrit : ${p}`);
  }

  console.error("[qc-status-report] terminé.");
}

main().catch((err) => {
  console.error("[qc-status-report] ÉCHEC :", err);
  process.exitCode = 1;
});
