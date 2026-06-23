/**
 * coverage-report.ts — TRACK-REPORT dédié, régénérable.
 *
 * Roll-up reportable de la matrice (lit coverage-matrix.json) : par couche, le
 * nombre de villes done / planned / to-research sur les 1106, VENTILÉ PAR TRACK
 * (combien de villes done via agol-account, via disaggregation, via pdf-*, etc.),
 * + le % d'avancement vers 1106.
 *
 * Pure lecture/agrégation : aucun réseau, aucun LLM. Sortie Markdown écrite dans
 * `work/coverage/TRACK-REPORT.md`, régénérable à volonté depuis la matrice.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  COVERAGE_LAYERS,
  COVERAGE_TRACKS,
  type CoverageLayer,
} from "./coverage-tracks.js";
import {
  type CoverageMatrix,
  type CoverageStatus,
  loadMatrix,
  MATRIX_PATH,
} from "./coverage-matrix.js";

export const REPORT_PATH =
  "/home/antoinefa/src/geo/work/coverage/TRACK-REPORT.md";

/** Comptes agrégés d'une couche. */
export interface LayerRollup {
  readonly layer: CoverageLayer;
  readonly total: number;
  readonly done: number;
  readonly planned: number;
  readonly toResearch: number;
  /** % done sur 1106. */
  readonly pctDone: number;
  /** ventilation done par track : trackId → nb villes. */
  readonly doneByTrack: Record<string, number>;
  /**
   * ventilation du "plan" (planned + to-research) par track de TÊTE candidat :
   * la voie qui serait tentée en premier. trackId → nb villes.
   */
  readonly plannedByLeadTrack: Record<string, number>;
}

export interface CoverageRollup {
  readonly generatedAt: string;
  readonly municipalityCount: number;
  readonly layers: readonly LayerRollup[];
}

/** Agrège la matrice en roll-up par couche × track. */
export function rollup(matrix: CoverageMatrix): CoverageRollup {
  const total = matrix.municipalityCount;
  const slugs = Object.keys(matrix.cities);
  const layers: LayerRollup[] = [];

  for (const layer of COVERAGE_LAYERS) {
    const counts: Record<CoverageStatus, number> = {
      done: 0,
      planned: 0,
      "to-research": 0,
    };
    const doneByTrack: Record<string, number> = {};
    const plannedByLeadTrack: Record<string, number> = {};

    for (const slug of slugs) {
      const cell = matrix.cities[slug][layer];
      counts[cell.status]++;
      if (cell.status === "done") {
        const tr = cell.doneTrack ?? "(?)";
        doneByTrack[tr] = (doneByTrack[tr] ?? 0) + 1;
      } else {
        const lead = cell.candidateTracks[0] ?? "(none)";
        plannedByLeadTrack[lead] = (plannedByLeadTrack[lead] ?? 0) + 1;
      }
    }

    layers.push({
      layer,
      total,
      done: counts.done,
      planned: counts.planned,
      toResearch: counts["to-research"],
      pctDone: total > 0 ? Math.round((counts.done / total) * 1000) / 10 : 0,
      doneByTrack,
      plannedByLeadTrack,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    municipalityCount: total,
    layers,
  };
}

/** Ordonne les ids de track d'une couche selon la taxonomie (priorité). */
function trackOrder(layer: CoverageLayer): string[] {
  return COVERAGE_TRACKS[layer].map((t) => t.id);
}

function fmtByTrack(
  layer: CoverageLayer,
  byTrack: Record<string, number>,
): string {
  const order = trackOrder(layer);
  const entries = Object.entries(byTrack).sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  if (entries.length === 0) return "—";
  return entries.map(([t, n]) => `${t}=${n}`).join(", ");
}

/** Rend le roll-up en Markdown (tableau par couche + ventilation par track). */
export function renderMarkdown(r: CoverageRollup): string {
  const lines: string[] = [];
  lines.push("# TRACK-REPORT — couverture QC par couche × track");
  lines.push("");
  lines.push(`Généré : ${r.generatedAt}`);
  lines.push(`Cible : **${r.municipalityCount} municipalités** sur chaque couche.`);
  lines.push(
    "Régénérable : lit `work/coverage/coverage-matrix.json` (lecture pure, 0 LLM, 0 crédit).",
  );
  lines.push("");
  lines.push("## Roll-up par couche");
  lines.push("");
  lines.push("| Couche | done | planned | to-research | % done /1106 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const l of r.layers) {
    lines.push(
      `| ${l.layer} | ${l.done} | ${l.planned} | ${l.toResearch} | ${l.pctDone}% |`,
    );
  }
  lines.push("");
  lines.push("## Ventilation DONE par track");
  lines.push("");
  lines.push("| Couche | done par track |");
  lines.push("|---|---|");
  for (const l of r.layers) {
    lines.push(`| ${l.layer} | ${fmtByTrack(l.layer, l.doneByTrack)} |`);
  }
  lines.push("");
  lines.push("## Ventilation PLAN (planned + to-research) par track de tête");
  lines.push("");
  lines.push("| Couche | plan par track de tête |");
  lines.push("|---|---|");
  for (const l of r.layers) {
    lines.push(
      `| ${l.layer} | ${fmtByTrack(l.layer, l.plannedByLeadTrack)} |`,
    );
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

/** Charge la matrice, agrège, écrit TRACK-REPORT.md, renvoie le roll-up. */
export function generateReport(
  matrixPath: string = MATRIX_PATH,
  reportPath: string = REPORT_PATH,
): CoverageRollup {
  const matrix = loadMatrix(matrixPath);
  if (!matrix) {
    throw new Error(
      `Matrice introuvable : ${matrixPath} — lance d'abord le seed (coverage-cli seed).`,
    );
  }
  const r = rollup(matrix);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdown(r), "utf8");
  return r;
}
