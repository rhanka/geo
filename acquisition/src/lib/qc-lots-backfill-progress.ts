export interface ChildProcessResult {
  batch: number;
  join_code: number;
  enrich_code: number;
}

export function batchCompletedSuccessfully(
  result: Pick<ChildProcessResult, "join_code" | "enrich_code">,
): boolean {
  return result.join_code === 0 && result.enrich_code === 0;
}

function latestBatchResults(
  results: ChildProcessResult[],
): Map<number, ChildProcessResult> {
  const latest = new Map<number, ChildProcessResult>();
  for (const result of results) latest.set(result.batch, result);
  return latest;
}

/** Repair legacy progress where a failed child result was still marked done. */
export function reconcileDoneBatchIds(
  doneIds: number[],
  results: ChildProcessResult[],
): number[] {
  const done = new Set(doneIds);
  for (const [batch, result] of latestBatchResults(results)) {
    if (!batchCompletedSuccessfully(result)) done.delete(batch);
  }
  return [...done].sort((a, b) => a - b);
}

/** Only unresolved failures from each batch's latest attempt remain active. */
export function latestCrashedSteps(results: ChildProcessResult[]): string[] {
  const crashed: string[] = [];
  for (const [batch, result] of latestBatchResults(results)) {
    if (result.join_code !== 0) {
      crashed.push(`join batch ${batch} code=${result.join_code}`);
    }
    if (result.enrich_code !== 0) {
      crashed.push(`enrich batch ${batch} code=${result.enrich_code}`);
    }
  }
  return crashed;
}

export function assertBackfillSucceeded(crashedSteps: string[]): void {
  if (crashedSteps.length > 0) {
    throw new Error(`backfill incomplete: ${crashedSteps.join(" | ")}`);
  }
}
