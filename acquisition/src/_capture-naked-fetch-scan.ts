/**
 * _capture-naked-fetch-scan.ts — balaye `acquisition/src` et RÉGÉNÈRE l'allow-list
 * committée qui fige la dette de `fetch()` nu.
 *
 * Le gate (`lib/naked-fetch-gate.test.ts`) échoue sur toute AUGMENTATION. Quand un
 * fichier est migré vers le chokepoint (`capturedFetch`), le compte baisse : c'est
 * ici qu'on le regrave, jamais à la main.
 *
 * Usage :
 *   npx tsx acquisition/src/_capture-naked-fetch-scan.ts            # rapport seul
 *   npx tsx acquisition/src/_capture-naked-fetch-scan.ts --write    # regrave l'allow-list
 *   npx tsx acquisition/src/_capture-naked-fetch-scan.ts --diff     # écarts vs allow-list
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NAKED_FETCH_PATTERN,
  scanNakedFetch,
  trackedTsFiles,
  type NakedFetchAllowlist,
} from "./lib/naked-fetch-scan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SCANNED_SUBDIR = "acquisition/src";
const ALLOWLIST = resolve(ROOT, "acquisition/config/naked-fetch-allowlist.json");

const DOC =
  "Dette FIGÉE de `fetch()` nu dans acquisition/src (SPEC_CAPTURE_ON_CLUSTER.md §5.1). " +
  "Tout appel réseau vers une source tierce DOIT passer par le chokepoint " +
  "packages/qc-sources/src/capture/capturedFetch.ts (règle C-0). Ce registre ne peut que " +
  "DÉCROÎTRE : le gate acquisition/src/lib/naked-fetch-gate.test.ts échoue sur toute hausse. " +
  "Régénérer avec: npx tsx acquisition/src/_capture-naked-fetch-scan.ts --write";

function main(): void {
  const argv = process.argv.slice(2);
  const scan = scanNakedFetch(trackedTsFiles(ROOT, SCANNED_SUBDIR), ROOT);
  console.error(`[naked-fetch] ${scan.total} occurrence(s) dans ${scan.fileCount} fichier(s) suivis par git`);

  if (argv.includes("--write")) {
    const payload: NakedFetchAllowlist = {
      _doc: DOC,
      pattern: NAKED_FETCH_PATTERN,
      scanned: SCANNED_SUBDIR,
      frozen_at: new Date().toISOString().slice(0, 10),
      total: scan.total,
      file_count: scan.fileCount,
      files: Object.fromEntries(Object.entries(scan.files).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(ALLOWLIST, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.error(`[naked-fetch] allow-list regravée -> ${ALLOWLIST}`);
    return;
  }

  if (argv.includes("--diff")) {
    const current = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as NakedFetchAllowlist;
    let clean = true;
    for (const [file, count] of Object.entries(scan.files)) {
      const frozen = current.files[file] ?? 0;
      if (count > frozen) { console.error(`  HAUSSE   ${file}: ${frozen} -> ${count}`); clean = false; }
      else if (count < frozen) { console.error(`  baisse   ${file}: ${frozen} -> ${count}`); clean = false; }
    }
    for (const [file, frozen] of Object.entries(current.files)) {
      if (!(file in scan.files)) { console.error(`  MIGRÉ    ${file}: ${frozen} -> 0`); clean = false; }
    }
    console.error(clean ? "  (aucun écart)" : `  total ${current.total} -> ${scan.total}`);
    return;
  }

  for (const [file, count] of Object.entries(scan.files).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${String(count).padStart(3)}  ${file}`);
  }
}

main();
