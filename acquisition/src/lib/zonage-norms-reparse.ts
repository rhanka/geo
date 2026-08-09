/**
 * zonage-norms-reparse — recompute the flat `<field>_value` columns of an ALREADY
 * DEPOSITED `qc-zonage-norms-<slug>.parquet` row FROM its stored `<field>_raw`,
 * WITHOUT re-OCR / re-vision. Pure + unit-testable; the runner
 * (`zonage-norms-reparse-run.ts`) owns all S3 I/O.
 *
 * WHY THIS EXISTS. A field is deposited as `value:null` + `raw:"…"` whenever the
 * extractor REFUSED the value — most often, on the vertical mistral-VISION path,
 * because the two independent passes DIVERGED (`divergence-2-passes`, the tell
 * being `<field>_unit=null` + `<field>_confidence=0` on a column whose fallback
 * unit is non-null). The stored `raw` is a faithful VERBATIM read; today's frozen
 * single-read guards (`buildVisionField`) parse many of those raws cleanly
 * (`"90 / -"`→90, `"20"`→20, `"800"`→800). This pass republishes ONLY the value
 * the stored raw literally carries.
 *
 * ANTI-INVENTION CONTRACT (the four hard rules the caller asked for):
 *   (a) value comes ONLY from the stored `raw`, through the SAME frozen guards
 *       every extractor uses (parse → semantic unit type-check → plausibility
 *       window). A raw that is not numerically parsable, or that a guard refuses,
 *       stays `value:null` — never fabricated.
 *   (b) FILL-NULLS-ONLY: an already-published value (a concordant 2-pass value)
 *       is NEVER overwritten. We only populate a column that is currently null.
 *   (c) A recomputed field carries a DISTINCT single-read confidence
 *       (`REPARSE_RAW_CONFIDENCE`, below the 2-pass / native-text confidences) and
 *       the row's `_methode` is tagged `+reparse-raw`, so a consumer (immo) can
 *       tell a single-read re-parse from a 2-pass-concordant value.
 *   (d) IDEMPOTENT: re-running fills nothing new and re-tags nothing (the tag is
 *       already present), so the output is byte-stable.
 *
 * `raw` is NEVER modified — it is the source of truth and stays verbatim.
 */
import {
  FIELD_SPECS,
  buildVisionField,
  type FieldSpec,
} from "../../../packages/qc-sources/src/sources/grille-vision-extractor.js";
import type { FieldProvenanceT } from "../../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import { NORM_FIELDS } from "./zonage-norms.js";

/**
 * Confidence stamped on a value REPUBLISHED from a single stored raw. Deliberately
 * BELOW the 2-pass vision confidence (0.92) and the native-text confidence (≤0.97)
 * so a downstream consumer can distinguish a single-read re-parse from a value that
 * survived the two-pass concordance guard. It is metadata only — the served
 * pipeline (publish-norms-grilles, lot⋈norms join, lots-enriched) passes every norm
 * column through verbatim and never gates on confidence.
 */
export const REPARSE_RAW_CONFIDENCE = 0.8;

/** Provenance suffix appended to a row's `_methode` when ≥1 value was re-parsed. */
export const REPARSE_METHODE_TAG = "reparse-raw";

/**
 * Map a FLAT norm field name to the vision `FieldSpec` (semantic + plausibility +
 * fallback unit) that governs its guard. `hauteur_min`/`hauteur_max` have no single
 * spec — the grille publishes hauteur as étages OR metres — so we resolve them from
 * the row's STORED unit; a hauteur cell with no stored unit is AMBIGUOUS and is
 * left untouched (never guessed). A field with no spec is skipped.
 */
function specForFlatField(field: string, storedUnit: unknown): FieldSpec | null {
  const byId = (id: FieldSpec["id"]): FieldSpec | null =>
    FIELD_SPECS.find((s) => s.id === id) ?? null;
  switch (field) {
    case "densite":
    case "frontage_min":
    case "superficie_min":
    case "marge_avant_min":
    case "marge_laterale_min":
    case "marge_arriere_min":
      return byId(field);
    case "hauteur_min":
    case "hauteur_max": {
      const u = typeof storedUnit === "string" ? storedUnit : null;
      if (u === "etages") return byId("hauteur_etages");
      if (u === "m") return byId("hauteur_metres");
      return null; // ambiguous (no stored unit) → skip, never guess
    }
    default:
      return null;
  }
}

function nonEmptyString(v: unknown): string | null {
  return v !== null && v !== undefined && String(v).trim() ? String(v) : null;
}

export interface ReparseOutcome {
  /** The row with any newly-filled `<field>_value/_unit/_confidence` + tagged `_methode`. */
  row: Record<string, unknown>;
  /** Flat field names whose value was populated from raw this pass. */
  filled: string[];
}

/**
 * Re-parse ONE flat norms parquet row. Returns a NEW row object (input untouched)
 * and the list of fields whose `value` was populated from the stored `raw`. Applies
 * rules (a)–(d) above. A no-op row (nothing to fill) is returned with `filled: []`
 * and no `_methode` change.
 */
export function reparseNormRow(input: Record<string, unknown>): ReparseOutcome {
  const row: Record<string, unknown> = { ...input };
  const filled: string[] = [];

  const provenance: FieldProvenanceT = {
    source_url: nonEmptyString(row["_source_url"]) ?? "reparse-raw",
    methode: nonEmptyString(row["_methode"]) ?? "reparse-raw",
    snapshot: nonEmptyString(row["_snapshot"]) ?? "reparse-raw",
  };

  for (const field of NORM_FIELDS) {
    const valueKey = `${field}_value`;
    const rawKey = `${field}_raw`;
    const unitKey = `${field}_unit`;
    const confKey = `${field}_confidence`;

    // (b) FILL-NULLS-ONLY — never touch an already-published value.
    const current = row[valueKey];
    if (current !== null && current !== undefined && Number.isFinite(Number(current))) {
      continue;
    }
    // (a) value only from the stored raw; no raw → stays null.
    const raw = nonEmptyString(row[rawKey]);
    if (raw === null) continue;

    const spec = specForFlatField(field, row[unitKey]);
    if (spec === null) continue; // no/ambiguous spec (e.g. hauteur w/o unit) → skip

    // Same frozen single-read guard the OCR path uses (raw fed as both passes →
    // concordance trivially holds; parse + semantic + plausibility still gate).
    const nf = buildVisionField(spec, raw, raw, provenance);
    if (nf.value === null) continue; // not parsable / guard refused → stays null

    row[valueKey] = nf.value;
    row[unitKey] = nf.unit ?? undefined; // column unit, from the grille (not fabricated)
    row[confKey] = REPARSE_RAW_CONFIDENCE; // (c) distinct single-read marker
    filled.push(field);
  }

  // (c) tag provenance so the re-parse is auditable; (d) idempotent (tag once).
  if (filled.length > 0) {
    const methode = nonEmptyString(row["_methode"]) ?? "";
    if (!methode.includes(REPARSE_METHODE_TAG)) {
      row["_methode"] = methode ? `${methode}+${REPARSE_METHODE_TAG}` : REPARSE_METHODE_TAG;
    }
  }

  return { row, filled };
}

/** Re-parse a whole parquet's rows; returns new rows + per-field fill counts. */
export function reparseNormRows(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  filledByField: Record<string, number>;
  rowsChanged: number;
} {
  const out: Record<string, unknown>[] = [];
  const filledByField: Record<string, number> = {};
  let rowsChanged = 0;
  for (const r of rows) {
    const { row, filled } = reparseNormRow(r);
    out.push(row);
    if (filled.length > 0) rowsChanged++;
    for (const f of filled) filledByField[f] = (filledByField[f] ?? 0) + 1;
  }
  return { rows: out, filledByField, rowsChanged };
}
