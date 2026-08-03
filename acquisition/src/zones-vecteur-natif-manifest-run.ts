/**
 * zones-vecteur-natif-manifest-run.ts — construit le capture-manifest §3 exigé par
 * le gate qa `scripts/vecteur-natif-attestation.mjs` (SPEC_QA_GATE_VECTEUR_NATIF,
 * ruling geo-qa 1a0e86d7).
 *
 * Pour chaque ville PASS (PASS_CAPTURE|PASS_CAPTURE_NUMERIC) d'un ou plusieurs
 * rapports de capture gonet/arcgis committés, RELIT LES OCTETS RÉELS depuis le CAS
 * (run + url, jamais un re-fetch) et DÉRIVE geometry_type / zone_maxlen /
 * zone_nonnull_pct des features parsées — les autres champs (feature_count,
 * zone_distinct, bbox_diag, registry_attribution_km) viennent du rapport de gate.
 * Rien n'est déclaré : tout est dérivé de la preuve.
 *
 * Lecture seule S3. Aucun dépôt. Sortie = manifeste §3 (contrat d'entrée qa).
 *
 * USAGE :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/zones-vecteur-natif-manifest-run.ts \
 *     --reports work/coverage/zones-gonet-capture-report-A.json,...,reverify.json \
 *     --slugs saint-charles-sur-richelieu,saint-dominique,... \
 *     --out work/coverage/zones-vecteur-natif-manifest-<STAMP>.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  parseManifestJsonl,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

function requireS3(): void {
  const opts = process.env["NODE_OPTIONS"] ?? "";
  if (!opts.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("lecture S3 refusée: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") {
    throw new Error("lecture S3 refusée: préfixer AWS_MAX_ATTEMPTS=10");
  }
}

interface ReportEntry {
  slug: string;
  source_url_reelle?: string;
  retrieved_at?: string;
  sha256_octets?: string | null;
  n_features?: number;
  codes_distinct?: number;
  bbox_diag_km?: number | null;
  nearest_km?: number | null;
  nearest_registre_muni?: string | null;
  verdict?: string;
}
interface ReportFile { capture_run_id?: string; capture_report?: ReportEntry[] }

const PASS = new Set(["PASS_CAPTURE", "PASS_CAPTURE_NUMERIC"]);

// Champ zone porté par outFields=<champ> dans l'URL /query.
function zoneFieldFromUrl(url: string): string | null {
  const m = /[?&]outFields=([^&]+)/i.exec(url);
  if (!m) return null;
  const f = decodeURIComponent(m[1]).split(",").map((s) => s.trim()).filter((s) => s && s !== "*");
  return f[0] ?? null;
}

interface GeoDerived { geometry_type: string | null; feature_count: number; zone_maxlen: number | null; zone_nonnull_pct: number | null }

function deriveFromGeojson(bytes: Buffer, zoneField: string | null): GeoDerived {
  const gj = JSON.parse(bytes.toString("utf8")) as { features?: Array<{ geometry?: { type?: string }; properties?: Record<string, unknown> }> };
  const feats = Array.isArray(gj.features) ? gj.features : [];
  const types = new Set<string>();
  let nonNull = 0;
  let maxLen = 0;
  for (const f of feats) {
    const gt = f.geometry?.type;
    if (typeof gt === "string") types.add(gt);
    if (zoneField) {
      const v = f.properties?.[zoneField];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        nonNull++;
        maxLen = Math.max(maxLen, String(v).trim().length);
      }
    }
  }
  // geometry_type unique attendu ; si mixte polygonal, garder le surtype MultiPolygon.
  let geometry_type: string | null = null;
  if (types.size === 1) geometry_type = [...types][0]!;
  else if (types.size > 1 && [...types].every((t) => /Polygon/.test(t))) geometry_type = "MultiPolygon";
  else if (types.size > 1) geometry_type = [...types].sort().join("+"); // signale l'anomalie, laissera G1 échouer
  return {
    geometry_type,
    feature_count: feats.length,
    zone_maxlen: zoneField ? maxLen : null,
    zone_nonnull_pct: zoneField && feats.length > 0 ? Math.round((nonNull / feats.length) * 1000) / 10 : null,
  };
}

async function readCasBytes(s3: ReturnType<typeof s3Client>, run: string, url: string): Promise<{ bytes: Buffer; http_status: number; retrieved_at: string; sha256: string }> {
  const keys = captureRunKeys(run);
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  if (header.run_id !== run || header.finished_at === null || header.exit_code !== 0) {
    throw new Error(`run non probant ${run}: finished=${String(header.finished_at)} exit=${String(header.exit_code)}`);
  }
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  const direct = manifest.map((line, index) => ({ line, index })).filter(({ line }) => line.url === url);
  const matches = direct.length > 0 ? direct : manifest.map((line, index) => ({ line, index })).filter(({ line }) => line.final_url === url);
  if (matches.length !== 1) throw new Error(`capture exacte attendue 1x, trouvée ${matches.length}: ${url}`);
  const { line } = matches[0]!;
  if (line.http_status === null || line.storage_key === null || line.sha256 === null) {
    throw new Error(`ligne non matérialisable: status=${String(line.http_status)} sha=${String(line.sha256)}`);
  }
  const bytes = await getBytes(s3, line.storage_key);
  return { bytes, http_status: line.http_status, retrieved_at: line.retrieved_at, sha256: line.sha256 };
}

async function main(): Promise<void> {
  requireS3();
  const reportsArg = arg("reports");
  const slugsArg = arg("slugs");
  const out = arg("out");
  if (!reportsArg || !out) throw new Error("usage: --reports a.json,b.json [--slugs a,b] --out f.json");
  const wantSlugs = slugsArg ? new Set(slugsArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;

  // Collecte les entrées PASS (dedup par slug ; 1re rencontrée = retenue).
  const bySlug = new Map<string, { entry: ReportEntry; run: string }>();
  for (const rel of reportsArg.split(",").map((s) => s.trim()).filter(Boolean)) {
    const rf = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8")) as ReportFile;
    const run = rf.capture_run_id;
    if (!run) continue;
    for (const e of rf.capture_report ?? []) {
      if (!e.verdict || !PASS.has(e.verdict)) continue;
      if (wantSlugs && !wantSlugs.has(e.slug)) continue;
      if (!bySlug.has(e.slug)) bySlug.set(e.slug, { entry: e, run });
    }
  }

  const s3 = s3Client();
  const cities: Record<string, unknown>[] = [];
  const errors: { slug: string; reason: string }[] = [];
  for (const [slug, { entry, run }] of bySlug) {
    try {
      const url = entry.source_url_reelle;
      if (!url) throw new Error("source_url_reelle absente");
      const zone_field = zoneFieldFromUrl(url);
      const cas = await readCasBytes(s3, run, url);
      const d = deriveFromGeojson(cas.bytes, zone_field);
      // cohérence feature_count rapport vs octets
      if (typeof entry.n_features === "number" && entry.n_features !== d.feature_count) {
        errors.push({ slug, reason: `feature_count divergent rapport=${entry.n_features} octets=${d.feature_count}` });
      }
      cities.push({
        slug,
        source_url: url,
        retrieved_at: cas.retrieved_at,
        sha256: cas.sha256,
        http_status: cas.http_status,
        feature_count: d.feature_count,
        geometry_type: d.geometry_type,
        zone_field,
        zone_distinct: entry.codes_distinct ?? null,
        zone_maxlen: d.zone_maxlen,
        zone_nonnull_pct: d.zone_nonnull_pct,
        bbox_diag: entry.bbox_diag_km ?? null,
        registry_attribution_km: entry.nearest_km ?? null,
        // Discriminant PRIMAIRE anti-homonyme G4 (ruling qa amende: nearest===slug ;
        // le km n'est qu'un proxy qui faux-positive sur grande muni rurale).
        nearest_registre_muni: entry.nearest_registre_muni ?? null,
        capture_run_id: run,
      });
    } catch (e) {
      errors.push({ slug, reason: (e as Error).message });
    }
  }

  const manifest = {
    contract: "zones-vecteur-natif-capture-manifest/v1",
    spec: "docs/spec/SPEC_QA_GATE_VECTEUR_NATIF.md@1a0e86d7",
    generated_from: reportsArg.split(",").map((s) => s.trim()),
    total: cities.length,
    errors,
    cities,
  };
  writeFileSync(resolve(ROOT, out), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stderr.write(`[manifest] ${cities.length} villes, ${errors.length} erreurs -> ${out}\n`);
  for (const e of errors) process.stderr.write(`  ERR ${e.slug}: ${e.reason}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
