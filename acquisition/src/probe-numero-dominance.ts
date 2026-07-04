/**
 * probe-numero-dominance.ts — committed inspection helper for the "Numéro de zone:" /
 * "Dominance:" split-header one-zone-per-page grille parser
 * (packages/qc-sources parseNumeroDominanceGrillePage — Béloeil / Saint-Félicien
 * family).
 *
 * WHY. Ad-hoc diagnostics are rejected by the geo Bash hook. This runs the parser
 * over a whole staged grille PDF and prints, per zone, the emitted "<Dominance>-
 * <Numéro>" code + the guarded norm values, plus the aggregate publishedFieldPct
 * (the exact deposit-gate metric) — so a header-read or value-bind gap is visible
 * without a paid OCR pass.
 *
 * Usage:
 *   npx tsx acquisition/src/probe-numero-dominance.ts --slug saint-felicien
 *   npx tsx acquisition/src/probe-numero-dominance.ts --slug beloeil --page 220
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseNumeroDominanceGrillePage } from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";
import type { ZoneNormsT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";
import { canonZone, publishedFieldPct } from "./lib/zonage-norms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function pageTexts(pdfPath: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed: ${r.stderr?.slice(0, 160)}`);
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function vals(z: ZoneNormsT): Record<string, string | number | null> {
  return {
    code: z.zone_code,
    canon: canonZone(z.zone_code),
    d: z.densite?.value ?? null,
    h: z.hauteur_max?.value ?? null,
    av: z.marges.avant_min?.value ?? null,
    lat: z.marges.laterale_min?.value ?? null,
    ar: z.marges.arriere_min?.value ?? null,
    front: z.frontage_min?.value ?? null,
    sup: z.superficie_min?.value ?? null,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const slug = arg(argv, "slug");
  if (!slug) throw new Error("--slug required");
  const pdf = arg(argv, "pdf") ?? join(REPO, "work", "zonage-norms", slug, "grille.pdf");
  if (!existsSync(pdf)) throw new Error(`missing PDF: ${pdf}`);
  const allPages = pageTexts(pdf);
  const meta = { source_url: "probe://local", snapshot: "probe" };

  const page = arg(argv, "page");
  if (page) {
    const zs = parseNumeroDominanceGrillePage(allPages[Number(page) - 1] ?? "", Number(page), meta);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ slug, page: Number(page), zones: zs.map(vals) }, null, 2));
    return;
  }

  const byZone = new Map<string, ZoneNormsT>();
  const pub = (z: ZoneNormsT): number =>
    [z.densite, z.hauteur_max, z.frontage_min, z.superficie_min, z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min].filter(
      (f) => f && f.value !== null,
    ).length;
  for (let i = 0; i < allPages.length; i++) {
    for (const zn of parseNumeroDominanceGrillePage(allPages[i] ?? "", i + 1, meta)) {
      const key = canonZone(zn.zone_code);
      const prev = byZone.get(key);
      if (!prev || pub(zn) > pub(prev)) byZone.set(key, zn);
    }
  }
  const zones = [...byZone.values()];
  const withFields = zones.filter((z) => pub(z) > 0).length;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        slug,
        distinctZones: zones.length,
        zonesWithFields: withFields,
        publishedFieldPct: publishedFieldPct(zones),
        sample: zones.slice(0, 12).map(vals),
      },
      null,
      2,
    ),
  );
}

main();
