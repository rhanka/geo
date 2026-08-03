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

// ── Registre municipal + géométrie (dérivation du gate depuis les OCTETS) ──────
const MUNIS_PATH = resolve(ROOT, "packages/qc-sources/src/geo/municipalities.qc.json");
interface MuniEntry { slug: string; lat: number; lon: number }
function loadRegistry(): MuniEntry[] {
  const raw = JSON.parse(readFileSync(MUNIS_PATH, "utf8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>).find(Array.isArray)) as Array<Record<string, unknown>>;
  return arr.map((m) => ({
    slug: String(m["slug"] ?? ""),
    lat: Number(m["lat"] ?? m["latitude"]),
    lon: Number(m["lon"] ?? m["lng"] ?? m["longitude"]),
  })).filter((m) => m.slug && Number.isFinite(m.lat) && Number.isFinite(m.lon));
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { yield [coords[0], coords[1]]; return; }
  for (const c of coords) yield* positions(c);
}

interface GeoDerived {
  geometry_type: string | null; feature_count: number;
  zone_distinct: number; zone_maxlen: number | null; zone_nonnull_pct: number | null;
  bbox_diag: number | null; nearest_registre_muni: string | null; registry_attribution_km: number | null;
}

function deriveFromGeojson(bytes: Buffer, zoneField: string | null, registry: MuniEntry[]): GeoDerived {
  const gj = JSON.parse(bytes.toString("utf8")) as { features?: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }> };
  const feats = Array.isArray(gj.features) ? gj.features : [];
  const types = new Set<string>();
  const codes = new Set<string>();
  let nonNull = 0, maxLen = 0;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of feats) {
    const gt = f.geometry?.type;
    if (typeof gt === "string") types.add(gt);
    for (const [x, y] of positions(f.geometry?.coordinates)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    if (zoneField) {
      const v = f.properties?.[zoneField];
      if (v !== null && v !== undefined && String(v).trim() !== "") { nonNull++; const s = String(v).trim(); codes.add(s); maxLen = Math.max(maxLen, s.length); }
    }
  }
  let geometry_type: string | null = null;
  if (types.size === 1) geometry_type = [...types][0]!;
  else if (types.size > 1 && [...types].every((t) => /Polygon/.test(t))) geometry_type = "MultiPolygon";
  else if (types.size > 1) geometry_type = [...types].sort().join("+");
  const bboxOk = [minx, miny, maxx, maxy].every(Number.isFinite);
  const bbox_diag = bboxOk ? haversineKm(miny, minx, maxy, maxx) : null;
  let nearest: { slug: string; km: number } | null = null;
  if (bboxOk) {
    const clat = (miny + maxy) / 2, clon = (minx + maxx) / 2;
    for (const m of registry) { const km = haversineKm(m.lat, m.lon, clat, clon); if (nearest === null || km < nearest.km) nearest = { slug: m.slug, km }; }
  }
  return {
    geometry_type, feature_count: feats.length,
    zone_distinct: codes.size,
    zone_maxlen: zoneField ? maxLen : null,
    zone_nonnull_pct: zoneField && feats.length > 0 ? Math.round((nonNull / feats.length) * 1000) / 10 : null,
    bbox_diag, nearest_registre_muni: nearest?.slug ?? null,
    registry_attribution_km: nearest ? Math.round(nearest.km * 100) / 100 : null,
  };
}

// Localise la ligne de capture : par URL exacte, sinon par sous-chaîne (mode --direct
// robuste à l'encodage), en préférant une réponse /query f=geojson.
async function readCasLine(s3: ReturnType<typeof s3Client>, run: string, match: { url?: string; contains?: string }): Promise<{ bytes: Buffer; url: string; http_status: number; retrieved_at: string; sha256: string }> {
  const keys = captureRunKeys(run);
  const header = CaptureRunHeaderSchema.parse(JSON.parse((await getBytes(s3, keys.header)).toString("utf8")));
  if (header.run_id !== run || header.finished_at === null || header.exit_code !== 0) {
    throw new Error(`run non probant ${run}: finished=${String(header.finished_at)} exit=${String(header.exit_code)}`);
  }
  const manifest = parseManifestJsonl((await getBytes(s3, keys.manifest)).toString("utf8"));
  let picks;
  if (match.url) {
    picks = manifest.filter((l) => l.url === match.url);
    if (picks.length === 0) picks = manifest.filter((l) => l.final_url === match.url);
  } else if (match.contains) {
    picks = manifest.filter((l) => l.url.includes(match.contains!) && /f=geojson/i.test(l.url) && /outFields=/i.test(l.url));
  } else throw new Error("readCasLine: url ou contains requis");
  if (picks.length !== 1) throw new Error(`capture attendue 1x, trouvée ${picks.length} (${match.url ?? match.contains})`);
  const line = picks[0]!;
  if (line.http_status === null || line.storage_key === null || line.sha256 === null) {
    throw new Error(`ligne non matérialisable: status=${String(line.http_status)} sha=${String(line.sha256)}`);
  }
  const bytes = await getBytes(s3, line.storage_key);
  return { bytes, url: line.url, http_status: line.http_status, retrieved_at: line.retrieved_at, sha256: line.sha256 };
}

interface Spec { slug: string; run: string; zoneField: string | null; match: { url?: string; contains?: string } }

async function main(): Promise<void> {
  requireS3();
  const reportsArg = arg("reports");
  const directArg = arg("direct");
  const slugsArg = arg("slugs");
  const out = arg("out");
  if (!out || (!reportsArg && !directArg)) throw new Error("usage: (--reports a.json,b.json [--slugs a,b] | --direct cities.json) --out f.json");
  const wantSlugs = slugsArg ? new Set(slugsArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;

  // Sources : rapports gonet (capture_report[] PASS) + entrees DIRECTES (arcgis etc.).
  const specs = new Map<string, Spec>();
  if (reportsArg) {
    for (const rel of reportsArg.split(",").map((s) => s.trim()).filter(Boolean)) {
      const rf = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8")) as ReportFile;
      if (!rf.capture_run_id) continue;
      for (const e of rf.capture_report ?? []) {
        if (!e.verdict || !PASS.has(e.verdict) || !e.source_url_reelle) continue;
        if (wantSlugs && !wantSlugs.has(e.slug)) continue;
        if (!specs.has(e.slug)) specs.set(e.slug, { slug: e.slug, run: rf.capture_run_id, zoneField: zoneFieldFromUrl(e.source_url_reelle), match: { url: e.source_url_reelle } });
      }
    }
  }
  if (directArg) {
    const rows = JSON.parse(readFileSync(resolve(ROOT, directArg), "utf8")) as Array<{ slug: string; capture_run_id: string; zone_field: string; url?: string; url_contains?: string }>;
    for (const r of rows) {
      if (wantSlugs && !wantSlugs.has(r.slug)) continue;
      if (!specs.has(r.slug)) specs.set(r.slug, { slug: r.slug, run: r.capture_run_id, zoneField: r.zone_field, match: { url: r.url, contains: r.url_contains } });
    }
  }

  const registry = loadRegistry();
  const s3 = s3Client();
  const cities: Record<string, unknown>[] = [];
  const errors: { slug: string; reason: string }[] = [];
  for (const [slug, spec] of specs) {
    try {
      const cas = await readCasLine(s3, spec.run, spec.match);
      const zone_field = spec.zoneField ?? zoneFieldFromUrl(cas.url);
      const d = deriveFromGeojson(cas.bytes, zone_field, registry);
      cities.push({
        slug,
        source_url: cas.url,
        retrieved_at: cas.retrieved_at,
        sha256: cas.sha256,
        http_status: cas.http_status,
        feature_count: d.feature_count,
        geometry_type: d.geometry_type,
        zone_field,
        zone_distinct: d.zone_distinct,
        zone_maxlen: d.zone_maxlen,
        zone_nonnull_pct: d.zone_nonnull_pct,
        bbox_diag: d.bbox_diag,
        registry_attribution_km: d.registry_attribution_km,
        // Discriminant PRIMAIRE anti-homonyme G4 (nearest===slug ; km informatif).
        nearest_registre_muni: d.nearest_registre_muni,
        capture_run_id: spec.run,
      });
    } catch (e) {
      errors.push({ slug, reason: (e as Error).message });
    }
  }

  const manifest = {
    contract: "zones-vecteur-natif-capture-manifest/v1",
    spec: "docs/spec/SPEC_QA_GATE_VECTEUR_NATIF.md@1a0e86d7",
    generated_from: { reports: reportsArg ?? null, direct: directArg ?? null },
    total: cities.length,
    errors,
    cities,
  };
  writeFileSync(resolve(ROOT, out), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stderr.write(`[manifest] ${cities.length} villes, ${errors.length} erreurs -> ${out}\n`);
  for (const e of errors) process.stderr.write(`  ERR ${e.slug}: ${e.reason}\n`);
}

main().catch((e) => { process.stderr.write(`${(e as Error).stack ?? String(e)}\n`); process.exit(1); });
