/** Classify one completed cluster worklist as a closed per-city capture result. */
import type {
  CaptureManifestLine,
  CaptureWorklistTarget,
} from "../../../packages/qc-sources/src/capture/index.js";

export type CaptureCityWallOutcome =
  | "captured-v2-input"
  | "wall-http-404"
  | "wall-http"
  | "wall-transport";

export interface CaptureCityWallObservation {
  run_id: string;
  url: string;
  http_status: number | null;
  retrieved_at: string | null;
  sha256: string | null;
  storage_key: string | null;
  error: string | null;
  outcome: CaptureCityWallOutcome;
}

export interface CaptureCityWall {
  slug: string;
  source: string;
  observations: CaptureCityWallObservation[];
  outcome: CaptureCityWallOutcome;
}

function outcome(line: CaptureManifestLine): CaptureCityWallOutcome {
  if (line.http_status === 200 && line.retrieved_at !== null && line.sha256 !== null && line.storage_key !== null) {
    return "captured-v2-input";
  }
  if (line.http_status === 404) return "wall-http-404";
  if (line.http_status === null) return "wall-transport";
  return "wall-http";
}

/**
 * Requires one durable manifest observation for each submitted city URL. A
 * non-2xx response is a terminal wall, never an omitted city or a success.
 */
export function classifyCaptureCityWalls(
  targets: readonly CaptureWorklistTarget[],
  lines: readonly CaptureManifestLine[],
): CaptureCityWall[] {
  return targets.map((target) => {
    const observations = target.urls.map((url) => {
      const matching = lines.filter((line) =>
        line.source === target.source && line.url === url && line.slugs.includes(target.slug));
      if (matching.length !== 1) {
        throw new Error(`manifest must contain exactly one observation for ${target.slug} ${url}; found ${matching.length}`);
      }
      const line = matching[0]!;
      return {
        run_id: line.run_id,
        url,
        http_status: line.http_status,
        retrieved_at: line.retrieved_at,
        sha256: line.sha256,
        storage_key: line.storage_key,
        error: line.error,
        outcome: outcome(line),
      };
    });
    const cityOutcome = observations.every((observation) => observation.outcome === "captured-v2-input")
      ? "captured-v2-input"
      : observations.find((observation) => observation.outcome === "wall-http-404")?.outcome
        ?? observations.find((observation) => observation.outcome === "wall-transport")?.outcome
        ?? "wall-http";
    return { slug: target.slug, source: target.source, observations, outcome: cityOutcome };
  });
}
