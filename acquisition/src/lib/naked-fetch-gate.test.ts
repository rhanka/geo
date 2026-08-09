/**
 * GATE — « plus aucun NOUVEAU `fetch()` nu dans acquisition/src ».
 *
 * SPEC_CAPTURE_ON_CLUSTER.md §5.1 : « un test DOIT échouer si un fichier de
 * `acquisition/src/**` contient un `fetch(` nu hors du chokepoint. Sans ce gate,
 * la règle est un vœu. »
 *
 * Le compte est FIGÉ dans `acquisition/config/naked-fetch-allowlist.json` et ne
 * peut que DÉCROÎTRE. La migration des dizaines de runners restants est
 * progressive et assumée ; ce qui est interdit, c'est d'en RAJOUTER.
 *
 * Aucun réseau, aucune I/O S3 : le test ne fait que lire des sources.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  countNakedFetch,
  NAKED_FETCH_PATTERN,
  scanNakedFetch,
  stripCommentsAndStrings,
  trackedTsFiles,
  type NakedFetchAllowlist,
} from "./naked-fetch-scan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const ALLOWLIST_PATH = resolve(ROOT, "acquisition/config/naked-fetch-allowlist.json");
const CHOKEPOINT = "packages/qc-sources/src/capture/capturedFetch.ts";
const REFRESH = "npx tsx acquisition/src/_capture-naked-fetch-scan.ts --write";

function loadAllowlist(): NakedFetchAllowlist {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as NakedFetchAllowlist;
}

describe("scanner de fetch nu", () => {
  it("compte le fetch global et lui seul", () => {
    expect(countNakedFetch("const r = await fetch(url);")).toBe(1);
    expect(countNakedFetch("await fetch (url);")).toBe(1);
    expect(countNakedFetch("await globalThis.fetch(url);")).toBe(0);
    expect(countNakedFetch("await capturedFetch(url, undefined, ctx);")).toBe(0);
    expect(countNakedFetch("await this.fetchImpl(url);")).toBe(0);
    expect(countNakedFetch("await nodeFetch(url);")).toBe(0);
  });

  it("ne compte NI les commentaires NI les littéraux (un gate qui lit de la prose ment)", () => {
    expect(countNakedFetch("// plus aucun fetch() nu ici\nconst x = 1;")).toBe(0);
    expect(countNakedFetch("/* interdit: fetch(url) */")).toBe(0);
    expect(countNakedFetch('const msg = "remplace fetch(url) par capturedFetch";')).toBe(0);
    expect(countNakedFetch("const re = `fetch(`;")).toBe(0);
    // ... mais le vrai appel derrière un commentaire, si.
    expect(countNakedFetch("// note: fetch(x)\nconst r = await fetch(u);")).toBe(1);
  });

  it("dépouille sans détruire le code utile", () => {
    expect(stripCommentsAndStrings('const a = "x"; // y\nconst b = 2;')).toContain("const b = 2;");
  });
});

describe("gate: la dette de fetch nu ne peut que DÉCROÎTRE", () => {
  const allowlist = loadAllowlist();
  const scan = scanNakedFetch(trackedTsFiles(ROOT, allowlist.scanned), ROOT);

  it("l'allow-list committée est bien formée et décrit le même motif", () => {
    expect(allowlist.pattern).toBe(NAKED_FETCH_PATTERN);
    expect(allowlist.scanned).toBe("acquisition/src");
    expect(Object.keys(allowlist.files)).toHaveLength(allowlist.file_count);
    expect(Object.values(allowlist.files).reduce((a, b) => a + b, 0)).toBe(allowlist.total);
  });

  it("AUCUN fichier ne dépasse son compte figé, et aucun fichier neuf n'en introduit", () => {
    const offenders: string[] = [];
    for (const [file, count] of Object.entries(scan.files)) {
      const frozen = allowlist.files[file] ?? 0;
      if (count > frozen) offenders.push(`  ${file}: figé ${frozen} -> trouvé ${count}`);
    }
    expect(
      offenders.length === 0,
      offenders.length === 0
        ? ""
        : [
            "",
            `${offenders.length} fichier(s) ont GAGNÉ un appel \`fetch()\` nu :`,
            ...offenders,
            "",
            "Tout appel réseau vers une source tierce DOIT passer par LE CHOKEPOINT DE CAPTURE",
            `(règle C-0, docs/spec/SPEC_CAPTURE_ON_CLUSTER.md §5.1) :`,
            `  ${CHOKEPOINT}`,
            "",
            "Remplacer :",
            "  const r = await fetch(url, init);",
            "par :",
            "  import { capturedFetch, capturedText } from \"../../packages/qc-sources/src/capture/index.js\";",
            "  import { openCaptureRun } from \"./lib/capture-s3.js\";",
            "  const run = openCaptureRun({ lane: \"zones\" });",
            "  const res = await capturedFetch(url, init, { run, source: \"zones-arcgis\", slugs: [slug] });",
            "",
            "Un fetch non journalisé est un fetch PERDU : ni url, ni http_status, ni retrieved_at,",
            "ni sha256 — donc aucune preuve v2 possible (c'est la cause de 0/1106).",
            "Un ÉCHEC se journalise aussi : c'est lui qui documente un gisement épuisé.",
            "",
            `Si la hausse est légitime et arbitrée, regraver le registre : ${REFRESH}`,
          ].join("\n"),
    ).toBe(true);
  });

  it("le total figé n'est jamais dépassé (cliquet global)", () => {
    expect(
      scan.total <= allowlist.total,
      `dette totale ${scan.total} > total figé ${allowlist.total} — le cliquet est cassé. ${REFRESH}`,
    ).toBe(true);
  });

  it("les deux runners câblés sur le chokepoint sont sortis de la dette", () => {
    for (const migrated of [
      "acquisition/src/zones-arcgis-replace.ts",
      "acquisition/src/zones-geocentralis-replace.ts",
    ]) {
      expect(scan.files[migrated], `${migrated} a re-gagné un fetch() nu`).toBeUndefined();
      expect(allowlist.files[migrated]).toBeUndefined();
    }
  });
});
