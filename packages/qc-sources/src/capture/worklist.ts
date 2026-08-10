/**
 * Exécution déterministe d'une worklist de capture.
 *
 * Cette couche reste dans la lib : le pod, un Serverless Job ou un autre
 * adaptateur peuvent tous consommer le même contrat `[ { slug, source, urls } ]`
 * sans réimplémenter le sharding ni contourner `capturedFetch`.
 */
import { z } from "zod";

import { capturedFetch, type CaptureFetchLike, type RobotsGate } from "./capturedFetch.js";
import type { CaptureRun } from "./capture-run.js";

const SOURCE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const CaptureWorklistTargetSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  source: z.string().regex(SOURCE_RE),
  urls: z.array(z.string().refine(isHttpUrl, "URL http(s) requise")).min(1),
  /** Immutable S3 control record that justified a derived capture target. */
  derivation: z.object({
    kind: z.enum(["captured-normes-subpages/v1", "captured-normes-pdf-selection/v1"]),
    selection_key: z.string().min(1),
  }).strict().optional(),
}).strict();
export type CaptureWorklistTarget = z.infer<typeof CaptureWorklistTargetSchema>;

export const CaptureWorklistSchema = z.array(CaptureWorklistTargetSchema).min(1);

/** Parse au bord du système : le runner ne reçoit jamais un JSON de travail non typé. */
export function parseCaptureWorklist(value: unknown): CaptureWorklistTarget[] {
  return CaptureWorklistSchema.parse(value);
}

/**
 * Répartition stable, sans état : un même fichier et un même couple
 * shard/shards sélectionnent toujours les mêmes cibles. Les URLs d'une ville
 * restent ensemble afin que leur contexte de capture reste dans un seul run.
 */
export function selectCaptureWorklistShard(
  targets: readonly CaptureWorklistTarget[],
  shard: number,
  shards: number,
): CaptureWorklistTarget[] {
  if (!Number.isInteger(shards) || shards < 1) throw new Error("SHARDS doit être un entier positif");
  if (!Number.isInteger(shard) || shard < 0 || shard >= shards) {
    throw new Error(`SHARD doit être dans 0..${shards - 1}`);
  }
  return targets.filter((_target, index) => index % shards === shard);
}

export interface CaptureWorklistRobots extends RobotsGate {
  crawlDelayMs?(url: string): Promise<number | null>;
}

export interface CaptureWorklistOptions {
  run: CaptureRun;
  targets: readonly CaptureWorklistTarget[];
  shard?: number;
  shards?: number;
  delayMs?: number;
  maxBytes?: number;
  /** `false` journalise sans déposer de CAS (DRY_RUN). */
  store?: boolean;
  robots?: CaptureWorklistRobots;
  fetchImpl?: CaptureFetchLike;
  /** Injection de test; la production utilise un délai non bloquant Node. */
  wait?: (milliseconds: number) => Promise<void>;
}

export interface CaptureWorklistResult {
  selectedTargets: number;
  attempted: number;
  succeeded: number;
  failed: number;
  durable: number;
}

const waitFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Capture chaque URL séquentiellement. Les 4xx/5xx sont des résultats de
 * collecte, non des crashes : leur ligne est durable et le lot continue. Les
 * seuls rejets sont les défauts d'infrastructure/configuration, que le runner
 * ferme aussi dans son `finally`.
 */
export async function captureWorklist(opts: CaptureWorklistOptions): Promise<CaptureWorklistResult> {
  const shard = opts.shard ?? 0;
  const shards = opts.shards ?? 1;
  const delayMs = opts.delayMs ?? 2_000;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("DELAY_MS doit être >= 0");
  const selected = selectCaptureWorklistShard(opts.targets, shard, shards);
  const wait = opts.wait ?? waitFor;
  const result: CaptureWorklistResult = {
    selectedTargets: selected.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    durable: 0,
  };

  opts.run.log(
    `[capture-worklist] shard=${shard}/${shards} targets=${selected.length} delay_ms=${delayMs} dry_run=${opts.store === false}`,
  );
  for (let targetIndex = 0; targetIndex < selected.length; targetIndex++) {
    const target = selected[targetIndex]!;
    for (let urlIndex = 0; urlIndex < target.urls.length; urlIndex++) {
      const url = target.urls[urlIndex]!;
      const captured = await capturedFetch(url, { method: "GET" }, {
        run: opts.run,
        source: target.source,
        slugs: [target.slug],
        ...(opts.robots !== undefined ? { robots: opts.robots } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
        ...(opts.store !== undefined ? { store: opts.store } : {}),
        // Une worklist ne parse jamais le document qu'elle vient de capturer :
        // le corps va donc en flux au spool S3 puis au CAS, sans `Uint8Array`
        // de la taille d'un règlement/PV dans le pod.
        retainBody: false,
      });
      result.attempted++;
      if (captured.ok) result.succeeded++;
      else result.failed++;
      if (captured.line.storage_key !== null) result.durable++;

      const isLast = targetIndex === selected.length - 1 && urlIndex === target.urls.length - 1;
      if (!isLast) {
        const robotsDelay = opts.robots?.crawlDelayMs
          ? await opts.robots.crawlDelayMs(url)
          : null;
        await wait(Math.max(delayMs, robotsDelay ?? 0));
      }
    }
  }
  opts.run.log(
    `[capture-worklist] done attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} durable=${result.durable}`,
  );
  return result;
}
