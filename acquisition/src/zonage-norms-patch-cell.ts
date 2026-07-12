/**
 * zonage-norms-patch-cell — VERBATIM single-cell correction of an already-deposited
 * `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet`, for ONE norm field whose
 * value the extractor MISSED because the field's `raw` itself is null (so the
 * fill-from-raw `zonage-norms-reparse-run` cannot recover it), but which is legibly
 * present in the official source grille.
 *
 * WHY THIS EXISTS. On a multi-column ("multizone") grille the frozen specifications
 * parser can drop a value from some columns while capturing the SAME row for the
 * sibling columns (observed on Coaticook page zones 101-106: the `hauteur maximale
 * (m)` row reads 10/9/9/9/9/9 in the source, but only C-101/P-102/P-105 were
 * captured — RA-103/RD-104/RB-106 came out null). The proper systemic fix is the
 * parser re-extraction; this tool is the SURGICAL, verbatim, audited stopgap for a
 * single P0 cell where the operator has READ the source value and cited it.
 *
 * ANTI-INVENTION CONTRACT:
 *   - the value/raw/unit come ONLY from the operator's `--raw/--value/--unit`, which
 *     must be a verbatim read of the cited source cell (`--note` records provenance);
 *   - FILL-NULLS-ONLY by default: an already-published value is NEVER overwritten
 *     unless `--force` is passed (guards against clobbering a real 2-pass value);
 *   - the row's `_methode` is tagged with `--note` so the correction is auditable;
 *   - IDEMPOTENT: re-running with the same patch is a NOOP (no write);
 *   - the ORIGINAL parquet is backed up ONCE to `<key>.precellpatch` before any write,
 *     and the round-trip re-read is verified.
 *
 * Usage (npx tsx, from repo root or acquisition/):
 *   tsx acquisition/src/zonage-norms-patch-cell.ts --slug coaticook --zone RD-104 \
 *     --field hauteur_max --raw 9 --value 9 --unit m --confidence 0.92 \
 *     --note manual-native-cell-zones101-106-p3 [--dry-run] [--force]
 */
import { BUCKET, copyObject, exists, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  NORM_FIELDS,
  canonZoneCodeServe,
  normsKey,
  writeNormsParquet,
} from "./lib/zonage-norms.js";

interface Args {
  slug: string;
  zone: string;
  field: string;
  raw: string | null;
  value: number | null;
  unit: string | null;
  confidence: number | null;
  note: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? String(argv[i + 1]) : null;
  };
  const slug = get("--slug") ?? "";
  const zone = get("--zone") ?? "";
  const field = get("--field") ?? "";
  const rawStr = get("--raw");
  const valueStr = get("--value");
  const unit = get("--unit");
  const confStr = get("--confidence");
  const note = get("--note") ?? "";
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  if (!slug || !zone || !field) throw new Error("required: --slug --zone --field");
  if (!NORM_FIELDS.includes(field as (typeof NORM_FIELDS)[number])) {
    throw new Error(`--field must be one of: ${NORM_FIELDS.join(", ")}`);
  }
  if (!note) throw new Error("required: --note (source provenance, tagged into _methode)");
  const value = valueStr !== null && valueStr.trim() !== "" ? Number(valueStr) : null;
  if (value !== null && !Number.isFinite(value)) throw new Error(`--value not numeric: ${valueStr}`);
  const confidence = confStr !== null && confStr.trim() !== "" ? Number(confStr) : null;
  if (confidence !== null && !Number.isFinite(confidence)) throw new Error(`--confidence not numeric: ${confStr}`);
  return { slug, zone, field, raw: rawStr, value, unit, confidence, note, dryRun, force };
}

/** Normalise a zone_code for matching (upper, no whitespace). */
function normKey(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/\s+/g, "");
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const key = normsKey(a.slug);
  if (!(await exists(s3, key))) throw new Error(`no norms parquet: ${key}`);

  const original = await getBytes(s3, key);
  const rows = await readParquetRowsFromBuffer(original);

  const wantExact = normKey(a.zone);
  const wantCanon = normKey(canonZoneCodeServe(a.zone));
  const idx = rows.findIndex((r) => {
    const zc = r["zone_code"];
    return normKey(zc) === wantExact || normKey(canonZoneCodeServe(String(zc ?? ""))) === wantCanon;
  });
  if (idx < 0) {
    const sample = rows.slice(0, 30).map((r) => r["zone_code"]).join(", ");
    throw new Error(`zone ${a.zone} not found in ${key}. First codes: ${sample}`);
  }
  const row = rows[idx]!;

  const vKey = `${a.field}_value`;
  const rKey = `${a.field}_raw`;
  const uKey = `${a.field}_unit`;
  const cKey = `${a.field}_confidence`;

  const before = {
    zone_code: row["zone_code"],
    [vKey]: row[vKey] ?? null,
    [rKey]: row[rKey] ?? null,
    [uKey]: row[uKey] ?? null,
    [cKey]: row[cKey] ?? null,
    _methode: row["_methode"] ?? null,
  };
  console.log(`BEFORE ${JSON.stringify(before)}`);

  const current = row[vKey];
  const hasCurrent = current !== null && current !== undefined && Number.isFinite(Number(current));
  if (hasCurrent && !a.force) {
    throw new Error(
      `${a.field}_value already present (${current}) for zone ${a.zone}; refusing to overwrite without --force`,
    );
  }

  // Idempotency check: is the target already exactly this patch (and tagged)?
  const methodeStr = row["_methode"] === null || row["_methode"] === undefined ? "" : String(row["_methode"]);
  const alreadyValue = Number(current) === a.value && String(row[rKey] ?? "") === String(a.raw ?? "") && String(row[uKey] ?? "") === String(a.unit ?? "");
  if (alreadyValue && methodeStr.includes(a.note)) {
    console.log(`NOOP zone ${a.zone} field ${a.field} already patched (idempotent) — no write`);
    return;
  }

  // Apply the verbatim patch.
  row[rKey] = a.raw ?? undefined;
  row[vKey] = a.value ?? undefined;
  row[uKey] = a.unit ?? undefined;
  if (a.confidence !== null) row[cKey] = a.confidence;
  if (!methodeStr.includes(a.note)) {
    row["_methode"] = methodeStr ? `${methodeStr}+${a.note}` : a.note;
  }

  const after = {
    zone_code: row["zone_code"],
    [vKey]: row[vKey] ?? null,
    [rKey]: row[rKey] ?? null,
    [uKey]: row[uKey] ?? null,
    [cKey]: row[cKey] ?? null,
    _methode: row["_methode"] ?? null,
  };
  console.log(`AFTER  ${JSON.stringify(after)}`);

  if (a.dryRun) {
    console.log(`DRY-RUN — no write. Would patch ${a.slug}/${a.zone}/${a.field} in ${key}`);
    return;
  }

  // Back up the ORIGINAL once (keep the true pre-patch bytes across re-runs).
  const backupKey = `${key}.precellpatch`;
  if (!(await exists(s3, backupKey))) {
    await copyObject(s3, key, backupKey);
    console.log(`BACKUP ${backupKey}`);
  } else {
    console.log(`BACKUP exists (kept) ${backupKey}`);
  }

  const parquet = await writeNormsParquet(rows);
  await putBytes(s3, key, parquet, "application/octet-stream");

  // Verify the round-trip re-read carries the patched value.
  const check = await readParquetRowsFromBuffer(await getBytes(s3, key, BUCKET));
  const cr = check.find((r) => normKey(r["zone_code"]) === normKey(row["zone_code"]));
  console.log(
    `OK wrote ${key} bytes=${parquet.length} verify ${a.field}_value=${cr ? cr[vKey] : "?"} ` +
      `${a.field}_unit=${cr ? cr[uKey] : "?"} ${a.field}_raw=${cr ? cr[rKey] : "?"}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
