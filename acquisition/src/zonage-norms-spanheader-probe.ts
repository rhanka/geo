/**
 * zonage-norms-spanheader-probe — READ-ONLY enumerator for the SPAN-HEADER
 * ALPHA-ONLY grille residue (the `grille-spanheader-parser.ts` variant's target).
 *
 * For every on-disk grille PDF at `work/zonage-norms/<slug>/grille.pdf` it probes the
 * `pdftotext -layout` projection and keeps a slug ONLY when:
 *   - the FROZEN native readers decline it (no accepted native rows, and the frozen
 *     `parseLabelValueGrillePage` maps 0 fields on the sampled pages), AND
 *   - the span-header variant reads ≥ MIN alpha-only codes AND maps ≥1 norm field.
 * That is exactly the "standard returns 0 → span-header fallback" gate, offline.
 *
 * Pure read: stats + pdftotext on local PDFs. 0 S3, 0 LLM. Committed (gate-safe).
 *
 * Usage: npx tsx acquisition/src/zonage-norms-spanheader-probe.ts [--limit N] [--json]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSpanHeaderGrillePage,
  readSpanHeaderCodes,
} from "../../packages/qc-sources/src/sources/grille-spanheader-parser.js";
import { parseLabelValueGrillePage } from "../../packages/qc-sources/src/sources/grille-zoneheader-parser.js";
import {
  isGrillePage,
  parseGrillePage,
  type ZoneNormsT,
} from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, "..");
const REPO = resolve(ACQ, "..");
const WORK = join(REPO, "work", "zonage-norms");
const SNAP = new Date().toISOString().slice(0, 10);

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pageTexts(pdf: string): string[] {
  const r = spawnSync("pdftotext", ["-q", "-layout", "-enc", "UTF-8", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const parts = (r.stdout ?? "").split("\f");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function published(z: ZoneNormsT): number {
  return [
    z.densite,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ].filter((f) => f && f.value !== null).length;
}

interface Cand {
  slug: string;
  pages: number;
  nativeRows: number;
  labelValueFields: number;
  spanCodes: string[];
  spanZones: number;
  spanFieldZones: number;
  spanFields: number;
}

function main(): void {
  const limit = Number(get("limit") ?? "0");
  const slugs = existsSync(WORK)
    ? readdirSync(WORK)
        .filter((d) => {
          try {
            return (
              statSync(join(WORK, d)).isDirectory() && existsSync(join(WORK, d, "grille.pdf"))
            );
          } catch {
            return false;
          }
        })
        .sort()
    : [];

  const cands: Cand[] = [];
  for (const slug of slugs) {
    const pdf = join(WORK, slug, "grille.pdf");
    const texts = pageTexts(pdf);
    if (texts.length === 0) continue;

    // Frozen native horizontal parser accepted rows?
    let nativeRows = 0;
    for (const t of texts) {
      if (!isGrillePage(t).isGrille) continue;
      const res = parseGrillePage(t, { source_url: "probe", snapshot: SNAP });
      if (!res.rejected) nativeRows += res.zones.length;
    }
    // Frozen label:value zoneheader mapper fields (the standard voie-B reader)?
    let labelValueFields = 0;
    for (const t of texts) {
      const zs = parseLabelValueGrillePage(t, 1, { source_url: "probe", snapshot: SNAP });
      for (const z of zs) labelValueFields += published(z);
    }
    // Span-header variant?
    const spanByCode = new Map<string, ZoneNormsT>();
    for (let i = 0; i < texts.length; i++) {
      for (const z of parseSpanHeaderGrillePage(texts[i] ?? "", i + 1, {
        source_url: "probe",
        snapshot: SNAP,
      })) {
        const prev = spanByCode.get(z.zone_code);
        if (!prev || published(z) > published(prev)) spanByCode.set(z.zone_code, z);
      }
    }
    const spanZonesArr = [...spanByCode.values()];
    const spanFields = spanZonesArr.reduce((n, z) => n + published(z), 0);
    const spanFieldZones = spanZonesArr.filter((z) => published(z) > 0).length;

    // Candidate = frozen readers decline AND span variant maps ≥3 codes with fields.
    if (nativeRows === 0 && labelValueFields === 0 && spanByCode.size >= 3 && spanFields > 0) {
      cands.push({
        slug,
        pages: texts.length,
        nativeRows,
        labelValueFields,
        spanCodes: [...spanByCode.keys()],
        spanZones: spanByCode.size,
        spanFieldZones,
        spanFields,
      });
    }
    void readSpanHeaderCodes; // (kept for ad-hoc REPL use)
  }

  cands.sort((a, b) => b.spanFields - a.spanFields);
  const out = limit > 0 ? cands.slice(0, limit) : cands;
  console.error(
    `[spanheader-probe] on-disk grilles=${slugs.length} candidates=${cands.length} (frozen=0, span≥3 codes+fields)`,
  );
  console.log(
    JSON.stringify(
      {
        onDisk: slugs.length,
        candidates: cands.length,
        rows: out.map((c) => ({
          slug: c.slug,
          pages: c.pages,
          spanZones: c.spanZones,
          spanFieldZones: c.spanFieldZones,
          spanFields: c.spanFields,
          codes: c.spanCodes.slice(0, 16),
        })),
      },
      null,
      2,
    ),
  );
}

main();
