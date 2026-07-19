/**
 * norms-arcgis-grille-fetch — harvest a "one grille PDF per zone" municipality.
 *
 * Some munis (L'Assomption) never publish a consolidated grille annex; instead their
 * public ArcGIS zoning layer carries a per-feature `Lien` attribute pointing at a
 * ONE-PAGE "grille des spécifications" PDF for that zone. This walks the FeatureServer
 * (paged), dedups the links, downloads each PDF, then concatenates them into a single
 * PDF whose per-page header banner carries the zone code — exactly the shape the
 * committed `--route zoneheader` extractor consumes.
 *
 * Anti-invention: the zone code is never derived from the URL; it is only reported
 * from the layer attribute, and the deposit still reads each code VERBATIM from the
 * PDF header downstream. Pages that fail to download are dropped and counted, never
 * substituted.
 *
 * Cost: HTTP only. 0 LLM.
 *
 * Usage:
 *   npx tsx acquisition/src/norms-arcgis-grille-fetch.ts --slug lassomption \
 *     --layer 'https://services9.arcgis.com/.../FeatureServer/0' \
 *     [--code-field Zonage] [--link-field Lien] [--limit N]
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Feat {
  attributes: Record<string, unknown>;
}

async function queryAll(layer: string, fields: string[]): Promise<Feat[]> {
  const out: Feat[] = [];
  let offset = 0;
  for (;;) {
    const url =
      `${layer}/query?where=1%3D1&outFields=${encodeURIComponent(fields.join(","))}` +
      `&returnGeometry=false&f=json&resultOffset=${offset}&resultRecordCount=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`layer query HTTP ${res.status}`);
    const json = (await res.json()) as { features?: Feat[]; exceededTransferLimit?: boolean };
    const feats = json.features ?? [];
    out.push(...feats);
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
    if (offset > 20000) break; // runaway guard
  }
  return out;
}

async function main(): Promise<void> {
  const slug = get("slug");
  const layer = get("layer");
  if (!slug || !layer) throw new Error("required: --slug <slug> --layer <FeatureServer/0 url>");
  const codeField = get("code-field") ?? "Zonage";
  const linkField = get("link-field") ?? "Lien";
  const limit = Number(get("limit") ?? "0");

  const feats = await queryAll(layer, [codeField, linkField]);
  const byLink = new Map<string, string>(); // link -> code
  for (const f of feats) {
    const code = String(f.attributes[codeField] ?? "").trim();
    const link = String(f.attributes[linkField] ?? "").trim();
    if (!code || !link.toLowerCase().endsWith(".pdf")) continue;
    if (!byLink.has(link)) byLink.set(link, code);
  }
  const entries = [...byLink.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const todo = limit > 0 ? entries.slice(0, limit) : entries;
  console.log(`[arcgis-grille] features=${feats.length} distinct grille PDFs=${entries.length} fetching=${todo.length}`);

  const dir = join("work/zonage-norms", slug, "grilles");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  let ok = 0;
  let fail = 0;
  for (const [link, code] of todo) {
    const path = join(dir, `${code.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`);
    if (existsSync(path) && statSync(path).size > 2048) {
      files.push(path);
      ok++;
      continue;
    }
    try {
      const res = await fetch(link);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2048 || buf.subarray(0, 4).toString() !== "%PDF") {
        throw new Error(`not a PDF (${buf.length} bytes)`);
      }
      writeFileSync(path, buf);
      files.push(path);
      ok++;
    } catch (e) {
      fail++;
      console.log(`  MISS ${code}\t${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`[arcgis-grille] downloaded ok=${ok} fail=${fail}`);
  if (!files.length) return;

  const merged = join("work/zonage-norms", slug, "grilles-merged.pdf");
  const r = spawnSync("pdfunite", [...files, merged], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`pdfunite failed (${r.status}): ${r.stderr?.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[arcgis-grille] merged -> ${merged} (${files.length} grille pages)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
