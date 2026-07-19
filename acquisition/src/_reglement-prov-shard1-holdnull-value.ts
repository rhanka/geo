/**
 * _reglement-prov-shard1-holdnull-value.ts — lane P0_1, READ-ONLY, $0.
 *
 * Priorise les HOLD-NULL (entrée registre présente, reglement_numero null) :
 * un null curé ne vaut la peine d'être re-instruit QUE si le POLYGONE
 * `qc-zonage-<slug>` est servi (sinon le numéro gagné ne sert 0 fiche lot,
 * le goulot est la lane ZONES et pas la provenance).
 *
 * `fold --dry-run` ne le dit pas : le VETO court-circuite AVANT le test
 * d'existence du polygone. D'où cette sonde.
 *
 * Sort aussi le `_note` (verdict antérieur) pour distinguer un JUGEMENT
 * ré-instruisable d'une prémisse mesurable (voir note-premisse-mesurable-vs-jugement).
 *
 * Usage: npx tsx src/_reglement-prov-shard1-holdnull-value.ts <slug> [<slug> ...]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

async function polygonCount(s3: ReturnType<typeof s3Client>, slug: string): Promise<number | null> {
  // fold sert soit la clé plate, soit la clé sous-dossier (fold-double-key-s3-serving)
  const keys = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  for (const key of keys) {
    if (!(await exists(s3, key))) continue;
    try {
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
        features?: unknown[];
      };
      return fc.features?.length ?? 0;
    } catch {
      return -1;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    slugs: Record<string, Record<string, unknown>>;
  };
  const s3 = s3Client();
  const rows: Array<{ slug: string; poly: number | null; note: string; url: string }> = [];
  for (const slug of slugs) {
    const e = cfg.slugs[slug] ?? {};
    const poly = await polygonCount(s3, slug);
    rows.push({
      slug,
      poly,
      note: String(e["_note"] ?? ""),
      url: String(e["reglement_url"] ?? ""),
    });
  }
  rows.sort((a, b) => (b.poly ?? -1) - (a.poly ?? -1));
  for (const r of rows) {
    console.log(`\n### ${r.slug}  polygones=${r.poly === null ? "ABSENT" : r.poly}`);
    if (r.url) console.log(`    url=${r.url}`);
    if (r.note) console.log(`    note=${r.note}`);
  }
  const withPoly = rows.filter((r) => (r.poly ?? 0) > 0);
  console.log(
    `\nSUMMARY n=${rows.length} avecPolygoneServi=${withPoly.length} (${withPoly
      .map((r) => `${r.slug}:${r.poly}`)
      .join(", ")})`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
