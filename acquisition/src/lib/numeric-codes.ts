/**
 * numeric-codes.ts — SAFE, opt-in relaxation of the anti-#74 lettered-code gate
 * for municipalities that legitimately zone with PURE-NUMERIC codes
 * (val-dor 100–1000, acton-vale 101–105, rougemont 107–636, …).
 *
 * The DEFAULT (lettered) behaviour is UNCHANGED: a pure integer is treated as a
 * sequential OBJECTID/NumZone fabrication artefact and rejected (see
 * `looksLikeZoneCode`'s anti-#74 rule and the builders' `nonLettered` gate).
 * This module is reached only when a caller passes `--allow-numeric-codes
 * --dict <grille.json>`, and it admits a numeric code ONLY when EVERY guard
 * below holds — otherwise the whole build ABORTS (never fabricates):
 *
 *   1. `--dict` is MANDATORY for this path and the code appears VERBATIM in the
 *      authoritative by-law dictionary (norms parquet / règlement grille);
 *   2. the DICT itself is not a trivial contiguous 1..N run from a low base
 *      (that is indistinguishable from an OBJECTID sequence → rejected);
 *   3. the DISTINCT extracted numeric set is not a trivial contiguous 1..N run;
 *   4. the extracted numeric set matches the dict SET with strong overlap
 *      (≥ most extracted numeric codes ∈ dict) — a real authored set, not an
 *      auto-generated range.
 *
 * ≥3 distinct codes, the spatial gate and real georef stay enforced by the
 * callers (t1-build / t2-build / t2-build-multisheet), unchanged.
 */

/** A pure-numeric zone code is 1–4 digits (100..1000, 101..505); anything
 * wider is treated as a lot number / OBJECTID and never admitted here. */
export const PURE_NUMERIC_RE = /^\d{1,4}$/;

/**
 * A numeric zone code carrying a SUBDIVISION SUFFIX (`105-1`, `503-1`, `608-1`):
 * the dominant QC pattern for a zone split by amendment (saint-come 206-1990
 * creates `105-2` out of `105-1`; `411-1`, `608-1`, `828-A` are the same move).
 *
 * Why admitting this is SAFE — strictly safer than the bare integer this module
 * already admits: the anti-#74 target is a SEQUENTIAL OBJECTID/NO_ZONE run, and
 * such a run never carries a `-N` suffix. `105-1` is therefore FURTHER from the
 * fabrication fingerprint than `105`. It stays gated on the identical guard: the
 * code must appear VERBATIM in the authoritative dict. That guard is what stops
 * the one real ambiguity here — an OLD-cadastre lot number (`12-3`) — since a
 * lot number is never in a zoning grille index.
 */
export const NUMERIC_ZONE_RE = /^\d{1,4}(-\d{1,2})?$/;

function normalizeCode(code: string): string {
  return String(code).trim().replace(/\s+/g, "-");
}

/**
 * Build the set of PURE-NUMERIC entries of an authoritative dictionary (the
 * lettered entries stay on the normal path / the gpt55 dict match). Used both
 * for label recognition and for the build-time guard.
 */
export function numericDictSet(dictCodes: string[]): Set<string> {
  const s = new Set<string>();
  for (const c of dictCodes) {
    const t = normalizeCode(c);
    if (NUMERIC_ZONE_RE.test(t)) s.add(t);
  }
  return s;
}

/**
 * The OBJECTID fingerprint: a set of integers that is a fully contiguous run
 * (no gaps: max-min+1 === count) starting at 0 or 1. A real QC numeric zoning
 * scheme starts in the hundreds and has gaps (deleted / renumbered zones), so
 * this rejects exactly the "1..N sequential" case the anti-#74 gate targets,
 * while accepting val-dor (100..1000 with gaps) and acton-vale (101..105).
 */
export function isTrivialContiguousSequence(nums: number[]): boolean {
  const sorted = [...new Set(nums.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (sorted.length < 2) return false; // too small to judge (≥3-distinct guarded elsewhere)
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const contiguous = max - min + 1 === sorted.length;
  return contiguous && min <= 1;
}

export interface NumericRelaxationResult {
  ok: boolean;
  reason?: string;
  /** distinct extracted numeric codes that are verbatim in the dict */
  numericInDict: number;
  /** distinct extracted numeric codes NOT in the dict (should be 0 — dropped upstream) */
  numericNotInDict: string[];
  /** count of pure-numeric codes in the authoritative dict */
  dictNumeric: number;
}

/**
 * Validate the numeric relaxation for a build. `distinctExtracted` is the set of
 * distinct zone codes that survived label extraction; `dictCodes` is the
 * authoritative by-law code list. Returns `ok:false` with a precise reason if
 * ANY anti-#74 guard fails; the caller MUST abort on `ok:false`.
 */
export function validateNumericRelaxation(params: {
  distinctExtracted: string[];
  dictCodes: string[];
  minDictNumeric?: number;
  minOverlap?: number;
}): NumericRelaxationResult {
  const minDictNumeric = params.minDictNumeric ?? 3;
  const minOverlap = params.minOverlap ?? 0.9;

  const dictSet = numericDictSet(params.dictCodes);
  const dictNumeric = dictSet.size;
  const base: Omit<NumericRelaxationResult, "ok" | "reason"> = {
    numericInDict: 0,
    numericNotInDict: [],
    dictNumeric,
  };

  // Guard 1 (dict mandatory + real): the dict must carry a real numeric grille.
  if (dictNumeric < minDictNumeric) {
    return {
      ...base,
      ok: false,
      reason: `dict carries only ${dictNumeric} pure-numeric codes (< ${minDictNumeric}) — not an authoritative numeric grille`,
    };
  }
  // Guard 2: the dict itself must not be a trivial contiguous 1..N run.
  if (isTrivialContiguousSequence([...dictSet].map(Number))) {
    return {
      ...base,
      ok: false,
      reason: `dict numeric codes form a trivial contiguous 1..N run — indistinguishable from an OBJECTID sequence; rejected`,
    };
  }

  const extractedNumeric = [...new Set(params.distinctExtracted.map(normalizeCode))].filter((c) => NUMERIC_ZONE_RE.test(c));
  // No numeric codes extracted → nothing to relax (pure-lettered build): pass.
  if (extractedNumeric.length === 0) return { ...base, ok: true };

  const inDict = extractedNumeric.filter((c) => dictSet.has(c));
  const notInDict = extractedNumeric.filter((c) => !dictSet.has(c));
  const overlap = inDict.length / extractedNumeric.length;
  // Guard 4: strong overlap with the authored dict SET (not a fabricated range).
  if (overlap < minOverlap) {
    return {
      ...base,
      ok: false,
      numericInDict: inDict.length,
      numericNotInDict: notInDict.slice(0, 8),
      reason:
        `only ${(overlap * 100).toFixed(0)}% of extracted numeric codes are in the dict ` +
        `(${notInDict.slice(0, 8).join(", ")}) — looks auto-generated, not a dict match`,
    };
  }
  // Guard 3: the extracted numeric set must not be a trivial contiguous 1..N run.
  if (isTrivialContiguousSequence(inDict.map(Number))) {
    return {
      ...base,
      ok: false,
      numericInDict: inDict.length,
      numericNotInDict: notInDict.slice(0, 8),
      reason: `extracted numeric codes form a trivial contiguous 1..N run — OBJECTID fingerprint; rejected`,
    };
  }

  return { ...base, ok: true, numericInDict: inDict.length, numericNotInDict: notInDict.slice(0, 8) };
}

/**
 * Build-time gate helper shared by the three builders: given the distinct codes
 * that survived extraction, return the offending codes that are NEITHER a
 * lettered zone code (letter+digit) NOR a dict-backed pure-numeric code. A
 * non-empty result MUST abort the build.
 */
export function nonAdmissibleCodes(distinct: string[], numericDict: Set<string>): string[] {
  return distinct.filter((raw) => {
    const c = normalizeCode(raw);
    const lettered = /[A-Za-z]/.test(c) && /\d/.test(c);
    const dictNumeric = NUMERIC_ZONE_RE.test(c) && numericDict.has(c);
    return !lettered && !dictNumeric;
  });
}
