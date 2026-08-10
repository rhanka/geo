/**
 * _zones-vnatif-resolve-20260810.ts — SONDE DIAGNOSTIC (lecture seule, aucun dépôt).
 *
 * Pour la capture cluster run-stamp 20260810T100500Z (5 villes vecteur natif) :
 *   1. liste `capture/_runs/zones-20260810T100500Z-*`, dérive les run_id (shards) ;
 *   2. pour chaque run VÉRIFIE le header (finished_at + exit_code 0) ;
 *   3. pour chaque URL de la worklist, localise la ligne de capture (url|final_url)
 *      dans les manifestes, relit les octets CAS et RE-HASHE (sha256) pour confirmer
 *      l'intégrité octet-pour-octet vs le sha annoncé + la clé CAS ;
 *   4. parse le geojson (FeatureCollection), compte les features, et EXPOSE les
 *      champs de propriété candidats (zone_field) avec distinct/sample — pour
 *      choisir le zone_field réel (mirabel = code composite à trancher).
 *
 * N'écrit RIEN sur S3. Émet un rapport JSON sur stdout.
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/_zones-vnatif-resolve-20260810.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN_STAMP = "20260810T100500Z";
const LANE = "zones";
const PREFIX = `capture/_runs/${LANE}-${RUN_STAMP}-`;

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
}

interface WorklistEntry { slug: string; source: string; urls: string[] }

// Run-ids from the manifest keys under the stamp prefix.
function runIdsFromKeys(keys: string[]): string[] {
  const ids = new Set<string>();
  for (const k of keys) {
    const m = /^capture\/_runs\/(.+?)\/manifest\.jsonl$/.exec(k);
    if (m) ids.add(m[1]!);
  }
  return [...ids].sort();
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface FieldStat { field: string; nonnull_pct: number; distinct: number; maxlen: number; sample: string[] }

function fieldStats(feats: Array<{ properties?: Record<string, unknown> | null }>, field: string): FieldStat {
  const vals: string[] = [];
  let nonnull = 0;
  const distinct = new Set<string>();
  let maxlen = 0;
  for (const f of feats) {
    const v = f.properties?.[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      nonnull++;
      const s = String(v).trim();
      distinct.add(s);
      maxlen = Math.max(maxlen, s.length);
      if (vals.length < 8) vals.push(s);
    }
  }
  return {
    field,
    nonnull_pct: feats.length ? Math.round((nonnull / feats.length) * 1000) / 10 : 0,
    distinct: distinct.size,
    maxlen,
    sample: vals,
  };
}

async function main(): Promise<void> {
  requireS3();
  const worklist = JSON.parse(
    readFileSync(resolve(ROOT, "work/coverage/zones-vnatif-capture-worklist-20260810.json"), "utf8"),
  ) as WorklistEntry[];

  const s3 = s3Client();
  const listed = await listObjectEntries(s3, PREFIX);
  const keys = listed.map((e) => e.key);
  const runIds = runIdsFromKeys(keys);

  // Load + verify each run header and manifest once.
  interface RunData { run_id: string; ok: boolean; note: string; lines: CaptureManifestLine[] }
  const runs: RunData[] = [];
  for (const runId of runIds) {
    const rk = captureRunKeys(runId);
    try {
      const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, rk.header)).toString("utf8")));
      const ok = header.run_id === runId && header.finished_at !== null && header.exit_code === 0;
      const lines = parseManifestJsonl((await getBytes(s3, rk.manifest)).toString("utf8"));
      runs.push({ run_id: runId, ok, note: `finished=${String(header.finished_at)} exit=${String(header.exit_code)} lines=${lines.length}`, lines });
    } catch (e) {
      runs.push({ run_id: runId, ok: false, note: `header/manifest ERR: ${(e as Error).message}`, lines: [] });
    }
  }

  const report: Record<string, unknown>[] = [];
  for (const w of worklist) {
    const url = w.urls[0]!;
    const entry: Record<string, unknown> = { slug: w.slug, url };
    // Find the run + line whose url or final_url matches.
    let found: { run_id: string; line: CaptureManifestLine } | null = null;
    for (const r of runs) {
      const direct = r.lines.filter((l) => l.url === url);
      const matches = direct.length > 0 ? direct : r.lines.filter((l) => l.final_url === url);
      if (matches.length === 1) { found = { run_id: r.run_id, line: matches[0]! }; break; }
      if (matches.length > 1) { entry.match_error = `run ${r.run_id}: ${matches.length} lignes matchent`; }
    }
    if (!found) { entry.status = "NO_CAPTURE_LINE"; report.push(entry); continue; }
    const { run_id, line } = found;
    entry.capture_run_id = run_id;
    entry.http_status = line.http_status;
    entry.redacted = line.redacted;
    entry.sha256 = line.sha256;
    entry.retrieved_at = line.retrieved_at;
    entry.storage_key = line.storage_key;
    if (line.redacted || line.http_status === null || line.http_status < 200 || line.http_status >= 300 || line.storage_key === null || line.sha256 === null) {
      entry.status = "LINE_NOT_DEPOSITABLE";
      report.push(entry);
      continue;
    }
    // Re-hash CAS bytes.
    let bytes: Buffer;
    try {
      bytes = await getBytes(s3, line.storage_key);
    } catch (e) {
      entry.status = `CAS_READ_ERR: ${(e as Error).message}`;
      report.push(entry);
      continue;
    }
    const rehash = `sha256:${sha256Hex(bytes)}`;
    entry.rehash_ok = rehash === line.sha256;
    const casInName = /\/cas\/([a-f0-9]{64})\./.exec(line.storage_key)?.[1] ?? null;
    entry.cas_key_matches = casInName !== null && `sha256:${casInName}` === line.sha256;
    if (!entry.rehash_ok || !entry.cas_key_matches) {
      entry.status = "HASH_MISMATCH";
      report.push(entry);
      continue;
    }
    // Parse geojson.
    let gj: { type?: string; features?: Array<{ properties?: Record<string, unknown> | null; geometry?: { type?: string } | null }> };
    try {
      gj = JSON.parse(bytes.toString("utf8"));
    } catch (e) {
      entry.status = `GEOJSON_PARSE_ERR: ${(e as Error).message}`;
      report.push(entry);
      continue;
    }
    const feats = Array.isArray(gj.features) ? gj.features : [];
    entry.is_featurecollection = gj.type === "FeatureCollection";
    entry.feature_count = feats.length;
    const geomTypes = new Set<string>();
    for (const f of feats) if (typeof f.geometry?.type === "string") geomTypes.add(f.geometry.type);
    entry.geometry_types = [...geomTypes].sort();
    // Property keys across all features.
    const allKeys = new Set<string>();
    for (const f of feats) for (const k of Object.keys(f.properties ?? {})) allKeys.add(k);
    entry.property_keys = [...allKeys].sort();
    // Candidate zone fields: any key containing zon/zone/etq/contents/code plus known ones.
    const candidates = [...allKeys].filter((k) => /zon|etq|contents|code|grille|secteur|nom/i.test(k));
    entry.zone_field_candidates = candidates.map((c) => fieldStats(feats, c));
    entry.status = feats.length > 0 && gj.type === "FeatureCollection" ? "OK" : "EMPTY_OR_NOT_FC";
    report.push(entry);
  }

  process.stdout.write(`${JSON.stringify({
    contract: "zones-vnatif-resolve/diagnostic",
    run_stamp: RUN_STAMP,
    prefix: PREFIX,
    run_ids: runIds,
    runs: runs.map((r) => ({ run_id: r.run_id, ok: r.ok, note: r.note })),
    cities: report,
  }, null, 1)}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
