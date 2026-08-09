/**
 * Keep the free native-text pass independent from any paid-extraction budget.
 *
 * `--budget-usd 0` historically reduced the OCR route to one page even when
 * every useful read was native. In native-only mode there is no paid call to
 * budget, so every page selected by the caller remains eligible.
 */
export function pageLimitForNativeFirstRoute(
  pageCount: number,
  costPerPaidPage: number,
  budgetUsd: number,
  nativeOnly: boolean,
): number {
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new Error(`pageCount invalide: ${pageCount}`);
  }
  if (nativeOnly || costPerPaidPage <= 0) return pageCount;
  return Math.min(pageCount, Math.max(1, Math.floor(budgetUsd / costPerPaidPage)));
}
