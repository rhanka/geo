/**
 * probe-transposed-cols.ts — committed inspection helper for the zones-in-COLUMNS
 * transposed grille parser (packages/qc-sources parseTransposedColumnsGrille).
 *
 * WHY. When a real grille reports overlap≠0 but publishedFieldPct≈0, we must SEE
 * why the norm VALUES do not bind to the header anchors — but ad-hoc diagnostics are
 * rejected by the geo Bash hook. This prints, per page, the detected header band(s)
 * (each zone code + its left-edge column) and the per-zone captured norm fields, so
 * a column-alignment or label-mapping gap is visible without a paid OCR pass.
 *
 * Usage:
 *   npx tsx acquisition/src/probe-transposed-cols.ts --slug baie-comeau --page 1
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseTransposedColumnsGrille,
  columnsHeaderZones,
} from "../../packages/qc-sources/src/sources/grille-ocr-extractor.js";

function tokCols(line: string): { t: string; c: number }[] {
  const out: { t: string; c: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push({ t: m[0], c: m.index });
  return out;
}

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

function main(): void {
  const argv = process.argv.slice(2);
  const slug = arg(argv, "slug");
  if (!slug) throw new Error("--slug required");
  const page = Number(arg(argv, "page") ?? "1");
  const pdf = arg(argv, "pdf") ?? join(REPO, "work", "zonage-norms", slug, "grille.pdf");
  if (!existsSync(pdf)) throw new Error(`missing PDF: ${pdf}`);
  const allPages = pageTexts(pdf);
  if (argv.includes("--scan")) {
    for (let i = 0; i < allPages.length; i++) {
      const zs = parseTransposedColumnsGrille(allPages[i] ?? "", i + 1, {
        source_url: "probe://local",
        snapshot: "probe",
      });
      if (zs.length > 0) {
        const pub = zs.filter((z) =>
          [z.densite, z.hauteur_max, z.marges.avant_min, z.marges.laterale_min, z.marges.arriere_min].some(
            (f) => f && f.value !== null,
          ),
        ).length;
        // eslint-disable-next-line no-console
        console.log(`p${i + 1}: ${zs.length} zones (${pub} w/fields) :: ${zs.slice(0, 10).map((z) => z.zone_code).join(", ")}`);
      }
    }
    return;
  }
  const text = allPages[page - 1] ?? "";
  if (argv.includes("--raw")) {
    for (const line of text.split(/\r?\n/)) {
      const zs = columnsHeaderZones(line);
      const isHdr = zs.length >= 3;
      const label = line.slice(0, 40).trimEnd();
      if (isHdr) {
        // eslint-disable-next-line no-console
        console.log(`HDR[${zs.length}] "${label}" :: ${zs.map((z) => `${z.code}@${z.start}`).join(" ")}`);
      } else if (/occupation au sol|hauteur en etage|hauteur en étage|generale|générale|^avant|^arri|^lateral|^latéral/i.test(line.trim())) {
        // eslint-disable-next-line no-console
        console.log(`ROW "${label}" :: ${tokCols(line).slice(0, 12).map((x) => `${x.t}@${x.c}`).join(" ")}`);
      }
    }
    return;
  }
  const zones = parseTransposedColumnsGrille(text, page, {
    source_url: "probe://local",
    snapshot: "probe",
  });
  const out = zones.slice(0, 14).map((z) => ({
    code: z.zone_code,
    d: z.densite?.value ?? null,
    h: z.hauteur_max?.value ?? null,
    av: z.marges.avant_min?.value ?? null,
    ar: z.marges.arriere_min?.value ?? null,
    lat: z.marges.laterale_min?.value ?? null,
    front: z.frontage_min?.value ?? null,
    sup: z.superficie_min?.value ?? null,
  }));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ slug, page, distinctZones: zones.length, zones: out }, null, 2));
}

main();
