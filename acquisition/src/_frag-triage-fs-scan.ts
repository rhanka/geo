/**
 * _frag-triage-fs-scan.ts — ONE-OFF (zone-contiguity `fragmented` triage mission):
 * for each of the 10 fragmented slugs, report what's ON DISK ($0 gate before
 * paying anything): work/zonage-norms/<slug>-.../ directories + their PDFs, whether
 * acquisition/config/usage-dominant-map/<slug>.json exists (legend source), and
 * whether acquisition/config/reglement-provenance.json has an entry (corpus
 * availability). For every PDF found, attempts extractGeoRef (embedded T1
 * georeferencing) — the saint-stanislas-de-kostka recipe gate.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-fs-scan.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractGeoRef } from "./lib/t1-georef.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const ZONAGE_NORMS = join(ROOT, "work", "zonage-norms");
const UD_MAP_DIR = join(ROOT, "acquisition", "config", "usage-dominant-map");
const REGL_PROV = join(ROOT, "acquisition", "config", "reglement-provenance.json");

const SLUGS = [
  "notre-dame-de-lourdes--joliette",
  "saint-amable",
  "preissac",
  "stratford",
  "mont-saint-hilaire",
  "hemmingford--les-jardins-de-napierville--2",
  "cowansville",
  "chelsea",
  "boucherville",
];

function findPdfsRecursive(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out = out.concat(findPdfsRecursive(p, depth + 1));
    else if (e.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

function main(): void {
  let allDirs: string[] = [];
  try {
    allDirs = readdirSync(ZONAGE_NORMS);
  } catch (e) {
    console.log(`ERREUR lecture ${ZONAGE_NORMS}: ${e}`);
  }

  let provenance: Record<string, unknown> = {};
  if (existsSync(REGL_PROV)) {
    try {
      provenance = JSON.parse(readFileSync(REGL_PROV, "utf8")) as Record<string, unknown>;
    } catch (e) {
      console.log(`ERREUR parse reglement-provenance.json: ${e}`);
    }
  }

  for (const slug of SLUGS) {
    console.log(`\n=== ${slug} ===`);
    const matchDirs = allDirs.filter((d) => d === slug || d.startsWith(`${slug}-`) || d.startsWith(`${slug}_`));
    console.log(`  work/zonage-norms/ dirs matching: ${matchDirs.length ? matchDirs.join(", ") : "(aucun)"}`);
    let pdfs: string[] = [];
    for (const d of matchDirs) pdfs = pdfs.concat(findPdfsRecursive(join(ZONAGE_NORMS, d)));
    console.log(`  PDFs trouvés: ${pdfs.length}`);
    for (const p of pdfs) {
      let sizeKb = 0;
      try {
        sizeKb = Math.round(statSync(p).size / 1024);
      } catch {
        /* ignore */
      }
      let geoVerdict = "?";
      try {
        const buf = readFileSync(p);
        const geo = extractGeoRef(buf, p);
        geoVerdict = geo
          ? `GEOREF OK (${geo.crsName}, residu ${geo.maxResidualM.toFixed(3)} m)`
          : "no /VP /Measure /GEO";
      } catch (e) {
        geoVerdict = `erreur extractGeoRef: ${(e as Error).message?.slice(0, 120)}`;
      }
      console.log(`    - ${p.replace(ROOT + "/", "")} (${sizeKb} Ko) -> ${geoVerdict}`);
    }
    const udPath = join(UD_MAP_DIR, `${slug}.json`);
    console.log(`  usage-dominant-map: ${existsSync(udPath) ? "PRESENT" : "absent"}`);
    const provKey = Object.keys(provenance).find((k) => k === slug);
    console.log(`  reglement-provenance entry: ${provKey ? JSON.stringify((provenance as Record<string, unknown>)[provKey]).slice(0, 300) : "absent"}`);
  }
}

main();
