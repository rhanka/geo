/**
 * t1-labels-claude.ts — Claude-vision label lane for GLYPH GeoPDFs.
 *
 * Same anti-invention contract as the GPT-5.5 lane (lib/t2-labels-gpt55.ts) but
 * the vision reader is Claude ITSELF (the operating agent, 4.8). Instead of
 * shelling out to a model subprocess, this lane is two-step:
 *
 *   1. RENDER — `renderClaudeCrop` rasterises the map neatline crop to PNG (the
 *      SAME `renderRegion` the GPT lane uses) so the agent can read it visually.
 *   2. INGEST — `loadClaudeReads` + `extractLabelsClaude` take the agent's
 *      positioned reads (`{labels:[{code,x,y}]}`, x/y normalized 0..1 in that
 *      crop) and validate them verbatim + unambiguously against the by-law
 *      `--dict` through the SHARED `validateGpt55LabelReads` guard.
 *
 * Nothing is fabricated: a read is kept only if it is a real dictionary code at a
 * real in-crop position; the georef transform (page→WGS84) then places it. This
 * reuses the frozen GPT-lane validator wholesale, so the anti-invention gate is
 * byte-identical across the vision backends — only the reader differs.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GeoRef } from "./t1-georef.js";
import {
  renderRegion,
  validateGpt55LabelReads,
  type Gpt55LabelRead,
  type Gpt55LabelResult,
} from "./t2-labels-gpt55.js";

export interface ClaudeRenderOptions {
  dpi?: number;
  page?: number;
  region?: [number, number, number, number];
  workDir?: string;
}

export interface ClaudeCrop {
  imagePath: string;
  region: [number, number, number, number];
  dpi: number;
  page: number;
}

/** Rasterise the neatline crop for the agent to read (reuses the GPT renderer). */
export function renderClaudeCrop(
  pdfPath: string,
  geo: GeoRef,
  slug: string,
  opts: ClaudeRenderOptions = {},
): ClaudeCrop {
  const dpi = opts.dpi ?? 150;
  const page = opts.page ?? 1;
  const region = opts.region ?? [0, 0, geo.pageW, geo.pageH];
  const workDir =
    opts.workDir ??
    join(tmpdir(), `t1claude-${createHash("md5").update(`${pdfPath}:${slug}`).digest("hex").slice(0, 8)}`);
  mkdirSync(workDir, { recursive: true });
  const imagePath = renderRegion(pdfPath, page, dpi, region, workDir);
  return { imagePath, region, dpi, page };
}

interface ReadsFile {
  labels: Array<{ code: string; x: number; y: number }>;
}

/** Load the agent's positioned reads from a JSON file into the validator shape. */
export function loadClaudeReads(readsPath: string): Gpt55LabelRead[] {
  const j = JSON.parse(readFileSync(readsPath, "utf8")) as ReadsFile | ReadsFile["labels"];
  const labels = Array.isArray(j) ? j : j.labels;
  if (!Array.isArray(labels)) {
    throw new Error('--reads must be JSON { "labels": [{ "code", "x", "y" }] } or [{ "code","x","y" }]');
  }
  return labels.map((l) => ({ text: String(l.code), x: Number(l.x), y: Number(l.y) }));
}

export interface ClaudeExtractOptions {
  region?: [number, number, number, number];
  allowNumeric?: boolean;
  imagePath?: string;
}

/** Validate the agent's reads against the dict and place them via the georef. */
export function extractLabelsClaude(
  reads: Gpt55LabelRead[],
  geo: GeoRef,
  dict: string[],
  opts: ClaudeExtractOptions = {},
): Gpt55LabelResult {
  const region = opts.region ?? [0, 0, geo.pageW, geo.pageH];
  const validated = validateGpt55LabelReads(reads, geo, dict, {
    region,
    ...(opts.allowNumeric ? { allowNumeric: true } : {}),
  });
  const snapRate = validated.nCodeLike > 0 ? (100 * validated.nValidated) / validated.nCodeLike : 0;
  return {
    ...validated,
    ocr_engine: "claude-4.8-vision",
    dict_size: dict.length,
    image_path: opts.imagePath ?? "",
    n_model_labels: reads.length,
    n_exact: validated.nExact,
    n_distance1: 0,
    n_canonical: validated.nCanonical,
    n_validated: validated.nValidated,
    n_rejected: validated.nRejected,
    n_distinct: validated.nDistinct,
    snap_rate_pct: Number(snapRate.toFixed(1)),
    reject_samples: validated.rejectSamples,
    rejectSamples: validated.rejectSamples,
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
    latency_ms: 0,
  };
}
